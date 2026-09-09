# Durable Profile Email Archive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make profile email an app-owned, durable record that remains readable and replyable after the Gmail copy is deleted.

**Architecture:** Add an archive repository for CRM conversations/messages, reuse private profile-file storage for attachment bytes, and change profile email routes to read the archive first while using Gmail only to refresh and send. Every ingestion path calls one idempotent archive service; Gmail missing/deletion never removes archived data.

**Tech Stack:** TypeScript, Express, PostgreSQL, Vitest, React, Gmail API, Google Cloud private object storage.

**Spec:** `docs/superpowers/specs/2026-09-09-durable-profile-email-archive-design.md`

## Global Constraints

- Gmail deletion must never delete app archive rows or stored attachment bytes.
- An email is not described as safely saved until its messages are committed to PostgreSQL.
- Attachment failures are visible and retryable without discarding saved messages.
- Reads verify organization ownership; reply sends require the existing authorized Google Workspace connection.
- Repeated sync, assignment, backfill, and reply retries are idempotent.
- Message bodies and attachment bytes must never be written to logs.
- Profile email renders archived plain text; unsafe Gmail HTML is not rendered.
- No destructive cleanup of existing mapping data is part of this change.

---

### Task 1: Archive schema and repository

**Files:**
- Modify: `artifacts/api-server/src/db/google-workspace-startup-migration.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-archive-types.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-archive-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-archive-repository.test.ts`
- Modify: `artifacts/api-server/src/features/organizations/organization-merge-additional-references.ts`
- Modify: `artifacts/api-server/src/features/organizations/organization-merge-google-workspace.integration.test.ts`

**Interfaces:**
- Produces:
```ts
export type ProfileEmailArchiveState = "pending" | "complete" | "partial" | "failed";
export type ArchivedProfileEmailThread = {
  id: string;
  organizationId: string;
  contactId: string | null;
  subject: string;
  originalGmailUrl: string | null;
  providerThreadIds: string[];
  archiveState: ProfileEmailArchiveState;
  lastSyncedAt: string | null;
  lastGmailErrorCode: string | null;
  messages: ArchivedProfileEmailMessage[];
};
export type ArchivedProfileEmailMessage = {
  id: string;
  gmailMessageId: string;
  gmailThreadId: string;
  internalDateMs: number | null;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  direction: "incoming" | "outgoing" | "unknown";
  bodyText: string;
  attachments: GoogleThreadAttachment[];
};
export interface GoogleProfileEmailArchiveAccess {
  upsertThread(input: ArchiveThreadInput): Promise<ArchivedProfileEmailThread>;
  listForOrganization(organizationId: string): Promise<ArchivedProfileEmailThread[]>;
  getForOrganization(input: { organizationId: string; conversationId: string }): Promise<ArchivedProfileEmailThread | null>;
  findByProviderThread(input: { organizationId: string; gmailThreadId: string }): Promise<ArchivedProfileEmailThread | null>;
  recordSyncFailure(input: { conversationId: string; code: string; now: Date }): Promise<void>;
}
```

- [ ] **Step 1: Write failing migration/repository tests**

Create tests that run the startup migration twice, upsert the same Gmail message twice, attach a second Gmail thread ID to the same app conversation, reject cross-organization reads, and merge archive ownership when organizations merge.

- [ ] **Step 2: Run the tests to verify RED**

Run:
```bash
pnpm --filter @workspace/api-server exec vitest run   src/features/google-workspace/google-profile-email-archive-repository.test.ts   src/features/organizations/organization-merge-google-workspace.integration.test.ts
```

Expected: FAIL because the archive tables and repository do not exist.

- [ ] **Step 3: Add schema and minimal repository**

Add:
```sql
CREATE TABLE IF NOT EXISTS google_workspace_profile_email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id uuid NULL REFERENCES contacts(id) ON DELETE SET NULL,
  subject text NOT NULL DEFAULT '',
  original_gmail_url text NULL,
  archive_state text NOT NULL DEFAULT 'pending'
    CHECK (archive_state IN ('pending','complete','partial','failed')),
  last_synced_at timestamptz NULL,
  last_gmail_error_code text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS google_workspace_profile_email_thread_sources (
  conversation_id uuid NOT NULL REFERENCES google_workspace_profile_email_threads(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
  gmail_thread_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, gmail_thread_id),
  UNIQUE (conversation_id, gmail_thread_id)
);
CREATE TABLE IF NOT EXISTS google_workspace_profile_email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES google_workspace_profile_email_threads(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL,
  gmail_thread_id text NOT NULL,
  internal_date_ms bigint NULL,
  from_value text NOT NULL DEFAULT '',
  to_value text NOT NULL DEFAULT '',
  cc_value text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  date_value text NOT NULL DEFAULT '',
  direction text NOT NULL CHECK (direction IN ('incoming','outgoing','unknown')),
  body_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, gmail_message_id)
);
```

Use a transaction in `upsertThread`; lock the source row/conversation while associating provider IDs; never issue delete statements from sync code.

- [ ] **Step 4: Run repository tests to verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/db/google-workspace-startup-migration.ts   artifacts/api-server/src/features/google-workspace/google-profile-email-archive-*   artifacts/api-server/src/features/organizations/organization-merge-*
git commit -m "feat: add durable profile email archive"
```

### Task 2: Idempotent Gmail-to-archive service

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-archive-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-archive-service.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-profile-file-service.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-profile-file-service.test.ts`

**Interfaces:**
- Consumes: `GoogleWorkspaceReadClient.getThreadDetail`, `GoogleProfileEmailArchiveAccess.upsertThread`, and `GoogleProfileFileService.copyApprovedThreadAttachments`.
- Produces:
```ts
export type ArchiveProfileEmailResult = {
  conversation: ArchivedProfileEmailThread;
  attachmentState: "complete" | "partial";
  failedAttachmentCount: number;
};
export class GoogleProfileEmailArchiveService {
  archiveApprovedThread(input: {
    organizationId: string;
    contactId: string | null;
    gmailThreadId: string;
    now: Date;
  }): Promise<ArchiveProfileEmailResult>;
}
```

- [ ] **Step 1: Write failing service tests**

Prove complete message bodies are stored, a repeat call does not duplicate rows/files, attachments are automatically copied, one failed attachment returns `partial`, and a Gmail 404 records failure without deleting the prior archive.

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run   src/features/google-workspace/google-profile-email-archive-service.test.ts   src/features/google-workspace/google-profile-file-service.test.ts
```

Expected: FAIL because `GoogleProfileEmailArchiveService` is missing.

- [ ] **Step 3: Implement the archive coordinator**

Fetch the full thread once, map every Gmail message into `ArchiveThreadInput`, commit messages before attachment copying, call the existing file service, then set `complete` or `partial`. Convert only Gmail not-found into `GOOGLE_WORKSPACE_PROFILE_EMAIL_GMAIL_MISSING`; preserve auth/network codes for retry.

- [ ] **Step 4: Run to verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/google-workspace/google-profile-email-archive-service*   artifacts/api-server/src/features/google-workspace/google-profile-file-service*
git commit -m "feat: archive assigned Gmail threads"
```

### Task 3: Archive every approved assignment and new reply

**Files:**
- Modify: `artifacts/api-server/src/routes/google-workspace-validation.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-validation.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-historical-backfill-service.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-historical-backfill-service.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-recent-validation-service.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-recent-validation-service.test.ts`

**Interfaces:**
- Consumes: `archiveApprovedThread({ organizationId, contactId, gmailThreadId, now })`.
- Produces: assignment responses with:
```ts
archive: {
  state: "complete" | "partial" | "failed";
  conversationId: string | null;
  failedAttachmentCount: number;
  errorCode: string | null;
}
```

- [ ] **Step 1: Write failing integration tests**

Cover manual review assignment, automatic recent matching, and historical backfill. Each must call the archive exactly once per approved thread; the manual UI response must not say safely saved when message archival fails.

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run   src/routes/google-workspace-validation.test.ts   src/features/google-workspace/google-recent-validation-service.test.ts   src/features/google-workspace/google-historical-backfill-service.test.ts
```

Expected: FAIL because those paths do not archive message content.

- [ ] **Step 3: Wire the shared archive service**

Call the archive service after CRM ownership is established and before returning final success. Preserve the existing Gmail label mutation behavior. Attachment-only partial state remains assigned and shows a retry; message-storage failure returns `archive.state = "failed"`.

- [ ] **Step 4: Run to verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/google-workspace-validation*   artifacts/api-server/src/features/google-workspace/google-recent-validation-service*   artifacts/api-server/src/features/google-workspace/google-historical-backfill-service*
git commit -m "feat: archive all approved profile email"
```

### Task 4: Archive-first profile email reads with Gmail fallback

**Files:**
- Modify: `artifacts/api-server/src/routes/google-workspace-profile-email.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-profile-email.test.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-profile-email.current-history.test.ts`
- Modify: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`

**Interfaces:**
- Produces list/detail status:
```ts
export type ProfileEmailSourceState =
  | "synced"
  | "saved_copy_gmail_missing"
  | "saved_copy_gmail_unavailable";
export type GoogleProfileEmailConversation = {
  conversationId: string;
  threadId: string;
  sourceState: ProfileEmailSourceState;
  archiveState: ProfileEmailArchiveState;
  // existing subject/from/to/date/attachment/contact/evidence fields
};
```

- [ ] **Step 1: Write failing route tests**

Seed an archive, make `getThreadDetail` return Gmail 404, and assert list/detail still return complete saved bodies. Repeat with auth/network failure. Assert a Gmail missing response performs zero archive deletes and a cross-profile conversation ID returns 404.

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run   src/routes/google-workspace-profile-email.test.ts   src/routes/google-workspace-profile-email.current-history.test.ts
```

Expected: FAIL because routes still require live Gmail.

- [ ] **Step 3: Implement archive-first reads**

Load archived conversations before opening a Google client. Attempt bounded refresh only for mapped provider thread IDs. Merge newly archived messages, return saved content on provider failure, and lazily archive successful legacy mappings. Keep current-year/historical grouping based on archived latest-message dates.

- [ ] **Step 4: Run to verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/google-workspace-profile-email*   artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts
git commit -m "feat: read profile email from durable archive"
```

### Task 5: Reply service and endpoint

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-reply-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-reply-service.test.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-profile-email.ts`
- Modify: `artifacts/api-server/src/routes/google-workspace-profile-email.test.ts`

**Interfaces:**
- Extend:
```ts
createGmailDraft(input: { raw: string; threadId?: string }): Promise<GoogleGmailDraft>;
```
- Produce:
```ts
reply(input: {
  organizationId: string;
  conversationId: string;
  bodyText: string;
  actorId: string;
  now: Date;
}): Promise<{
  conversation: ArchivedProfileEmailThread;
  gmailMessageId: string;
  gmailThreadId: string;
}>;
```
- Endpoint: `POST /google-workspace/profiles/:organizationId/email-conversations/:conversationId/reply` with `{ bodyText }`.

- [ ] **Step 1: Write failing reply tests**

Prove normal replies include `threadId`, `In-Reply-To`, and `References`; Gmail-not-found retries once without provider thread ID; the new provider thread ID attaches to the same app conversation; Gmail-confirmed outgoing content is archived; failure preserves a retryable draft record; blank bodies and cross-profile access are rejected.

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run   src/features/google-workspace/google-api-client.test.ts   src/features/google-workspace/google-profile-email-reply-service.test.ts   src/routes/google-workspace-profile-email.test.ts
```

Expected: FAIL because reply support is absent.

- [ ] **Step 3: Implement sending and fallback**

Build RFC 5322 plain-text reply with saved recipients/subject and message references. First create/send using the latest provider thread ID. On a confirmed Gmail thread-not-found response only, create/send without `threadId`; do not retry auth, validation, or ambiguous network failures. After Gmail confirms send, archive the returned message ID and provider thread ID. Store a draft/retry record before sending and mark it sent only after confirmation.

- [ ] **Step 4: Run to verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/google-workspace/google-api-*   artifacts/api-server/src/features/google-workspace/google-profile-email-reply-service*   artifacts/api-server/src/routes/google-workspace-profile-email*
git commit -m "feat: reply to profile email from the app"
```

### Task 6: Profile UI saved-copy status and reply composer

**Files:**
- Modify: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/profile-google-email-panel.tsx`
- Modify: `artifacts/adventure-zone/src/components/google-workspace/profile-google-email-panel.test.tsx`

**Interfaces:**
- Add:
```ts
export async function replyToGoogleProfileEmail(
  organizationId: string,
  conversationId: string,
  bodyText: string,
): Promise<GoogleThreadDetail>;
```

- [ ] **Step 1: Write failing UI tests**

Render archived email with Gmail missing and assert the complete body plus `Saved in app; no longer in Gmail`. Render Gmail outage and assert `Showing saved copy`. Submit a reply, assert the POST request uses the conversation ID, clear the composer on success, append the outgoing message, and retain typed text with retry messaging on failure.

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run   src/components/google-workspace/profile-google-email-panel.test.tsx
```

Expected: FAIL because source states and reply composer are missing.

- [ ] **Step 3: Implement the mobile-friendly UI**

Show a compact source-status badge in the thread detail. Add a plain-text reply textarea and Send button below the messages. Disable duplicate submission, keep the draft on failure, and refresh the conversation from the returned archived detail after success.

- [ ] **Step 4: Run to verify GREEN**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts   artifacts/adventure-zone/src/components/google-workspace/profile-google-email-panel*
git commit -m "feat: add durable profile email replies"
```

### Task 7: Existing-mapping archive backfill and release verification

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-archive-backfill.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-email-archive-backfill.test.ts`
- Modify: `artifacts/api-server/src/server.ts`
- Modify: `.github/workflows/google-workspace.yml`

**Interfaces:**
- Produces:
```ts
runArchiveBackfillBatch(input: {
  limit: number;
  now: Date;
}): Promise<{ processed: number; archived: number; partial: number; failed: number }>;
```

- [ ] **Step 1: Write failing bounded-backfill tests**

Prove only approved mapped threads missing archive rows are selected, `limit` is enforced, one failure does not stop the batch, reruns skip completed threads, and no mapping/archive rows are deleted.

- [ ] **Step 2: Run to verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run   src/features/google-workspace/google-profile-email-archive-backfill.test.ts
```

Expected: FAIL because the backfill does not exist.

- [ ] **Step 3: Implement bounded startup/background batches**

Start only after required Google Workspace schema settles. Use a conservative batch size of 25 and the repository's existing non-overlapping loop/timeout pattern. Log counts and safe error codes only. Stop cleanly when no candidates remain or Google requires reauthorization.

- [ ] **Step 4: Run complete focused verification**

```bash
pnpm --filter @workspace/api-server exec vitest run   src/features/google-workspace/google-profile-email-archive-repository.test.ts   src/features/google-workspace/google-profile-email-archive-service.test.ts   src/features/google-workspace/google-profile-email-archive-backfill.test.ts   src/features/google-workspace/google-profile-email-reply-service.test.ts   src/features/google-workspace/google-profile-file-service.test.ts   src/features/google-workspace/google-api-client.test.ts   src/features/google-workspace/google-recent-validation-service.test.ts   src/features/google-workspace/google-historical-backfill-service.test.ts   src/routes/google-workspace-validation.test.ts   src/routes/google-workspace-profile-email.test.ts   src/routes/google-workspace-profile-email.current-history.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run   src/components/google-workspace/profile-google-email-panel.test.tsx
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: all tests and both production builds exit 0.

- [ ] **Step 5: Update focused CI and commit**

Add all new archive/reply tests plus both production builds to `.github/workflows/google-workspace.yml`.

```bash
git add artifacts/api-server/src/features/google-workspace/google-profile-email-archive-backfill*   artifacts/api-server/src/server.ts .github/workflows/google-workspace.yml
git commit -m "feat: backfill durable profile email archive"
```

- [ ] **Step 6: Final safety review**

Inspect the full diff for any DELETE statement touching archive tables, any log containing body/attachment content, any unguarded cross-profile route, and any UI success copy emitted before archive completion. Confirm none exist before opening the PR.
