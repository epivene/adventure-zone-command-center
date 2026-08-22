# Event Source Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach the Ravalli County Fair contract and Hawthorne Armed Forces Day vendor application to the correct event/profile history as protected historical source documents, preserving reviewed event-specific facts without changing universal package defaults or creating obsolete tasks.

**Architecture:** Extend the Phase 1 `business_source_documents` model with explicit entity links and protected binary-object metadata. Reuse the existing Google Cloud object-storage infrastructure used by Leg Manager receipt images instead of introducing another storage provider. Owner-only upload/link/review routes manage the actual files and historical terms; profile views render document metadata according to access scope, while signed-contract binaries and signatures remain owner-only by default.

**Tech Stack:** TypeScript, Express, React/Vite, PostgreSQL/Drizzle, Zod, Vitest/Testing Library, existing owner auth, existing profile/event-family/location model, existing Google Cloud object storage infrastructure.

**Spec:** `docs/superpowers/specs/2026-08-22-business-drive-source-integration-design.md`

## Global Constraints

- Do not commit signed contracts, signatures, private applications, or other business-drive binaries into GitHub.
- The uploaded Ravalli County Fair file is a 2025 event-specific agreement; its negotiated terms must never overwrite Pirate's Rebellion or Adventure Zone package defaults.
- The Hawthorne Armed Forces Day application is a historical 2026 application whose April 25, 2026 deadline has passed; attaching it must not create an overdue task automatically.
- Hawthorne's listed 10x10, 10x25, and 15x20 vendor booth sizes are normal form choices and must never be treated as sufficient Adventure Zone setup footprints.
- Contract signatures and private legal/business identifiers remain owner-only.
- Office Coordinator may see only document metadata or files explicitly marked office-safe; release 1 seeds these two source documents as owner-only.
- Leg Managers do not receive these sales/legal documents through this feature.
- File access must be authorized on the server. A storage key or object URL must never become a permanent public URL.
- Event-specific reviewed facts remain snapshots with provenance. Later package-setting changes do not rewrite historical contract/application terms.

---

### Task 1: Add source-document links, file-object metadata, and reviewed historical terms

**Files:**
- Modify: `lib/db/src/business-source-schema.ts`
- Create: `lib/db/migrations/20260822_event_source_documents.sql`
- Modify: `lib/db/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/db/schema.ts`
- Test: `artifacts/api-server/src/features/business-sources/event-source-document-schema.test.ts`

**Interfaces:**

```ts
export const sourceDocumentLinkKindValues = [
  "profile",
  "location",
  "booking",
  "package_reference",
] as const;

export const historicalTermValueTypeValues = [
  "text",
  "money_cents",
  "date",
  "date_range",
  "integer",
  "boolean",
] as const;
```

**Schema:**

```text
business_source_document_files
  id uuid PK
  source_document_id uuid NOT NULL UNIQUE FK business_source_documents cascade
  storage_key text NOT NULL UNIQUE
  mime_type text NOT NULL
  original_size_bytes bigint NOT NULL CHECK >= 0
  sha256_hex text NOT NULL
  uploaded_by text NOT NULL
  uploaded_at timestamptz NOT NULL

business_source_document_links
  id uuid PK
  source_document_id uuid NOT NULL FK business_source_documents cascade
  organization_id uuid NULL FK organizations set null
  organization_location_id uuid NULL FK organization_locations set null
  booking_id uuid NULL FK bookings set null
  package_template_id uuid NULL FK package_templates set null
  link_kind text NOT NULL
  link_note text NULL
  created_by text NOT NULL
  created_at timestamptz NOT NULL
  CONSTRAINT exactly_one_link_target CHECK (
    (organization_id IS NOT NULL)::int +
    (organization_location_id IS NOT NULL)::int +
    (booking_id IS NOT NULL)::int +
    (package_template_id IS NOT NULL)::int = 1
  )
  UNIQUE(source_document_id, link_kind, organization_id, organization_location_id, booking_id, package_template_id)

business_source_historical_terms
  id uuid PK
  source_document_id uuid NOT NULL FK business_source_documents cascade
  document_link_id uuid NULL FK business_source_document_links cascade
  term_key text NOT NULL
  label text NOT NULL
  value_text text NOT NULL
  value_type text NOT NULL
  source_locator text NOT NULL
  review_state text NOT NULL CHECK proposed|approved|rejected
  reviewed_by text NULL
  reviewed_at timestamptz NULL
  created_at / updated_at timestamptz NOT NULL
  UNIQUE(source_document_id, term_key, source_locator)
```

- [ ] **Step 1: Write the failing schema contract test**

```ts
import { describe, expect, it } from "vitest";
import {
  businessSourceDocumentFiles,
  businessSourceDocumentLinks,
  businessSourceHistoricalTerms,
} from "@workspace/db";

describe("event source document schema", () => {
  it("stores protected file metadata, one-target links, and historical terms", () => {
    expect(businessSourceDocumentFiles.sha256Hex).toBeDefined();
    expect(businessSourceDocumentLinks.organizationLocationId).toBeDefined();
    expect(businessSourceHistoricalTerms.sourceLocator).toBeDefined();
  });
});
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/business-sources/event-source-document-schema.test.ts
```

- [ ] **Step 3: Implement migration and matching Drizzle schema**

Index `(organization_id, created_at)`, `(organization_location_id, created_at)`, `(booking_id, created_at)`, and `(source_document_id, review_state)`.

- [ ] **Step 4: Export schema and run typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/business-source-schema.ts lib/db/migrations/20260822_event_source_documents.sql lib/db/src/index.ts lib/db/src/schema/index.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/features/business-sources/event-source-document-schema.test.ts
git commit -m "feat: add linked event source documents"
```

---

### Task 2: Add protected source-document object storage using the existing Google Cloud provider

**Files:**
- Create: `artifacts/api-server/src/features/business-sources/source-document-storage.ts`
- Modify: `artifacts/api-server/src/features/leg-manager/leg-manager-object-storage.ts` only if a small generic base abstraction is needed
- Create: `artifacts/api-server/src/features/business-sources/source-document-file-service.ts`
- Test: `artifacts/api-server/src/features/business-sources/source-document-file-service.test.ts`

**Interfaces:**

```ts
export interface SourceDocumentObjectStorage {
  put(input: {
    key: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<void>;
  get(input: { key: string }): Promise<{
    mimeType: string;
    bytes: Uint8Array;
  } | null>;
  delete(input: { key: string }): Promise<void>;
}

export class GoogleCloudSourceDocumentObjectStorage
  implements SourceDocumentObjectStorage {}

export async function uploadSourceDocumentFile(input: {
  documentId: string;
  originalFilename: string;
  mimeType: string;
  bytes: Uint8Array;
  actorId: string;
}): Promise<SourceDocumentFileRecord>;
```

Storage key format:

```ts
`business-source-documents/${documentId}/${sha256Hex}`
```

Allowed release-1 MIME types:

```ts
[
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]
```

Maximum source-document upload size: `30 * 1024 * 1024` bytes.

- [ ] **Step 1: Write service tests with an in-memory storage fake**

Prove SHA-256 metadata is stable, repeated upload of identical bytes is idempotent, replacement updates metadata only after new object storage succeeds, and unsupported MIME/oversize inputs reject before storage.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/business-sources/source-document-file-service.test.ts
```

- [ ] **Step 3: Implement storage by reusing current Google Cloud credentials/configuration**

Do not add new environment variable names or a second bucket/provider path unless the existing object-storage class cannot support a different key prefix. If a generic base is extracted, keep receipt behavior byte-for-byte compatible.

- [ ] **Step 4: Run receipt storage regression tests plus source-document tests**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/business-sources/source-document-file-service.test.ts artifacts/api-server/src/features/leg-manager/receipt-service.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/business-sources/source-document-storage.ts artifacts/api-server/src/features/business-sources/source-document-file-service.ts artifacts/api-server/src/features/business-sources/source-document-file-service.test.ts artifacts/api-server/src/features/leg-manager/leg-manager-object-storage.ts
git commit -m "feat: store protected business source documents"
```

---

### Task 3: Add owner-only upload, download, link, and historical-term APIs

**Files:**
- Create: `artifacts/api-server/src/routes/business-source-document-files.ts`
- Create: `artifacts/api-server/src/routes/business-source-document-links.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Test: `artifacts/api-server/src/routes/business-source-document-files.test.ts`
- Test: `artifacts/api-server/src/routes/business-source-document-links.test.ts`

**Owner routes:**

```text
PUT  /business-sources/:documentId/file
GET  /business-sources/:documentId/file
DELETE /business-sources/:documentId/file
GET  /business-sources/:documentId/links
POST /business-sources/:documentId/links {
  linkKind,
  organizationId?,
  organizationLocationId?,
  bookingId?,
  packageTemplateId?,
  linkNote?
}
DELETE /business-sources/:documentId/links/:linkId
GET  /business-sources/:documentId/historical-terms
POST /business-sources/:documentId/historical-terms
PATCH /business-sources/:documentId/historical-terms/:termId
```

Binary upload body uses `express.raw` with the 30 MB limit. Download returns authorized bytes with `Content-Type` and `Content-Disposition: inline; filename="..."`.

- [ ] **Step 1: Write authorization and file tests**

Owner can upload/download. Office token and Leg Manager token cannot access these owner-only source binaries. Missing storage object returns 404 without exposing the storage key.

- [ ] **Step 2: Write strict link tests**

Exactly one target ID is required. The target must exist. `linkKind` must match the provided target type. A profile document cannot be linked to a consolidated/retired profile when an active canonical profile is known.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/business-source-document-files.test.ts artifacts/api-server/src/routes/business-source-document-links.test.ts
```

- [ ] **Step 4: Implement both routers after `requireOwnerMiddleware`**

Use the existing Phase 1 source-document repository and never return raw object-storage keys to clients.

- [ ] **Step 5: Test/typecheck and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/business-source-document-files.test.ts artifacts/api-server/src/routes/business-source-document-links.test.ts
pnpm run typecheck
git add artifacts/api-server/src/routes/business-source-document-files.ts artifacts/api-server/src/routes/business-source-document-links.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/routes/business-source-document-files.test.ts artifacts/api-server/src/routes/business-source-document-links.test.ts
git commit -m "feat: add protected event document APIs"
```

---

### Task 4: Seed reviewed historical-term suggestions for Ravalli and Hawthorne

**Files:**
- Create: `artifacts/api-server/src/features/business-sources/event-document-term-seed.ts`
- Test: `artifacts/api-server/src/features/business-sources/event-document-term-seed.test.ts`

**Interfaces:**

```ts
export async function ensureEventDocumentTermSeed(database: DrizzleDatabase): Promise<void>;
```

**Ravalli County Fair / 2025 source suggestions:**

```ts
const RAVALLI_TERMS = [
  ["event.name", "Event", "Ravalli County Fair", "text", "Contract p.1"],
  ["event.location", "Location", "Hamilton, MT", "text", "Contract p.1"],
  ["event.dates", "Event dates", "2025-08-27/2025-08-30", "date_range", "Contract p.1"],
  ["contract.price_cents", "Negotiated convention rate", "630000", "money_cents", "Contract p.1"],
  ["setup.arrival_date", "Permission to arrive", "2025-08-25", "date", "Contract p.1"],
  ["setup.departure_through", "Permission to remain through", "2025-08-31", "date", "Contract p.1"],
  ["site.camping", "Camping with attractions", "true", "boolean", "Contract p.1"],
  ["site.water", "Water access", "One faucet within 150 feet for water rides and cleaning", "text", "Contract p.1"],
  ["site.restrooms", "Restroom access", "24-hour restroom access from arrival through departure", "text", "Contract p.1"],
  ["site.exclusivity", "Attraction exclusivity", "The Adventure Zone exclusive on all rides and games", "text", "Contract p.1"],
  ["attractions.summary", "Attraction list", "10-12 inflatable attractions; 3-5 carnival-style games; access to 100-500 prizes, with additional fees when discounted/free to the public", "text", "Contract p.1"],
];
```

Do **not** seed a universal package price from the contract. Do not seed signature names/images as historical terms.

**Hawthorne Armed Forces Day / 2026 source suggestions:**

```ts
const HAWTHORNE_TERMS = [
  ["event.name", "Event", "75th Annual Armed Forces Day", "text", "Vendor application p.1"],
  ["event.location", "Location", "Hawthorne, NV", "text", "Vendor application p.1"],
  ["event.dates", "Event dates", "2026-05-12/2026-05-17", "date_range", "Vendor application p.1"],
  ["application.deadline", "Application deadline", "2026-04-25", "date", "Vendor application p.2"],
  ["application.water", "Vendor-form water note", "Water is available for use but must be hauled to the space; no hookups are available", "text", "Vendor application p.1"],
  ["application.generator", "Generator disclosure", "Generator use must be disclosed because it affects placement", "text", "Vendor application p.1"],
  ["application.setup", "Vendor setup window", "Vendor setup begins Tuesday at 9:00 AM; all vendors must be completely set up by Saturday at 10:00 AM", "text", "Vendor application p.2"],
  ["application.booth_sizes_warning", "Booth-size interpretation", "10x10, 10x25, and 15x20 are normal vendor-form choices only and are not Adventure Zone package footprint approvals", "text", "Reviewed source interpretation"],
];
```

- [ ] **Step 1: Write seed tests**

Assert Ravalli `contract.price_cents=630000` exists only as a historical term and never mutates `package_templates.base_price_cents`. Assert Hawthorne deadline remains a historical term and no Office task/follow-up is created.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/business-sources/event-document-term-seed.test.ts
```

- [ ] **Step 3: Implement idempotent proposed-term seeding**

Locate documents by `original_filename`. Seed terms as `proposed` until the profile/link target is selected; when an owner links the document to the intended profile/booking, the review UI can approve terms against that entity.

- [ ] **Step 4: Verify package/task non-mutation and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/features/business-sources/event-document-term-seed.test.ts
pnpm run typecheck
git add artifacts/api-server/src/features/business-sources/event-document-term-seed.ts artifacts/api-server/src/features/business-sources/event-document-term-seed.test.ts
git commit -m "feat: seed historical event document terms"
```

---

### Task 5: Add owner source-document upload/link UI and profile document section

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.tsx`
- Create: `artifacts/adventure-zone/src/components/business-sources/source-document-file-card.tsx`
- Create: `artifacts/adventure-zone/src/components/business-sources/source-document-link-editor.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/profile-source-documents.tsx`
- Modify: `artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.tsx`
- Test: `artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.test.tsx`
- Test: `artifacts/adventure-zone/src/components/profiles/profile-source-documents.test.tsx`

**UI behavior:**

```text
Settings -> Business sources -> source row
  File: Not uploaded / Uploaded
  Upload or replace file
  Linked to: profile/location/booking
  Historical terms: proposed/approved/rejected

Full Profile -> Documents / Source documents
  document title
  effective year
  document category
  historical flag
  Open document (owner only in release 1)
  reviewed historical terms
```

- [ ] **Step 1: Write UI tests**

The source page accepts PDF/DOCX/XLSX and displays file state. Profile component shows linked Ravalli/Hawthorne metadata only when the API returns an authorized link. No storage key is rendered.

- [ ] **Step 2: Add upload/link controls to Business Sources settings**

Use the normal profile search to choose Ravalli County Fair and Hawthorne Armed Forces Day rather than hard-coding organization UUIDs.

- [ ] **Step 3: Add source-document section to the existing full profile sheet**

Keep it below core booking/contact context. Do not move raw legal text into Notes or ordinary system History.

- [ ] **Step 4: Test and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.test.tsx artifacts/adventure-zone/src/components/profiles/profile-source-documents.test.tsx
pnpm run typecheck
git add artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.tsx artifacts/adventure-zone/src/components/business-sources/source-document-file-card.tsx artifacts/adventure-zone/src/components/business-sources/source-document-link-editor.tsx artifacts/adventure-zone/src/components/profiles/profile-source-documents.tsx artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.tsx artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.test.tsx artifacts/adventure-zone/src/components/profiles/profile-source-documents.test.tsx
git commit -m "feat: show historical source documents on profiles"
```

---

### Task 6: Add role-safe profile source-document projections

**Files:**
- Modify: `artifacts/api-server/src/routes/event-profiles.ts`
- Modify: `artifacts/api-server/src/routes/office-profiles.ts`
- Create: `artifacts/api-server/src/features/business-sources/profile-source-documents.ts`
- Test: `artifacts/api-server/src/routes/event-profiles.source-documents.test.ts`
- Test: `artifacts/api-server/src/routes/office-profiles.source-documents.test.ts`

**Owner projection:**

```ts
sourceDocuments: Array<{
  id: string;
  title: string;
  category: string;
  effectiveYear: number | null;
  hasFile: boolean;
  canOpenFile: true;
  historicalTerms: Array<{ label: string; value: string; sourceLocator: string }>;
}>;
```

**Office projection:**

Return only documents with `access_scope='office'`. The seeded Ravalli contract and Hawthorne vendor application are `owner`, so they do not appear in Office profile responses in release 1.

- [ ] **Step 1: Write owner/Office projection tests**

Owner sees linked owner documents. Office gets no Ravalli/Hawthorne document metadata or terms. Leg Manager routes remain unchanged and receive no sales/legal source documents.

- [ ] **Step 2: Implement one shared projection service with explicit access filtering**

Do not duplicate authorization filtering in React.

- [ ] **Step 3: Run security regression tests**

```bash
pnpm --filter @workspace/api-server exec vitest run artifacts/api-server/src/routes/event-profiles.source-documents.test.ts artifacts/api-server/src/routes/office-profiles.source-documents.test.ts artifacts/api-server/src/routes/office-security-regression.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/event-profiles.ts artifacts/api-server/src/routes/office-profiles.ts artifacts/api-server/src/features/business-sources/profile-source-documents.ts artifacts/api-server/src/routes/event-profiles.source-documents.test.ts artifacts/api-server/src/routes/office-profiles.source-documents.test.ts
git commit -m "feat: enforce source document profile access"
```

---

### Task 7: Post-deploy upload/link runbook for the two current files

**Files:**
- Create: `docs/operations/business-source-document-upload.md`
- Test: no automated test; verification uses the deployed owner UI/API created above.

**Runbook content must identify the exact current files:**

```text
pirates rebellion contract.pdf
  -> Business source: Ravalli County Fair Pirate's Rebellion Contract
  -> Search/select existing Ravalli County Fair profile/location
  -> Historical year: 2025
  -> Upload binary
  -> Approve reviewed terms only after confirming selected profile/booking

VENDOR APP 2026.docx
  -> Business source: Hawthorne Armed Forces Day Vendor Application
  -> Search/select existing Hawthorne Armed Forces Day profile/location
  -> Historical year: 2026
  -> Upload binary
  -> Do not create an overdue April 25, 2026 task
  -> Keep booth sizes marked as vendor-form context, not package footprint
```

- [ ] **Step 1: Write the runbook with owner UI steps**

Include how to replace a mistaken file, unlink a wrong profile before relinking, and verify that package defaults did not change.

- [ ] **Step 2: Verify no private binary has been added to git**

```bash
git ls-files | rg -i "pirates rebellion contract|vendor app 2026|\.pdf$|\.docx$" || true
```

Expected: neither uploaded private business file is tracked by GitHub.

- [ ] **Step 3: Commit the runbook**

```bash
git add docs/operations/business-source-document-upload.md
git commit -m "docs: add event source document upload runbook"
```

---

### Task 8: Full Phase 4 security/regression verification

**Files:**
- Modify only tracked files required by failures found in this verification task.

- [ ] **Step 1: Run source-document API/service tests**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  artifacts/api-server/src/features/business-sources/event-source-document-schema.test.ts \
  artifacts/api-server/src/features/business-sources/source-document-file-service.test.ts \
  artifacts/api-server/src/features/business-sources/event-document-term-seed.test.ts \
  artifacts/api-server/src/routes/business-source-document-files.test.ts \
  artifacts/api-server/src/routes/business-source-document-links.test.ts \
  artifacts/api-server/src/routes/event-profiles.source-documents.test.ts \
  artifacts/api-server/src/routes/office-profiles.source-documents.test.ts
```

- [ ] **Step 2: Run profile/source settings UI tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.test.tsx artifacts/adventure-zone/src/components/profiles/profile-source-documents.test.tsx
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm run typecheck
```

- [ ] **Step 4: Verify no source binary/public object URL leaked into the repository**

```bash
git ls-files | rg -i "pirates rebellion contract|vendor app 2026" && exit 1 || true
rg -n "storage.googleapis.com|business-source-documents/" artifacts/adventure-zone/src || true
```

Any frontend match containing a permanent bucket/object URL must be removed; downloads must go through authorized API access.

- [ ] **Step 5: Commit verification fixes if required**

```bash
git add -u
git diff --cached --quiet || git commit -m "test: harden event source document access"
```
