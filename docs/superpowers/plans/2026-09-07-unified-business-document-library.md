# Unified Business Document Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one private, deduplicated Adventure Zone business-document library that links documents to profiles and bookings, preserves COI tracking, imports approved Drive/Gmail history, and automatically reviews future Gmail attachments.

**Architecture:** Add a canonical document domain beside the existing legacy tables, with immutable versions, checksum-addressed private blobs, many-to-many record links, source provenance, review items, audit events, and import runs. Compatibility adapters migrate and read existing Business Source, Google profile-file, Design asset, and COI data while the UI moves to the canonical API; source-specific Drive and Gmail discovery feed one idempotent ingestion service.

**Tech Stack:** TypeScript 5.9, Node.js, Express 5, PostgreSQL, Drizzle ORM, Google Drive/Gmail REST APIs, Google Cloud Storage, React 19, Wouter, TanStack Query, Vitest, Testing Library, Supertest, PGlite.

**Spec:** `docs/superpowers/specs/2026-09-07-unified-business-document-library-design.md`

## Global Constraints

- Never delete or move Google Drive or Gmail source files.
- Import only explicitly approved Adventure Zone Drive folders; never sweep all of My Drive.
- Keep personal and unrelated attachments out of the library.
- Deduplicate physical storage by SHA-256 content checksum.
- Allow one document to link to multiple profiles, bookings, and event families.
- Keep company-wide documents valid without a profile link.
- Restrict file contents to the owner/admin authentication path; ordinary profile visibility does not grant file access.
- Use short-lived signed download URLs and never expose storage keys.
- Accept only strong automatic matches; ambiguous category, relationship, or date evidence goes to Document Review.
- Keep the existing hourly Google Workspace cadence; do not add real-time Gmail push delivery.
- Make migration and ongoing ingestion idempotent, resumable, auditable, and observable.
- Preserve legacy identifiers until reconciliation proves every legacy record is represented.

---

## File Structure

### Canonical data and backend

- Create `lib/db/src/business-document-schema.ts` — canonical Drizzle tables, value lists, and exported domain types.
- Create `lib/db/migrations/20260907_business_document_library.sql` — production DDL matching the Drizzle schema.
- Modify `lib/db/src/index.ts` — export the canonical tables and types.
- Create `artifacts/api-server/src/db/business-document-required-startup.ts` — fail-closed startup DDL check.
- Modify `artifacts/api-server/src/db/required-schema-startup.ts` — run the required document schema before accepting traffic.
- Create `artifacts/api-server/src/features/business-documents/business-document-types.ts` — API/domain contracts shared by document services.
- Create `artifacts/api-server/src/features/business-documents/business-document-repository.ts` — transactional persistence and queries.
- Create `artifacts/api-server/src/features/business-documents/business-document-storage.ts` — checksum-addressed private blob operations.
- Create `artifacts/api-server/src/features/business-documents/business-document-ingestion.ts` — source-independent validate/fingerprint/classify/match/decide/persist pipeline.
- Create `artifacts/api-server/src/features/business-documents/business-document-classifier.ts` — deterministic category and metadata proposals.
- Create `artifacts/api-server/src/features/business-documents/business-document-matcher.ts` — strong-evidence CRM link proposals.
- Create `artifacts/api-server/src/features/business-documents/business-document-service.ts` — owner-facing list, detail, upload, link, version, archive, review, and open operations.
- Create `artifacts/api-server/src/routes/business-documents.ts` — owner-protected canonical HTTP API.
- Modify `artifacts/api-server/src/routes/index.ts` — mount canonical routes behind existing owner authentication.

### Compatibility and COI

- Create `artifacts/api-server/src/features/business-documents/legacy-document-migration.ts` — idempotent migration of existing app records.
- Modify `artifacts/api-server/src/routes/coi-certificates.ts` — read/write COI metadata through canonical document IDs while honoring legacy asset IDs during rollout.
- Modify `artifacts/api-server/src/routes/boss-documents.ts` — read canonical documents for the Boss workspace.
- Modify `artifacts/adventure-zone/src/lib/boss-documents-api.ts` — expose canonical document identifiers and URLs.

### Google ingestion

- Modify `artifacts/api-server/src/features/google-workspace/google-api-types.ts` — add Drive file/page and download contracts.
- Modify `artifacts/api-server/src/features/google-workspace/google-api-client.ts` — implement read-only Drive listing/download and Gmail attachment discovery inputs.
- Create `artifacts/api-server/src/features/business-documents/google-drive-document-source.ts` — allowlisted recursive Drive inventory.
- Create `artifacts/api-server/src/features/business-documents/google-gmail-document-source.ts` — historical/incremental Gmail candidates.
- Create `artifacts/api-server/src/features/business-documents/business-document-import-service.ts` — resumable inventories/import batches/reconciliation.
- Create `artifacts/api-server/src/routes/business-document-imports.ts` — owner-only preview, start, status, retry, and report endpoints.
- Create `artifacts/api-server/src/features/business-documents/google-document-worker.ts` — incremental future Gmail attachment processing.
- Create `artifacts/api-server/src/features/business-documents/google-document-worker-loop.ts` — hourly scheduler and non-overlapping worker loop.
- Modify `artifacts/api-server/src/index.ts` — start and close the worker with the server lifecycle.

### Frontend

- Create `artifacts/adventure-zone/src/lib/business-documents-api.ts` — typed owner API client.
- Create `artifacts/adventure-zone/src/pages/BusinessDocumentsPage.tsx` — All, Templates, COIs & Insurance, and Needs Review views.
- Create `artifacts/adventure-zone/src/pages/BusinessDocumentImportPage.tsx` — allowlist inventory, pilot import, progress, and reconciliation report.
- Create `artifacts/adventure-zone/src/components/profiles/profile-documents.tsx` — profile-linked canonical documents and profile-scoped upload/link actions.
- Modify `artifacts/adventure-zone/src/pages/EventProfilePage.tsx` — replace the source-only panel with Profile Documents.
- Modify `artifacts/adventure-zone/src/pages/CoiManagementPage.tsx` — use canonical document actions and links.
- Modify `artifacts/adventure-zone/src/pages/BossTemplatesFilesPage.tsx` — display canonical library records in the Boss view.
- Modify `artifacts/adventure-zone/src/pages/TodayPage.tsx` — show unresolved document-review attention.
- Modify `artifacts/adventure-zone/src/App.tsx` — add `/business-documents` and `/business-documents/import` routes and legacy redirects.
- Modify `artifacts/adventure-zone/src/components/navigation/app-menu.tsx` — add Business Documents and its pending-review badge.

---

### Task 1: Canonical schema and required startup

**Files:**
- Create: `lib/db/src/business-document-schema.ts`
- Create: `lib/db/migrations/20260907_business_document_library.sql`
- Modify: `lib/db/src/index.ts`
- Create: `artifacts/api-server/src/db/business-document-required-startup.ts`
- Create: `artifacts/api-server/src/db/business-document-required-startup.test.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.test.ts`

**Interfaces:**
- Produces: `businessDocuments`, `businessDocumentBlobs`, `businessDocumentVersions`, `businessDocumentLinks`, `businessDocumentSources`, `businessDocumentCoiMetadata`, `businessDocumentReviewItems`, `businessDocumentAuditEvents`, `businessDocumentImportRuns`, and `businessDocumentImportItems`.
- Produces: `ensureBusinessDocumentSchemaBeforeListen(): Promise<void>`.

- [ ] **Step 1: Write failing schema/startup tests**

Add assertions that required startup invokes the new schema step and that the migration defines the uniqueness and relationship constraints:

```ts
it("runs the business-document schema before traffic is ready", async () => {
  const ensureBusinessDocuments = vi.fn(async () => undefined);
  await runRequiredSchemaStartup({ run: async (_name, step) => step(), ensureBusinessDocuments });
  expect(ensureBusinessDocuments).toHaveBeenCalledOnce();
});

it("creates checksum blobs and idempotent sources", () => {
  expect(sql).toContain("UNIQUE (sha256_hex)");
  expect(sql).toContain("UNIQUE (source_kind, source_account_key, external_id)");
  expect(sql).toContain("CHECK (target_kind IN ('profile','booking','event_family'))");
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
pnpm --filter @workspace/api-server test -- business-document-required-startup.test.ts required-schema-startup.test.ts
```

Expected: FAIL because the document schema module and dependency do not exist.

- [ ] **Step 3: Add the schema and startup DDL**

Define the value sets exactly once in `business-document-schema.ts`:

```ts
export const businessDocumentCategoryValues = [
  "contract", "proposal", "coi", "insurance_policy", "w9_tax", "permit",
  "vendor_application", "inspection", "deposit_receipt", "operational_template",
  "marketing", "other",
] as const;
export const businessDocumentLifecycleValues = ["active", "archived", "deleted"] as const;
export const businessDocumentReviewStateValues = ["accepted", "needs_review", "rejected"] as const;
export const businessDocumentTargetKindValues = ["profile", "booking", "event_family"] as const;
export const businessDocumentSourceKindValues = ["manual", "gmail", "drive", "business_source", "google_profile_file", "design_asset", "design_output"] as const;
```

Use UUID primary keys, `timestamptz`, FK `ON DELETE` rules that preserve documents, a unique lowercase 64-character checksum, a unique `(document_id, version_number)`, partial unique link indexes by target, and a unique source identity. Store proposals/evidence in `jsonb`, not free-form executable data. Add `document_id uuid` to `design_certificates` as a nullable compatibility FK and unique index.

`ensureBusinessDocumentSchemaBeforeListen()` must acquire a connection, set a five-second lock timeout, execute the same idempotent DDL, reset the timeout in `finally`, and release the connection.

- [ ] **Step 4: Run schema, type, and startup tests**

Run:

```bash
pnpm --filter @workspace/api-server test -- business-document-required-startup.test.ts required-schema-startup.test.ts
pnpm run typecheck:libs
pnpm --filter @workspace/api-server typecheck
```

Expected: all commands PASS.

- [ ] **Step 5: Commit the schema foundation**

```bash
git add lib/db/src/business-document-schema.ts lib/db/src/index.ts lib/db/migrations/20260907_business_document_library.sql artifacts/api-server/src/db/business-document-required-startup.ts artifacts/api-server/src/db/business-document-required-startup.test.ts artifacts/api-server/src/db/required-schema-startup.ts artifacts/api-server/src/db/required-schema-startup.test.ts
git commit -m "feat: add canonical business document schema"
```

### Task 2: Private blob storage and transactional repository

**Files:**
- Create: `artifacts/api-server/src/features/business-documents/business-document-types.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-storage.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-storage.test.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-repository.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-repository.test.ts`

**Interfaces:**
- Consumes: canonical tables from Task 1.
- Produces: `BusinessDocumentCandidate`, `BusinessDocumentView`, `DocumentLinkProposal`, `DocumentSourceIdentity`, and `DocumentIngestionOutcome`.
- Produces: `BusinessDocumentStorage.putIfAbsent(bytes, mimeType): Promise<StoredBlob>` and `signedReadUrl(storageKey, ttlSeconds): Promise<string>`.
- Produces: `BusinessDocumentRepository.ingest(input): Promise<DocumentIngestionOutcome>` and list/detail/link/version/review methods.

- [ ] **Step 1: Write failing storage and repository tests**

```ts
it("stores equal bytes once under their checksum", async () => {
  const first = await storage.putIfAbsent(new TextEncoder().encode("contract"), "application/pdf");
  const second = await storage.putIfAbsent(new TextEncoder().encode("contract"), "application/pdf");
  expect(second).toEqual(first);
  expect(objectStore.put).toHaveBeenCalledOnce();
});

it("adds a second source without creating a second blob", async () => {
  await repository.ingest(gmailCandidate);
  const result = await repository.ingest({ ...driveCandidate, sha256Hex: gmailCandidate.sha256Hex });
  expect(result.outcome).toBe("deduplicated");
  expect(await countRows("business_document_blobs")).toBe(1);
  expect(await countRows("business_document_sources")).toBe(2);
});
```

- [ ] **Step 2: Run tests and verify missing-module failures**

```bash
pnpm --filter @workspace/api-server test -- business-document-storage.test.ts business-document-repository.test.ts
```

Expected: FAIL because storage and repository modules do not exist.

- [ ] **Step 3: Implement focused storage and repository units**

Use the existing `PrivateObjectStorage` adapter and checksum-addressed keys:

```ts
export type StoredBlob = { sha256Hex: string; storageKey: string; sizeBytes: number; mimeType: string };

export class BusinessDocumentStorage {
  async putIfAbsent(bytes: Uint8Array, mimeType: string): Promise<StoredBlob> {
    const sha256Hex = createHash("sha256").update(bytes).digest("hex");
    const storageKey = `business-documents/${sha256Hex.slice(0, 2)}/${sha256Hex}`;
    if (!(await this.objects.exists(storageKey))) await this.objects.put(storageKey, bytes, mimeType);
    return { sha256Hex, storageKey, sizeBytes: bytes.byteLength, mimeType };
  }
}
```

`repository.ingest()` must run document/version/blob/source/link/review/audit writes in one database transaction. Source conflicts return the existing document. Blob conflicts reuse the existing blob. Link insertions use conflict-safe unique indexes and record evidence plus confirmation mode.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- business-document-storage.test.ts business-document-repository.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit storage and persistence**

```bash
git add artifacts/api-server/src/features/business-documents
git commit -m "feat: add private business document persistence"
```

### Task 3: Classification, matching, and ingestion decisions

**Files:**
- Create: `artifacts/api-server/src/features/business-documents/business-document-classifier.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-classifier.test.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-matcher.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-matcher.test.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-ingestion.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-ingestion.test.ts`

**Interfaces:**
- Consumes: `BusinessDocumentCandidate`, repository, and storage from Task 2.
- Produces: `classifyBusinessDocument(candidate): DocumentClassificationProposal`.
- Produces: `matchBusinessDocument(candidate, crmEvidence): DocumentLinkProposal[]`.
- Produces: `BusinessDocumentIngestion.ingest(candidate): Promise<DocumentIngestionOutcome>`.

- [ ] **Step 1: Write decision tests before rules**

Cover exact filename/category rules, temp-file rejection, strong approved-thread matching, exact known email matching, fuzzy-name review, conflicts, and unconfirmed COI dates:

```ts
it("never auto-links on fuzzy name similarity alone", async () => {
  const proposals = await matcher.match(candidateNamedLaramie, twoLaramieProfiles);
  expect(proposals.every((proposal) => proposal.decision === "review")).toBe(true);
});

it("auto-files an approved profile thread attachment", async () => {
  const outcome = await ingestion.ingest(approvedThreadCoi);
  expect(outcome.reviewState).toBe("accepted");
  expect(outcome.linkedProfileIds).toEqual([approvedThreadCoi.organizationId]);
});
```

- [ ] **Step 2: Verify tests fail**

```bash
pnpm --filter @workspace/api-server test -- business-document-classifier.test.ts business-document-matcher.test.ts business-document-ingestion.test.ts
```

Expected: FAIL because the rule modules do not exist.

- [ ] **Step 3: Implement deterministic proposals and the confidence gate**

Use explainable results:

```ts
export type EvidenceStrength = "strong" | "supporting" | "conflicting";
export type DocumentLinkProposal = {
  targetKind: "profile" | "booking" | "event_family";
  targetId: string;
  confidence: number;
  decision: "auto" | "review";
  evidence: Array<{ kind: string; strength: EvidenceStrength; value: string }>;
};
```

Auto-link only an approved thread/profile relationship, exact known contact email, migrated authoritative legacy relationship, or exact event identity plus compatible location/date. Any conflict forces review. Exclude `~$*`, `.tmp`, `desktop.ini`, empty files, and unsupported MIME types with a recorded skip code. Do not assign an extracted date unless parsing returns a valid ISO date and issue date is not after expiration date.

- [ ] **Step 4: Run decision tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- business-document-classifier.test.ts business-document-matcher.test.ts business-document-ingestion.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit ingestion decisions**

```bash
git add artifacts/api-server/src/features/business-documents/business-document-classifier.ts artifacts/api-server/src/features/business-documents/business-document-classifier.test.ts artifacts/api-server/src/features/business-documents/business-document-matcher.ts artifacts/api-server/src/features/business-documents/business-document-matcher.test.ts artifacts/api-server/src/features/business-documents/business-document-ingestion.ts artifacts/api-server/src/features/business-documents/business-document-ingestion.test.ts
git commit -m "feat: classify and match business documents"
```

### Task 4: Owner-protected document API

**Files:**
- Create: `artifacts/api-server/src/features/business-documents/business-document-service.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-service.test.ts`
- Create: `artifacts/api-server/src/routes/business-documents.ts`
- Create: `artifacts/api-server/src/routes/business-documents.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**
- Consumes: repository/storage/ingestion from Tasks 2–3 and `requireOwnerMiddleware` from `artifacts/api-server/src/lib/auth.ts`.
- Produces: `/business-documents`, `/business-documents/:id`, `/business-documents/:id/open`, `/business-documents/:id/links`, `/business-documents/:id/versions`, `/business-documents/:id/archive`, and `/business-documents/review-count`.

- [ ] **Step 1: Write route contract and authorization tests**

```ts
it("does not expose metadata or signed URLs without owner auth", async () => {
  await request(app).get("/api/business-documents").expect(401);
  await request(app).post(`/api/business-documents/${id}/open`).expect(401);
});

it("unlinks a profile without deleting the document", async () => {
  await owner.delete(`/api/business-documents/${id}/links/${linkId}`).expect(200, { ok: true });
  await owner.get(`/api/business-documents/${id}`).expect(200);
});
```

- [ ] **Step 2: Run route tests and verify failure**

```bash
pnpm --filter @workspace/api-server test -- business-document-service.test.ts business-documents.test.ts
```

Expected: FAIL because the route is not mounted.

- [ ] **Step 3: Implement strict request schemas and safe responses**

Mount the router as:

```ts
router.use("/business-documents", requireOwnerMiddleware, businessDocumentsRouter);
```

Use Zod `.strict()` bodies, UUID parameters, a 30 MB raw upload limit consistent with Business Sources, allowlisted MIME types, pagination bounded to 100, and signed read URLs with a 900-second TTL. Responses contain `fileAvailable` and source display metadata but never `storageKey`, extracted sensitive text, or Google tokens. Archive is the normal removal action; deletion uses a separate confirmation body `{ confirmation: "DELETE" }` and records an audit event.

- [ ] **Step 4: Run API tests and typecheck**

```bash
pnpm --filter @workspace/api-server test -- business-document-service.test.ts business-documents.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the canonical API**

```bash
git add artifacts/api-server/src/features/business-documents/business-document-service.ts artifacts/api-server/src/features/business-documents/business-document-service.test.ts artifacts/api-server/src/routes/business-documents.ts artifacts/api-server/src/routes/business-documents.test.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: expose protected business document API"
```

### Task 5: Unified Business Documents and Profile Documents UI

**Files:**
- Create: `artifacts/adventure-zone/src/lib/business-documents-api.ts`
- Create: `artifacts/adventure-zone/src/pages/BusinessDocumentsPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/BusinessDocumentsPage.test.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/profile-documents.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/profile-documents.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/profile-source-documents-wiring.test.ts`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu-canonical-links.test.ts`

**Interfaces:**
- Consumes: Task 4 JSON endpoints.
- Produces: `businessDocumentsApi` and routes `/business-documents` plus profile-scoped `ProfileDocuments`.

- [ ] **Step 1: Write UI tests for the approved navigation and behavior**

```tsx
it("shows one library with the approved four views", async () => {
  render(<BusinessDocumentsPage />);
  expect(await screen.findByRole("tab", { name: "All Documents" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Templates" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "COIs & Insurance" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "Needs Review" })).toBeVisible();
});

it("removes a profile link without offering to delete the file", async () => {
  render(<ProfileDocuments mode="owner" profileId={profileId} />);
  fireEvent.click(await screen.findByRole("button", { name: "Remove from this profile" }));
  expect(screen.queryByText(/delete document/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI tests and verify failure**

```bash
pnpm --filter @workspace/adventure-zone test -- BusinessDocumentsPage.test.tsx profile-documents.test.tsx profile-source-documents-wiring.test.ts app-menu-canonical-links.test.ts
```

Expected: FAIL because the page, component, and routes do not exist.

- [ ] **Step 3: Build the typed client and accessible views**

Export these client methods:

```ts
export const businessDocumentsApi = {
  list: (query: BusinessDocumentQuery) => apiGet<BusinessDocumentList>(`/business-documents?${toQuery(query)}`),
  forProfile: (profileId: string) => apiGet<BusinessDocumentList>(`/business-documents?profileId=${encodeURIComponent(profileId)}`),
  open: (id: string) => apiPost<{ url: string }>(`/business-documents/${id}/open`, {}),
  unlink: (documentId: string, linkId: string) => apiDelete<{ ok: true }>(`/business-documents/${documentId}/links/${linkId}`),
};
```

Use semantic tabs, labeled filters, loading/error/empty states, and buttons whose names distinguish link removal from archive/deletion. Replace `ProfileSourceDocuments` with `ProfileDocuments` on the owner profile page; retain historical terms inside each migrated document detail. Add Business Documents under Admin Tools → Business Setup and a canonical route in `App.tsx`.

- [ ] **Step 4: Run UI tests, typecheck, and build**

```bash
pnpm --filter @workspace/adventure-zone test -- BusinessDocumentsPage.test.tsx profile-documents.test.tsx profile-source-documents-wiring.test.ts app-menu-canonical-links.test.ts
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS.

- [ ] **Step 5: Commit the unified library UI**

```bash
git add artifacts/adventure-zone/src/lib/business-documents-api.ts artifacts/adventure-zone/src/pages/BusinessDocumentsPage.tsx artifacts/adventure-zone/src/pages/BusinessDocumentsPage.test.tsx artifacts/adventure-zone/src/components/profiles/profile-documents.tsx artifacts/adventure-zone/src/components/profiles/profile-documents.test.tsx artifacts/adventure-zone/src/pages/EventProfilePage.tsx artifacts/adventure-zone/src/pages/profile-source-documents-wiring.test.ts artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/components/navigation/app-menu.tsx artifacts/adventure-zone/src/components/navigation/app-menu-canonical-links.test.ts
git commit -m "feat: unify business and profile documents UI"
```

### Task 6: COI and Boss compatibility adapters

**Files:**
- Modify: `artifacts/api-server/src/routes/coi-certificates.ts`
- Modify: `artifacts/api-server/src/routes/coi-certificates.test.ts`
- Modify: `artifacts/api-server/src/routes/boss-documents.ts`
- Modify: `artifacts/api-server/src/routes/boss-workspace.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/CoiManagementPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/CoiManagementPage.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/BossTemplatesFilesPage.tsx`
- Modify: `artifacts/adventure-zone/src/lib/boss-documents-api.ts`

**Interfaces:**
- Consumes: canonical document API/model from Tasks 1–5.
- Produces: COI responses containing `documentId` and one canonical `fileAvailable`/open path; Boss responses contain canonical library records while preserving existing response fields during rollout.

- [ ] **Step 1: Add compatibility tests**

```ts
it("returns one COI backed by one canonical document", async () => {
  const response = await owner.get("/api/coi-certificates").expect(200);
  expect(response.body.certificates[0]).toMatchObject({ documentId, fileAvailable: true });
});

it("keeps a legacy asset-backed certificate visible before migration", async () => {
  const response = await owner.get("/api/coi-certificates").expect(200);
  expect(response.body.certificates.map((item: any) => item.id)).toContain(legacyCertificateId);
});
```

- [ ] **Step 2: Run existing and new COI/Boss tests**

```bash
pnpm --filter @workspace/api-server test -- coi-certificates.test.ts boss-workspace.test.ts
pnpm --filter @workspace/adventure-zone test -- CoiManagementPage.test.ts
```

Expected: FAIL on canonical `documentId` assertions while legacy tests remain green.

- [ ] **Step 3: Add dual-read/canonical-write adapters**

New COI writes create a canonical `coi` document and `business_document_coi_metadata`; during rollout, reads union canonical records with unmigrated legacy `design_certificates` and deduplicate by legacy source ID. Opening always delegates to the owner-protected document service when `documentId` exists. Boss document aggregation reads canonical contracts/COIs/templates and retains email drafts as a separate non-file section.

- [ ] **Step 4: Run compatibility tests and typechecks**

```bash
pnpm --filter @workspace/api-server test -- coi-certificates.test.ts boss-workspace.test.ts
pnpm --filter @workspace/adventure-zone test -- CoiManagementPage.test.ts App.boss-workspace.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit compatibility adapters**

```bash
git add artifacts/api-server/src/routes/coi-certificates.ts artifacts/api-server/src/routes/coi-certificates.test.ts artifacts/api-server/src/routes/boss-documents.ts artifacts/api-server/src/routes/boss-workspace.test.ts artifacts/adventure-zone/src/pages/CoiManagementPage.tsx artifacts/adventure-zone/src/pages/CoiManagementPage.test.ts artifacts/adventure-zone/src/pages/BossTemplatesFilesPage.tsx artifacts/adventure-zone/src/lib/boss-documents-api.ts
git commit -m "feat: back COI and Boss documents with library"
```

### Task 7: Idempotent legacy-app migration

**Files:**
- Create: `artifacts/api-server/src/features/business-documents/legacy-document-migration.ts`
- Create: `artifacts/api-server/src/features/business-documents/legacy-document-migration.test.ts`
- Create: `scripts/migrate-business-documents.ts`
- Create: `scripts/migrate-business-documents.test.ts`
- Modify: `scripts/package.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: canonical ingestion service and legacy Business Source, Google profile-file, Design asset/output, and COI records.
- Produces: `migrateLegacyDocuments({ dryRun, batchSize, afterId }): Promise<MigrationReport>` and scripts `preview:business-documents`/`migrate:business-documents`.

- [ ] **Step 1: Write migration fixture tests**

```ts
it("maps all legacy sources and preserves links", async () => {
  const report = await migrateLegacyDocuments({ dryRun: false, batchSize: 50, afterId: null });
  expect(report.bySource).toEqual({ business_source: 1, google_profile_file: 1, design_asset: 1, design_output: 1, design_certificate: 1 });
  expect(await canonicalLinksFor(profileId)).toHaveLength(3);
});

it("is idempotent on rerun", async () => {
  await migrateLegacyDocuments(input);
  const second = await migrateLegacyDocuments(input);
  expect(second.imported).toBe(0);
  expect(second.deduplicated).toBe(5);
});
```

- [ ] **Step 2: Verify migration tests fail**

```bash
pnpm --filter @workspace/api-server test -- legacy-document-migration.test.ts
pnpm --filter @workspace/scripts exec vitest run migrate-business-documents.test.ts
```

Expected: FAIL because migration entry points do not exist.

- [ ] **Step 3: Implement preview-first batched migration**

Map each legacy row to `sourceKind` and a stable `externalId`. Reuse existing checksums/storage keys when verified; download bytes only when the legacy metadata lacks a valid checksum. Convert existing Business Source links into canonical relationships, Google profile files into profile relationships, Design output project links into profile/booking links, and `design_certificates` into COI metadata. The CLI refuses a live run unless invoked with `--apply` and prints JSON totals for discovered/imported/deduplicated/review/skipped/failed.

- [ ] **Step 4: Run tests and a dry preview**

```bash
pnpm --filter @workspace/api-server test -- legacy-document-migration.test.ts
pnpm --filter @workspace/scripts exec vitest run migrate-business-documents.test.ts
pnpm run preview:business-documents
```

Expected: tests PASS; preview exits zero, performs no writes, and prints every source count.

- [ ] **Step 5: Commit legacy migration**

```bash
git add artifacts/api-server/src/features/business-documents/legacy-document-migration.ts artifacts/api-server/src/features/business-documents/legacy-document-migration.test.ts scripts/migrate-business-documents.ts scripts/migrate-business-documents.test.ts scripts/package.json package.json
git commit -m "feat: migrate legacy document records safely"
```

### Task 8: Document Review queue and Today attention

**Files:**
- Modify: `artifacts/api-server/src/routes/business-documents.ts`
- Modify: `artifacts/api-server/src/routes/business-documents.test.ts`
- Modify: `artifacts/api-server/src/features/business-documents/business-document-service.ts`
- Modify: `artifacts/api-server/src/features/business-documents/business-document-service.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/BusinessDocumentsPage.tsx`
- Create: `artifacts/adventure-zone/src/components/business-documents/document-review-queue.tsx`
- Create: `artifacts/adventure-zone/src/components/business-documents/document-review-queue.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`

**Interfaces:**
- Consumes: review items from Tasks 1–4.
- Produces: review list/count and actions `approve`, `correct_and_approve`, `non_business`, `defer`, and `retry`.

- [ ] **Step 1: Write review-state and notification tests**

```tsx
it("shows document attention separately from calls and follow-ups", async () => {
  render(<TodayPage />);
  expect(await screen.findByText("3 documents need review")).toBeVisible();
  expect(screen.getByRole("link", { name: "Review documents" })).toHaveAttribute("href", "/business-documents?view=review");
});

it("requires corrected targets before correct-and-approve", async () => {
  render(<DocumentReviewQueue />);
  expect(await screen.findByRole("button", { name: "Correct and approve" })).toBeDisabled();
});
```

- [ ] **Step 2: Run review tests and verify failure**

```bash
pnpm --filter @workspace/api-server test -- business-documents.test.ts business-document-service.test.ts
pnpm --filter @workspace/adventure-zone test -- document-review-queue.test.tsx TodayPage.test.tsx
```

Expected: FAIL on missing actions/count/UI.

- [ ] **Step 3: Implement atomic review actions and dedicated UI**

Approval applies the stored proposals and creates an audit event. Correct-and-approve validates category, ISO dates, and target UUIDs before replacing proposals. Non-business rejects the review item and archives the document without deleting its source record. Defer leaves the item unresolved with `deferred_until`. Retry applies only to `retry_required` source failures. Today and menu badges use the unresolved count endpoint and do not add items to call/follow-up lists.

- [ ] **Step 4: Run review/API/UI tests**

```bash
pnpm --filter @workspace/api-server test -- business-documents.test.ts business-document-service.test.ts
pnpm --filter @workspace/adventure-zone test -- document-review-queue.test.tsx TodayPage.test.tsx app-menu.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit review workflow**

```bash
git add artifacts/api-server/src/routes/business-documents.ts artifacts/api-server/src/routes/business-documents.test.ts artifacts/api-server/src/features/business-documents/business-document-service.ts artifacts/api-server/src/features/business-documents/business-document-service.test.ts artifacts/adventure-zone/src/pages/BusinessDocumentsPage.tsx artifacts/adventure-zone/src/components/business-documents/document-review-queue.tsx artifacts/adventure-zone/src/components/business-documents/document-review-queue.test.tsx artifacts/adventure-zone/src/pages/TodayPage.tsx artifacts/adventure-zone/src/pages/TodayPage.test.tsx artifacts/adventure-zone/src/components/navigation/app-menu.tsx
git commit -m "feat: add document review and attention workflow"
```

### Task 9: Read-only Drive inventory and approved-folder import

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-types.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-api-client.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-api-drive.test.ts`
- Create: `artifacts/api-server/src/features/business-documents/google-drive-document-source.ts`
- Create: `artifacts/api-server/src/features/business-documents/google-drive-document-source.test.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-import-service.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-import-service.test.ts`
- Create: `artifacts/api-server/src/routes/business-document-imports.ts`
- Create: `artifacts/api-server/src/routes/business-document-imports.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Create: `artifacts/adventure-zone/src/pages/BusinessDocumentImportPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/BusinessDocumentImportPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

**Interfaces:**
- Produces: `GoogleDriveFile`, `GoogleDrivePage`, `listDriveFiles(parentId, pageToken)`, and `downloadDriveFile(fileId)`.
- Produces: `inventoryDriveFolders(folderIds): AsyncIterable<BusinessDocumentCandidate>`.
- Produces: owner-only `/business-document-imports/drive/preview`, `/start`, `/:runId`, and `/:runId/retry`.

- [ ] **Step 1: Write API pagination, allowlist, and import tests**

```ts
it("never lists outside the approved folder roots", async () => {
  await source.inventory([contractsFolderId]);
  expect(client.listDriveFiles).not.toHaveBeenCalledWith(myDriveRootId, expect.anything());
});

it("preview records candidates without downloading bytes", async () => {
  const response = await owner.post("/api/business-document-imports/drive/preview").send({ folderIds: [contractsFolderId] }).expect(200);
  expect(response.body.discovered).toBe(7);
  expect(client.downloadDriveFile).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm --filter @workspace/api-server test -- google-api-drive.test.ts google-drive-document-source.test.ts business-document-import-service.test.ts business-document-imports.test.ts
pnpm --filter @workspace/adventure-zone test -- BusinessDocumentImportPage.test.tsx
```

Expected: FAIL because Drive methods, source, import API, and page do not exist.

- [ ] **Step 3: Implement Drive read-only discovery and resumable import**

Use Drive v3 `files.list` with escaped parent ID, `trashed = false`, explicit fields, and page tokens. Use `files.get?alt=media` for binary files; export Google-native Docs to PDF, Sheets to XLSX, and Slides to PDF using `files.export`. The preview accepts only folder IDs selected from the connected account and stores them on the import run. Recursion follows folders under those roots only and skips temp/system names. Import items checkpoint stable Drive file ID, modified time, size, MIME type, and status before moving to the next item.

The frontend first shows folder roots and candidate counts, then requires an explicit pilot start. It displays discovered/imported/deduplicated/linked/review/skipped/retry/failed counts and does not offer source deletion.

- [ ] **Step 4: Run tests, typechecks, and a mocked pilot**

```bash
pnpm --filter @workspace/api-server test -- google-api-drive.test.ts google-drive-document-source.test.ts business-document-import-service.test.ts business-document-imports.test.ts
pnpm --filter @workspace/adventure-zone test -- BusinessDocumentImportPage.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Drive import**

```bash
git add artifacts/api-server/src/features/google-workspace/google-api-types.ts artifacts/api-server/src/features/google-workspace/google-api-client.ts artifacts/api-server/src/features/google-workspace/google-api-drive.test.ts artifacts/api-server/src/features/business-documents/google-drive-document-source.ts artifacts/api-server/src/features/business-documents/google-drive-document-source.test.ts artifacts/api-server/src/features/business-documents/business-document-import-service.ts artifacts/api-server/src/features/business-documents/business-document-import-service.test.ts artifacts/api-server/src/routes/business-document-imports.ts artifacts/api-server/src/routes/business-document-imports.test.ts artifacts/api-server/src/routes/index.ts artifacts/adventure-zone/src/pages/BusinessDocumentImportPage.tsx artifacts/adventure-zone/src/pages/BusinessDocumentImportPage.test.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat: import approved Drive business folders"
```

### Task 10: Historical Gmail attachment import

**Files:**
- Create: `artifacts/api-server/src/features/business-documents/google-gmail-document-source.ts`
- Create: `artifacts/api-server/src/features/business-documents/google-gmail-document-source.test.ts`
- Modify: `artifacts/api-server/src/features/business-documents/business-document-import-service.ts`
- Modify: `artifacts/api-server/src/features/business-documents/business-document-import-service.test.ts`
- Modify: `artifacts/api-server/src/routes/business-document-imports.ts`
- Modify: `artifacts/api-server/src/routes/business-document-imports.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/BusinessDocumentImportPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/BusinessDocumentImportPage.test.tsx`

**Interfaces:**
- Consumes: existing `listMessagePage`, `getMessageMetadata`, `getThreadDetail`, and `getAttachment`; canonical ingestion service.
- Produces: `inventoryHistoricalGmail({ after, before, pageToken }): AsyncIterable<BusinessDocumentCandidate>` and Gmail preview/import endpoints.

- [ ] **Step 1: Write Gmail safety and deduplication tests**

```ts
it("uses message and attachment IDs as the source identity", async () => {
  const [candidate] = await collect(source.inventoryHistoricalGmail(window));
  expect(candidate.source).toMatchObject({ sourceKind: "gmail", externalId: "message-1:attachment-1" });
});

it("reuses a previously copied profile-file blob", async () => {
  const result = await importer.importGmailCandidate(candidate);
  expect(result.outcome).toBe("deduplicated");
  expect(storage.putIfAbsent).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify Gmail import tests fail**

```bash
pnpm --filter @workspace/api-server test -- google-gmail-document-source.test.ts business-document-import-service.test.ts business-document-imports.test.ts
pnpm --filter @workspace/adventure-zone test -- BusinessDocumentImportPage.test.tsx
```

Expected: FAIL on missing Gmail inventory/import support.

- [ ] **Step 3: Implement bounded historical Gmail ingestion**

Page Gmail with a query bounded by the operator-approved date window and `has:attachment`; retrieve thread context only for messages with attachments. Reuse `google_workspace_profile_files.content_sha256` and storage object key when available. Preserve connection/message/attachment/thread identifiers and original Gmail URL. Use approved thread/profile relationships as strong evidence, exact contact email as strong evidence, and all conflicts as review. The UI presents a preview count and date window before starting.

- [ ] **Step 4: Run Gmail import tests and typechecks**

```bash
pnpm --filter @workspace/api-server test -- google-gmail-document-source.test.ts business-document-import-service.test.ts business-document-imports.test.ts google-profile-file-service.test.ts
pnpm --filter @workspace/adventure-zone test -- BusinessDocumentImportPage.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit historical Gmail import**

```bash
git add artifacts/api-server/src/features/business-documents/google-gmail-document-source.ts artifacts/api-server/src/features/business-documents/google-gmail-document-source.test.ts artifacts/api-server/src/features/business-documents/business-document-import-service.ts artifacts/api-server/src/features/business-documents/business-document-import-service.test.ts artifacts/api-server/src/routes/business-document-imports.ts artifacts/api-server/src/routes/business-document-imports.test.ts artifacts/adventure-zone/src/pages/BusinessDocumentImportPage.tsx artifacts/adventure-zone/src/pages/BusinessDocumentImportPage.test.tsx
git commit -m "feat: import historical Gmail business attachments"
```

### Task 11: Hourly future Gmail document automation

**Files:**
- Create: `artifacts/api-server/src/features/business-documents/google-document-worker.ts`
- Create: `artifacts/api-server/src/features/business-documents/google-document-worker.test.ts`
- Create: `artifacts/api-server/src/features/business-documents/google-document-worker-loop.ts`
- Create: `artifacts/api-server/src/features/business-documents/google-document-worker-loop.test.ts`
- Modify: `artifacts/api-server/src/index.ts`
- Modify: `artifacts/api-server/src/index.google-document-worker.test.ts`

**Interfaces:**
- Consumes: Gmail source and ingestion service from Tasks 3 and 10.
- Produces: `GoogleDocumentWorker.runOnce(now): Promise<GoogleDocumentRunSummary>` and `GoogleDocumentWorkerLoop.start()/close()`.

- [ ] **Step 1: Write worker idempotency, retry, and scheduling tests**

```ts
it("does not process the same Gmail attachment twice", async () => {
  await worker.runOnce(now);
  const second = await worker.runOnce(now);
  expect(second.discovered).toBe(0);
  expect(ingestion.ingest).toHaveBeenCalledOnce();
});

it("waits one hour and never overlaps runs", async () => {
  loop.start();
  scheduler.advanceBy(60 * 60 * 1000);
  expect(worker.runOnce).toHaveBeenCalledTimes(1);
  scheduler.advanceBy(60 * 60 * 1000);
  expect(worker.runOnce).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run worker tests and verify failure**

```bash
pnpm --filter @workspace/api-server test -- google-document-worker.test.ts google-document-worker-loop.test.ts index.google-document-worker.test.ts
```

Expected: FAIL because the worker does not exist.

- [ ] **Step 3: Implement incremental cursor and hourly non-overlapping loop**

Persist the last successful Gmail internal timestamp plus message ID tie-breaker in the import-run/cursor table. Each pass queries only newer messages, processes source identities idempotently, retries transient download/storage/database failures with bounded attempts, and promotes permanent/repeated failures to review. The loop uses `60 * 60 * 1000`, skips when no connected Workspace client exists, catches/logs safe summaries, and schedules the next pass only after the current pass settles. Add `close()` to server shutdown alongside existing loops.

- [ ] **Step 4: Run worker and regression tests**

```bash
pnpm --filter @workspace/api-server test -- google-document-worker.test.ts google-document-worker-loop.test.ts index.google-document-worker.test.ts google-historical-backfill-service.test.ts google-sent-profile-link-sweep-loop.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit ongoing automation**

```bash
git add artifacts/api-server/src/features/business-documents/google-document-worker.ts artifacts/api-server/src/features/business-documents/google-document-worker.test.ts artifacts/api-server/src/features/business-documents/google-document-worker-loop.ts artifacts/api-server/src/features/business-documents/google-document-worker-loop.test.ts artifacts/api-server/src/index.ts artifacts/api-server/src/index.google-document-worker.test.ts
git commit -m "feat: automate hourly Gmail document intake"
```

### Task 12: Reconciliation, security regression, and rollout documentation

**Files:**
- Create: `scripts/report-business-document-import.ts`
- Create: `scripts/report-business-document-import.test.ts`
- Modify: `scripts/package.json`
- Modify: `package.json`
- Create: `docs/operations/business-document-library.md`
- Modify: `docs/operations/business-source-document-upload.md`
- Create: `artifacts/api-server/src/routes/business-documents.security.test.ts`
- Create: `artifacts/api-server/src/features/business-documents/business-document-reconciliation.test.ts`
- Modify: `artifacts/adventure-zone/src/App.business-drive-reconciliation.test.ts`

**Interfaces:**
- Consumes: import runs/items, source rows, canonical documents, blobs, links, and review items.
- Produces: `report:business-documents` and the operator runbook.

- [ ] **Step 1: Write reconciliation and security regression tests**

```ts
it("accounts for every discovered import item", async () => {
  const report = await buildReconciliationReport(runId);
  expect(report.discovered).toBe(report.imported + report.deduplicated + report.review + report.skipped + report.retry + report.failed);
});

it("never returns storage keys or signed links to office auth", async () => {
  const response = await office.get(`/api/business-documents/${documentId}`).expect(401);
  expect(JSON.stringify(response.body)).not.toContain("storageKey");
  expect(JSON.stringify(response.body)).not.toContain("storage.googleapis.com");
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm --filter @workspace/api-server test -- business-documents.security.test.ts business-document-reconciliation.test.ts
pnpm --filter @workspace/scripts exec vitest run report-business-document-import.test.ts
pnpm --filter @workspace/adventure-zone test -- App.business-drive-reconciliation.test.ts
```

Expected: FAIL until report and security regression fixtures exist.

- [ ] **Step 3: Add the report command and exact operator runbook**

The report command accepts `--run-id`, prints JSON and a human-readable table, exits nonzero when counts do not reconcile, and lists safe error codes without filenames from private documents. The runbook records this rollout order: deploy schema/API, preview legacy migration, apply legacy migration, verify UI/permissions, preview Drive folders, run a small Drive pilot, reconcile, run bounded Gmail pilot, reconcile, enable hourly automation, and retain legacy views until reconciliation passes. Include rollback instructions that disable ingestion without deleting canonical records or source data.

- [ ] **Step 4: Run full verification**

```bash
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/adventure-zone test
pnpm --filter @workspace/scripts exec vitest run
pnpm run typecheck
pnpm run build
git diff --check
```

Expected: all commands PASS with no whitespace errors.

- [ ] **Step 5: Commit reconciliation and operations docs**

```bash
git add scripts/report-business-document-import.ts scripts/report-business-document-import.test.ts scripts/package.json package.json docs/operations/business-document-library.md docs/operations/business-source-document-upload.md artifacts/api-server/src/routes/business-documents.security.test.ts artifacts/api-server/src/features/business-documents/business-document-reconciliation.test.ts artifacts/adventure-zone/src/App.business-drive-reconciliation.test.ts
git commit -m "docs: add business document rollout safeguards"
```

## Execution Order and Review Gates

- Review after Task 1: schema safety and startup behavior.
- Review after Task 4: canonical backend works before UI or migration.
- Review after Task 6: existing COI/Boss behavior remains compatible.
- Review after Task 8: owner-facing library and review workflow are complete.
- Review after Task 10: historical imports are previewable and resumable.
- Review after Task 11: hourly automation is safe and non-overlapping.
- Review after Task 12: full tests, reconciliation, and operations handoff pass.

Do not run a production migration merely because the implementation tests pass. Production preview, pilot scope, reconciliation, and explicit operator confirmation remain separate operational gates.
