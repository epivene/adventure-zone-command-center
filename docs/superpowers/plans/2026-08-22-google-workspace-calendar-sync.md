# Google Workspace Calendar Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill the full history of the four approved Google Calendars, preserve source and recurrence identity, connect only exact high-confidence events to existing CRM records, and show nonduplicated Google events on profiles and the Command Center schedule.

**Architecture:** Add a normalized Calendar archive with one row per calendar/event/instance identity and explicit content links to organizations, contacts, and bookings. A restart-safe Calendar discovery/import worker reads only selected calendar IDs from Phase 1. A conservative deterministic matcher uses exact attendee/organizer emails and exact booking name/date/location agreement; ambiguous events remain `awaiting_match`. The existing `/calendar` route includes unlinked Google events and suppresses a separate Google card when the event is already linked to a booking returned by the schedule.

**Tech Stack:** TypeScript, Express, PostgreSQL/Drizzle, `googleapis`, Zod, React/Vite/Wouter, TanStack Query, Vitest, PGlite, Supertest.

**Spec:** `docs/superpowers/specs/2026-08-22-google-workspace-crm-sync-design.md`

**Depends on:**
- `docs/superpowers/plans/2026-08-22-google-workspace-connection-scope.md`
- `docs/superpowers/plans/2026-08-22-google-workspace-gmail-files-backfill.md`

## Global Constraints

- Read only the four selected calendar IDs saved in Phase 1.
- Preserve each source calendar independently; `zone.pirate.warrior@gmail.com` is not a duplicate/combined calendar.
- Never create, update, delete, accept, decline, or otherwise mutate a Google Calendar event.
- Preserve event ID, calendar ID, iCal UID, recurring master ID, original instance start, status, ETag, and Google update timestamp.
- Preserve all-day dates without converting them into midnight timestamps.
- A source calendar is useful evidence but never sufficient by itself to choose a profile/package.
- Automatic CRM links require deterministic, unique, nonconflicting evidence.
- Do not create a new booking in this phase.
- A Google event linked to an existing booking must not appear as a second independent schedule card.
- Cancelled/deleted Google events remain auditable and do not delete CRM bookings.
- Owner and Office Coordinator may read approved Calendar data.
- Only owner may start/pause/resume Calendar backfill.
- Leg managers receive no Google event metadata or endpoints.
- AI is not used in this phase.

---

### Task 1: Add Calendar archive and cross-content link schema

**Files:**
- Create: `lib/db/src/google-workspace-calendar-schema.ts`
- Create: `lib/db/migrations/20260822_google_workspace_calendar_archive.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Modify: `artifacts/api-server/src/db/google-workspace-startup-migration.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/calendar-schema-contract.test.ts`

**Tables:**

```text
google_workspace_calendar_events
  id uuid PK
  connection_id uuid NOT NULL -> connections
  calendar_scope_id uuid NOT NULL -> calendar_scopes
  google_calendar_id text NOT NULL
  google_event_id text NOT NULL
  i_cal_uid text
  recurring_event_id text
  original_start_key text
  etag text
  status text CHECK confirmed|tentative|cancelled
  title text NOT NULL
  description_text text
  location_text text
  organizer_email text
  organizer_name text
  attendees jsonb NOT NULL default '[]'
  all_day boolean NOT NULL
  starts_at timestamptz
  ends_at timestamptz
  starts_on date
  ends_on date
  source_time_zone text
  recurrence jsonb NOT NULL default '[]'
  source_created_at / source_updated_at timestamptz
  original_google_url text
  source_available boolean NOT NULL default true
  match_state text CHECK unprocessed|connected|awaiting_match|conflict|internal_only
  created_at / updated_at
  UNIQUE(connection_id,google_calendar_id,google_event_id,coalesce(original_start_key,''))

google_workspace_content_links
  id uuid PK
  thread_id uuid -> gmail_threads ON DELETE CASCADE
  file_id uuid -> files ON DELETE CASCADE
  calendar_event_id uuid -> calendar_events ON DELETE CASCADE
  target_type text CHECK organization|contact|booking
  target_id uuid NOT NULL
  origin text CHECK deterministic|review
  confidence text CHECK high|medium
  evidence jsonb NOT NULL
  created_by text NOT NULL
  created_at / updated_at
  CHECK num_nonnulls(thread_id,file_id,calendar_event_id)=1
  UNIQUE(source identity,target_type,target_id)
```

Because `target_id` is polymorphic, repository code must verify the referenced table before insertion; do not add an unenforceable foreign key to one table.

- [ ] **Step 1: Write schema tests**

Prove all-day/timed mutual consistency:

```sql
CHECK (
  (all_day AND starts_on IS NOT NULL AND ends_on IS NOT NULL AND starts_at IS NULL AND ends_at IS NULL)
  OR
  (NOT all_day AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND starts_on IS NULL AND ends_on IS NULL)
)
```

Also prove exactly one source per content link, Calendar identity uniqueness, JSON array checks, and allowed match/status values.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/calendar/calendar-schema-contract.test.ts
```

- [ ] **Step 3: Implement SQL, Drizzle, exports, startup DDL**

Add indexes for selected calendar/date, `(match_state,source_updated_at desc)`, booking links, organization links, contact links, and recurring master/instance lookup.

- [ ] **Step 4: Run/typecheck and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/calendar/calendar-schema-contract.test.ts
pnpm run typecheck
git add lib/db/src/google-workspace-calendar-schema.ts lib/db/migrations/20260822_google_workspace_calendar_archive.sql lib/db/src/index.ts lib/db/src/schema/index.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/db/google-workspace-startup-migration.ts artifacts/api-server/src/features/google-workspace/calendar/calendar-schema-contract.test.ts
git commit -m "feat: add Google Calendar archive schema"
```

---

### Task 2: Add typed Calendar source adapter and event normalizer

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/calendar/calendar-source-client.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/calendar-source-client.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/calendar-event-normalizer.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/calendar-event-normalizer.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`

**Interfaces:**

```ts
export interface CalendarSourceClient {
  listEvents(input: {
    calendarId: string;
    pageToken?: string;
    maxResults: number;
    showDeleted: true;
    singleEvents: true;
  }): Promise<{ events: GoogleCalendarEventResource[]; nextPageToken: string | null }>;
}

export type NormalizedGoogleCalendarEvent = {
  googleEventId: string;
  iCalUid: string | null;
  recurringEventId: string | null;
  originalStartKey: string | null;
  etag: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  title: string;
  descriptionText: string | null;
  locationText: string | null;
  organizer: { name: string | null; email: string } | null;
  attendees: Array<{ name: string | null; email: string; responseStatus: string | null }>;
  time: { kind: "all_day"; startsOn: string; endsOn: string }
    | { kind: "timed"; startsAt: Date; endsAt: Date; timeZone: string | null };
  recurrence: string[];
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  originalGoogleUrl: string | null;
};

export function normalizeGoogleCalendarEvent(
  raw: GoogleCalendarEventResource,
): NormalizedGoogleCalendarEvent;
```

- [ ] **Step 1: Write normalization fixtures**

Cover timed events, all-day exclusive end dates, cancelled events, recurring instances, missing title, organizer/attendee normalization, HTML descriptions converted to safe text, and date-time offsets.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/calendar/calendar-source-client.test.ts src/features/google-workspace/calendar/calendar-event-normalizer.test.ts
```

- [ ] **Step 3: Implement read-only adapter and normalizer**

Use `showDeleted: true` and `singleEvents: true`. Default missing titles to `Untitled Google Calendar event`. Do not infer an end time when Google omits required time fields; return a typed normalization error and queue review/retry rather than inventing it.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/calendar/calendar-source-client.test.ts src/features/google-workspace/calendar/calendar-event-normalizer.test.ts
git add artifacts/api-server/src/features/google-workspace/calendar/calendar-source-client* artifacts/api-server/src/features/google-workspace/calendar/calendar-event-normalizer* artifacts/api-server/src/features/google-workspace/google-api-client.ts
git commit -m "feat: normalize read-only Google Calendar events"
```

---

### Task 3: Discover and import full Calendar history idempotently

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/calendar/calendar-archive-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/calendar-archive-repository.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/calendar-discovery-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/calendar-discovery-service.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/calendar-import-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/calendar-import-service.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/sync/google-sync-repository.ts`

**Interfaces:**

```ts
export type CalendarImportResult = {
  eventId: string;
  created: boolean;
  changed: boolean;
  cancelled: boolean;
};

export class CalendarDiscoveryService {
  discoverRun(runId: string): Promise<{ discovered: number; calendarCount: number }>;
}

export class CalendarImportService {
  importClaim(input: {
    connectionId: string;
    calendarScopeId: string;
    googleCalendarId: string;
    googleEventId: string;
    originalStartKey: string | null;
  }): Promise<CalendarImportResult>;
}
```

- [ ] **Step 1: Write repository/import tests**

Prove one row per event/instance, reimport changes the same row, source calendar remains stable, cancellation marks the source cancelled/available state without removing links, and repeated import creates no duplicate.

- [ ] **Step 2: Write discovery tests**

Only selected calendar IDs are called. The same iCal UID on two selected calendars remains two source events. Queue `sort_at` uses event start for upcoming/recent usefulness, falling back to source update date.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/calendar/calendar-archive-repository.pglite.test.ts src/features/google-workspace/calendar/calendar-discovery-service.test.ts src/features/google-workspace/calendar/calendar-import-service.test.ts
```

- [ ] **Step 4: Implement bounded discovery/import**

Use the existing sync run/item ledger with source kind `calendar_event`. Store raw source IDs in the claim payload; fetch and normalize full event content only while processing.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/calendar/calendar-archive-repository.pglite.test.ts src/features/google-workspace/calendar/calendar-discovery-service.test.ts src/features/google-workspace/calendar/calendar-import-service.test.ts
git add artifacts/api-server/src/features/google-workspace/calendar artifacts/api-server/src/features/google-workspace/sync/google-sync-repository.ts
git commit -m "feat: archive approved Google Calendar history"
```

---

### Task 4: Add conservative deterministic Calendar matching

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/matching/google-content-link-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/google-content-link-repository.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/calendar-exact-matcher.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/calendar-exact-matcher.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/normalized-business-evidence.ts`
- Create: `artifacts/api-server/src/features/google-workspace/matching/normalized-business-evidence.test.ts`

**Interfaces:**

```ts
export type DeterministicMatchEvidence = {
  code:
    | "exact_contact_email"
    | "exact_booking_name_date_venue"
    | "exact_booking_contact_date"
    | "existing_approved_link";
  value: string;
};

export type CalendarMatchDecision =
  | { kind: "connected"; targetType: "organization" | "contact" | "booking"; targetId: string; evidence: DeterministicMatchEvidence[] }
  | { kind: "awaiting_match"; candidates: Array<{ targetType: string; targetId: string; evidence: DeterministicMatchEvidence[] }> }
  | { kind: "conflict"; reason: string; candidates: Array<{ targetType: string; targetId: string }> };

export class CalendarExactMatcher {
  match(eventId: string): Promise<CalendarMatchDecision>;
}
```

- [ ] **Step 1: Write exact-evidence tests**

Cases:

1. One attendee email exactly matches one contact with one active organization membership: connect contact and organization.
2. Organizer email matches contacts in two organizations: awaiting match.
3. Event title, start/end business dates, venue, and city exactly match one existing booking: connect booking and organization.
4. Calendar source alone suggests Adventure Zone: remain awaiting match.
5. Date conflicts with an otherwise exact booking: conflict.
6. Generic Gmail/Yahoo domain without exact contact: no automatic organization link.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/matching/normalized-business-evidence.test.ts src/features/google-workspace/matching/calendar-exact-matcher.test.ts src/features/google-workspace/matching/google-content-link-repository.pglite.test.ts
```

- [ ] **Step 3: Implement unique-match thresholds**

Automatic booking matching requires all available core fields to agree: normalized event/booking name, start/end business dates, and venue/city when present. Do not use partial fuzzy string distance in this phase.

- [ ] **Step 4: Persist links and event match state transactionally**

Verify target existence, insert one or more valid links, set event `match_state='connected'`; otherwise persist `awaiting_match` or `conflict` without links.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/matching
git add artifacts/api-server/src/features/google-workspace/matching
git commit -m "feat: match Google Calendar events by exact CRM evidence"
```

---

### Task 5: Add Calendar backfill lifecycle and review APIs

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/sync/google-backfill-worker.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/sync/google-backfill-worker.test.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-calendar.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-calendar.test.ts`
- Create: `artifacts/api-server/src/routes/office-google-workspace-calendar.ts`
- Create: `artifacts/api-server/src/routes/office-google-workspace-calendar.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Owner routes:**

```text
POST /google-workspace/calendar/backfill/start
GET  /google-workspace/calendar/status
GET  /google-workspace/calendar/review?page=1&pageSize=50&state=awaiting_match|conflict
GET  /google-workspace/profiles/:organizationId/calendar
```

**Office route:**

```text
GET /office/google-workspace/profiles/:organizationId/calendar
```

Office route uses `createRequireOfficeMiddleware`; it returns approved business event data and links but no Google credential/scope configuration.

- [ ] **Step 1: Write worker and route tests**

Calendar source items route to `CalendarImportService` then `CalendarExactMatcher`. Owner can start/status/review. Office can read one profile Calendar list. Leg-manager token fails. Office cannot start, pause, scope, or disconnect.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/sync/google-backfill-worker.test.ts src/routes/google-workspace-calendar.test.ts src/routes/office-google-workspace-calendar.test.ts
```

- [ ] **Step 3: Implement shared read service and separate route mounts**

Mount Office route before owner middleware and owner route after it. Return no attendee email not already present in the business event source; do not project unrelated CRM notes.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/sync/google-backfill-worker.test.ts src/routes/google-workspace-calendar.test.ts src/routes/office-google-workspace-calendar.test.ts
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/features/google-workspace/sync/google-backfill-worker* artifacts/api-server/src/routes/google-workspace-calendar* artifacts/api-server/src/routes/office-google-workspace-calendar* artifacts/api-server/src/routes/index.ts
git commit -m "feat: expose Google Calendar backfill and profile data"
```

---

### Task 6: Integrate Google events into Schedule without duplicates

**Files:**
- Modify: `artifacts/api-server/src/routes/calendar.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/google-schedule-events.ts`
- Create: `artifacts/api-server/src/features/google-workspace/calendar/google-schedule-events.pglite.test.ts`
- Modify: `artifacts/api-server/src/routes/calendar.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/SchedulePage.tsx`
- Create: `artifacts/adventure-zone/src/features/calendar/google-calendar-source.test.ts`

**Schedule DTO:**

```ts
export type GoogleScheduleEvent = {
  source: "google_calendar";
  id: string;
  title: string;
  startsAt: string | null;
  endsAt: string | null;
  startsOn: string | null;
  endsOn: string | null;
  allDay: boolean;
  location: string | null;
  sourceCalendar: string;
  organizationId: string | null;
  bookingId: null;
  matchState: "awaiting_match" | "conflict";
};
```

Linked Google events are not emitted because the linked booking is already in `bookingEvents`. Unlinked/conflict events are emitted so the calendar remains complete.

- [ ] **Step 1: Write database and route tests**

Prove linked booking event returns one schedule entry (the booking), unlinked Google event returns one Google entry, cancelled event is excluded from normal schedule but visible in profile audit, all-day dates remain date-only, and date filters work.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/calendar/google-schedule-events.pglite.test.ts src/routes/calendar.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/calendar/google-calendar-source.test.ts
```

- [ ] **Step 3: Implement route merge and frontend source badge**

Use `Promise.all([getMapEvents, getActCalendarActivities, getGoogleScheduleEvents])`. Display `Google Calendar · <source calendar>` for unlinked Google events and a review-needed badge for conflicts.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/calendar/google-schedule-events.pglite.test.ts src/routes/calendar.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/calendar/google-calendar-source.test.ts src/pages/SchedulePage.test.tsx
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
git add artifacts/api-server/src/routes/calendar* artifacts/api-server/src/features/google-workspace/calendar/google-schedule-events* artifacts/adventure-zone/src/pages/SchedulePage.tsx artifacts/adventure-zone/src/features/calendar/google-calendar-source.test.ts
git commit -m "feat: show nonduplicate Google events on schedule"
```

---

### Task 7: Add Calendar progress and source visibility to Google settings

**Files:**
- Modify: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-calendar-progress.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-calendar-progress.test.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-calendar-review-list.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-calendar-review-list.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.test.tsx`

- [ ] **Step 1: Write UI tests**

Show separate progress for all four calendars, preserve source labels, display exact-evidence matches distinctly from conflicts, and never offer an edit-Google-event button.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace/google-calendar-progress.test.tsx src/components/google-workspace/google-calendar-review-list.test.tsx src/pages/SettingsGoogleWorkspacePage.test.tsx
```

- [ ] **Step 3: Implement read-only progress/review display**

Review list is informational in this phase; manual assignment arrives in the matching/review plan. Provide links to the existing CRM profile/booking candidate and original Google event.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace src/pages/SettingsGoogleWorkspacePage.test.tsx
pnpm --filter @workspace/adventure-zone build
git add artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts artifacts/adventure-zone/src/components/google-workspace artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage*
git commit -m "feat: show Google Calendar sync and conflicts"
```

---

### Task 8: Add Calendar E2E and security gates

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/calendar/calendar-backfill.e2e.pglite.test.ts`
- Modify: `.github/workflows/google-workspace-sync-ci.yml`

- [ ] **Step 1: Seed a four-calendar E2E fixture**

Include:

- one exact booking match;
- one exact contact/organization match;
- one ambiguous attendee event;
- one date conflict;
- one recurring instance;
- one cancelled event;
- the same iCal UID on two different calendars.

Run the Calendar backfill twice and assert no duplicate source events or content links.

- [ ] **Step 2: Add server-side access assertions**

Use Supertest with owner, Office, and leg-manager tokens. Owner gets all Calendar sync endpoints; Office gets profile Calendar read only; leg manager gets 401/404 everywhere.

- [ ] **Step 3: Run full phase verification**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/calendar src/features/google-workspace/matching src/routes/google-workspace-calendar.test.ts src/routes/office-google-workspace-calendar.test.ts src/routes/calendar.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace src/features/calendar/google-calendar-source.test.ts src/pages/SettingsGoogleWorkspacePage.test.tsx src/pages/SchedulePage.test.tsx
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/features/google-workspace/calendar/calendar-backfill.e2e.pglite.test.ts .github/workflows/google-workspace-sync-ci.yml
git commit -m "test: verify Calendar backfill matching and access"
```

## Phase Acceptance

- All four approved calendars are backfilled independently and restart-safely.
- All-day, timed, recurring, tentative, and cancelled source events retain correct identity and time semantics.
- Exact unique evidence can connect an event to an existing contact, organization, or booking.
- Ambiguous or conflicting events remain visible without guessed links.
- Linked booking events do not duplicate schedule entries.
- Unlinked/conflict Google events appear on Schedule with their source calendar.
- Owner and Office Coordinator can read profile-related Calendar items; leg managers cannot.
- Re-running Calendar backfill creates no duplicates and makes no Google mutations.
