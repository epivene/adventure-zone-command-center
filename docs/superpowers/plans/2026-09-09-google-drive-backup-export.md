# Google Drive Backup Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reliable, one-way backup from Adventure Zone Command Center to an app-owned Google Drive tree containing compact profile and follow-up PDFs plus separately filed source documents, without touching Amy's existing folders.

**Architecture:** PostgreSQL triggers write coalesced durable outbox jobs in the same transaction as app changes. A paced API worker claims jobs, builds snapshots or retrieves stored document bytes, resolves an app-owned path, and creates or updates Drive files idempotently through a new `drive.file` client. Owner-only API endpoints and an admin page provide configuration, dry-run preview, pilot/backfill controls, progress, retries, and reauthorization state.

**Tech Stack:** TypeScript, PostgreSQL/Drizzle, PGlite, Fastify, Google Drive API v3, `pdf-lib`, React, TanStack Query, Vitest, Testing Library, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-09-google-drive-backup-export-design.md`

## Global Constraints

- The Command Center database remains the source of truth; this feature is export-only.
- Every Drive write must be contained below the configured `Adventure Zone Command Center Backup` root.
- Never search for, adopt, move, rename, overwrite, or delete Amy's existing Drive files or folders.
- Request `https://www.googleapis.com/auth/drive.file`; do not request unrestricted Drive scope.
- Profile folders normally contain only `Profile Summary.pdf` and `Follow-ups.pdf`. Uploaded documents live under `Documents/<year>/<type>/<profile>/`.
- Email exports contain date, sender, subject, short summary, and an app link; never export full email bodies.
- File updates preserve the mapped Drive file ID. App deletion or unlinking records source removal but does not automatically delete Drive content.
- Incremental changes outrank backfill work. Backfill is paced, resumable, active/newest-first, and begins only after dry run and a pilot of at most 25 profiles.
- All queue mutations, retries, mapping updates, and status transitions are deterministic and test-covered.
- No production deployment, OAuth consent publication, pilot run, or full backfill is part of the implementation branch.

---

## Task 1: Add the Durable Backup Schema and Transactional Outbox

**Files:**

- Create: `lib/db/src/google-drive-backup-schema.ts`
- Create: `lib/db/migrations/20260909_google_drive_backup_exports.sql`
- Modify: `lib/db/src/index.ts`
- Create: `artifacts/api-server/src/db/google-drive-backup-required-startup.ts`
- Create: `artifacts/api-server/src/db/google-drive-backup-required-startup.test.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.ts`

- [ ] **Step 1: Write failing schema startup tests**

Cover idempotent installation, required tables/indexes, a single configuration row, and trigger coalescing. Insert an organization/contact change twice and assert a single queued `profile_summary` job; insert/update a follow-up and assert one `follow_up_summary` job; insert a business-document version/link and assert one `document` job.

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/db/google-drive-backup-required-startup.test.ts
```

Expected: FAIL because the startup module and tables do not exist.

- [ ] **Step 2: Define Drizzle tables and shared types**

Export these enums/unions and tables from `google-drive-backup-schema.ts`:

```ts
export type GoogleDriveBackupState =
  | "disabled"
  | "preview"
  | "pilot"
  | "active"
  | "paused"
  | "reauthorization_required";

export type GoogleDriveBackupEntityKind =
  | "profile_summary"
  | "follow_up_summary"
  | "document";

export type GoogleDriveBackupJobStatus =
  | "queued"
  | "processing"
  | "retry"
  | "blocked"
  | "failed"
  | "succeeded";

export const googleDriveBackupConfig = pgTable("google_drive_backup_config", { ... });
export const googleDriveBackupJobs = pgTable("google_drive_backup_jobs", { ... });
export const googleDriveBackupMappings = pgTable("google_drive_backup_mappings", { ... });
export const googleDriveBackupRuns = pgTable("google_drive_backup_runs", { ... });
```

Use UUID primary keys except the singleton config key. Store `connection_id`, `root_folder_id`, `root_web_view_link`, `state`, `last_success_at`, and `last_error` in config. Jobs store kind/entity, priority, requested version, attempts, `next_attempt_at`, lease data, and error fields, with a unique index on `(entity_kind, entity_id)`. Mappings store stable Drive IDs, parent IDs, logical paths, checksum, source version, export time, and nullable `source_removed_at`. Runs store mode, state, counters, cursor, and timestamps.

- [ ] **Step 3: Implement the migration and trigger functions**

Create `enqueue_google_drive_backup_job(kind, entity_id, priority, requested_version)` using `INSERT ... ON CONFLICT ... DO UPDATE` so a newer change resets a succeeded/retry job to queued without creating duplicates.

Install narrowly scoped triggers on:

- `contacts`, `organizations`, and `bookings` for profile summaries.
- `follow_ups` for the owning profile's follow-up summary.
- `activities` for the owning contact/profile summaries.
- `business_documents`, `business_document_versions`, and `business_document_links` for document exports.

Resolve the profile identity from the affected row or related booking/contact inside the trigger. Give incremental mutations priority 100; backfill jobs will use priority 10. Trigger functions must return the original row and never touch backup tables recursively.

- [ ] **Step 4: Add idempotent required-schema startup**

Follow the business-document startup pattern. Export:

```ts
export async function ensureGoogleDriveBackupRequiredSchema(
  db: PgliteDatabase<Record<string, never>>,
): Promise<void>;
```

The function must create missing objects safely, seed exactly one disabled config row, and be callable on every server start. Add it to `ensureRequiredSchema()` after core and business-document schemas exist.

- [ ] **Step 5: Export the schema and make tests pass**

Update `lib/db/src/index.ts` so the new tables/types are available to the API package.

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/db/google-drive-backup-required-startup.test.ts
pnpm --filter @workspace/db build
```

Expected: PASS.

- [ ] **Step 6: Commit the schema checkpoint**

```bash
git add lib/db/src/google-drive-backup-schema.ts lib/db/migrations/20260909_google_drive_backup_exports.sql lib/db/src/index.ts artifacts/api-server/src/db/google-drive-backup-required-startup.ts artifacts/api-server/src/db/google-drive-backup-required-startup.test.ts artifacts/api-server/src/db/required-schema-startup.ts
git commit -m "feat: add Google Drive backup outbox schema"
```

---

## Task 2: Add Least-Privilege Drive Write Support

**Files:**

- Modify: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-connection-repository.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-connection-repository.test.ts`
- Modify: OAuth callback and settings tests that assert required scopes.

- [ ] **Step 1: Write failing Drive mutation tests**

Test folder lookup, folder creation, multipart file creation, media update preserving file ID, metadata move/rename, and metadata read. Assert exact HTTP method, Drive v3 URL/query, authorization header, multipart content type, parent IDs, and requested fields. Also test 401/403 as reauthorization errors and 429/5xx as retryable errors.

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-api-client.test.ts src/features/google-workspace/google-connection-repository.test.ts
```

Expected: FAIL because write scope and client methods are absent.

- [ ] **Step 2: Add the scope and client contract**

Add:

```ts
export const GOOGLE_WORKSPACE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file";

export interface GoogleDriveBackupFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  webViewLink: string | null;
  md5Checksum: string | null;
}

export interface GoogleDriveBackupClient {
  findChild(parentId: string, name: string, mimeType?: string): Promise<GoogleDriveBackupFile | null>;
  createFolder(parentId: string, name: string): Promise<GoogleDriveBackupFile>;
  createFile(input: DriveCreateFileInput): Promise<GoogleDriveBackupFile>;
  updateFile(input: DriveUpdateFileInput): Promise<GoogleDriveBackupFile>;
  getFile(fileId: string): Promise<GoogleDriveBackupFile>;
}
```

Include `drive.file` in `GOOGLE_WORKSPACE_REQUIRED_SCOPES`. Keep `drive.readonly` while existing read/import features require it.

- [ ] **Step 3: Implement Drive v3 writes**

Use `POST /drive/v3/files` for folders, `POST /upload/drive/v3/files?uploadType=multipart` for file creation, `PATCH /upload/drive/v3/files/{id}?uploadType=multipart` for content replacement, and `PATCH /drive/v3/files/{id}` with `addParents`/`removeParents` for moves. Escape Drive search literals before `findChild`. Request only `id,name,mimeType,parents,webViewLink,md5Checksum`.

Build multipart bodies from a generated boundary and raw bytes; do not convert PDFs or documents to text.

- [ ] **Step 4: Expose a connected backup client**

Add:

```ts
createDriveBackupClient(): Promise<GoogleDriveBackupClient | null>
```

to `PostgresGoogleConnectionRepository`. Return null unless the saved connection is connected and has `drive.file`; preserve existing refresh-token and reauthorization behavior.

- [ ] **Step 5: Update scope assertions and run tests**

Update OAuth callback, connection-status, and settings tests to expect `drive.file`.

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the Google client checkpoint**

```bash
git add artifacts/api-server/src/features/google-workspace
git commit -m "feat: add least-privilege Drive backup client"
```

---

## Task 3: Resolve Safe, Compact Backup Paths

**Files:**

- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-types.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-path-resolver.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-path-resolver.test.ts`

- [ ] **Step 1: Write the path matrix tests**

Table-test people and organization profiles, punctuation/Unicode/control characters, blank names, duplicate-looking names with stable short IDs, each business-document category, every year source, and ambiguous dates. Assert:

```text
Profiles/<profile-name--short-id>/Profile Summary.pdf
Profiles/<profile-name--short-id>/Follow-ups.pdf
Documents/<year>/<type>/<profile-name--short-id>/<document-name--short-id.ext>
Documents/Needs Filing/<type>/<profile-name--short-id>/<document-name--short-id.ext>
```

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-drive-backup/google-drive-backup-path-resolver.test.ts
```

Expected: FAIL because the resolver is absent.

- [ ] **Step 2: Define resolver inputs and outputs**

```ts
export interface ResolvedBackupPath {
  directories: readonly string[];
  fileName: string;
  logicalPath: string;
}

export function sanitizeDriveSegment(value: string): string;
export function resolveProfileBackupPath(input: ProfilePathInput): ResolvedBackupPath;
export function resolveDocumentBackupPath(input: DocumentPathInput): ResolvedBackupPath;
```

A segment must be trimmed, whitespace-collapsed, control-character-free, bounded in length, and nonblank. Append an 8-character stable entity-ID suffix to profile and source-document names to prevent collisions without multiplying folders.

- [ ] **Step 3: Implement category and year rules**

Map all existing categories to fixed readable folders:

```ts
const DOCUMENT_TYPE_FOLDERS = {
  contract: "Contracts",
  proposal: "Proposals",
  coi: "COI",
  insurance_policy: "Insurance",
  w9_tax: "W-9 and Tax",
  permit: "Permits",
  vendor_application: "Vendor Applications",
  inspection: "Inspections",
  deposit_receipt: "Deposit Receipts",
  operational_template: "Operational Templates",
  marketing: "Marketing",
  other: "Other",
} as const;
```

Resolve year in this order: explicit document year, effective/contract date, event/booking date, issue date, created date. If no trustworthy year exists, use `Needs Filing`.

- [ ] **Step 4: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-drive-backup/google-drive-backup-path-resolver.test.ts
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/features/google-drive-backup
git commit -m "feat: resolve safe Drive backup paths"
```

---

## Task 4: Build Export Snapshots and the Two Rolling PDFs

**Files:**

- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-snapshot-repository.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-snapshot-repository.test.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-pdf.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-pdf.test.ts`
- Reuse: `artifacts/api-server/src/features/contracts/contract-pdf-service.ts` patterns.

- [ ] **Step 1: Write failing snapshot tests**

Seed a contact, organization, booking, activities, linked email metadata, and follow-ups. Assert stable ordering and these contracts:

```ts
export interface ProfileBackupSnapshot {
  profileId: string;
  displayName: string;
  profileKind: "contact" | "organization";
  contactDetails: readonly LabeledValue[];
  bookingSummaries: readonly BookingSummary[];
  recentActivity: readonly ActivitySummary[];
  emailSummaries: readonly EmailBackupSummary[];
  appUrl: string;
  generatedAt: Date;
}

export interface FollowUpBackupSnapshot {
  profileId: string;
  displayName: string;
  open: readonly FollowUpSummary[];
  scheduled: readonly FollowUpSummary[];
  completedRecent: readonly FollowUpSummary[];
  appUrl: string;
  generatedAt: Date;
}
```

Assert email summaries contain only `occurredAt`, sender, subject, short summary, and app URL. Include a test proving body/plain-text/HTML fields cannot appear in the returned type or serialized snapshot.

- [ ] **Step 2: Implement the snapshot repository**

Export `getProfileSnapshot(profileId, now)` and `getFollowUpSnapshot(profileId, now)`. Use existing profile/booking/activity and Google email link tables rather than parsing Drive content. Apply explicit limits: 20 recent activities, 20 email summaries, and 20 recently completed follow-ups; include all currently open and scheduled follow-ups. Sort open/due first, then future by due date, then recent completion descending.

Return `null` when the source profile no longer exists so the worker can mark mappings source-removed without deleting Drive files.

- [ ] **Step 3: Write failing PDF tests**

Parse generated PDFs with `pdf-lib` and assert valid bytes, expected page count growth, fixed title/section order, deterministic metadata, link annotations, and absence of a seeded email-body sentinel. Test long names, long summaries, empty sections, Unicode, and page breaks.

- [ ] **Step 4: Implement deterministic renderers**

Export:

```ts
export async function renderProfileSummaryPdf(
  snapshot: ProfileBackupSnapshot,
): Promise<Uint8Array>;

export async function renderFollowUpsPdf(
  snapshot: FollowUpBackupSnapshot,
): Promise<Uint8Array>;
```

Use the wrapping, paging, font, and metadata conventions in `contract-pdf-service.ts`. Titles must be `Profile Summary` and `Follow-ups`; include the profile display name, generated timestamp, concise sections, and a Command Center link. Do not embed attachments or email bodies.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-drive-backup/google-drive-backup-snapshot-repository.test.ts src/features/google-drive-backup/google-drive-backup-pdf.test.ts
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/features/google-drive-backup
git commit -m "feat: render Drive backup profile snapshots"
```

---

## Task 5: Implement Idempotent Folder/File Export and the Worker

**Files:**

- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-repository.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-repository.test.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-drive-service.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-drive-service.test.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-worker.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-worker.test.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-worker-loop.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-worker-loop.test.ts`

- [ ] **Step 1: Test queue claiming and state transitions**

Test `FOR UPDATE SKIP LOCKED` claiming, priority ordering, expired leases, requested-version coalescing during processing, success, retry scheduling, blocked reauthorization, terminal failure, source removal, mapping upsert, and admin retry.

Define:

```ts
export interface GoogleDriveBackupRepository {
  claimNext(workerId: string, now: Date): Promise<GoogleDriveBackupJob | null>;
  markSucceeded(input: BackupSuccess): Promise<void>;
  markRetry(input: BackupRetry): Promise<void>;
  markBlocked(input: BackupBlocked): Promise<void>;
  markFailed(input: BackupFailure): Promise<void>;
  markSourceRemoved(input: SourceRemoved): Promise<void>;
  upsertMapping(input: BackupMappingWrite): Promise<void>;
}
```

- [ ] **Step 2: Implement the repository atomically**

Claim only queued/retry jobs whose `next_attempt_at <= now`, ordered by priority descending then requested time ascending. On completion, compare the claimed requested version with the current row: mark succeeded only when unchanged; otherwise return it to queued. Clear leases on every terminal transition.

Use bounded exponential backoff with jitter for retryable errors. Cap automatic attempts at 10 while preserving an owner-triggered retry path.

- [ ] **Step 3: Test the Drive service's containment and idempotency**

With a fake client, assert the service:

- Creates or reuses only descendants of the configured root.
- Builds each directory segment in order and stores its IDs.
- Creates an unmapped file once.
- Updates mapped files in place when checksum changes.
- Skips uploads when checksum is unchanged.
- Refuses a mapped parent/file that is outside the app-owned root graph.
- Moves a mapped source document when its resolved year/type/profile path changes.
- Never issues a Drive delete.
- Never discovers or adopts similarly named files outside the configured root.

- [ ] **Step 4: Implement the Drive service**

Export:

```ts
export interface GoogleDriveBackupDriveService {
  ensureRoot(): Promise<GoogleDriveBackupFile>;
  exportFile(input: BackupFileExport): Promise<BackupFileExportResult>;
}

export class DriveContainmentError extends Error {}
```

Create the root only through an explicit owner configuration action; normal job processing requires a saved root ID. Validate every reused folder and file through stored parent relationships or Drive metadata back to the root. Compute SHA-256 locally for idempotency.

- [ ] **Step 5: Test all worker branches**

For `profile_summary`, render and export `Profile Summary.pdf`. For `follow_up_summary`, render and export `Follow-ups.pdf`. For `document`, fetch the current business-document version from `BusinessDocumentStorage.get(storageKey)` and preserve MIME type/extension. Test missing source, changed path, unchanged checksum, 401/403, 429, 5xx, corrupt storage, containment failure, and an update arriving mid-processing.

- [ ] **Step 6: Implement one worker pass and loop**

```ts
export class GoogleDriveBackupWorker {
  runOnce(now: Date): Promise<"idle" | "exported" | "skipped" | "blocked" | "failed">;
}

export class GoogleDriveBackupWorkerLoop {
  start(): void;
  close(): Promise<void>;
}
```

The worker handles one job per pass. The loop uses short idle polling, stops cleanly, emits structured counts without document contents, and pauses processing when config is disabled, paused, preview-only, or reauthorization-required.

Classify failures:

- 401/403 or missing `drive.file`: block jobs and set reauthorization-required.
- 429 and 5xx: retry with backoff.
- Missing/corrupt source or containment violation: terminal failure with actionable code.
- Missing source entity: mark mapping source-removed, do not delete Drive content.

- [ ] **Step 7: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-drive-backup
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/features/google-drive-backup
git commit -m "feat: export Drive backups with durable worker"
```

---

## Task 6: Add Dry Run, Pilot, and Resumable Backfill

**Files:**

- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-backfill-service.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-backfill-service.test.ts`

- [ ] **Step 1: Write failing preview and backfill tests**

Seed profiles, follow-ups, linked documents, and ambiguous years. Assert preview performs zero Drive calls and returns:

```ts
export interface BackupPreview {
  profileCount: number;
  followUpPdfCount: number;
  documentCount: number;
  needsFilingCount: number;
  byYear: Record<string, number>;
  byDocumentType: Record<string, number>;
  samplePaths: readonly string[];
  warnings: readonly string[];
}
```

Test pilot validation (`1..25`), active/newest-first ordering, batches of 100 jobs, cursor persistence, pause/resume, idempotent restart, and priority 10 so new incremental work remains first.

- [ ] **Step 2: Implement preview without writes**

Read source records, run the path resolver, and calculate counts/warnings. Do not create config, folders, mappings, jobs, or Drive requests during preview. Limit sample paths to 50 and never expose email bodies or document bytes.

- [ ] **Step 3: Implement controlled run creation**

Export:

```ts
preview(now: Date): Promise<BackupPreview>;
startPilot(input: { profileLimit: number; now: Date }): Promise<BackupRun>;
startBackfill(now: Date): Promise<BackupRun>;
pause(now: Date): Promise<BackupRun>;
resume(now: Date): Promise<BackupRun>;
enqueueNextBatch(runId: string, now: Date): Promise<BackfillBatchResult>;
```

Pilot selects at most the requested number of profiles and their eligible documents. Full backfill orders active profiles first, then newest activity, then stable ID. Persist the last ordering tuple as cursor. Only enqueue another batch when queued backfill work is below the configured low-water mark.

- [ ] **Step 4: Add reconciliation tests**

When all batches finish, verify planned profile/document counts equal exported + skipped + failed + needs-filing outcomes, and a rerun creates no duplicate files/jobs. Ensure source records changed during backfill remain queued at incremental priority.

- [ ] **Step 5: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-drive-backup/google-drive-backup-backfill-service.test.ts
pnpm --filter @workspace/api-server typecheck
git add artifacts/api-server/src/features/google-drive-backup/google-drive-backup-backfill-service.ts artifacts/api-server/src/features/google-drive-backup/google-drive-backup-backfill-service.test.ts
git commit -m "feat: add Drive backup preview and backfill"
```

---

## Task 7: Add Owner-Only API Controls and Admin UI

**Files:**

- Create: `artifacts/api-server/src/routes/google-drive-backup.ts`
- Create: `artifacts/api-server/src/routes/google-drive-backup.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Create: `artifacts/adventure-zone/src/features/google-drive-backup/google-drive-backup-client.ts`
- Create: `artifacts/adventure-zone/src/features/google-drive-backup/google-drive-backup-client.test.ts`
- Create: `artifacts/adventure-zone/src/pages/DriveBackupPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/DriveBackupPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsGoogleWorkspacePage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Create: `artifacts/adventure-zone/src/App.google-drive-backup.test.ts`

- [ ] **Step 1: Write failing route authorization and validation tests**

Register an owner and non-owner session. Require owner access for every endpoint:

```text
GET  /api/google-drive-backup
POST /api/google-drive-backup/root
POST /api/google-drive-backup/preview
POST /api/google-drive-backup/pilot
POST /api/google-drive-backup/backfill/start
POST /api/google-drive-backup/backfill/pause
POST /api/google-drive-backup/backfill/resume
POST /api/google-drive-backup/retry
```

Assert 403 for non-owners, 400 for pilot limits outside 1..25, 409 when root/connection/state prerequisites are unmet, and redacted error responses.

- [ ] **Step 2: Implement typed routes**

`GET` returns connection email, scope readiness, root ID/link, state, queue counts, active run counts, last success, last error code/message, and reconnect-required flag. `root` creates the app-owned root via the Drive service and persists its ID/link. Mutation endpoints call the backfill/repository services and return the updated status.

Register the router after authentication and owner authorization in `routes/index.ts`.

- [ ] **Step 3: Write the frontend client tests and implement it**

Use the existing authenticated request wrapper and runtime validation. Export query/mutation functions plus shared response types. Treat 409 reauthorization distinctly so the page can link to Google reconnect.

- [ ] **Step 4: Write failing page tests**

Cover:

- Disconnected and missing-scope reconnect states.
- Connected state before root creation.
- Preview results and warnings.
- Pilot confirmation showing the exact limit and `25` maximum.
- Active/paused/completed backfill progress.
- Queued/retrying/failed counts, last success, root link, and retry button.
- No control that can delete or import from Drive.
- Settings page navigation and direct route rendering.

- [ ] **Step 5: Implement the admin page**

Add route `/settings/google-workspace/backup`. The page should show four compact sections: connection/root, preview, rollout controls, and health. Disable full backfill until a successful pilot is recorded. Require a confirmation dialog before root creation, pilot start, and full backfill. Poll status only while a run or queue is active.

Add a `Drive backup` card/link to `SettingsGoogleWorkspacePage`; keep Amy's system separation copy visible: “Writes only inside the Command Center backup folder.”

- [ ] **Step 6: Run and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/google-drive-backup.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-drive-backup src/pages/DriveBackupPage.test.tsx src/pages/SettingsGoogleWorkspacePage.test.tsx src/App.google-drive-backup.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
git add artifacts/api-server/src/routes artifacts/adventure-zone/src
git commit -m "feat: add Drive backup administration"
```

---

## Task 8: Wire Runtime Controls, Operations, and Acceptance Gates

**Files:**

- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-config.ts`
- Create: `artifacts/api-server/src/features/google-drive-backup/google-drive-backup-config.test.ts`
- Modify: `artifacts/api-server/src/index.ts`
- Modify: `artifacts/api-server/src/index.test.ts` or the existing runtime-loop test file.
- Create: `docs/operations/google-drive-backup.md`
- Create: `docs/acceptance/google-drive-backup-v1-checklist.md`

- [ ] **Step 1: Test runtime configuration**

Define and test:

```ts
export interface GoogleDriveBackupRuntimeConfig {
  enabled: boolean;
  idlePollMs: number;
  batchLowWaterMark: number;
  maxAutomaticAttempts: number;
}

export function readGoogleDriveBackupRuntimeConfig(
  env: NodeJS.ProcessEnv,
): GoogleDriveBackupRuntimeConfig;
```

Defaults: disabled, 2,000 ms idle poll, 100-job low-water mark, 10 attempts. Reject invalid negative/non-integer values at startup.

- [ ] **Step 2: Wire worker lifecycle**

In `artifacts/api-server/src/index.ts`, create/start the backup loop only when `GOOGLE_DRIVE_BACKUP_ENABLED=true`. Reuse the shared DB pool, Google connection repository, business-document storage, and logger. Add `close()` to the existing shutdown sequence and verify it executes once even after partial startup failure.

- [ ] **Step 3: Write the operations runbook**

Document:

- Required OAuth `drive.file` scope and reconnect procedure.
- Enabling/disabling the runtime flag.
- Root creation and how to verify its owner/account.
- Dry-run review criteria.
- Pilot selection capped at 25 profiles and reconciliation checks.
- Pause/resume, retry categories, queue-health queries, and log fields.
- Full backfill start and completion reconciliation.
- Recovery from 401/403, 429, storage corruption, and containment errors.
- Explicit instruction never to point the root at Amy's folders and never to manually merge the two trees.
- Rollback: disable worker and pause run; do not delete already exported Drive files automatically.

- [ ] **Step 4: Write the acceptance checklist**

Include checkboxes proving:

- App updates enqueue after commit and export eventually.
- Existing app data is covered by preview/pilot/backfill.
- One profile folder contains only the two rolling PDFs.
- Documents are under year/type/profile; unknown years use `Needs Filing`.
- Repeated exports preserve file IDs and do not duplicate folders/files.
- Email body sentinel is absent.
- App-side source removal does not delete Drive files.
- Amy's existing tree has zero writes.
- Reauthentication blocks safely and resumes.
- Incremental jobs remain ahead of backfill.
- Counts reconcile at pilot and full-run completion.

- [ ] **Step 5: Run focused and full verification**

```bash
pnpm --filter @workspace/api-server exec vitest run src/db/google-drive-backup-required-startup.test.ts src/features/google-drive-backup src/features/google-workspace/google-api-client.test.ts src/features/google-workspace/google-connection-repository.test.ts src/routes/google-drive-backup.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/google-drive-backup src/pages/DriveBackupPage.test.tsx src/pages/SettingsGoogleWorkspacePage.test.tsx src/App.google-drive-backup.test.ts
pnpm --filter @workspace/db build
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/adventure-zone test
```

Expected: all commands PASS with the backup runtime disabled by default.

- [ ] **Step 6: Review the diff against the spec**

Check every success criterion and non-goal in the design spec. Search changed files for placeholders:

```bash
git diff --check
git grep -nE 'TODO|TBD|FIXME|placeholder' -- lib/db artifacts/api-server artifacts/adventure-zone docs/operations docs/acceptance
```

Expected: `git diff --check` is clean; the placeholder scan has no new implementation placeholders. Confirm no Drive delete endpoint, unrestricted Drive scope, two-way sync, restoration path, or code that accepts a root outside the explicitly created app-owned folder.

- [ ] **Step 7: Commit the rollout checkpoint**

```bash
git add artifacts/api-server/src/index.ts artifacts/api-server/src/features/google-drive-backup/google-drive-backup-config.ts artifacts/api-server/src/features/google-drive-backup/google-drive-backup-config.test.ts docs/operations/google-drive-backup.md docs/acceptance/google-drive-backup-v1-checklist.md
git commit -m "docs: add Drive backup rollout safeguards"
```

---

## Completion Handoff

Implementation is complete only when all automated checks pass, the design-spec criteria are accounted for, and the branch remains undeployed. The operational sequence after review is:

1. Merge and deploy with `GOOGLE_DRIVE_BACKUP_ENABLED=false`.
2. Reconnect the designated Command Center Google account with `drive.file`.
3. Create the dedicated `Adventure Zone Command Center Backup` root.
4. Run and reconcile preview.
5. Enable the worker and run a pilot of no more than 25 profiles.
6. Verify Drive containment, compact profile folders, PDFs, document paths, checksums, and queue health.
7. Start the paced full backfill, monitor counts, and pause on any containment or authorization error.
