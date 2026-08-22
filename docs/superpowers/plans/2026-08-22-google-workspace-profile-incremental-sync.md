# Google Workspace Profile Views, ACT Deduplication, and Continuous Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present approved Google conversations, files, Calendar events, and profile suggestions inside owner and Office Coordinator profiles; connect duplicate ACT email history without deleting provenance; and keep Gmail, Calendar, and linked Drive files continuously synchronized after the historical backfill.

**Architecture:** Add a shared profile projection service over the durable Google archive and existing content links, with separate owner and Office route mounts and no manager mount. Add exact ACT↔Gmail provenance links so richer Gmail threads replace duplicate-looking ACT email rows in presentation while both sources remain stored. Persist Gmail history and Calendar sync checkpoints per connection/source; incremental workers consume changes in bounded restart-safe batches and fall back to a visible repair/full-resync state when Google invalidates a cursor. Rollout is controlled through explicit feature switches and a bounded recent-history validation gate before continuous sync is enabled.

**Tech Stack:** TypeScript, Express 5, PostgreSQL/Drizzle, `googleapis`, Google Cloud private object storage, Zod, React/Vite/Wouter, TanStack Query, Vitest, PGlite, Supertest.

**Spec:** `docs/superpowers/specs/2026-08-22-google-workspace-crm-sync-design.md`

**Depends on:**
- `docs/superpowers/plans/2026-08-22-google-workspace-connection-scope.md`
- `docs/superpowers/plans/2026-08-22-google-workspace-gmail-files-backfill.md`
- `docs/superpowers/plans/2026-08-22-google-workspace-calendar-sync.md`
- `docs/superpowers/plans/2026-08-22-google-workspace-matching-ai-review.md`

## Global Constraints

- Profile presentation is profile-first; users should not need to understand which import pipeline supplied an item.
- Each profile has Conversations, Files, Calendar, and Suggested Updates views.
- Full Gmail threads stay intact and are stored once even when linked to an organization and booking.
- Files are stored once and may have multiple profile/contact/booking/source associations.
- Google Calendar source identity remains visible.
- ACT history remains read-only and is never deleted to remove duplicate presentation.
- A Gmail↔ACT link is automatic only with exact, unique, agreeing evidence; otherwise it is a review candidate.
- Gmail and Calendar remain read-only.
- Source deletion/unavailability does not delete durable CRM content or file copies.
- Incremental sync runs only after a successful historical backfill and saved source checkpoint.
- An invalid Gmail history ID or Calendar sync token creates visible repair work and triggers a bounded source rescan; it never silently skips changes.
- One source failure cannot stop another source or the API server.
- Owner and Office Coordinator may read approved business profile data and suggestions.
- Leg managers see no email, file, note, Google event metadata, sync state, or Google-derived profile suggestions.
- `GOOGLE_WORKSPACE_SYNC_ENABLED` defaults to `false` and gates background incremental work.
- `GOOGLE_WORKSPACE_AI_ENABLED` remains independently controlled and defaults to `false`.
- No Google content mutation is introduced in this plan.

---

### Task 1: Add incremental checkpoints, ACT links, and rollout state schema

**Files:**
- Create: `lib/db/src/google-workspace-incremental-schema.ts`
- Create: `lib/db/migrations/20260822_google_workspace_incremental_and_act_links.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Modify: `artifacts/api-server/src/db/google-workspace-startup-migration.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/google-incremental-schema-contract.test.ts`

**Tables:**

```text
google_workspace_source_checkpoints
  id uuid PK
  connection_id uuid NOT NULL -> connections ON DELETE CASCADE
  source_type text NOT NULL CHECK gmail_history|calendar_sync|drive_file
  source_key text NOT NULL
  cursor_value text
  cursor_observed_at timestamptz
  state text NOT NULL CHECK ready|repair_required|reauthorization_required|disabled
  last_success_at timestamptz
  last_attempt_at timestamptz
  last_error_code text
  created_at / updated_at
  UNIQUE(connection_id,source_type,source_key)

google_workspace_act_history_links
  id uuid PK
  thread_id uuid NOT NULL -> gmail_threads ON DELETE CASCADE
  message_id uuid -> gmail_messages ON DELETE CASCADE
  activity_id uuid NOT NULL -> activities ON DELETE RESTRICT
  origin text NOT NULL CHECK deterministic|review
  evidence jsonb NOT NULL CHECK array
  confidence text NOT NULL CHECK high|medium
  created_by text NOT NULL
  created_at / updated_at
  UNIQUE(thread_id,activity_id)
  UNIQUE(message_id,activity_id) WHERE message_id IS NOT NULL

google_workspace_rollout_state
  connection_id uuid PK -> connections ON DELETE CASCADE
  validation_status text NOT NULL CHECK not_started|running|ready_for_review|approved|rejected
  validation_thread_limit integer NOT NULL default 500 CHECK > 0
  validation_calendar_limit integer NOT NULL default 250 CHECK > 0
  validation_run_id uuid -> sync_runs
  full_backfill_approved_at timestamptz
  continuous_sync_enabled_at timestamptz
  approved_by text
  created_at / updated_at
```

Add a presentation index/view for the latest Google thread analysis and content links per organization. Do not denormalize message bodies into profile rows.

- [ ] **Step 1: Write schema contract tests**

Assert source checkpoint uniqueness, allowed source/state combinations, ACT activity foreign-key protection, message/thread consistency enforced in repository code, exact rollout status values, positive validation limits, and no cascade deletion from an ACT activity to imported Google data.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/incremental/google-incremental-schema-contract.test.ts
```

- [ ] **Step 3: Implement SQL, Drizzle exports, and startup DDL**

Add indexes for repair-required checkpoints, last-success monitoring, ACT activity lookup, and validation state. Required startup DDL remains limited to Google Workspace tables.

- [ ] **Step 4: Run/typecheck and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/incremental/google-incremental-schema-contract.test.ts
pnpm run typecheck
git add lib/db/src/google-workspace-incremental-schema.ts lib/db/migrations/20260822_google_workspace_incremental_and_act_links.sql lib/db/src/index.ts lib/db/src/schema/index.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/db/google-workspace-startup-migration.ts artifacts/api-server/src/features/google-workspace/incremental/google-incremental-schema-contract.test.ts
git commit -m "feat: add Google incremental and ACT link schema"
```

---

### Task 2: Build one shared profile projection service

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/profile/google-profile-view-types.ts`
- Create: `artifacts/api-server/src/features/google-workspace/profile/google-profile-view-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/profile/google-profile-view-service.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/profile/google-thread-detail-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/profile/google-thread-detail-service.pglite.test.ts`

**Interfaces:**

```ts
export type GoogleProfileOverview = {
  organizationId: string;
  counts: {
    conversations: number;
    files: number;
    calendarEvents: number;
    pendingSuggestions: number;
  };
};

export type GoogleProfileConversation = {
  id: string;
  subject: string | null;
  participants: Array<{ name: string | null; address: string }>;
  firstMessageAt: string | null;
  latestMessageAt: string | null;
  direction: "incoming" | "outgoing" | "mixed";
  category: string | null;
  tags: string[];
  summary: string | null;
  fileCount: number;
  bookingLinks: Array<{ id: string; name: string }>;
  originalGmailUrl: string;
  alsoRecordedInAct: boolean;
};

export type GoogleProfileFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  currentVersionId: string;
  versionCount: number;
  sourceKind: "gmail_attachment" | "drive_file";
  sourceDate: string | null;
  originalUrl: string | null;
  availability: "available" | "file_unavailable" | "retry_required";
};

export type GoogleProfileCalendarEvent = {
  id: string;
  title: string;
  sourceCalendar: string;
  status: "confirmed" | "tentative" | "cancelled";
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startsOn: string | null;
  endsOn: string | null;
  location: string | null;
  bookingId: string | null;
  originalGoogleUrl: string | null;
};

export type GoogleProfileSuggestion = {
  id: string;
  targetType: "organization" | "contact" | "booking";
  targetId: string;
  field: string;
  currentValue: string | null;
  suggestedValue: string;
  confidence: "high" | "medium" | "low";
  rationale: string;
  evidenceExcerpt: string;
  sourceType: "thread" | "file" | "calendar_event";
  sourceId: string;
  status: "pending" | "accepted" | "rejected" | "stale";
};

export class GoogleProfileViewService {
  overview(organizationId: string): Promise<GoogleProfileOverview>;
  conversations(input: { organizationId: string; page: number; pageSize: number }): Promise<GoogleProfileConversation[]>;
  files(input: { organizationId: string; page: number; pageSize: number }): Promise<GoogleProfileFile[]>;
  calendar(input: { organizationId: string; from?: Date; to?: Date }): Promise<GoogleProfileCalendarEvent[]>;
  suggestions(input: { organizationId: string; status?: "pending" | "accepted" | "rejected" | "stale" }): Promise<GoogleProfileSuggestion[]>;
}
```

- [ ] **Step 1: Write projection tests**

Seed one thread linked to organization and booking, one file with two source references, one Calendar event, one pending suggestion, and one unrelated organization. Prove no cross-profile leakage, no duplicated thread/file rows, newest-first conversations, current file version selection, cancelled Calendar visibility on profile, and ACT link projection.

- [ ] **Step 2: Write thread-detail tests**

Thread detail returns messages chronologically, message direction, readable bodies, attachment links, Gmail source link, ACT provenance marker, and no credential/scope fields.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/profile/google-profile-view-service.pglite.test.ts src/features/google-workspace/profile/google-thread-detail-service.pglite.test.ts
```

- [ ] **Step 4: Implement bounded queries**

Use content links rather than names to select records. Files linked through thread/booking as well as direct organization links should appear once. Paginate conversations/files and cap thread detail message count per page.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/profile
git add artifacts/api-server/src/features/google-workspace/profile
git commit -m "feat: project Google data onto CRM profiles"
```

---

### Task 3: Add owner and Office profile-data APIs with signed file access

**Files:**
- Create: `artifacts/api-server/src/routes/google-workspace-profiles.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-profiles.test.ts`
- Create: `artifacts/api-server/src/routes/office-google-workspace-profiles.ts`
- Create: `artifacts/api-server/src/routes/office-google-workspace-profiles.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Owner routes:**

```text
GET /google-workspace/profiles/:organizationId/overview
GET /google-workspace/profiles/:organizationId/conversations?page=1&pageSize=25
GET /google-workspace/profiles/:organizationId/files?page=1&pageSize=25
GET /google-workspace/profiles/:organizationId/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
GET /google-workspace/profiles/:organizationId/suggestions?status=pending
GET /google-workspace/threads/:threadId
GET /google-workspace/files/:fileId/url
```

**Office routes:**

```text
GET /office/google-workspace/profiles/:organizationId/overview
GET /office/google-workspace/profiles/:organizationId/conversations?page=1&pageSize=25
GET /office/google-workspace/profiles/:organizationId/files?page=1&pageSize=25
GET /office/google-workspace/profiles/:organizationId/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
GET /office/google-workspace/profiles/:organizationId/suggestions?status=pending
GET /office/google-workspace/threads/:threadId
GET /office/google-workspace/files/:fileId/url
```

- [ ] **Step 1: Write route tests**

Owner and Office may access only organization-linked approved business items. Unknown organization/source IDs return 404. Cross-profile thread/file IDs return 404 rather than revealing existence. Signed URL TTL is 900 seconds. Office receives no connection, OAuth, scope, or token fields.

- [ ] **Step 2: Write manager-exclusion tests**

Use a valid leg-manager token against every route family and assert 401/404. Verify no `/manager/google-workspace/*` route exists.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/google-workspace-profiles.test.ts src/routes/office-google-workspace-profiles.test.ts
```

- [ ] **Step 4: Implement one service with separate auth mounts**

Mount Office routes before owner middleware with `createRequireOfficeMiddleware`. Mount owner routes after `requireOwnerMiddleware`. Use the existing private-object-storage signed URL adapter and never proxy raw storage credentials.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/google-workspace-profiles.test.ts src/routes/office-google-workspace-profiles.test.ts
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/routes/google-workspace-profiles* artifacts/api-server/src/routes/office-google-workspace-profiles* artifacts/api-server/src/routes/index.ts
git commit -m "feat: add owner and Office Google profile APIs"
```

---

### Task 4: Add Emails & Files tabs to owner and Office profiles

**Files:**
- Create: `artifacts/adventure-zone/src/features/google-workspace/google-profile-client.ts`
- Create: `artifacts/adventure-zone/src/features/google-workspace/google-profile-client.test.ts`
- Create: `artifacts/adventure-zone/src/components/google-workspace/profile-google-workspace-panel.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/profile-google-workspace-panel.test.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-conversation-list.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-conversation-list.test.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-thread-detail.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-thread-detail.test.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-profile-file-list.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-profile-file-list.test.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-profile-calendar-list.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-profile-calendar-list.test.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-profile-suggestion-list.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-profile-suggestion-list.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OfficeProfilePage.tsx`

**Tabs:**

```text
Conversations
Files
Calendar
Suggested Updates
```

- [ ] **Step 1: Write owner-panel tests**

Prove counts render before tab fetches, conversations paginate, thread detail opens without navigating away, original Gmail links are explicit, ACT duplicate marker reads `Also recorded in ACT`, file download requests a signed URL only on click, Calendar source is visible, and accepted/rejected/stale suggestions are visually distinct.

- [ ] **Step 2: Write Office-panel tests**

Office panel uses Office API helpers, permits factual suggestion review through the review client, and has no Google setup/disconnect/sync controls. Existing Office profile safe fields and current notes behavior remain unchanged.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-workspace/google-profile-client.test.ts src/components/google-workspace/profile-google-workspace-panel.test.tsx src/components/google-workspace/google-conversation-list.test.tsx src/components/google-workspace/google-thread-detail.test.tsx src/components/google-workspace/google-profile-file-list.test.tsx src/components/google-workspace/google-profile-calendar-list.test.tsx src/components/google-workspace/google-profile-suggestion-list.test.tsx
```

- [ ] **Step 4: Implement one presentational panel with owner/Office client adapters**

Do not duplicate UI logic between profiles. Pass an adapter implementing `overview`, `conversations`, `thread`, `files`, `fileUrl`, `calendar`, `suggestions`, `acceptSuggestion`, and `rejectSuggestion`.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-workspace src/components/google-workspace src/pages/EventProfilePage.test.tsx src/pages/OfficeProfilePage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
git add artifacts/adventure-zone/src/features/google-workspace artifacts/adventure-zone/src/components/google-workspace artifacts/adventure-zone/src/pages/EventProfilePage.tsx artifacts/adventure-zone/src/pages/OfficeProfilePage.tsx
git commit -m "feat: add Emails and Files to CRM profiles"
```

---

### Task 5: Link exact Gmail messages to duplicate ACT email history

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/act-dedupe/act-email-history-fingerprint.ts`
- Create: `artifacts/api-server/src/features/google-workspace/act-dedupe/act-email-history-fingerprint.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/act-dedupe/act-gmail-link-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/act-dedupe/act-gmail-link-repository.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/act-dedupe/act-gmail-dedupe-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/act-dedupe/act-gmail-dedupe-service.pglite.test.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-timeline-view.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-timeline-view.test.ts`

**Interfaces:**

```ts
export type ActGmailEvidence =
  | { code: "exact_internet_message_id"; value: string }
  | { code: "exact_subject_body_business_date_unique"; value: string }
  | { code: "exact_subject_business_date_participant_profile_unique"; value: string };

export type ActGmailDedupeDecision =
  | { kind: "linked"; activityId: string; threadId: string; messageId: string | null; evidence: ActGmailEvidence[] }
  | { kind: "review"; activityId: string; candidates: Array<{ threadId: string; messageId: string | null; evidence: ActGmailEvidence[] }> }
  | { kind: "none" };

export class ActGmailDedupeService {
  reconcileActivity(activityId: string): Promise<ActGmailDedupeDecision>;
}
```

- [ ] **Step 1: Write fingerprint and matching tests**

Automatic linking cases:

1. Exact Internet Message-ID preserved in ACT content/provenance and one Gmail message.
2. Exact normalized subject, exact normalized body, same business date, one Gmail message, and agreeing organization link.
3. Exact subject, same business date, exact participant email, one Gmail thread, and agreeing profile.

Review cases:

- two Gmail messages share the exact subject/date;
- body differs materially;
- organization links disagree;
- only fuzzy phrase similarity exists.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/act-dedupe/act-email-history-fingerprint.test.ts src/features/google-workspace/act-dedupe/act-gmail-link-repository.pglite.test.ts src/features/google-workspace/act-dedupe/act-gmail-dedupe-service.pglite.test.ts src/features/activities/activity-timeline-view.test.ts
```

- [ ] **Step 3: Implement preservation-first linkage**

Insert a provenance link; never update/delete ACT `activities` content. In the timeline projection, mark linked ACT rows as represented by Gmail and omit the duplicate-looking standalone row from the default list. A `Show source history` option may still reveal it.

- [ ] **Step 4: Add unresolved dedupe candidates to Google review**

Create `ambiguous_match` review items with source type `thread` and evidence referring to the ACT activity. Manual review inserts a link with `origin='review'`.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/act-dedupe src/features/activities/activity-timeline-view.test.ts
git add artifacts/api-server/src/features/google-workspace/act-dedupe artifacts/api-server/src/features/activities/activity-timeline-view*
git commit -m "feat: link Gmail conversations to ACT email history"
```

---

### Task 6: Implement Gmail incremental history with repair fallback

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/gmail/gmail-source-client.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/gmail/gmail-source-client.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/google-checkpoint-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/google-checkpoint-repository.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/gmail-history-sync-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/gmail-history-sync-service.test.ts`

**Interfaces:**

```ts
export interface GmailSourceClient {
  // existing methods
  listHistory(input: {
    startHistoryId: string;
    pageToken?: string;
    maxResults: number;
  }): Promise<{
    historyId: string;
    messageIds: string[];
    deletedMessageIds: string[];
    nextPageToken: string | null;
  }>;
}

export type IncrementalSyncResult =
  | { kind: "progress"; discovered: number; newHistoryId: string }
  | { kind: "idle"; historyId: string }
  | { kind: "repair_required"; errorCode: "GMAIL_HISTORY_CURSOR_INVALID" }
  | { kind: "reauthorization_required" };

export class GmailHistorySyncService {
  runPage(input: { connectionId: string; maxResults: number }): Promise<IncrementalSyncResult>;
}
```

- [ ] **Step 1: Write checkpoint transaction tests**

A new history ID is committed only after all page message IDs are durably enqueued. A crash/retry re-enqueues idempotently. Deleted source IDs mark `source_available=false` without deleting thread/message/file rows.

- [ ] **Step 2: Write invalid-cursor tests**

Google 404/invalid start history maps to `repair_required`, preserves the old checkpoint and archive, and creates one `repair` sync run for selected Gmail labels. Successful repair writes the latest profile history ID and returns checkpoint state to `ready`.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/incremental/google-checkpoint-repository.pglite.test.ts src/features/google-workspace/incremental/gmail-history-sync-service.test.ts src/features/google-workspace/gmail/gmail-source-client.test.ts
```

- [ ] **Step 4: Implement scope-aware change handling**

Fetch metadata first for changed messages. If no approved selected label/thread relationship remains, retain the existing durable business archive but set current scope evidence inactive and do not send updated content to AI. Newly approved-scope messages enter normal thread import/match/analysis stages.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/incremental/google-checkpoint-repository.pglite.test.ts src/features/google-workspace/incremental/gmail-history-sync-service.test.ts src/features/google-workspace/gmail/gmail-source-client.test.ts
git add artifacts/api-server/src/features/google-workspace/incremental artifacts/api-server/src/features/google-workspace/gmail/gmail-source-client*
git commit -m "feat: sync Gmail changes with repair fallback"
```

---

### Task 7: Implement Calendar incremental sync-token handling

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/calendar-source-client.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/calendar/calendar-source-client.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/calendar-incremental-sync-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/calendar-incremental-sync-service.test.ts`

**Interfaces:**

```ts
export interface CalendarSourceClient {
  // existing full-list method
  listChanges(input: {
    calendarId: string;
    syncToken: string;
    pageToken?: string;
    maxResults: number;
  }): Promise<{
    events: GoogleCalendarEventResource[];
    nextPageToken: string | null;
    nextSyncToken: string | null;
  }>;
}

export class CalendarIncrementalSyncService {
  runPage(input: {
    connectionId: string;
    calendarScopeId: string;
    maxResults: number;
  }): Promise<IncrementalSyncResult>;
}
```

- [ ] **Step 1: Write token/checkpoint tests**

Each selected calendar has its own checkpoint keyed by exact calendar ID. `nextSyncToken` is saved only after all events from the page are archived/enqueued. Updates modify the same source row, cancelled events remain auditable, and the four calendars never share tokens.

- [ ] **Step 2: Write invalid-token tests**

Google 410 maps to `repair_required`, creates one full calendar repair run for that calendar only, preserves current CRM links, and replaces the checkpoint only after the repair completes.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/incremental/calendar-incremental-sync-service.test.ts src/features/google-workspace/calendar/calendar-source-client.test.ts
```

- [ ] **Step 4: Implement and rematch changed events**

Every changed event returns through normalize → archive → deterministic match → review/suggestions. If dates/location now conflict with an existing booking link, retain the prior link, set event state `conflict`, and create a review item; do not change the booking automatically.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/incremental/calendar-incremental-sync-service.test.ts src/features/google-workspace/calendar/calendar-source-client.test.ts
git add artifacts/api-server/src/features/google-workspace/incremental/calendar-incremental-sync-service* artifacts/api-server/src/features/google-workspace/calendar/calendar-source-client*
git commit -m "feat: sync Google Calendar changes safely"
```

---

### Task 8: Refresh known Drive-linked files without broad Drive crawling

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/incremental/drive-file-refresh-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/drive-file-refresh-service.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/files/google-file-copy-service.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/files/google-file-copy-service.test.ts`

**Interfaces:**

```ts
export class DriveFileRefreshService {
  refreshBatch(input: {
    connectionId: string;
    afterSourceId?: string;
    limit: number;
  }): Promise<{
    checked: number;
    unchanged: number;
    versioned: number;
    unavailable: number;
    nextSourceId: string | null;
  }>;
}
```

- [ ] **Step 1: Write refresh tests**

Check only Drive source IDs already discovered through approved Gmail/Calendar content. Same modified time and checksum do nothing. Changed bytes create a new immutable version. Access removed marks source unavailable while old private versions remain downloadable. Temporary errors remain retryable.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/incremental/drive-file-refresh-service.test.ts src/features/google-workspace/files/google-file-copy-service.test.ts
```

- [ ] **Step 3: Implement bounded stable pagination**

Order by source row ID and persist the last checked ID/check time. Do not call Drive `files.list` across the company account; Release 1 only follows approved discovered links.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/incremental/drive-file-refresh-service.test.ts src/features/google-workspace/files/google-file-copy-service.test.ts
git add artifacts/api-server/src/features/google-workspace/incremental/drive-file-refresh-service* artifacts/api-server/src/features/google-workspace/files/google-file-copy-service*
git commit -m "feat: version changed linked Drive files"
```

---

### Task 9: Add the continuous-sync runtime, monitoring, and repair APIs

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/incremental/google-incremental-worker.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/google-incremental-worker.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/google-incremental-worker-loop.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/google-incremental-worker-loop.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/google-workspace-feature-flags.ts`
- Create: `artifacts/api-server/src/features/google-workspace/incremental/google-workspace-feature-flags.test.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-incremental.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-incremental.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/index.ts`

**Owner routes:**

```text
GET  /google-workspace/incremental/status
POST /google-workspace/incremental/enable
POST /google-workspace/incremental/disable
POST /google-workspace/incremental/repair/:checkpointId
POST /google-workspace/validation/start
POST /google-workspace/validation/approve
POST /google-workspace/validation/reject
```

**Flags:**

```ts
export type GoogleWorkspaceFeatureFlags = {
  syncEnabled: boolean;
  aiEnabled: boolean;
};

export function getGoogleWorkspaceFeatureFlags(
  env?: Record<string, string | undefined>,
): GoogleWorkspaceFeatureFlags;
```

Only exact case-insensitive `true` enables a flag.

- [ ] **Step 1: Write worker scheduling tests**

When disabled, the runtime makes no Google calls. When enabled and eligible, process Gmail history, one Calendar page per selected calendar, and one bounded Drive refresh batch. Progress reschedules immediately; idle waits five minutes. One source failure records its checkpoint error and does not skip other sources.

- [ ] **Step 2: Write validation-gate tests**

`validation/start` creates a bounded newest-first run limited to 500 Gmail threads and 250 Calendar events. It ends `ready_for_review` rather than starting full backfill automatically. `approve` records the owner decision and enables the existing full-backfill controls. `reject` pauses further Google processing but preserves the preview/archive for diagnosis.

- [ ] **Step 3: Write route/security tests**

Only owner may enable/disable continuous sync or start/approve validation. Office can see profile content and review work but not rollout toggles. Leg-manager token fails. Enabling requires connected status, approved scope, completed full historical backfill, and no unresolved reauthorization state.

- [ ] **Step 4: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/incremental/google-workspace-feature-flags.test.ts src/features/google-workspace/incremental/google-incremental-worker.test.ts src/features/google-workspace/incremental/google-incremental-worker-loop.test.ts src/routes/google-workspace-incremental.test.ts
```

- [ ] **Step 5: Implement runtime and shutdown integration**

Start the loop after required schemas and the application server are ready. Use a dedicated worker ID and durable checkpoints. Add `close()` to application shutdown. Do not couple it to ACT background-worker flags.

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/incremental src/routes/google-workspace-incremental.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
git add artifacts/api-server/src/features/google-workspace/incremental artifacts/api-server/src/routes/google-workspace-incremental* artifacts/api-server/src/routes/index.ts artifacts/api-server/src/index.ts
git commit -m "feat: run monitored continuous Google sync"
```

---

### Task 10: Add rollout, checkpoint, and reconnect UI

**Files:**
- Modify: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-rollout-controls.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-rollout-controls.test.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-checkpoint-status.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-checkpoint-status.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.test.tsx`

- [ ] **Step 1: Write UI tests**

Prove the page guides the owner through:

```text
1. Connect Google
2. Approve business scope
3. Validate recent history
4. Continue full historical backfill
5. Enable continuous sync
```

Show Gmail, each of four Calendar checkpoints, and Drive refresh separately with last success/error. Reauthorization state shows `Reconnect Google` and never displays a token. Invalid cursor shows `Repair required` with a bounded repair action.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace/google-rollout-controls.test.tsx src/components/google-workspace/google-checkpoint-status.test.tsx src/pages/SettingsGoogleWorkspacePage.test.tsx
```

- [ ] **Step 3: Implement explicit owner-controlled progression**

Do not automatically enable continuous sync after backfill. Show exact validation sample counts and owner approval timestamp. Disabling continuous sync stops future Google calls but leaves all archived profile data visible.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace src/pages/SettingsGoogleWorkspacePage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
git add artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts artifacts/adventure-zone/src/components/google-workspace artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage*
git commit -m "feat: add Google sync rollout and monitoring UI"
```

---

### Task 11: Add full release E2E, privacy, and failure-recovery gates

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-workspace-release.e2e.pglite.test.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-role-boundary.e2e.test.ts`
- Modify: `.github/workflows/google-workspace-sync-ci.yml`
- Modify: `docs/operations/google-workspace-readonly-setup.md`

- [ ] **Step 1: Build the complete E2E fixture**

Seed:

- approved and personal Gmail labels;
- Inbox/Sent thread with an attachment;
- employee, receipt, and association threads;
- four Calendar sources with linked and unlinked events;
- exact and ambiguous CRM matches;
- AI available and unavailable runs;
- profile suggestions including one stale target;
- exact and ambiguous ACT email-history candidates;
- Gmail invalid history cursor;
- one Calendar invalid sync token;
- changed and inaccessible Drive files;
- owner, Office, and leg-manager credentials.

Run recent validation, full backfill, matching/analysis, continuous sync, source repair, and a second complete replay.

- [ ] **Step 2: Assert final visible-state reconciliation**

```ts
expect(totalGoogleSources()).toBe(
  connectedAutomatically()
  + connectedByReview()
  + internalFiling()
  + awaitingProfileMatch()
  + awaitingFactReview()
  + fileUnavailable()
  + ignoredOutOfScope()
  + retryRequired(),
);
expect(hiddenUnclassifiedCount()).toBe(0);
```

Also assert no personal body persisted, no duplicate source/message/file/event/link/suggestion rows, no automatic AI-only links, no CRM overwrite without accepted suggestion, and old file versions remain after Drive change.

- [ ] **Step 3: Assert role and Google mutation boundaries**

Owner has setup/sync/review/profile access. Office has approved business review/profile access but no setup/toggles/secrets. Leg manager has no Google/notes/files access. Fake Google clients record zero send/modify/delete calls.

- [ ] **Step 4: Run complete release verification**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace src/routes/google-workspace-*.test.ts src/routes/office-google-workspace-*.test.ts src/routes/google-workspace-role-boundary.e2e.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-workspace src/components/google-workspace src/pages/SettingsGoogleWorkspacePage.test.tsx src/pages/GoogleWorkspaceReviewPage.test.tsx src/pages/OfficeGoogleWorkspaceReviewPage.test.tsx src/pages/EventProfilePage.test.tsx src/pages/OfficeProfilePage.test.tsx src/pages/SchedulePage.test.tsx
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: all commands exit 0.

- [ ] **Step 5: Update operations documentation and commit**

Document rollout flags, recent validation, full backfill approval, continuous sync enabling, reconnect, cursor repair, disabling without data loss, file bucket verification, AI enablement, and role spot checks.

```bash
git add artifacts/api-server/src/features/google-workspace/google-workspace-release.e2e.pglite.test.ts artifacts/api-server/src/routes/google-workspace-role-boundary.e2e.test.ts .github/workflows/google-workspace-sync-ci.yml docs/operations/google-workspace-readonly-setup.md
git commit -m "test: gate the Google Workspace read-only release"
```

## Phase Acceptance

- Owner and Office profiles show Conversations, Files, Calendar, and Suggested Updates with no duplicate archive rows.
- Gmail threads and files linked to organizations/bookings remain one durable source object.
- Exact Gmail↔ACT duplicates display as one primary Gmail conversation with `Also recorded in ACT`; ACT provenance remains stored/read-only.
- Ambiguous ACT dedupe remains reviewable.
- Gmail, all four Calendars, and known Drive-linked files continuously sync through durable independent checkpoints.
- Invalid source cursors create visible repair work and recover without deleting durable CRM data.
- Source deletion/unavailability marks source state without deleting CRM history or file versions.
- Recent validation, full backfill, and continuous sync require explicit owner progression.
- AI and sync feature switches are independent and default off.
- Owner has full control, Office has approved business profile/review access, and leg managers have zero Google/content access.
- Every source reconciles to one visible state and replay creates no duplicates.
- Gmail and Google Calendar remain unchanged.
