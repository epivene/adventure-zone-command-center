# Paper Notes Importer Required Contract Appendix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining type, recovery, observability, and side-effect ambiguity from the Paper Notes Importer master implementation plan before code work begins.

**Architecture:** This file is a mandatory companion to `docs/superpowers/plans/2026-08-20-paper-notes-importer-master.md`. Read both files before Task 1. The master plan defines delivery order; this appendix defines exact shared contracts and adds required behavior to the named tasks. When wording conflicts, this appendix takes precedence.

**Tech Stack:** TypeScript 5.9, Express 5, PostgreSQL + Drizzle ORM, React 19, Wouter, TanStack React Query, Vitest, PGlite, Google Cloud Storage, Sharp, and the existing image-capable AI client.

**Spec:** `docs/superpowers/specs/2026-08-20-paper-notes-importer-design.md`

## Global Constraints

- This appendix and the master plan form one implementation-plan set; neither is optional.
- Do not broaden Release 1 to PDF import, automatic booking/calendar creation, automatic relative-date resolution, automatic favorites, or automatic CRM linking.
- Real paper-note photos and real extracted personal/business data never enter source control or CI artifacts.
- Every type below is the canonical name/signature used by the master plan. Do not create a second near-duplicate type with different property names.
- A source restore must reproduce the original stored SHA-256 exactly; replacement with different content is not restoration.
- Re-reading a rotated page is destructive to unimported extraction/review work and therefore requires an explicit confirmation.
- Imported pages and entries are immutable except for exact source-object restoration and batch archive state.

---

## Canonical Shared Contracts

Add these definitions to the file named beside each section during the referenced master-plan task.

### Extraction contracts

**Defined in:** `artifacts/api-server/src/features/paper-notes/paper-note-extraction-schema.ts` during master Task 9.

```ts
export type PaperNoteWarning = {
  fieldPath: string;
  message: string;
  severity: "warning" | "blocking";
};

export type PaperNoteExtractedPhone = {
  number: string | null;
  extension: string | null;
  type: "mobile" | "office" | "alternate" | "unknown";
  label: string | null;
  instructions: string | null;
  crossedOut: boolean;
};

export type PaperNoteExtraction = {
  source: "provider" | "manual";
  transcription: string;
  sourceRegion: PaperNoteRegion | null;
  mayContinue: boolean;
  event: {
    name: string | null;
    city: string | null;
    region: string | null;
    venue: string | null;
  };
  eventDates: Array<{
    rawText: string;
    startsOn: string | null;
    endsOn: string | null;
    derivedFromPageYear: boolean;
  }>;
  activity: {
    rawDateText: string | null;
    occurredOn: string | null;
    dateSource: "entry" | "page_heading" | "unknown";
    method: "call" | "email" | "mail" | "text" | "unknown";
    outcome: string | null;
    summary: string | null;
  };
  contacts: Array<{
    name: string | null;
    role: string | null;
    email: string | null;
    phones: PaperNoteExtractedPhone[];
  }>;
  organizationPhones: PaperNoteExtractedPhone[];
  oldReminder: string | null;
  starredOnPaper: boolean;
  generalNotes: string[];
  warnings: PaperNoteWarning[];
};
```

`source = "manual"` is used only by the explicit manual-entry recovery route. It starts with no inferred structured values and keeps the supplied transcription.

### Reviewed phone/contact contracts

**Defined in:** `artifacts/api-server/src/features/paper-notes/paper-note-review-schema.ts` during master Task 14.

```ts
export type PaperNotePhoneStatus = "active" | "questionable" | "inactive";

export type PaperNoteReviewedPhone = {
  key: string;
  number: string;
  extension: string | null;
  type: "mobile" | "office" | "alternate" | "unknown";
  label: string | null;
  instructions: string | null;
  status: PaperNotePhoneStatus;
  primary: boolean;
  crossedOut: boolean;
  importAsStructuredValue: boolean;
};

export type PaperNoteReviewedContact = {
  key: string;
  mode: "existing_contact" | "new_contact" | "note_only";
  selectedContactId: string | null;
  name: string;
  role: string | null;
  email: string | null;
  primary: boolean;
  phones: PaperNoteReviewedPhone[];
};
```

`note_only` preserves the person/email/phone wording in the historical activity without creating or changing a contact. Release 1 does not add a multi-email table. A paper email that conflicts with an existing email may only:

- replace the saved email after explicit approval,
- belong to a newly created contact, or
- remain note-only.

### Destination contracts

**Defined in:** `paper-note-review-schema.ts` during master Task 14.

```ts
export type PaperNoteNewLocationInput = {
  label: string;
  venueName: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
};

export type PaperNoteDestinationChoice =
  | {
      mode: "existing_profile";
      organizationId: string;
      organizationLocationId: string | null;
    }
  | {
      mode: "existing_profile_new_location";
      organizationId: string;
      newLocation: PaperNoteNewLocationInput;
    }
  | {
      mode: "new_profile";
      eventFamilyId: string | null;
    }
  | { mode: "skip" };
```

A `new_profile` destination takes its name/city/state/venue from the reviewed event fields. It creates no booking, calendar activity, route segment, trip, or package selection.

### Conflict-decision contracts

**Defined in:** `paper-note-review-schema.ts` during master Task 14 and used unchanged by master Tasks 18–21.

```ts
export type PaperNoteFieldDecision =
  | "keep_saved"
  | "replace_saved"
  | "ignore_paper_note_only"
  | "create_separate_location";

export type PaperNotePhoneDecision =
  | "keep_saved"
  | "same_phone_update_details"
  | "add_alternate"
  | "replace_primary"
  | "inactivate_saved_add_paper"
  | "add_questionable"
  | "ignore_paper"
  | "crossed_out_note_only";

export type PaperNoteConflictDecision =
  | {
      kind: "field";
      fieldPath: string;
      decision: PaperNoteFieldDecision;
      targetId: string | null;
    }
  | {
      kind: "phone";
      fieldPath: string;
      decision: PaperNotePhoneDecision;
      existingPhoneId: string | null;
    };
```

`create_separate_location` is valid only for profile/location conflicts. `crossed_out_note_only` is the default suggested choice for crossed-out text but still requires owner confirmation. No decision automatically changes Do Not Call fields.

### Review payload

**Defined in:** `paper-note-review-schema.ts` during master Task 14. This replaces any abbreviated version in the master plan.

```ts
export type PaperNoteReviewPayload = {
  event: {
    name: string;
    city: string;
    region: string;
    venue: string;
    eventDateText: string;
    startsOn: string | null;
    endsOn: string | null;
    pageYearConfirmed: boolean;
  };
  activity: {
    occurredOn: string | null;
    method: "call" | "email" | "mail" | "text" | "unknown";
    outcome: string;
    summary: string;
  };
  contacts: PaperNoteReviewedContact[];
  organizationPhones: PaperNoteReviewedPhone[];
  oldReminder: string;
  starredOnPaper: boolean;
  generalNotes: string[];
  destination: PaperNoteDestinationChoice;
  conflicts: Record<string, PaperNoteConflictDecision>;
  currentFollowUp: {
    enabled: boolean;
    kind: string;
    dueOn: string | null;
    contactKey: string | null;
  };
};
```

### Claimed-page worker contract

**Defined in:** `artifacts/api-server/src/features/paper-notes/paper-note-extraction-repository.ts` during master Task 10.

```ts
export type ClaimedPaperNotePage = {
  batchId: string;
  pageId: string;
  originalObjectKey: string;
  analysisObjectKey: string | null;
  declaredMimeType: string;
  rotationDegrees: 0 | 90 | 180 | 270;
  attemptCount: number;
  leaseToken: string;
  leaseExpiresAt: Date;
};
```

A claimed page never carries transcription, phone, email, or note text into structured logs.

### Transaction type

**Defined in:** `artifacts/api-server/src/features/paper-notes/paper-note-phone-service.ts` during master Task 19.

```ts
import type { db } from "@/db/client";

export type PaperNoteTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
```

`PaperNotePhoneService.apply()` consumes the caller's transaction. It must not call `db.transaction()` itself.

### Browser upload contracts

**Defined in:** `artifacts/adventure-zone/src/features/paper-notes/paper-note-upload-queue.ts` during master Task 7.

```ts
export type PaperNoteUploadProgress = {
  fileKey: string;
  filename: string;
  index: number;
  total: number;
  state: "pending" | "creating_page" | "uploading" | "uploaded" | "failed";
  pageId: string | null;
  error: string | null;
};

export type PaperNoteUploadResult = {
  fileKey: string;
  pageId: string | null;
  ok: boolean;
  error: string | null;
};
```

`fileKey` is a browser-only random UUID and is never treated as a database ID.

---

## Mandatory Amendments to Master Tasks

### Amendment A — Private storage must support existence checks

**Applies to master Task 3.**

Use this canonical interface:

```ts
export interface PrivateObjectStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  getSignedReadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
}
```

- [ ] **Add failing tests before implementation**

Prove `exists()` calls object metadata/existence without downloading bytes, returns false for a missing object, and never logs the key or object metadata. `PaperNoteSourceService` and preflight use `exists()` before returning/accepting provenance.

- [ ] **Run the amended focused test command**

```bash
pnpm --filter @workspace/api-server test -- src/lib/private-object-storage.test.ts src/features/paper-notes/paper-note-object-storage.test.ts src/features/paper-notes/paper-note-source-service.test.ts
```

Expected after implementation: PASS.

### Amendment B — Confirmed re-read after rotation

**Applies to master Tasks 5, 6, 10, 12, 13, and 17.**

Add this route:

```text
POST /paper-notes/batches/:batchId/pages/:pageId/re-read
```

Body:

```ts
{ rotationDegrees: 0 | 90 | 180 | 270; confirmDiscardReview: true }
```

Behavior:

1. Owner-scope and lock the batch/page.
2. Reject imported/archived batches and pages linked to imported entries.
3. Require `confirmDiscardReview === true` whenever extracted/manual entries exist.
4. Delete the old analysis object first; if deletion fails, leave database state unchanged.
5. In one transaction, delete that page's unimported entries, clear segmentation/context/errors/lease/analysis key, set the new rotation, set page `queued`, and set batch `queued`.
6. The worker recreates the analysis derivative from the unchanged original.

- [ ] **Add failing repository/service/route tests**

Prove changing an extracted page through the ordinary metadata PATCH returns 409 with `REREAD_CONFIRMATION_REQUIRED`; the dedicated route removes unimported corrections only after confirmation; a storage deletion failure preserves old extraction/review state; and imported pages cannot be re-read.

- [ ] **Add failing UI test**

Changing rotation on an extracted page opens a dialog stating that extracted entries and corrections for that page will be discarded. Cancel preserves state; confirm calls `/re-read` and returns the page to progress mode.

- [ ] **Run amended tests**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-intake-service.test.ts src/routes/paper-note-extraction.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/paper-notes/paper-note-source-viewer.test.tsx
```

Expected after implementation: PASS.

### Amendment C — Exact source-object restoration

**Applies to master Tasks 3, 5, 6, 16, 20, 22, and 23.**

Add this route:

```text
PUT /paper-notes/batches/:batchId/pages/:pageId/source
```

The route accepts a raw supported image and performs:

1. owner authorization;
2. image validation and SHA-256 calculation;
3. exact comparison with the page's stored `sha256`;
4. rejection with `SOURCE_HASH_MISMATCH` when different;
5. original-object write when identical;
6. no extraction/review/import mutation.

This route is allowed for imported batches because its only purpose is restoring provenance. It must not change filename, rotation, dimensions, extraction, activity, or import results.

- [ ] **Add failing tests**

Prove a missing original blocks approval/preflight and source viewing; an exact re-upload restores access; different bytes are rejected; restoration on an imported batch creates no CRM or review change; and a signed URL is returned only after `exists()` succeeds.

- [ ] **Add source-viewer recovery UI**

When the server returns `SOURCE_MISSING`, show **Restore original photo** with the exact-file requirement. Do not show ordinary replace wording.

- [ ] **Run amended tests**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-source-service.test.ts src/features/paper-notes/paper-note-preflight-service.pglite.test.ts src/routes/paper-note-intake.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/paper-notes/paper-note-source-viewer.test.tsx
```

Expected after implementation: PASS.

### Amendment D — Operational health and privacy-safe counts

**Applies to master Tasks 10–13 and 24.**

Define in `paper-note-types.ts`:

```ts
export type PaperNoteOperationalSummary = {
  queuedPages: number;
  extractingPages: number;
  retryablePages: number;
  batchesWaitingForReview: number;
  importedBatchesLast24Hours: number;
  failedImportsLast24Hours: number;
  averagePageExtractionMs: number | null;
  malformedOutputRate: number | null;
  providerUnavailableRate: number | null;
};
```

Add owner-only:

```text
GET /paper-notes/health
```

Response:

```ts
{
  configuration: PaperNoteConfigurationView;
  operations: PaperNoteOperationalSummary;
}
```

Counts and rates contain no names, filenames, object keys, transcriptions, phone numbers, emails, or note text.

- [ ] **Add failing repository/route tests**

Seed mixed page/batch states and extraction durations/error codes. Assert exact counts, bounded 24-hour window, null rates when denominator is zero, owner authentication, and absence of content fields.

- [ ] **Add safe structured-log tests**

Capture worker/import logger calls and assert allowed keys are limited to IDs, stage, provider name, attempt, duration, counts, safe error code, and entity totals. Assert no extraction payload or review payload appears.

- [ ] **Run amended tests**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-extraction-repository.pglite.test.ts src/features/paper-notes/paper-note-extraction-worker.test.ts src/routes/paper-note-extraction.test.ts
```

Expected after implementation: PASS.

### Amendment E — Source continuation warning is required UI

**Applies to master Tasks 9, 13, and 17.**

- [ ] **Add extraction parser assertion**

`mayContinue=true` survives segmentation → entry extraction persistence → browser view.

- [ ] **Add entry/source UI assertion**

The source area displays:

> This entry may continue outside this crop. Check the full page before approving it.

The message must be text, not color-only, and **View full page** must be adjacent.

- [ ] **Run amended tests**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-extraction-schema.test.ts src/features/paper-notes/paper-note-extraction-repository.pglite.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/paper-notes/paper-note-entry-card.test.tsx src/components/paper-notes/paper-note-source-viewer.test.tsx
```

Expected after implementation: PASS.

### Amendment F — Imported activity location and strict no-booking side effects

**Applies to master Tasks 21, 23, and 24.**

- [ ] **Add import-service assertions**

For an existing or newly created organization location, the historical activity sets `organizationLocationId`. A current follow-up, when explicitly enabled, also sets the selected/new location ID.

- [ ] **Add strict side-effect assertions**

After importing a new profile with a reviewed event date, assert zero new rows in:

```text
bookings
booking_contacts
booking_package_selections
booking_resource_assignments
trips
trip_segments
```

Also assert no `activities.kind = 'calendar'` row and no route/travel-leg assignment was inferred from the page.

- [ ] **Run amended tests**

```bash
pnpm --filter @workspace/api-server test -- src/features/paper-notes/paper-note-import-service.pglite.test.ts src/features/paper-notes/paper-note-import.e2e.pglite.test.ts
```

Expected after implementation: PASS.

### Amendment G — Test helpers must be local and explicit

**Applies to master Task 2.**

Define these helpers in `paper-notes-migration.pglite.test.ts`; do not reference undeclared test utilities:

```ts
async function hasTable(client: PGlite, tableName: string): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(
    "select to_regclass($1) is not null as present",
    [tableName],
  );
  return result.rows[0]?.present ?? false;
}

async function hasColumn(client: PGlite, tableName: string, columnName: string): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(`
    select exists (
      select 1 from information_schema.columns
      where table_schema = current_schema()
        and table_name = $1
        and column_name = $2
    ) as present
  `, [tableName, columnName]);
  return result.rows[0]?.present ?? false;
}
```

- [ ] **Run the migration test after adding the helpers**

```bash
pnpm --filter @workspace/api-server test -- src/db/paper-notes-migration.pglite.test.ts
```

Expected after implementation: PASS.

---

## Closed Spec-Coverage Matrix

| Approved requirement | Master task(s) | Appendix closure |
|---|---:|---|
| Persistent private intake | 2–7 | `exists()` and exact restoration added |
| Rotation after extraction | 5, 6, 10, 12, 13, 17 | Confirmed destructive re-read contract added |
| Two-stage extraction | 8–13 | `PaperNoteExtraction` and claimed-page types fixed |
| Page heading/date distinction | 9, 14, 21 | Extraction type and final assertions retained |
| Old reminder is historical | 9, 14, 18, 21 | Review/note contracts fixed |
| Star only adds note sentence | 9, 14, 17, 21 | Exact boolean/note behavior fixed |
| Extensions/instructions/status | 2, 14, 18, 19, 23 | Exact reviewed-phone and decision types fixed |
| No multi-email table | 14, 18, 21 | Allowed email outcomes made explicit |
| Matching never auto-links | 15–18 | Destination contract fixed |
| Source missing blocks import | 16, 20, 23 | `exists()` and restore route added |
| `mayContinue` warning | 9, 13, 17 | Required parser/UI test added |
| New profile/location/contact import | 21 | Exact destination/contact contracts fixed |
| Activity links to location | 21, 23 | Required import assertion added |
| No booking/calendar/route inference | 21, 24 | Strict zero-side-effect assertions added |
| Stale, atomic, idempotent import | 20–22 | Transaction contract fixed |
| Privacy-safe observability | 10–13, 24 | Health/count/log contracts added |
| Source-paper timeline action | 16, 23 | Exact restoration and existence behavior added |

## Appendix Verification

Before implementation begins:

- [ ] Read the approved design spec.
- [ ] Read the master plan.
- [ ] Read this appendix.
- [ ] Confirm migration `066` is still free on the latest `main`; rename all references together when it is not.
- [ ] Confirm every type name in the master plan resolves to a definition above or in its owning task.
- [ ] Confirm no real paper image or extracted personal data is present in the worktree.
