# Google Workspace Gmail and Files Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the full approved Gmail history newest-first, reconstruct complete Inbox/Sent threads, preserve business-only message bodies, copy accessible Gmail attachments and Drive-linked files into private storage, and expose durable backfill progress without changing Gmail.

**Architecture:** Extend the Phase-1 connection with a durable run/item ledger and normalized Gmail archive. Discovery only enumerates messages under approved label IDs; fetching one approved thread may include its Sent side. Message parsing, file copying, and persistence are independent retryable steps so one damaged message or unavailable file cannot stop the backfill. Owner controls live in the Google Workspace settings area; matching to CRM profiles is deliberately deferred to the deterministic matching plan.

**Tech Stack:** TypeScript, Express, PostgreSQL/Drizzle, `googleapis`, Google Cloud private object storage, Node `crypto`, Zod, React/TanStack Query, Vitest, PGlite, Supertest.

**Spec:** `docs/superpowers/specs/2026-08-22-google-workspace-crm-sync-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-22-google-workspace-connection-scope.md`

## Global Constraints

- Import only Gmail messages discovered through approved label IDs saved in Phase 1.
- Included root labels are Shows, Receipts, Off Season Business Opportunities, Employees, and Associations, including saved descendants.
- Full message content is fetched only after business-scope approval is proven.
- The complete thread is retained when at least one message belongs to approved scope; this includes Sent messages in that thread.
- Personal/unselected messages must not be stored merely because they are adjacent in the mailbox.
- Gmail remains read-only; do not modify labels, read state, archive state, trash state, or messages.
- Store one row per Google message ID and one row per Google thread ID.
- Store plain readable message content, essential headers, participants, source links, and scope evidence.
- Accessible files receive durable private copies and original Gmail/Drive links.
- Identical bytes are stored once by SHA-256, even when forwarded repeatedly.
- A changed Drive file creates a new immutable version.
- An inaccessible file becomes a visible `file_unavailable` record; never create a fake document.
- Process bounded batches with leases and restart-safe checkpoints.
- The first pass is newest-first.
- This plan does not use AI and does not attach threads to CRM profiles.
- Leg managers have no Gmail/file APIs.

---

### Task 1: Add Gmail archive, file, and durable work-ledger schema

**Files:**
- Create: `lib/db/src/google-workspace-gmail-schema.ts`
- Create: `lib/db/migrations/20260822_google_workspace_gmail_archive.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Modify: `artifacts/api-server/src/db/google-workspace-startup-migration.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-schema-contract.test.ts`

**Tables:**

```text
google_workspace_sync_runs
  id uuid PK
  connection_id uuid NOT NULL -> connections
  mode text CHECK historical|incremental|repair
  source text CHECK gmail|calendar|drive|combined
  status text CHECK queued|running|pausing|paused|complete|failed
  stage text NOT NULL
  discovered_count / processed_count / connected_count / review_count /
    ignored_count / unavailable_count / failed_count bigint NOT NULL default 0
  pause_requested_at / started_at / completed_at / failed_at
  last_error_code text
  created_at / updated_at

google_workspace_sync_items
  id uuid PK
  run_id uuid NOT NULL -> sync_runs ON DELETE CASCADE
  source_kind text CHECK gmail_message|gmail_thread|gmail_attachment|drive_file
  source_key text NOT NULL
  thread_key text
  state text CHECK pending|leased|complete|file_unavailable|retryable_failed|ignored
  sort_at timestamptz NOT NULL
  attempt_count integer NOT NULL default 0
  lease_owner text / lease_token uuid / lease_expires_at timestamptz
  retry_after / completed_at / created_at / updated_at
  last_error_code text
  UNIQUE(run_id,source_kind,source_key)

google_workspace_gmail_threads
  id uuid PK
  connection_id uuid NOT NULL
  google_thread_id text NOT NULL
  subject text
  snippet text
  latest_message_at timestamptz
  first_message_at timestamptz
  message_count integer NOT NULL
  direction text CHECK incoming|outgoing|mixed
  internal_area text CHECK none|employee|receipt|association
  source_available boolean NOT NULL default true
  original_gmail_url text NOT NULL
  created_at / updated_at
  UNIQUE(connection_id,google_thread_id)

google_workspace_gmail_messages
  id uuid PK
  thread_id uuid NOT NULL -> gmail_threads ON DELETE CASCADE
  google_message_id text NOT NULL
  google_history_id text
  internal_date timestamptz NOT NULL
  direction text CHECK incoming|outgoing
  from_address text / from_name text
  to_addresses jsonb / cc_addresses jsonb / bcc_addresses jsonb
  reply_to_addresses jsonb
  internet_message_id text
  subject text
  body_text text NOT NULL
  snippet text
  label_ids jsonb NOT NULL
  scope_evidence jsonb NOT NULL
  source_available boolean NOT NULL default true
  original_gmail_url text NOT NULL
  created_at / updated_at
  UNIQUE(google_message_id)

google_workspace_thread_labels
  thread_id uuid NOT NULL
  label_id text NOT NULL
  label_name text NOT NULL
  root_label_name text NOT NULL
  PRIMARY KEY(thread_id,label_id)

google_workspace_files
  id uuid PK
  connection_id uuid NOT NULL
  content_sha256 text NOT NULL
  logical_name text NOT NULL
  mime_type text NOT NULL
  current_version_id uuid
  created_at / updated_at
  UNIQUE(connection_id,content_sha256)

google_workspace_file_versions
  id uuid PK
  file_id uuid NOT NULL -> files ON DELETE CASCADE
  content_sha256 text NOT NULL
  size_bytes bigint NOT NULL
  storage_object_key text NOT NULL UNIQUE
  source_modified_at timestamptz
  created_at timestamptz NOT NULL
  UNIQUE(file_id,content_sha256)

google_workspace_file_sources
  id uuid PK
  file_version_id uuid -> file_versions
  message_id uuid -> gmail_messages
  source_kind text CHECK gmail_attachment|drive_file
  google_source_id text NOT NULL
  filename text NOT NULL
  original_url text
  availability text CHECK available|file_unavailable|retry_required
  last_error_code text
  created_at / updated_at
  UNIQUE(source_kind,google_source_id,message_id)
```

Use a deferred foreign key or follow-up update for `files.current_version_id` so insertion remains transactional.

- [ ] **Step 1: Write schema contract tests**

Prove unique Google identities, exactly-one lease consistency, JSON array checks for address/label fields, allowed internal areas, checksum/version uniqueness, and no file source may claim `available` without a `file_version_id`.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/gmail/gmail-schema-contract.test.ts
```

- [ ] **Step 3: Implement SQL, Drizzle exports, and startup DDL**

Add indexes for `(status, source, created_at)`, item claims `(state,retry_after,sort_at desc)`, thread latest date, message thread/date, participant header lookup through JSONB GIN only if query plans justify it, file checksum, and unavailable sources.

- [ ] **Step 4: Run/typecheck and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/gmail/gmail-schema-contract.test.ts
pnpm run typecheck
git add lib/db/src/google-workspace-gmail-schema.ts lib/db/migrations/20260822_google_workspace_gmail_archive.sql lib/db/src/index.ts lib/db/src/schema/index.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/db/google-workspace-startup-migration.ts artifacts/api-server/src/features/google-workspace/gmail/gmail-schema-contract.test.ts
git commit -m "feat: add Gmail archive and sync ledger"
```

---

### Task 2: Add generic HTML-to-text and Gmail MIME parsing

**Files:**
- Create: `artifacts/api-server/src/lib/html-to-plain-text.ts`
- Create: `artifacts/api-server/src/lib/html-to-plain-text.test.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/normalizers/act-html-text.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-message-parser.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-message-parser.test.ts`

**Interfaces:**

```ts
export function htmlToPlainText(value: string): string;

export type ParsedGmailMessage = {
  googleMessageId: string;
  googleThreadId: string;
  historyId: string | null;
  internalDate: Date;
  subject: string | null;
  from: { name: string | null; address: string } | null;
  to: Array<{ name: string | null; address: string }>;
  cc: Array<{ name: string | null; address: string }>;
  bcc: Array<{ name: string | null; address: string }>;
  replyTo: Array<{ name: string | null; address: string }>;
  internetMessageId: string | null;
  bodyText: string;
  snippet: string | null;
  labelIds: string[];
  attachments: Array<{
    attachmentId: string;
    partId: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
  driveLinks: string[];
};

export function parseGmailMessage(raw: GmailMessageResource): ParsedGmailMessage;
```

- [ ] **Step 1: Write fixture-based parser tests**

Cover plain text, HTML-only, multipart/alternative, nested multipart/mixed, base64url decoding, encoded display names, missing optional headers, inline images, real attachments, Drive links, and quoted-printable-looking content without corrupting it.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/html-to-plain-text.test.ts src/features/google-workspace/gmail/gmail-message-parser.test.ts
```

- [ ] **Step 3: Extract generic HTML normalization without changing ACT output**

Keep `actHtmlToPlainText` as a compatibility re-export:

```ts
export { htmlToPlainText as actHtmlToPlainText } from "@/lib/html-to-plain-text";
```

- [ ] **Step 4: Implement recursive MIME traversal**

Choose `text/plain` when nonblank; otherwise convert `text/html`. Do not store raw binary parts in message rows. Normalize addresses to lowercase while retaining display names.

- [ ] **Step 5: Run ACT normalization regressions and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/lib/html-to-plain-text.test.ts src/features/google-workspace/gmail/gmail-message-parser.test.ts src/features/act-recovery/timeline-html-normalization.test.ts
git add artifacts/api-server/src/lib/html-to-plain-text* artifacts/api-server/src/features/act-replacement/normalizers/act-html-text.ts artifacts/api-server/src/features/google-workspace/gmail/gmail-message-parser*
git commit -m "feat: parse Gmail messages into safe text"
```

---

### Task 3: Add typed Gmail and Drive read clients

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-source-client.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-source-client.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/files/drive-source-client.ts`
- Create: `artifacts/api-server/src/features/google-workspace/files/drive-source-client.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`

**Interfaces:**

```ts
export interface GmailSourceClient {
  listMessageIds(input: {
    labelId: string;
    pageToken?: string;
    maxResults: number;
  }): Promise<{ ids: string[]; nextPageToken: string | null }>;
  getMessage(id: string, format: "metadata" | "full"): Promise<GmailMessageResource>;
  getThread(id: string): Promise<GmailThreadResource>;
  getAttachment(input: { messageId: string; attachmentId: string }): Promise<Uint8Array>;
  getProfile(): Promise<{ emailAddress: string; historyId: string }>;
}

export interface DriveSourceClient {
  metadata(fileId: string): Promise<{
    id: string;
    name: string;
    mimeType: string;
    modifiedTime: Date | null;
    webViewLink: string | null;
  }>;
  download(fileId: string, mimeType: string): Promise<{ bytes: Uint8Array; outputMimeType: string; extension: string | null }>;
}
```

- [ ] **Step 1: Write adapter tests**

Prove no modifying methods are exposed, base64url attachments decode correctly, Google Docs/Sheets/Slides use export formats, blob files use media download, and permission/not-found errors map to safe codes.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/gmail/gmail-source-client.test.ts src/features/google-workspace/files/drive-source-client.test.ts
```

- [ ] **Step 3: Implement adapters using the Phase-1 authenticated OAuth client**

Use PDF export for Google Docs/Slides and XLSX export for Google Sheets. Preserve the source MIME type in metadata and the exported MIME type in the file version.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/gmail/gmail-source-client.test.ts src/features/google-workspace/files/drive-source-client.test.ts
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/features/google-workspace/gmail/gmail-source-client* artifacts/api-server/src/features/google-workspace/files/drive-source-client* artifacts/api-server/src/features/google-workspace/google-api-client.ts
git commit -m "feat: add read-only Gmail and Drive clients"
```

---

### Task 4: Implement business-scope discovery and newest-first queueing

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-scope-resolver.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-scope-resolver.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/sync/google-sync-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/sync/google-sync-repository.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-discovery-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-discovery-service.test.ts`

**Interfaces:**

```ts
export type GmailScope = {
  selectedLabelIds: Set<string>;
  labelsById: Map<string, { name: string; rootName: string }>;
};

export function classifyThreadFilingArea(rootNames: string[]):
  | "none" | "employee" | "receipt" | "association";

export interface GoogleSyncRepository {
  createHistoricalRun(connectionId: string, now: Date): Promise<GoogleSyncRun>;
  enqueue(input: {
    runId: string;
    sourceKind: "gmail_message";
    sourceKey: string;
    sortAt: Date;
    threadKey: string;
  }): Promise<"inserted" | "already_present">;
  claimNext(input: { workerId: string; now: Date }): Promise<SyncClaim | null>;
  complete(...): Promise<void>;
  failRetryable(...): Promise<void>;
  pause(...): Promise<void>;
}
```

- [ ] **Step 1: Write scope tests**

Messages with no selected label are rejected before full fetch. `Employees/*` maps to employee, `Receipts/*` to receipt, `Associations/*` to association, and Shows/Off Season to none. Multiple selected roots preserve all scope evidence.

- [ ] **Step 2: Write queue tests**

Prove idempotent enqueue, highest `sort_at` claimed first, expired lease reclaim, terminal items never reclaimed, pause prevents new claims, and counters reconcile.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/gmail/gmail-scope-resolver.test.ts src/features/google-workspace/sync/google-sync-repository.pglite.test.ts src/features/google-workspace/gmail/gmail-discovery-service.test.ts
```

- [ ] **Step 4: Implement discovery in bounded pages**

For each selected label ID, call `listMessageIds`. Fetch message metadata only to obtain thread ID/internal date/label IDs; do not fetch body content during discovery. Deduplicate the same message found under multiple labels.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/gmail/gmail-scope-resolver.test.ts src/features/google-workspace/sync/google-sync-repository.pglite.test.ts src/features/google-workspace/gmail/gmail-discovery-service.test.ts
git add artifacts/api-server/src/features/google-workspace/gmail/gmail-scope-resolver* artifacts/api-server/src/features/google-workspace/gmail/gmail-discovery-service* artifacts/api-server/src/features/google-workspace/sync/google-sync-repository*
git commit -m "feat: discover approved Gmail history"
```

---

### Task 5: Persist complete approved threads idempotently

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-archive-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-archive-repository.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-thread-import-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-thread-import-service.test.ts`

**Interfaces:**

```ts
export type ThreadImportResult = {
  threadId: string;
  messagesInserted: number;
  messagesUpdated: number;
  attachmentsQueued: number;
  driveFilesQueued: number;
};

export class GmailThreadImportService {
  importMessageClaim(input: {
    connectionId: string;
    runId: string;
    googleMessageId: string;
  }): Promise<ThreadImportResult>;
}
```

- [ ] **Step 1: Write repository integration tests**

Seed a thread with one selected Inbox message and two Sent replies. Prove all three messages persist once, direction is `mixed`, latest/first dates are correct, label/root evidence remains, repeated import creates no duplicates, and updated Google content updates only the same Google message row.

- [ ] **Step 2: Write privacy boundary test**

A thread fetched only because of an unselected/personal message must never be persisted. The service requires discovery evidence from a selected message claim before calling `getThread`.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/gmail/gmail-archive-repository.pglite.test.ts src/features/google-workspace/gmail/gmail-thread-import-service.test.ts
```

- [ ] **Step 4: Implement one-transaction thread upsert**

Upsert thread, messages, labels, and file-source queue records transactionally. Store readable text and headers only. Queue binary retrieval separately.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/gmail/gmail-archive-repository.pglite.test.ts src/features/google-workspace/gmail/gmail-thread-import-service.test.ts
git add artifacts/api-server/src/features/google-workspace/gmail/gmail-archive-repository* artifacts/api-server/src/features/google-workspace/gmail/gmail-thread-import-service*
git commit -m "feat: archive complete approved Gmail threads"
```

---

### Task 6: Copy and version Gmail attachments and Drive-linked files

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/files/google-file-object-storage.ts`
- Create: `artifacts/api-server/src/features/google-workspace/files/google-file-object-storage.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/files/google-file-repository.ts`
- Create: `artifacts/api-server/src/features/google-workspace/files/google-file-repository.pglite.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/files/google-file-copy-service.ts`
- Create: `artifacts/api-server/src/features/google-workspace/files/google-file-copy-service.test.ts`

**Interfaces:**

```ts
export function googleFileObjectKey(input: {
  connectionId: string;
  sha256: string;
  versionId: string;
}): string;

export type FileCopyResult =
  | { state: "available"; fileId: string; versionId: string; deduplicated: boolean }
  | { state: "file_unavailable"; errorCode: string }
  | { state: "retryable_failed"; errorCode: string };
```

- [ ] **Step 1: Write storage and checksum tests**

Prove UUID/path validation, SHA-256 checksum, same bytes from two messages create one logical file/version with two sources, changed Drive bytes create a second version, and signed URLs expire after 15 minutes.

- [ ] **Step 2: Write unavailable/retry tests**

Permission denied and not found become `file_unavailable`; rate limit, timeout, and storage errors become `retryable_failed`; no file/version row or object is created for unavailable bytes.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/files/google-file-object-storage.test.ts src/features/google-workspace/files/google-file-repository.pglite.test.ts src/features/google-workspace/files/google-file-copy-service.test.ts
```

- [ ] **Step 4: Implement using `GoogleCloudPrivateObjectStorage`**

Use `GOOGLE_CLOUD_STORAGE_BUCKET`; never use a public URL. Upload bytes before committing the version row, and delete the just-uploaded object if the DB transaction fails and no other row references it.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/files
git add artifacts/api-server/src/features/google-workspace/files
git commit -m "feat: copy and version Google Workspace files"
```

---

### Task 7: Add the historical backfill worker and lifecycle APIs

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/sync/google-backfill-worker.ts`
- Create: `artifacts/api-server/src/features/google-workspace/sync/google-backfill-worker.test.ts`
- Create: `artifacts/api-server/src/features/google-workspace/sync/google-sync-worker-loop.ts`
- Create: `artifacts/api-server/src/features/google-workspace/sync/google-sync-worker-loop.test.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-sync.ts`
- Create: `artifacts/api-server/src/routes/google-workspace-sync.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/index.ts`

**Owner routes:**

```text
POST /google-workspace/sync/backfill/start
POST /google-workspace/sync/:runId/pause
POST /google-workspace/sync/:runId/resume
GET  /google-workspace/sync/status
GET  /google-workspace/archive/threads?page=1&pageSize=50&area=all|employee|receipt|association
GET  /google-workspace/archive/files/:fileId/url
```

- [ ] **Step 1: Write worker tests**

Prove discovery runs before item claims, one claim processes one thread or file source, progress reschedules immediately, idle waits two seconds, pause drains the active claim then stops, restart reclaims expired leases, and a file failure does not fail its thread.

- [ ] **Step 2: Write route tests**

Start rejects missing connection/scope, duplicate start returns the same active run, pause/resume is idempotent, status arithmetic reconciles, and file URL is owner-only.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/sync src/routes/google-workspace-sync.test.ts
```

- [ ] **Step 4: Start the runtime independently of ACT workers**

Create the Google runtime after required schemas are ready. If no active connection exists, the loop idles. Add it to shutdown alongside paper notes, assistant jobs, and ACT runtime.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/sync src/routes/google-workspace-sync.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
git add artifacts/api-server/src/features/google-workspace/sync artifacts/api-server/src/routes/google-workspace-sync* artifacts/api-server/src/routes/index.ts artifacts/api-server/src/index.ts
git commit -m "feat: run restart-safe Gmail historical backfill"
```

---

### Task 8: Add backfill progress and archive inspection UI

**Files:**
- Modify: `artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-sync-progress.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-sync-progress.test.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-thread-preview-list.tsx`
- Create: `artifacts/adventure-zone/src/components/google-workspace/google-thread-preview-list.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.test.tsx`

**Status DTO:**

```ts
export type GoogleBackfillStatus = {
  runId: string;
  status: "queued" | "running" | "pausing" | "paused" | "complete" | "failed";
  stage: string;
  discovered: number;
  processed: number;
  filesAvailable: number;
  filesUnavailable: number;
  retryableFailed: number;
  latestProcessedAt: string | null;
};
```

- [ ] **Step 1: Write UI tests**

Prove Start is unavailable until connection and scope are valid; Pause/Resume copy is accurate; polling stops when complete/paused; progress survives remount; newest thread previews show participants, date, direction, root label, and file count; message body is collapsed by default.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace/google-sync-progress.test.tsx src/components/google-workspace/google-thread-preview-list.test.tsx src/pages/SettingsGoogleWorkspacePage.test.tsx
```

- [ ] **Step 3: Implement without profile matching controls**

Label the archive preview as validation data. Show Employees, Business Receipts, and Associations filters. Explain that profile matching arrives in the next implementation phase.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/google-workspace src/pages/SettingsGoogleWorkspacePage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
git add artifacts/adventure-zone/src/features/google-workspace/google-workspace-client.ts artifacts/adventure-zone/src/components/google-workspace artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage*
git commit -m "feat: show Gmail backfill progress and archive"
```

---

### Task 9: Expand CI and verify idempotency twice

**Files:**
- Modify: `.github/workflows/google-workspace-sync-ci.yml`
- Create: `artifacts/api-server/src/features/google-workspace/gmail/gmail-backfill.e2e.pglite.test.ts`

- [ ] **Step 1: Add an end-to-end archive fixture**

Seed selected labels, one incoming message, two Sent replies, the same PDF attached twice, one inaccessible Drive file, and one personal-label message. Run the backfill worker to idle twice.

Expected assertions:

```ts
expect(await count("google_workspace_gmail_threads")).toBe(1);
expect(await count("google_workspace_gmail_messages")).toBe(3);
expect(await count("google_workspace_file_versions")).toBe(1);
expect(await countUnavailableFiles()).toBe(1);
expect(await storedBodiesContaining("personal secret")).toBe(0);
```

- [ ] **Step 2: Add API and frontend test paths to CI**

Include Gmail, files, sync worker/routes, and Google settings components.

- [ ] **Step 3: Run the full phase verification**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace src/routes/google-workspace-sync.test.ts src/db/google-workspace-required-startup.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-workspace src/components/google-workspace src/pages/SettingsGoogleWorkspacePage.test.tsx
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: all commands exit 0 and the E2E fixture passes on both runs.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/google-workspace-sync-ci.yml artifacts/api-server/src/features/google-workspace/gmail/gmail-backfill.e2e.pglite.test.ts
git commit -m "test: verify Gmail backfill privacy and idempotency"
```

## Phase Acceptance

- Full approved Gmail history can be started, paused, resumed, and restarted safely.
- Newest approved business threads are processed first.
- Inbox and Sent messages form complete threads.
- Personal/unselected mail content is absent from CRM storage.
- Employees, Receipts, and Associations receive distinct internal filing values.
- Attachments and accessible Drive-linked files receive durable private copies and original source links.
- Duplicate bytes are stored once; changed Drive bytes create new versions.
- Unavailable files are visible without fake placeholders.
- A second complete run creates no duplicate threads, messages, files, or versions.
- No Google data is mutated.
