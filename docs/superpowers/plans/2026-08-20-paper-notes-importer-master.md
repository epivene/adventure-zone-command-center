# Paper Notes Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, mobile-first Paper Notes Importer under **Imports & Data** that privately stores photographed call sheets, extracts separate event entries, lets the owner review and match every value, and applies approved changes atomically without turning old reminders into current tasks.

**Architecture:** Build one durable `paper_note_batches → paper_note_pages → paper_note_entries` workflow in four independently testable releases. Release 1 provides private image intake and resumable batches; Release 2 adds leased two-stage AI extraction; Release 3 adds versioned review, deterministic matching, and explicit conflict decisions; Release 4 adds stale-aware preflight, structured phone writes, one-transaction import, completed summaries, and source-paper links from profile history. The feature stays inside the existing React/Express/PostgreSQL application and reuses the existing owner auth, Google Cloud credentials, activity timeline, organization/contact relationships, and image-capable AI client.

**Tech Stack:** TypeScript 5.9, Express 5, PostgreSQL + Drizzle ORM, React 19, Wouter, TanStack React Query, Vitest, PGlite, Google Cloud Storage, Sharp, the existing Anthropic/OpenAI image-completion abstraction.

**Spec:** `docs/superpowers/specs/2026-08-20-paper-notes-importer-design.md`

## Global Constraints

- Use the existing application and database; do not create a second app, database, or manager-only copy.
- Mount every paper-note API route after `requireOwnerMiddleware`; manager sessions never receive access.
- Release 1 accepts only JPEG, PNG, and WebP images, including multiple phone-camera selections; PDF support is deferred.
- Default limits are 25 pages per batch and 12 MB per image.
- Original image bytes remain unchanged and private; object keys use UUIDs, not event/contact names.
- Never log image bytes, base64, transcription, names, phone numbers, email addresses, note bodies, AI prompts, or raw AI output.
- Real user paper pages must never be committed to GitHub, snapshots, fixtures, or CI artifacts.
- Page headings are context, not event records. `Monday Call List` must not create a date or a task.
- `Call Monday`, `try again`, and similar wording remain historical source text unless the owner separately enables a current follow-up and selects a new absolute date.
- A reviewed star contributes only the sentence `Starred on original paper.` to the imported historical note; it creates no favorite, priority, icon, filter, or status.
- Phone number, extension, type, label, ownership, calling instructions, status, and Do Not Call state remain separate concepts.
- Crossed-out, unreadable, conflicting, inactive, or questionable data never causes an automatic overwrite, deletion, deactivation, or Do Not Call mutation.
- AI may segment/transcribe only. Deterministic code validates fields and ranks matches; the owner chooses the destination and every write decision.
- Nothing changes the CRM until **Import Approved Entries**.
- Final import is all-or-nothing, stale-data aware, and idempotent.
- No storage write or AI call may occur inside the final database transaction.
- Keep the page visible when AI or storage is unavailable and show an actionable unavailable state.
- Preserve existing Act! import, receipt extraction, assisted calling, manager features, and legacy phone fields.
- Begin implementation from the latest `main`. The approved branch currently leaves migration number `066` free; if latest `main` consumes it before execution, rename the migration and registry entry together before writing the first test.

---

## File Structure and Responsibility Map

### Database

- `lib/db/migrations/066_paper_notes_importer.sql` — durable tables, constraints, backfill, and compatibility triggers.
- `lib/db/src/schema/index.ts` — Drizzle definitions and exported value unions.
- `lib/db/src/migrations.ts` — startup migration registry/readiness marker.

### API feature

- `artifacts/api-server/src/features/paper-notes/paper-note-types.ts` — server domain contracts and serialized views.
- `paper-note-image.ts` — MIME signature checks, decode limits, orientation/rotation, analysis derivative, and region crops.
- `paper-note-object-storage.ts` — paper-note object key generation and private storage operations.
- `paper-note-intake-repository.ts` — batch/page persistence and draft lifecycle.
- `paper-note-intake-service.ts` — upload ordering, storage coordination, deletion, rotation, and extraction queueing.
- `paper-note-extraction-schema.ts` — strict provider JSON schemas and deterministic extraction warnings.
- `paper-note-extraction-provider.ts` — segmentation/entry prompts and bounded provider calls.
- `paper-note-extraction-repository.ts` — leased page claims and atomic extraction replacement.
- `paper-note-extraction-worker.ts` — one-page two-stage extraction orchestration.
- `paper-note-worker-loop.ts` — non-overlapping single-flight polling loop.
- `paper-note-review-schema.ts` — editable review payload, destination, conflicts, contacts, phones, and follow-up choices.
- `paper-note-review-service.ts` — optimistic versioning, validation, state transitions, target snapshots, and preview.
- `paper-note-matching-service.ts` — bounded deterministic profile/location/contact matching.
- `paper-note-note-composer.ts` — exact historical-note wording.
- `paper-note-phone-service.ts` — contact and organization/location phone mutations plus legacy synchronization.
- `paper-note-preflight-service.ts` — batch readiness and stale fingerprint verification.
- `paper-note-import-service.ts` — one protected transaction for approved entries.
- `paper-note-source-service.ts` — owner-authorized signed source URLs.

### API routes

- `artifacts/api-server/src/routes/paper-note-intake.ts` — batches, pages, raw upload, order, rotation, deletion, and extraction start.
- `paper-note-extraction.ts` — retry, manual entry, reviewed-empty, and progress reads.
- `paper-note-review.ts` — edits, matches, approve/unapprove/skip, and source URLs.
- `paper-note-import.ts` — preflight, import, archive, and completed summary.
- `paper-notes.ts` — composes the four routers.
- `routes/index.ts` — mounts the owner-only aggregate router.

### Frontend

- `artifacts/adventure-zone/src/features/paper-notes/paper-note-types.ts` — browser-safe serialized contracts.
- `paper-note-client.ts` — authenticated JSON/raw-image API calls.
- `paper-note-upload-queue.ts` — sequential, retryable multi-file uploads.
- `paper-note-review-state.ts` — local edit/autosave transition helpers.
- `pages/PaperNotesInboxPage.tsx` — new/importing/review/completed batches.
- `pages/PaperNoteBatchReviewPage.tsx` — progress, review navigation, and final import.
- `components/paper-notes/*` — focused upload, source, entry, destination, phone, conflict, preview, preflight, and summary components.
- `components/activities/activity-timeline.tsx` and activity types — unknown historical date label and **View source paper**.

---

# Release 1 — Durable Private Intake

Release 1 is independently testable: the owner can create a named batch, upload/reorder/rotate several private images, leave the app, resume the batch, and delete an unimported draft. It performs no AI extraction and no CRM writes.

### Task 1: Define Paper Notes domain contracts

**Files:**
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-types.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-types.test.ts`

**Interfaces:**

```ts
export const paperNoteBatchStatusValues = [
  "draft", "queued", "extracting", "review", "importing", "imported", "failed", "archived",
] as const;
export const paperNotePageStatusValues = [
  "uploading", "uploaded", "queued", "extracting", "extracted", "needs_retry", "reviewed_empty",
] as const;
export const paperNotePageStageValues = ["prepare", "segment", "extract_entries", "complete"] as const;
export const paperNoteEntryStateValues = ["needs_review", "ready", "approved", "skipped", "imported"] as const;
export const paperNoteDestinationModeValues = [
  "existing_profile", "existing_profile_new_location", "new_profile", "skip",
] as const;
export const paperNotePhoneStatusValues = ["active", "questionable", "inactive"] as const;
export type PaperNoteRegion = { x: number; y: number; width: number; height: number };
```

Also export `PaperNoteBatchListItem`, `PaperNotePageView`, `PaperNoteEntryView`, `PaperNoteBatchView`, `PaperNoteImportSummary`, and `PaperNoteConfigurationView`. Serialized dates are ISO strings; object keys and raw AI payloads are never included in browser views.

- [ ] **Step 1: Write failing value-contract tests**

```ts
import { describe, expect, it } from "vitest";
import {
  paperNoteBatchStatusValues,
  paperNoteDestinationModeValues,
  isNormalizedPaperNoteRegion,
} from "./paper-note-types";

describe("paper-note domain contracts", () => {
  it("keeps the approved workflow states exact", () => {
    expect(paperNoteBatchStatusValues).toEqual([
      "draft", "queued", "extracting", "review", "importing", "imported", "failed", "archived",
    ]);
    expect(paperNoteDestinationModeValues).toEqual([
      "existing_profile", "existing_profile_new_location", "new_profile", "skip",
    ]);
  });

  it("accepts only normalized regions fully inside the source page", () => {
    expect(isNormalizedPaperNoteRegion({ x: 0.1, y: 0.2, width: 0.4, height: 0.3 })).toBe(true);
    expect(isNormalizedPaperNoteRegion({ x: 0.8, y: 0.2, width: 0.4, height: 0.3 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-types.test.ts
```

Expected: FAIL because the paper-note contracts do not exist.

- [ ] **Step 3: Implement the contracts and safe region guard**

```ts
export function isNormalizedPaperNoteRegion(value: PaperNoteRegion): boolean {
  return [value.x, value.y, value.width, value.height].every(Number.isFinite)
    && value.x >= 0 && value.y >= 0
    && value.width > 0 && value.height > 0
    && value.x + value.width <= 1
    && value.y + value.height <= 1;
}
```

Define browser-view types with safe fields only. Keep database-only fields such as `originalObjectKey`, `analysisObjectKey`, `leaseToken`, and raw provider error text out of the view types.

- [ ] **Step 4: Run the test and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-types.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/paper-notes/paper-note-types*
git commit -m "feat: define paper note import contracts"
```

### Task 2: Add the Paper Notes schema and migration

**Files:**
- Create: `lib/db/migrations/066_paper_notes_importer.sql`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/db/src/migrations.ts`
- Create: `artifacts/api-server/src/db/paper-notes-migration.pglite.test.ts`

**Interfaces:**
- Produces Drizzle tables `paperNoteBatches`, `paperNotePages`, `paperNoteEntries`, and `organizationPhones`.
- Extends `contactPhones` with `instructions`, `status`, and `sourcePaperNoteEntryId`.
- Extends `activities` with `paperNoteEntryId` and allows `sourceType = "paper_note"`.
- Exports `phoneStatusValues` and `phoneStatusEnum` for both contact and organization phones.

- [ ] **Step 1: Write the failing migration contract test**

The PGlite fixture must create the existing minimum `organizations`, `organization_locations`, `contacts`, `contact_phones`, `activities`, `event_families`, and `follow_ups` tables, execute `066_paper_notes_importer.sql`, then assert:

```ts
expect(await hasTable(client, "paper_note_batches")).toBe(true);
expect(await hasTable(client, "paper_note_pages")).toBe(true);
expect(await hasTable(client, "paper_note_entries")).toBe(true);
expect(await hasTable(client, "organization_phones")).toBe(true);
expect(await hasColumn(client, "activities", "paper_note_entry_id")).toBe(true);
expect(await hasColumn(client, "contact_phones", "instructions")).toBe(true);
expect(await hasColumn(client, "contact_phones", "status")).toBe(true);
```

Seed one organization with a legacy phone before the migration and assert it is backfilled once as an active primary `legacy_backfill` organization phone without changing the legacy value.

- [ ] **Step 2: Run the migration test and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/db/paper-notes-migration.pglite.test.ts
```

Expected: FAIL because migration 066 is absent.

- [ ] **Step 3: Write migration 066**

Use UUID primary keys, `timestamptz`, bounded `jsonb`, explicit checks, and these required uniqueness rules:

```sql
create unique index paper_note_pages_batch_sort_unique
  on paper_note_pages(batch_id, sort_order);
create unique index paper_note_pages_batch_sha256_unique
  on paper_note_pages(batch_id, sha256)
  where sha256 is not null;
create unique index paper_note_entries_page_source_order_unique
  on paper_note_entries(page_id, source_order);
create unique index activities_paper_note_entry_unique
  on activities(paper_note_entry_id)
  where paper_note_entry_id is not null;
```

For `organization_phones`, use a generated normalized extension expression or a stored `normalized_extension` column and enforce uniqueness on `(organization_id, organization_location_id, normalized_number, normalized_extension)`. Add partial unique indexes for one active primary organization phone and one active primary phone per location. Add a composite FK or trigger that rejects a location whose `organization_id` differs from the phone row.

Drop and recreate the activity checks so local manual activities still require `occurred_at`, but a row with `paper_note_entry_id` may use `occurred_at = null` while retaining `timeline_sort_at` and `date_is_import_fallback = true`.

- [ ] **Step 4: Mirror the migration in Drizzle schema**

Add exact value arrays/checks and use lazy `AnyPgColumn` references for the paper-entry/activity cycle. Do not remove legacy `organizations.phone`, `organizations.normalizedPhone`, `contacts.phone`, or `contacts.normalizedPhone`.

- [ ] **Step 5: Register migration 066**

Append this readiness marker to `lib/db/src/migrations.ts`:

```ts
{
  name: "066_paper_notes_importer.sql",
  markerSql: `SELECT
    to_regclass(current_schema() || '.paper_note_batches') IS NOT NULL
    AND to_regclass(current_schema() || '.paper_note_pages') IS NOT NULL
    AND to_regclass(current_schema() || '.paper_note_entries') IS NOT NULL
    AND to_regclass(current_schema() || '.organization_phones') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'activities'
        AND column_name = 'paper_note_entry_id'
    ) AS ready`,
},
```

- [ ] **Step 6: Run migration tests and library/API typechecks**

```bash
pnpm --filter @workspace/api-server test -- src/db/paper-notes-migration.pglite.test.ts
pnpm run typecheck:libs
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/migrations/066_paper_notes_importer.sql lib/db/src/schema/index.ts lib/db/src/migrations.ts artifacts/api-server/src/db/paper-notes-migration.pglite.test.ts
git commit -m "feat: add paper note import schema"
```

### Task 3: Extract reusable private Google Cloud object storage

**Files:**
- Create: `artifacts/api-server/src/lib/private-object-storage.ts`
- Create: `artifacts/api-server/src/lib/private-object-storage.test.ts`
- Modify: `artifacts/api-server/src/features/leg-manager/leg-manager-object-storage.ts`
- Modify/Test: `artifacts/api-server/src/features/leg-manager/leg-manager-object-storage.test.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-object-storage.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-object-storage.test.ts`

**Interfaces:**

```ts
export interface PrivateObjectStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  getSignedReadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export interface PaperNoteObjectStorage {
  putOriginal(input: { batchId: string; pageId: string; bytes: Uint8Array; mimeType: string }): Promise<string>;
  putAnalysis(input: { batchId: string; pageId: string; bytes: Uint8Array; mimeType: string }): Promise<string>;
  get(key: string): Promise<Uint8Array>;
  signedReadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  deletePageObjects(keys: { originalObjectKey: string | null; analysisObjectKey: string | null }): Promise<void>;
}
```

- [ ] **Step 1: Write failing configuration/key tests**

Prove existing `GOOGLE_CLOUD_STORAGE_BUCKET` and `GOOGLE_SERVICE_ACCOUNT_JSON` behavior remains unchanged, signed URLs default to 900 seconds, metadata stays `private, max-age=0, no-store`, and generated paper keys equal:

```text
paper-notes/{batchId}/{pageId}/original
paper-notes/{batchId}/{pageId}/analysis.webp
```

Reject non-UUID batch/page IDs before constructing a key.

- [ ] **Step 2: Run storage tests and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/lib/private-object-storage.test.ts src/features/paper-notes/paper-note-object-storage.test.ts src/features/leg-manager/leg-manager-object-storage.test.ts
```

Expected: FAIL because the generic/private adapter and paper adapter do not exist.

- [ ] **Step 3: Implement `GoogleCloudPrivateObjectStorage`**

Use the existing credential parser and add `get()` via `file.download()`. Never set a public ACL. `delete()` uses `{ ignoreNotFound: true }`.

- [ ] **Step 4: Keep the leg-manager interface stable**

Make `GoogleCloudLegManagerObjectStorage` delegate to the new generic class; do not change receipt-service callers or route contracts.

- [ ] **Step 5: Implement paper-note key scoping and deletion order**

`deletePageObjects` deletes analysis first and original second. Surface failures so the intake service can retain database rows for retry.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/lib/private-object-storage.test.ts src/features/paper-notes/paper-note-object-storage.test.ts src/features/leg-manager/leg-manager-object-storage.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/private-object-storage* artifacts/api-server/src/features/leg-manager/leg-manager-object-storage* artifacts/api-server/src/features/paper-notes/paper-note-object-storage*
git commit -m "refactor: share private object storage"
```

### Task 4: Validate and normalize supported images

**Files:**
- Modify: `artifacts/api-server/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-image.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-image.test.ts`

**Interfaces:**

```ts
export type PreparedPaperNoteImage = {
  detectedMimeType: "image/jpeg" | "image/png" | "image/webp";
  sha256: string;
  width: number;
  height: number;
  analysisBytes: Uint8Array;
  analysisMimeType: "image/webp";
};

export async function preparePaperNoteImage(input: {
  bytes: Uint8Array;
  declaredMimeType: string;
  rotationDegrees: 0 | 90 | 180 | 270;
}): Promise<PreparedPaperNoteImage>;

export async function cropPaperNoteRegion(input: {
  analysisBytes: Uint8Array;
  region: PaperNoteRegion;
}): Promise<Uint8Array>;
```

- [ ] **Step 1: Add Sharp**

```bash
pnpm --filter @workspace/api-server add sharp
```

Expected: `artifacts/api-server/package.json` and `pnpm-lock.yaml` change; `build.mjs` already externalizes `sharp`.

- [ ] **Step 2: Write failing synthetic-image tests**

Generate fictional images in memory with Sharp. Cover JPEG/PNG/WebP signatures, declared/detected MIME mismatch, corrupt bytes, zero-byte input, >12 MB input, dimensions above a conservative 20,000-pixel side/80-megapixel decoded limit, EXIF orientation, 90-degree rotation, bounded WebP derivative, valid crop, and invalid region fallback rejection.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-image.test.ts
```

Expected: FAIL because image preparation is absent.

- [ ] **Step 4: Implement magic-byte detection before decode**

Recognize JPEG `FF D8 FF`, PNG signature, and WebP `RIFF....WEBP`. Reject a declared MIME that does not equal the detected MIME with a safe error code such as `IMAGE_TYPE_MISMATCH`.

- [ ] **Step 5: Implement bounded derivative and crop**

Call `sharp(bytes, { limitInputPixels: 80_000_000, failOn: "error" }).rotate()` for EXIF orientation, then apply the reviewed quarter-turn, resize inside `2400x2400` without enlargement, and encode WebP at quality 82. Convert normalized region coordinates to clamped integer pixels and reject zero-area crops.

- [ ] **Step 6: Run tests, typecheck, and API build**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-image.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
```

Expected: PASS and Sharp resolves at build/runtime boundary.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/package.json pnpm-lock.yaml artifacts/api-server/src/features/paper-notes/paper-note-image*
git commit -m "feat: prepare paper note images safely"
```

### Task 5: Persist batch/page intake and coordinate storage

**Files:**
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-intake-repository.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-intake-repository.pglite.test.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-intake-service.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-intake-service.test.ts`

**Interfaces:**

```ts
export interface PaperNoteIntakeRepository {
  createBatch(input: { createdBy: string; name: string | null; now: Date }): Promise<string>;
  listBatches(createdBy: string): Promise<PaperNoteBatchListItem[]>;
  getBatch(createdBy: string, batchId: string): Promise<PaperNoteBatchView | null>;
  createUploadingPage(input: { batchId: string; filename: string; mimeType: string; sizeBytes: number; now: Date }): Promise<string>;
  finalizeUploadedPage(input: { pageId: string; sha256: string; width: number; height: number; originalObjectKey: string; now: Date }): Promise<void>;
  reorderDraftPages(batchId: string, orderedPageIds: string[], now: Date): Promise<void>;
  setDraftPageRotation(batchId: string, pageId: string, rotationDegrees: 0 | 90 | 180 | 270, now: Date): Promise<void>;
  deleteDraftPage(batchId: string, pageId: string): Promise<{ originalObjectKey: string | null; analysisObjectKey: string | null } | null>;
  deleteDraftBatch(batchId: string): Promise<Array<{ originalObjectKey: string | null; analysisObjectKey: string | null }>>;
  queueBatch(batchId: string, now: Date): Promise<void>;
}
```

`PaperNoteIntakeService.uploadPage()` validates/decodes before storage, detects duplicates by batch/hash, stores the original, then finalizes the row. Storage failure leaves the page retryable and never claims upload success.

- [ ] **Step 1: Write failing repository transaction tests**

Prove page sort order is sequential, duplicate hash is rejected, reordering is atomic, rotation is allowed only before queueing, imported/archived batches cannot be deleted, and all list/get reads are owner-scoped.

- [ ] **Step 2: Write failing service compensation tests**

Use fake storage/repository objects. Prove:
- image validation failure performs no storage/database finalize;
- storage failure keeps the row unfinalized;
- DB finalize failure deletes the just-written object;
- page/batch deletion removes storage objects before deleting rows;
- object deletion failure retains rows.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-intake-repository.pglite.test.ts src/features/paper-notes/paper-note-intake-service.test.ts
```

Expected: FAIL because intake persistence is absent.

- [ ] **Step 4: Implement repository state guards**

Use transactions and `FOR UPDATE` for reorder/delete/queue operations. Derive counts from pages/entries instead of trusting client counters.

- [ ] **Step 5: Implement storage coordination**

Return safe typed errors:

```ts
export type PaperNoteIntakeErrorCode =
  | "BATCH_NOT_FOUND" | "BATCH_NOT_EDITABLE" | "PAGE_LIMIT_REACHED"
  | "DUPLICATE_PAGE" | "INVALID_IMAGE" | "STORAGE_UNAVAILABLE";
```

Do not include filenames, hashes, object keys, or contact content in error logs.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-intake-repository.pglite.test.ts src/features/paper-notes/paper-note-intake-service.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/paper-notes/paper-note-intake-*
git commit -m "feat: persist paper note intake batches"
```

### Task 6: Add owner-only intake routes

**Files:**
- Create: `artifacts/api-server/src/routes/paper-note-intake.ts`
- Create: `artifacts/api-server/src/routes/paper-notes.ts`
- Create: `artifacts/api-server/src/routes/paper-note-intake.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**

```text
POST   /paper-notes/batches
GET    /paper-notes/batches
GET    /paper-notes/batches/:batchId
DELETE /paper-notes/batches/:batchId
POST   /paper-notes/batches/:batchId/pages
PUT    /paper-notes/batches/:batchId/pages/:pageId/image
PATCH  /paper-notes/batches/:batchId/pages
DELETE /paper-notes/batches/:batchId/pages/:pageId
POST   /paper-notes/batches/:batchId/extract
```

- [ ] **Step 1: Write failing route/auth tests**

Use `supertest`. Prove unauthenticated requests return 401 through the mounted app; batch names are trimmed/max 160; page metadata accepts only supported MIME and <=12 MB declared size; raw upload accepts `image/*` with an Express 12 MB limit; invalid UUIDs return 400; cross-owner/missing IDs return 404; extract refuses zero uploaded pages or unresolved uploads.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/routes/paper-note-intake.test.ts
```

Expected: FAIL because routes are absent.

- [ ] **Step 3: Implement Zod request schemas and safe responses**

Use `express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "12mb" })` only on the image route. Read `req.userId` set by owner auth. Map typed service errors to 400/404/409/413/503 without returning stack traces.

- [ ] **Step 4: Mount after owner middleware**

In `routes/index.ts`, import `paperNotesRouter` and call `router.use(paperNotesRouter)` only after `router.use(requireOwnerMiddleware)`.

- [ ] **Step 5: Run route tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/routes/paper-note-intake.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/paper-note-intake* artifacts/api-server/src/routes/paper-notes.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: expose paper note intake routes"
```

### Task 7: Build the Imports & Data inbox and sequential upload flow

**Files:**
- Create: `artifacts/adventure-zone/src/features/paper-notes/paper-note-types.ts`
- Create: `artifacts/adventure-zone/src/features/paper-notes/paper-note-client.ts`
- Create: `artifacts/adventure-zone/src/features/paper-notes/paper-note-upload-queue.ts`
- Create: `artifacts/adventure-zone/src/features/paper-notes/paper-note-upload-queue.test.ts`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-upload-panel.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-upload-panel.test.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-batch-card.tsx`
- Create: `artifacts/adventure-zone/src/pages/PaperNotesInboxPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/App.admin-navigation.test.ts`

**Interfaces:**

```ts
export async function uploadPaperNoteFiles(input: {
  batchId: string;
  files: File[];
  onProgress(update: PaperNoteUploadProgress): void;
  signal?: AbortSignal;
}): Promise<PaperNoteUploadResult[]>;
```

The file input uses `accept="image/jpeg,image/png,image/webp"`, `multiple`, and `capture="environment"` where supported.

- [ ] **Step 1: Write failing upload-queue tests**

Mock `paper-note-client`. Prove uploads happen sequentially; one failed image can retry without recreating successful pages; removal/reorder affects only local pending files; unsupported files are rejected before API calls; and the queue never exceeds 25 retained pages.

- [ ] **Step 2: Write failing navigation/component tests**

Assert the menu includes `{ href: "/settings/paper-notes", label: "Paper notes" }`, `App.tsx` routes the inbox and future batch route, every input has a visible label, and failed uploads display text plus **Retry**.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/paper-notes/paper-note-upload-queue.test.ts src/components/paper-notes/paper-note-upload-panel.test.tsx src/App.admin-navigation.test.ts
```

Expected: FAIL because the inbox/upload UI is absent.

- [ ] **Step 4: Implement the authenticated client**

Use `apiFetch` for raw image PUT with the file MIME overriding the default JSON content type. Parse server error JSON and return plain-language messages. JSON mutations use `apiPost`, `apiPatch`, and `apiDelete`.

- [ ] **Step 5: Implement mobile-first upload/inbox UI**

Show local previews, filename, size, upload status, rotate/remove/reorder controls, optional batch name, **Read Paper Notes**, and separate **In review** / **Completed** sections. Disable extraction until all retained pages are uploaded. Keep touch controls at least 44px high and status text independent of color.

- [ ] **Step 6: Run frontend tests, typecheck, and build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/paper-notes/paper-note-upload-queue.test.ts src/components/paper-notes/paper-note-upload-panel.test.tsx src/App.admin-navigation.test.ts
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/features/paper-notes artifacts/adventure-zone/src/components/paper-notes artifacts/adventure-zone/src/pages/PaperNotesInboxPage.tsx artifacts/adventure-zone/src/components/navigation/app-menu.tsx artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/App.admin-navigation.test.ts
git commit -m "feat: add paper notes intake inbox"
```

---

# Release 2 — Two-Stage Handwriting Extraction

Release 2 is independently testable on top of Release 1: queued pages are claimed by one durable worker, normalized, segmented, read entry-by-entry, and saved as source-linked review cards. Provider failure affects only the page and supports retry/manual/empty recovery.

### Task 8: Extend image completion with a bounded token budget

**Files:**
- Modify: `artifacts/api-server/src/features/ai-suggestions/ai-client.ts`
- Modify/Test: `artifacts/api-server/src/features/ai-suggestions/ai-client.test.ts`
- Modify/Test: `artifacts/api-server/src/features/leg-manager/receipt-extraction.test.ts`

**Interfaces:**

```ts
completeImage?(input: {
  prompt: string;
  mimeType: string;
  base64: string;
  maxTokens?: number;
}): Promise<string>;
```

Default remains 1200. Paper segmentation may request 2400; entry extraction may request 1800. Clamp caller values to 256–4096.

- [ ] **Step 1: Write failing provider-budget tests**

Assert Anthropic/OpenAI requests use 1200 when omitted, use the requested value when in range, and clamp 10,000 to 4096. Receipt extraction must call the same interface without changing its prompt or parsed result.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/ai-suggestions/ai-client.test.ts src/features/leg-manager/receipt-extraction.test.ts
```

Expected: FAIL because `maxTokens` is not accepted.

- [ ] **Step 3: Implement the optional bounded budget**

```ts
const imageTokenBudget = (value?: number) => Math.max(256, Math.min(4096, value ?? 1200));
```

Use it for Anthropic `max_tokens` and OpenAI `max_tokens` only. Keep text completion behavior unchanged.

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/ai-suggestions/ai-client.test.ts src/features/leg-manager/receipt-extraction.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/ai-suggestions/ai-client* artifacts/api-server/src/features/leg-manager/receipt-extraction.test.ts
git commit -m "feat: bound image completion output"
```

### Task 9: Parse strict page segmentation and entry extraction output

**Files:**
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-extraction-schema.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-extraction-schema.test.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-extraction-provider.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-extraction-provider.test.ts`

**Interfaces:**

```ts
export type PaperNotePageSegmentation = {
  pageHeading: string | null;
  pageActivityDate: string | null;
  pageContext: string[];
  roughTranscription: string | null;
  entries: Array<{ sourceOrder: number; region: PaperNoteRegion | null; roughText: string; mayContinue: boolean }>;
};

export interface PaperNoteExtractionProvider {
  segmentPage(input: { bytes: Uint8Array; mimeType: string }): Promise<PaperNotePageSegmentation>;
  extractEntry(input: {
    bytes: Uint8Array;
    mimeType: string;
    pageContext: Pick<PaperNotePageSegmentation, "pageHeading" | "pageActivityDate">;
  }): Promise<PaperNoteExtraction>;
}
```

- [ ] **Step 1: Write failing parser tests**

Cover fenced JSON stripping, invalid JSON rejection, invalid/out-of-bounds region fallback to `null`, ordered source entries, `Phone Calls April 22, 2026` page context, `Monday Call List` with no date, distinct event/activity dates, page-derived event year flag, `call Monday` as `oldReminder`, star only as `starredOnPaper`, number/extension separation, labels/instructions, crossed-out warning, partial/unreadable phone as null or explicitly partial warning, and malformed output rejection.

- [ ] **Step 2: Write failing prompt/provider tests**

Use a fake `AiCompletionClient` and assert the prompt contains the exact rules:
- headings are context, not events;
- never invent missing digits/letters;
- separate event dates from communication dates;
- preserve extensions/instructions;
- old reminder text is not a scheduled task;
- star maps only to `starredOnPaper=true`;
- crossed-out text is review evidence, not a decision.

Assert one malformed-output retry maximum and distinct `PROVIDER_UNAVAILABLE`, `MALFORMED_OUTPUT`, and `TRANSIENT_PROVIDER_ERROR` errors.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-extraction-schema.test.ts src/features/paper-notes/paper-note-extraction-provider.test.ts
```

Expected: FAIL because extraction parsing/provider code is absent.

- [ ] **Step 4: Implement strict Zod schemas and deterministic warnings**

Strip only leading/trailing JSON code fences. Do not repair arbitrary prose. Normalize empty strings to null, cap arrays/text lengths, validate emails/dates/state codes/extensions, and derive authoritative warnings in code rather than trusting a model confidence number.

- [ ] **Step 5: Implement bounded provider calls**

Use `createAiClient()`, send only the current page/crop, set `maxTokens: 2400` for segmentation and `1800` for entry extraction, and never log prompt/image/output content.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-extraction-schema.test.ts src/features/paper-notes/paper-note-extraction-provider.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/paper-notes/paper-note-extraction-*
git commit -m "feat: parse handwritten paper note entries"
```

### Task 10: Add leased extraction persistence and worker orchestration

**Files:**
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-extraction-repository.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-extraction-repository.pglite.test.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-extraction-worker.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-extraction-worker.test.ts`

**Interfaces:**

```ts
export interface PaperNoteExtractionRepository {
  claimNextPage(input: { workerId: string; now: Date; leaseMs: number }): Promise<ClaimedPaperNotePage | null>;
  updateStage(input: { pageId: string; leaseToken: string; stage: PaperNotePageStage; contextPatch?: Record<string, unknown>; now: Date }): Promise<void>;
  completePage(input: {
    pageId: string;
    leaseToken: string;
    analysisObjectKey: string;
    segmentation: PaperNotePageSegmentation;
    entries: PaperNoteExtraction[];
    now: Date;
  }): Promise<void>;
  failPage(input: { pageId: string; leaseToken: string; errorCode: string; safeMessage: string; retryable: boolean; now: Date }): Promise<void>;
}

export class PaperNoteExtractionWorker {
  runOne(input: { workerId: string; now: Date }): Promise<{ kind: "idle" | "processed"; pageId?: string }>;
}
```

- [ ] **Step 1: Write failing claim/lease tests**

Prove `FOR UPDATE SKIP LOCKED`/equivalent claims one queued or expired-leased page, increments attempt count, uses a random lease token, releases the DB connection before provider work, rejects completion from a stale token, replaces prior extracted entries atomically on retry, and moves the batch to `review` when all pages are terminal/reviewable.

- [ ] **Step 2: Write failing worker tests**

With fake repository/storage/image/provider, prove the sequence:
1. claim;
2. fetch original;
3. prepare/store analysis derivative;
4. save `segment` stage;
5. segment page;
6. crop each valid region or use full page fallback;
7. extract entries sequentially in source order;
8. atomically complete page.

Also prove provider unavailable → `needs_retry`, malformed output gets only provider-level bounded retry, one page failure does not touch neighboring pages, and logs receive IDs/stage/counts only.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-extraction-repository.pglite.test.ts src/features/paper-notes/paper-note-extraction-worker.test.ts
```

Expected: FAIL because extraction persistence/worker are absent.

- [ ] **Step 4: Implement short claim/finalize transactions**

Never hold a transaction or pool client while calling storage, Sharp, or the AI provider. Use a five-minute lease and maximum three automatic page attempts; later retries require an explicit owner action.

- [ ] **Step 5: Implement immutable extraction replacement**

Within `completePage`, delete only the page's prior unimported entries, insert the new ordered extraction payloads, initialize review payloads, set validation issues, and update page/batch states in one transaction.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-extraction-repository.pglite.test.ts src/features/paper-notes/paper-note-extraction-worker.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/paper-notes/paper-note-extraction-repository* artifacts/api-server/src/features/paper-notes/paper-note-extraction-worker*
git commit -m "feat: process paper note extraction jobs"
```

### Task 11: Start one non-overlapping Paper Notes worker loop

**Files:**
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-worker-loop.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-worker-loop.test.ts`
- Modify: `artifacts/api-server/src/index.ts`
- Modify/Test: `artifacts/api-server/src/index.startup-order.test.ts`

**Interfaces:**

```ts
export class PaperNoteWorkerLoop {
  start(): void;
  close(): Promise<void>;
}
```

Idle delay 30 seconds, processed delay 1 second, unexpected outer failure delay 60 seconds. One active promise maximum.

- [ ] **Step 1: Write failing loop tests**

Copy the deterministic scheduler style from `lead-scout-worker-loop.test.ts`. Prove double `start()` does not create two loops, ticks never overlap, close cancels pending work and waits for active work, and safe logs contain no page content.

- [ ] **Step 2: Write failing startup/shutdown contract test**

Assert the server binds before post-listen maintenance, starts the Paper Notes loop only after migrations, and includes `paperNoteLoop.close()` in shutdown alongside ACT and Lead Scout loops.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-worker-loop.test.ts src/index.startup-order.test.ts
```

Expected: FAIL because the loop is absent.

- [ ] **Step 4: Implement the loop and startup wiring**

Instantiate one loop with worker ID `paper-notes-${randomUUID()}`. Start it regardless of provider configuration so it can idle and expose configuration state, but make the worker leave queued pages retryable instead of spinning when provider/storage is unavailable.

- [ ] **Step 5: Run tests, typecheck, and build**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-worker-loop.test.ts src/index.startup-order.test.ts
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/api-server build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/paper-notes/paper-note-worker-loop* artifacts/api-server/src/index.ts artifacts/api-server/src/index.startup-order.test.ts
git commit -m "feat: run paper note extraction worker"
```

### Task 12: Add extraction recovery routes

**Files:**
- Create: `artifacts/api-server/src/routes/paper-note-extraction.ts`
- Create: `artifacts/api-server/src/routes/paper-note-extraction.test.ts`
- Modify: `artifacts/api-server/src/routes/paper-notes.ts`
- Modify: `artifacts/api-server/src/features/paper-notes/paper-note-intake-repository.ts`

**Interfaces:**

```text
POST /paper-notes/batches/:batchId/pages/:pageId/retry
POST /paper-notes/batches/:batchId/pages/:pageId/manual-entry
POST /paper-notes/batches/:batchId/pages/:pageId/reviewed-empty
```

`GET /paper-notes/batches/:batchId` now returns progress, page stage, safe retry code/message, and extracted entry summaries.

- [ ] **Step 1: Write failing route/state tests**

Prove retry is accepted only for `needs_retry`; manual entry creates one `needs_review` entry linked to the page with extraction source `manual`; reviewed-empty is allowed only when no imported/approved entry exists; each action is owner-scoped and updates batch readiness.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/routes/paper-note-extraction.test.ts
```

Expected: FAIL because recovery routes are absent.

- [ ] **Step 3: Implement explicit recovery mutations**

Manual entry payload is `{ transcription: string }` with max 12,000 characters and no invented structured fields. Retry clears safe page error/stale lease and queues the page. Reviewed-empty retains source page provenance and marks a terminal page state.

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/routes/paper-note-extraction.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/paper-note-extraction* artifacts/api-server/src/routes/paper-notes.ts artifacts/api-server/src/features/paper-notes/paper-note-intake-repository.ts
git commit -m "feat: recover failed paper note pages"
```

### Task 13: Show extraction progress and source pages in the batch screen

**Files:**
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-progress.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-progress.test.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-source-viewer.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-source-viewer.test.tsx`
- Create: `artifacts/adventure-zone/src/pages/PaperNoteBatchReviewPage.tsx`
- Modify: `artifacts/adventure-zone/src/features/paper-notes/paper-note-client.ts`

**Interfaces:**
- Poll active batches every 3 seconds through React Query; stop polling when all pages are extracted/retryable/reviewed-empty.
- The source viewer requests a signed URL only when opened and does not retain object keys.

- [ ] **Step 1: Write failing progress/recovery tests**

Render mixed page states and assert readable messages such as `Preparing page 3 of 12`, `Finding entries`, `Reading entries`, and `2 pages need attention`. Prove **Retry reading**, **Add entry manually**, and **Mark page reviewed — no importable entries** call the correct client functions.

- [ ] **Step 2: Write failing source-viewer accessibility tests**

Assert dialog title/alt text, keyboard Escape close, focus return to invoking button, full-page/original toggle, and wrapped metadata without horizontal page scrolling.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/paper-notes/paper-note-progress.test.tsx src/components/paper-notes/paper-note-source-viewer.test.tsx
```

Expected: FAIL because progress/viewer components are absent.

- [ ] **Step 4: Implement progress polling and recovery UI**

Keep server data authoritative. Show a configuration banner when `configuration.aiAvailable` or `configuration.storageAvailable` is false; keep uploaded batches visible and retryable.

- [ ] **Step 5: Implement lazy source viewing**

Use the server-provided signed URL response; do not persist it beyond component state. Re-request after expiry or viewer reopen.

- [ ] **Step 6: Run tests, typecheck, and build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/paper-notes/paper-note-progress.test.tsx src/components/paper-notes/paper-note-source-viewer.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/paper-notes/paper-note-progress* artifacts/adventure-zone/src/components/paper-notes/paper-note-source-viewer* artifacts/adventure-zone/src/pages/PaperNoteBatchReviewPage.tsx artifacts/adventure-zone/src/features/paper-notes/paper-note-client.ts
git commit -m "feat: show paper note extraction progress"
```

---

# Release 3 — Versioned Review, Matching, and Conflict Decisions

Release 3 is independently testable on top of Release 2: every extracted/manual entry can be corrected, matched or marked new, reviewed against current CRM values, approved or skipped, and safely resumed. It still performs no CRM mutation.

### Task 14: Define reviewed payloads, deterministic validation, and note preview

**Files:**
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-review-schema.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-review-schema.test.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-note-composer.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-note-composer.test.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-review-service.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-review-service.test.ts`

**Interfaces:**

```ts
export type PaperNoteReviewPayload = {
  event: { name: string; city: string; region: string; venue: string; eventDateText: string; startsOn: string | null; endsOn: string | null; pageYearConfirmed: boolean };
  activity: { occurredOn: string | null; method: "call" | "email" | "mail" | "text" | "unknown"; outcome: string; summary: string };
  contacts: PaperNoteReviewedContact[];
  organizationPhones: PaperNoteReviewedPhone[];
  oldReminder: string;
  starredOnPaper: boolean;
  generalNotes: string[];
  destination: PaperNoteDestinationChoice;
  conflicts: Record<string, PaperNoteConflictDecision>;
  currentFollowUp: { enabled: boolean; kind: string; dueOn: string | null; contactKey: string | null };
};

export interface PaperNoteReviewService {
  updateEntry(input: { actorId: string; entryId: string; expectedVersion: number; review: PaperNoteReviewPayload; now: Date }): Promise<PaperNoteEntryView>;
  approveEntry(input: { actorId: string; entryId: string; expectedVersion: number; now: Date }): Promise<PaperNoteEntryView>;
  unapproveEntry(input: { actorId: string; entryId: string; expectedVersion: number; now: Date }): Promise<PaperNoteEntryView>;
  skipEntry(input: { actorId: string; entryId: string; expectedVersion: number; now: Date }): Promise<PaperNoteEntryView>;
}
```

- [ ] **Step 1: Write failing validation/state tests**

Cover extraction payload immutability, empty new-profile name, two-letter state, invalid email, partial/unreadable phone used as structured data, invalid extension, unresolved destination, unresolved conflict, source object missing, follow-up enabled without absolute date, skip without destination, editing an approved entry returning it to `ready`/`needs_review`, and stale `expectedVersion` returning 409 semantics.

- [ ] **Step 2: Write failing note-composer tests**

Assert exact rules:

```ts
expect(body).toContain("Imported from paper notes");
expect(body).toContain("Original reminder: Call Monday. This was a historical reminder and was not added as a current task.");
expect(body).toContain("Starred on original paper.");
expect(body).not.toContain("Favorite");
```

Also prove no star sentence when unchecked, original transcription is retained, unknown historical date is labeled, page-derived event year wording appears only after confirmation, and an explicitly created current follow-up states its new date separately.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-review-schema.test.ts src/features/paper-notes/paper-note-note-composer.test.ts src/features/paper-notes/paper-note-review-service.test.ts
```

Expected: FAIL because review services are absent.

- [ ] **Step 4: Implement authoritative validation and state derivation**

Clients never submit `state`, `validationIssues`, `targetSnapshot`, or preview text as trusted values. Derive them server-side. Approval requires zero blocking issues; skipped entries need no destination; every edit increments `reviewVersion` and clears `approvedAt`.

- [ ] **Step 5: Implement target fingerprint helpers**

Use canonical JSON plus SHA-256 for only fields used by decisions. Export:

```ts
export function fingerprintPaperNoteTarget(value: unknown): string;
```

Do not fingerprint unrelated `updatedAt` timestamps.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-review-schema.test.ts src/features/paper-notes/paper-note-note-composer.test.ts src/features/paper-notes/paper-note-review-service.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/paper-notes/paper-note-review-* artifacts/api-server/src/features/paper-notes/paper-note-note-composer*
git commit -m "feat: validate reviewed paper notes"
```

### Task 15: Rank existing profiles, locations, contacts, and phones deterministically

**Files:**
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-matching-service.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-matching-service.pglite.test.ts`

**Interfaces:**

```ts
export type PaperNoteMatchCandidate = {
  destinationMode: "existing_profile" | "existing_profile_new_location";
  organizationId: string;
  organizationLocationId: string | null;
  contactIds: string[];
  label: string;
  city: string | null;
  region: string | null;
  score: number;
  strength: "strong" | "possible" | "weak";
  reasons: string[];
};

export interface PaperNoteMatchingService {
  findMatches(input: { actorId: string; entryId: string; limit?: number }): Promise<PaperNoteMatchCandidate[]>;
}
```

- [ ] **Step 1: Write failing ranking tests**

Seed fictional records and prove this order:
1. exact normalized contact phone plus compatible extension;
2. exact organization/location phone;
3. exact email;
4. exact normalized event name + city/state;
5. strong name + venue/contact;
6. conservative fuzzy name/location;
7. weak name only.

Also prove parent organization + new city explains location mode, event-family context explains without auto-linking, similar names in different cities stay separate, inactive phones do not outrank active exact numbers, questionable phones include a warning reason, legacy phone fields remain matchable, consolidated profiles are not destinations, and at most five candidates return.

- [ ] **Step 2: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-matching-service.pglite.test.ts
```

Expected: FAIL because matching is absent.

- [ ] **Step 3: Implement bounded candidate queries**

Query exact phone/email candidates first, then normalized name/city candidates using bounded SQL. Score in TypeScript. Do not ask the AI provider to choose or rank a CRM destination.

- [ ] **Step 4: Implement explanation strings**

Produce plain evidence such as `Same event name, city, and phone number` or `Same parent organization; paper entry appears to be a new city/location`. Weak results are never preselected.

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-matching-service.pglite.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/paper-notes/paper-note-matching-service*
git commit -m "feat: match paper notes to crm profiles"
```

### Task 16: Expose versioned review, matching, and source authorization APIs

**Files:**
- Create: `artifacts/api-server/src/routes/paper-note-review.ts`
- Create: `artifacts/api-server/src/routes/paper-note-review.test.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-source-service.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-source-service.test.ts`
- Modify: `artifacts/api-server/src/routes/paper-notes.ts`

**Interfaces:**

```text
PATCH /paper-notes/entries/:entryId
POST  /paper-notes/entries/:entryId/approve
POST  /paper-notes/entries/:entryId/unapprove
POST  /paper-notes/entries/:entryId/skip
GET   /paper-notes/entries/:entryId/matches
GET   /paper-notes/entries/:entryId/source-url?variant=analysis|original
```

- [ ] **Step 1: Write failing route tests**

Prove owner auth, UUID validation, optimistic `expectedVersion`, 409 stale response with current entry view, server-generated issues/preview, invalid link IDs, approve only when ready, skip behavior, bounded matches, and no object key in source response.

- [ ] **Step 2: Write failing source-service tests**

Prove the entry belongs to the authenticated owner, imported/active source rows are allowed, missing object blocks approval/import, signed URL expires in 900 seconds, and cross-batch/cross-owner lookup returns not found.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/routes/paper-note-review.test.ts src/features/paper-notes/paper-note-source-service.test.ts
```

Expected: FAIL because review routes/source service are absent.

- [ ] **Step 4: Implement routes and safe conflict responses**

Return `{ error, code, currentEntry }` for version conflicts. Return only safe match/source metadata. Never accept client-computed validation, score, fingerprint, or preview fields.

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/routes/paper-note-review.test.ts src/features/paper-notes/paper-note-source-service.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/paper-note-review* artifacts/api-server/src/routes/paper-notes.ts artifacts/api-server/src/features/paper-notes/paper-note-source-service*
git commit -m "feat: expose paper note review workflow"
```

### Task 17: Build source-first entry editing with versioned autosave

**Files:**
- Create: `artifacts/adventure-zone/src/features/paper-notes/paper-note-review-state.ts`
- Create: `artifacts/adventure-zone/src/features/paper-notes/paper-note-review-state.test.ts`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-entry-navigator.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-entry-card.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-entry-card.test.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-contact-editor.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-phone-editor.tsx`
- Modify: `artifacts/adventure-zone/src/pages/PaperNoteBatchReviewPage.tsx`
- Modify: `artifacts/adventure-zone/src/features/paper-notes/paper-note-client.ts`

**Interfaces:**
- Autosave after 700 ms idle; only one save request per entry at a time.
- A stale-version response replaces the local base with the returned server entry and shows a merge/retry warning rather than pretending the edit saved.

- [ ] **Step 1: Write failing review-state tests**

Prove dirty/saving/saved/error transitions, queued edits are sent after the active save, approved entry edits invalidate local approval display, and stale server response keeps unsaved user values visible for manual reconciliation.

- [ ] **Step 2: Write failing entry-card tests**

Assert source crop/full page first on mobile, editable event/location/activity/contact/email/phone/extension/type/label/instructions/status fields, explicit **Unreadable / leave unstructured** behavior, old reminder shown as historical, star checkbox wording `Starred on original paper`, and no favorite/priority controls.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/paper-notes/paper-note-review-state.test.ts src/components/paper-notes/paper-note-entry-card.test.tsx
```

Expected: FAIL because review state/cards are absent.

- [ ] **Step 4: Implement one-card-at-a-time mobile review**

Filters are **Needs review**, **Ready**, **Approved**, **Skipped**, **All**. Next/previous controls preserve keyboard access. Long numbers/emails/transcriptions wrap. Every warning includes text and field association.

- [ ] **Step 5: Implement versioned autosave**

Send `{ expectedVersion, review }`. Show `Saving…`, `Saved`, or a retryable error. Never advance to another card while silently discarding unsaved edits; prompt or finish the save first.

- [ ] **Step 6: Run tests, typecheck, and build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/paper-notes/paper-note-review-state.test.ts src/components/paper-notes/paper-note-entry-card.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/features/paper-notes artifacts/adventure-zone/src/components/paper-notes/paper-note-entry-* artifacts/adventure-zone/src/components/paper-notes/paper-note-contact-editor.tsx artifacts/adventure-zone/src/components/paper-notes/paper-note-phone-editor.tsx artifacts/adventure-zone/src/pages/PaperNoteBatchReviewPage.tsx
git commit -m "feat: review extracted paper note entries"
```

### Task 18: Add destination, conflict, preview, approval, and skip controls

**Files:**
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-destination-picker.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-destination-picker.test.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-conflict-review.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-conflict-review.test.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-import-preview.tsx`
- Modify: `artifacts/adventure-zone/src/components/paper-notes/paper-note-entry-card.tsx`

**Interfaces:**
- Destination choices: link existing profile, create location under existing profile, create new profile, skip.
- Phone decisions use the exact approved values: `keep_saved`, `same_phone_update_details`, `add_alternate`, `replace_primary`, `inactivate_saved_add_paper`, `add_questionable`, `ignore_paper`, `crossed_out_note_only`.

- [ ] **Step 1: Write failing destination tests**

Prove match reasons display, weak matches are not preselected, manual search works, existing profile + new contact is possible, new location mode requires a parent, new profile requires name, optional event family is explicit, and skip removes destination requirements.

- [ ] **Step 2: Write failing conflict/preview tests**

Prove saved/paper values render side by side, every writable conflict requires a decision, crossed-out values default to note-only review, `bad number`/`mailbox full` do not set Do Not Call, current follow-up starts off, enabling it requires a new absolute date, and the plain-language preview says **No current follow-up** by default.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/paper-notes/paper-note-destination-picker.test.tsx src/components/paper-notes/paper-note-conflict-review.test.tsx
```

Expected: FAIL because destination/conflict UI is absent.

- [ ] **Step 4: Implement server-driven conflict controls**

Render only conflicts and allowed decisions returned by the server. Do not infer replacement/deactivation choices in the browser.

- [ ] **Step 5: Add approve/unapprove/skip actions**

Disable approve while dirty/saving or while server blocking issues exist. Update card/filter counts from the returned server entry/batch summary.

- [ ] **Step 6: Run tests, typecheck, and build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/paper-notes/paper-note-destination-picker.test.tsx src/components/paper-notes/paper-note-conflict-review.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/paper-notes/paper-note-destination-picker* artifacts/adventure-zone/src/components/paper-notes/paper-note-conflict-review* artifacts/adventure-zone/src/components/paper-notes/paper-note-import-preview.tsx artifacts/adventure-zone/src/components/paper-notes/paper-note-entry-card.tsx
git commit -m "feat: approve paper note import decisions"
```

---

# Release 4 — Atomic CRM Import and Provenance

Release 4 completes the feature: approved entries preflight against current CRM values and import together in one transaction. New/existing profiles, locations, contacts, structured phones, one historical activity per entry, and optional current follow-ups are written with provenance and a completed summary.

### Task 19: Add one structured phone mutation service

**Files:**
- Modify: `artifacts/api-server/src/features/contact-phones/contact-phone-types.ts`
- Modify: `artifacts/api-server/src/features/contact-phones/contact-phone-repository.ts`
- Modify/Test: `artifacts/api-server/src/features/contact-phones/contact-phone-repository.test.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-phone-service.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-phone-service.pglite.test.ts`

**Interfaces:**

```ts
export type StructuredPhoneMutation = {
  owner: { kind: "contact"; contactId: string } | { kind: "organization"; organizationId: string; organizationLocationId: string | null };
  decision: PaperNotePhoneDecision;
  paper: { number: string; extension: string | null; type: ContactPhoneType; label: string | null; instructions: string | null; status: "active" | "questionable" | "inactive" };
  existingPhoneId: string | null;
  sourcePaperNoteEntryId: string;
};

export interface PaperNotePhoneService {
  apply(transaction: PaperNoteTransaction, mutation: StructuredPhoneMutation, now: Date): Promise<{ phoneId: string | null; action: string }>;
}
```

- [ ] **Step 1: Write failing contact-phone regression tests**

Prove existing local edit flow preserves `instructions`, `status`, and provenance; exactly one active primary remains; inactive phones cannot be default primary; active primary still syncs `contacts.phone`; Do Not Call fields remain unchanged.

- [ ] **Step 2: Write failing paper-phone decision tests**

Cover add contact phone with extension, add organization/location phone, same-phone detail update, alternate, replace primary, inactivate-and-add, questionable, ignore, crossed-out note-only, duplicate normalized number+extension, wrong-location organization rejection, and legacy organization/contact synchronization.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/contact-phones/contact-phone-repository.test.ts src/features/paper-notes/paper-note-phone-service.pglite.test.ts
```

Expected: FAIL because new phone fields/service are not wired.

- [ ] **Step 4: Extend contact-phone repository without breaking callers**

Default omitted `instructions` to null and `status` to active for current UI callers. Sort active primary first, then questionable, then inactive. Keep suppressed numbers immutable according to existing Do Not Call rules.

- [ ] **Step 5: Implement paper-note phone decisions in the caller transaction**

Do not start a nested transaction. Normalize number/extension once, lock the owner scope, demote prior primary before promotion, and record `source = "paper_note"` plus entry provenance.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/contact-phones/contact-phone-repository.test.ts src/features/paper-notes/paper-note-phone-service.pglite.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/contact-phones artifacts/api-server/src/features/paper-notes/paper-note-phone-service*
git commit -m "feat: apply structured paper note phones"
```

### Task 20: Build stale-aware batch preflight

**Files:**
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-preflight-service.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-preflight-service.pglite.test.ts`

**Interfaces:**

```ts
export type PaperNoteBatchPreflight = {
  ready: boolean;
  batchId: string;
  approvedCount: number;
  skippedCount: number;
  blocking: Array<{ entryId: string | null; code: string; message: string }>;
  preview: PaperNoteImportSummary;
};

export interface PaperNotePreflightService {
  preflight(input: { actorId: string; batchId: string; now: Date }): Promise<PaperNoteBatchPreflight>;
}
```

- [ ] **Step 1: Write failing readiness tests**

Prove import blocks when zero approved entries, an entry is neither approved nor skipped, a page remains uploading/queued/extracting/needs-retry, source object metadata is absent, target IDs are invalid, current follow-up lacks a new date, or batch is already importing under another key.

- [ ] **Step 2: Write failing stale-fingerprint tests**

Review a saved phone/email/name, mutate only that field, and assert preflight blocks the affected entry with a specific message and moves it to `needs_review`. Mutate unrelated profile data and assert preflight remains ready.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-preflight-service.pglite.test.ts
```

Expected: FAIL because preflight is absent.

- [ ] **Step 4: Implement authoritative revalidation**

Reload each reviewed target field, recompute exact fingerprints, regenerate validation/issues/preview, and write stale issues before returning. Do not mutate CRM entities.

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-preflight-service.pglite.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/paper-notes/paper-note-preflight-service*
git commit -m "feat: preflight paper note imports"
```

### Task 21: Import approved entries in one idempotent transaction

**Files:**
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-import-service.ts`
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-import-service.pglite.test.ts`

**Interfaces:**

```ts
export interface PaperNoteImportService {
  importBatch(input: { actorId: string; batchId: string; requestKey: string; now: Date }): Promise<PaperNoteImportSummary>;
}
```

`requestKey` is a UUID generated once by the browser and reused on retry.

- [ ] **Step 1: Write failing happy-path tests**

Cover:
- link existing profile;
- create standalone `festival_event` profile without booking;
- create new location under existing profile;
- optional existing event-family membership;
- link existing/create new contacts and roles;
- structured contact and organization/location phones with extension/instructions;
- one source-linked historical activity per entry;
- no follow-up by default;
- explicit current follow-up with new absolute date;
- imported entry/batch summary fields.

- [ ] **Step 2: Write failing historical-note/date tests**

Assert `kind = "note"`, `subject = "Imported from paper notes"`, `sourceType = "paper_note"`, unique `paperNoteEntryId`, unknown historical date uses `occurredAt = null`, `timelineSortAt = now`, `dateIsImportFallback = true`, old reminder remains historical, and star sentence appears only when reviewed on.

- [ ] **Step 3: Write failing atomicity/idempotency tests**

Force the second entry write to fail and assert zero profiles/contacts/phones/activities/follow-ups from the batch persist. Repeat a successful request key and assert the stored summary is returned with no duplicate rows. A different key after success also returns the stored success rather than reimporting.

- [ ] **Step 4: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-import-service.pglite.test.ts
```

Expected: FAIL because import is absent.

- [ ] **Step 5: Implement the transaction sequence exactly**

1. Lock owner-scoped batch.
2. Return stored summary when imported.
3. Persist/reuse request key and mark importing.
4. Lock approved/skipped entries.
5. Run preflight/fingerprint checks before the first CRM write.
6. Create/link profile/location/family/contact relationships.
7. Apply explicit field/phone decisions only.
8. Compose and insert one paper-note activity.
9. Insert optional follow-up only when enabled.
10. Record audit entries/import result per entry.
11. Mark entries imported and batch imported with summary.
12. Commit.

No storage or provider operation is allowed in this function.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-import-service.pglite.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/paper-notes/paper-note-import-service*
git commit -m "feat: import approved paper note batches"
```

### Task 22: Add preflight/import/archive routes and completed-batch UI

**Files:**
- Create: `artifacts/api-server/src/routes/paper-note-import.ts`
- Create: `artifacts/api-server/src/routes/paper-note-import.test.ts`
- Modify: `artifacts/api-server/src/routes/paper-notes.ts`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-batch-preflight-dialog.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-batch-preflight-dialog.test.tsx`
- Create: `artifacts/adventure-zone/src/components/paper-notes/paper-note-import-summary.tsx`
- Modify: `artifacts/adventure-zone/src/pages/PaperNoteBatchReviewPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/PaperNotesInboxPage.tsx`
- Modify: `artifacts/adventure-zone/src/features/paper-notes/paper-note-client.ts`

**Interfaces:**

```text
POST /paper-notes/batches/:batchId/preflight
POST /paper-notes/batches/:batchId/import
POST /paper-notes/batches/:batchId/archive
```

- [ ] **Step 1: Write failing route tests**

Prove owner auth, UUID request key, preflight summary, 409 stale/unready response with entry IDs, successful import, safe retry, completed batch cannot be deleted/reimported, and archive changes only the list state while preserving pages/provenance.

- [ ] **Step 2: Write failing dialog/summary tests**

Assert final button is unavailable until every entry is approved/skipped and every page resolved; dialog announces blocking issues and exact create/update/note/follow-up counts; confirm text is **Import Approved Entries**; import generates/reuses one request key; connection failure offers retry with the same key; completed summary lists created/linked/updated/skipped/scheduled actions.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/routes/paper-note-import.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/paper-notes/paper-note-batch-preflight-dialog.test.tsx
```

Expected: FAIL because import route/UI are absent.

- [ ] **Step 4: Implement import routes**

Map stale/unready preflight to 409, validation to 400, missing to 404, transaction failure to 500 with safe text, and existing stored success to 200. Archive only imported batches.

- [ ] **Step 5: Implement preflight dialog and completed state**

Refresh the batch after preflight/import. Keep source pages accessible. Completed batch cards show import date and entity counts; release 1 has archive, not delete.

- [ ] **Step 6: Run focused tests, typechecks, and builds**

```bash
pnpm --filter @workspace/api-server test -- src/routes/paper-note-import.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/paper-notes/paper-note-batch-preflight-dialog.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/paper-note-import* artifacts/api-server/src/routes/paper-notes.ts artifacts/adventure-zone/src/components/paper-notes/paper-note-batch-preflight-dialog* artifacts/adventure-zone/src/components/paper-notes/paper-note-import-summary.tsx artifacts/adventure-zone/src/pages/PaperNoteBatchReviewPage.tsx artifacts/adventure-zone/src/pages/PaperNotesInboxPage.tsx artifacts/adventure-zone/src/features/paper-notes/paper-note-client.ts
git commit -m "feat: finish paper note batch imports"
```

### Task 23: Surface structured phones and source-paper provenance in existing CRM screens

**Files:**
- Modify: `artifacts/api-server/src/features/activities/activity-types.ts`
- Modify: `artifacts/api-server/src/features/activities/activity-repository.ts`
- Modify/Test: `artifacts/api-server/src/features/activities/activity-repository.test.ts`
- Modify: `artifacts/adventure-zone/src/features/activities/activity-types.ts`
- Modify: `artifacts/adventure-zone/src/components/activities/activity-timeline.tsx`
- Modify/Test: `artifacts/adventure-zone/src/components/activities/activity-timeline.test.tsx`
- Modify: `artifacts/api-server/src/features/event-profiles/event-profile-repository.ts`
- Modify/Test: `artifacts/api-server/src/features/event-profiles/event-profile-repository.test.ts`
- Modify: `artifacts/api-server/src/features/contact-phones/contact-phone-types.ts`
- Modify assisted-calling/profile phone consumers found by repository search.

**Interfaces:**

```ts
export type ActivityTimelineItem = {
  // existing fields...
  historicalDateUnknown: boolean;
  paperNoteSource: null | { entryId: string; pageId: string };
};
```

The browser receives IDs/flags only; **View source paper** calls the existing owner-authorized source endpoint.

- [ ] **Step 1: Write failing activity timeline tests**

Prove paper-note activity with null `occurredAt` renders `Historical date unknown · imported Aug 20, 2026`, shows **Imported from paper notes**, shows **View source paper**, and does not label it as ACT. Known historical date renders normally. Paper-note source activities are read-only like source-backed records; corrections are new notes, not edits to provenance.

- [ ] **Step 2: Write failing profile/calling phone tests**

Prove profile responses include organization/location phones and contact phone instructions/status; active primary is default dial target; inactive numbers are excluded from default dial action but remain visible; questionable number displays a warning; extension remains separate; legacy-only values still appear during transition.

- [ ] **Step 3: Run and confirm RED**

```bash
pnpm --filter @workspace/api-server test -- src/features/activities/activity-repository.test.ts src/features/event-profiles/event-profile-repository.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/activities/activity-timeline.test.tsx
```

Expected: FAIL because paper provenance/phone status are not projected.

- [ ] **Step 4: Extend server projections safely**

Join only paper-note entry/page IDs needed for authorization; never return storage keys. Update edit/delete guards to treat `paperNoteEntryId` as immutable source-backed history. Add structured organization/location phones to event profile projection and update calling selection rules.

- [ ] **Step 5: Extend timeline/profile UI**

Render source action and unknown-date label. Display phone type/label, extension, instructions, and active/questionable/inactive text. Keep Do Not Call display distinct.

- [ ] **Step 6: Run regressions, typechecks, and builds**

```bash
pnpm --filter @workspace/api-server test -- src/features/activities/activity-repository.test.ts src/features/event-profiles/event-profile-repository.test.ts src/features/contact-phones/contact-phone-repository.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/activities/activity-timeline.test.tsx
pnpm run typecheck
pnpm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/activities artifacts/api-server/src/features/event-profiles artifacts/api-server/src/features/contact-phones artifacts/api-server/src/features/calls artifacts/adventure-zone/src/features/activities artifacts/adventure-zone/src/components/activities artifacts/adventure-zone/src/components/event-profiles
git commit -m "feat: show paper note provenance and phone status"
```

### Task 24: Add end-to-end coverage, configuration health, and focused CI

**Files:**
- Create: `artifacts/api-server/src/features/paper-notes/paper-note-import.e2e.pglite.test.ts`
- Create: `artifacts/adventure-zone/src/pages/PaperNotesWorkflow.test.tsx`
- Create: `.github/workflows/paper-notes-importer-ci.yml`
- Modify: `render.yaml` only if a new documented environment variable is truly required; prefer existing Google Cloud/AI variables.
- Modify: `docs/superpowers/specs/2026-08-20-paper-notes-importer-design.md` only for implementation-discovered clarifications, not status notes.

- [ ] **Step 1: Write the server end-to-end synthetic workflow**

Use only fictional data and mocked provider responses. Exercise create batch → upload synthetic image → queue → worker segmentation/extraction → edit/version → match/create destination → approve/skip → preflight → import. Assert profile/contact/phone/activity/follow-up/source provenance and completed summary. Add variants for provider outage, failed page recovery, stale target, forced transaction rollback, and repeated request key.

- [ ] **Step 2: Write the browser workflow test**

Mock API responses and exercise multi-select upload, leave/resume, extraction progress, source viewer, entry correction, destination choice, conflict decision, approval/skip filters, final preflight dialog, retry using the same request key, and completed summary. Include keyboard/focus assertions and mobile-width rendering.

- [ ] **Step 3: Run the focused complete suite**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes src/routes/paper-note-intake.test.ts src/routes/paper-note-extraction.test.ts src/routes/paper-note-review.test.ts src/routes/paper-note-import.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/paper-notes src/components/paper-notes src/pages/PaperNotesWorkflow.test.tsx src/App.admin-navigation.test.ts
```

Expected: PASS with zero real-image fixtures.

- [ ] **Step 4: Add focused GitHub Actions workflow**

```yaml
name: Paper Notes Importer CI

on:
  pull_request:
    paths:
      - "artifacts/api-server/src/features/paper-notes/**"
      - "artifacts/api-server/src/routes/paper-note-*.ts"
      - "artifacts/api-server/src/features/contact-phones/**"
      - "artifacts/api-server/src/features/activities/**"
      - "artifacts/adventure-zone/src/features/paper-notes/**"
      - "artifacts/adventure-zone/src/components/paper-notes/**"
      - "artifacts/adventure-zone/src/pages/PaperNote*.tsx"
      - "lib/db/migrations/066_paper_notes_importer.sql"
      - "lib/db/src/schema/index.ts"
      - ".github/workflows/paper-notes-importer-ci.yml"
  workflow_dispatch:

jobs:
  paper-notes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Paper Notes tests
        run: pnpm exec vitest run artifacts/api-server/src/features/paper-notes artifacts/api-server/src/routes/paper-note-intake.test.ts artifacts/api-server/src/routes/paper-note-extraction.test.ts artifacts/api-server/src/routes/paper-note-review.test.ts artifacts/api-server/src/routes/paper-note-import.test.ts artifacts/adventure-zone/src/features/paper-notes artifacts/adventure-zone/src/components/paper-notes artifacts/adventure-zone/src/pages/PaperNotesWorkflow.test.tsx
      - name: Workspace typecheck
        run: pnpm run typecheck
      - name: Workspace build
        run: pnpm run build
```

- [ ] **Step 5: Run full verification**

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/adventure-zone exec vitest run
```

Expected: every command exits 0. Record exact failures rather than describing an unrun or zero-step job as passing.

- [ ] **Step 6: Privacy and fixture scan**

```bash
git grep -nE '(701|208|406|307|435|801)[ -]?[0-9]{3}[ -]?[0-9]{4}' -- artifacts/api-server/src/features/paper-notes artifacts/adventure-zone/src docs/superpowers/plans .github/workflows || true
git ls-files | grep -Ei 'paper.*\.(jpe?g|png|webp|pdf)$' && exit 1 || true
```

Expected: only clearly fictional/example values in test source; no committed source-page images or PDFs.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/paper-notes/paper-note-import.e2e.pglite.test.ts artifacts/adventure-zone/src/pages/PaperNotesWorkflow.test.tsx .github/workflows/paper-notes-importer-ci.yml
git commit -m "test: verify paper notes importer workflow"
```

---

## Final Acceptance Verification

After Task 24, verify each approved behavior directly:

- [ ] **Imports & Data → Paper notes** opens on mobile and desktop.
- [ ] Multiple JPEG/PNG/WebP images upload sequentially and survive navigation/reload.
- [ ] Originals remain private; source URLs are owner-authorized and short-lived.
- [ ] Page heading/date context is separate from event entries.
- [ ] Event date and historical communication date remain separate.
- [ ] `Call Monday` remains historical and creates no current task by default.
- [ ] A star adds only `Starred on original paper.` to the note.
- [ ] Phone extensions, labels, instructions, status, ownership, and Do Not Call remain distinct.
- [ ] Crossed-out/unreadable values require review and never auto-overwrite.
- [ ] Exact/strong/weak matches explain evidence; none auto-link without approval.
- [ ] New profile, new location under existing profile, and new contact paths work.
- [ ] Every entry is approved or skipped before final import.
- [ ] Stale reviewed values block the whole import before writes.
- [ ] A forced failure rolls back every CRM write from the batch.
- [ ] Retrying the same successful request creates no duplicates.
- [ ] Profile history shows the imported note, correct historical-date label, and **View source paper**.
- [ ] Completed batch summary lists created, linked, updated, skipped, and scheduled results.
- [ ] Existing Act!, receipt extraction, assisted calling, manager portal, contact-phone, and activity tests remain green.
- [ ] CI contains no real paper images or personal contact data.
