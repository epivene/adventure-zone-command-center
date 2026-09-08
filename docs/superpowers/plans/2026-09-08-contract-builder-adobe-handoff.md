# Contract Builder and Adobe Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner start from an event profile or booking, review and generate a versioned Adventure Zone contract PDF, hand it to Adobe Acrobat Sign with the event representative first and Dave second, then upload the completed agreement and create exactly one editable, unsent COI Gmail draft to Sara.

**Architecture:** Add an owner-only contract subsystem beside the existing booking, activity, protected-object-storage, and Google Workspace systems. Persist editable drafts separately from immutable finalized versions, render and store PDFs on the server, model Adobe progress as explicit user-confirmed state transitions, and isolate Gmail behind a draft-only COI provider with idempotent persistence. Reuse existing owner authorization, activity/audit records, booking package data, raw-file routes, signed read URLs, and `GoogleGmailDraftClient`.

**Tech Stack:** TypeScript 5.9, Express 5, Drizzle/PostgreSQL, Zod, React 19, Wouter, Vitest, Testing Library, `pdf-lib`, Google Cloud Storage, Gmail draft API.

**Spec:** `docs/superpowers/specs/2026-09-08-contract-builder-adobe-handoff-design.md`

## Global constraints

- Never store Dave's signature image or Adobe credentials in the CRM.
- Never send an Adobe agreement or email automatically. The only Gmail operation in this feature is `createGmailDraft`.
- Never invent a fee, percentage, deposit, threshold, party obligation, physical requirement, certificate-holder name/address, or additional-insured wording.
- Keep finalized snapshots and generated files immutable. Corrections create replacement versions.
- Keep contract status separate from booking status and never regress a booking that is already further along.
- Treat a PDF upload as plausible bytes only; the owner's explicit confirmation is the evidence that it is the completed agreement.
- Make signed-upload completion, activity/audit recording, and COI draft creation idempotent.
- Keep every contract route after `requireOwnerMiddleware` in `artifacts/api-server/src/routes/index.ts`.
- Guard the profile/booking actions and all contract routes with `CONTRACT_BUILDER_ENABLED === "true"` until acceptance checks pass.
- Use `express.raw({ type: "application/pdf", limit: "20mb" })` for contract-file uploads and short-lived signed URLs for reads.
- Use integer cents for money and integer basis points for percentages (`10% = 1000`) in normalized snapshots.
- Run the focused test after every red/green step. Run the full verification gate in Task 11.

## File responsibility map

| Area | Files | Responsibility |
|---|---|---|
| Database | `lib/db/migrations/20260908_contract_builder.sql`, `lib/db/src/schema/index.ts` | Contract templates, settings, drafts, versions, files, status events, and COI draft link/state |
| Contract domain | `artifacts/api-server/src/features/contracts/contract-types.ts`, `contract-validation.ts`, `contract-autofill.ts` | Stable DTOs, arrangement rules, required-field checks, and CRM-to-draft mapping |
| Templates/rendering | `contract-template-v1.ts`, `contract-template-service.ts`, `contract-renderer.ts`, `contract-pdf-service.ts` | Versioned approved copy, activation, deterministic text layout, and PDF bytes |
| Persistence/lifecycle | `contract-repository.ts`, `contract-draft-service.ts`, `contract-lifecycle-service.ts` | Draft resume/autosave, immutable finalization, replacements, transitions, booking coordination, activity/audit history |
| Files | `contract-file-service.ts`, existing `source-document-storage.ts` | Generated/signed PDF metadata, revisions, checksums, object storage, signed read URLs |
| COI | `coi-draft-service.ts`, existing Google Workspace draft interfaces | Required-data evaluation, exact request copy, idempotent draft-only creation, retry/manual-review state |
| Owner API | `artifacts/api-server/src/routes/contracts.ts`, `artifacts/api-server/src/routes/index.ts` | Owner-only JSON/raw-file endpoints and safe error responses |
| Client API/state | `artifacts/adventure-zone/src/features/contracts/contract-client.ts`, `contract-types.ts` | Typed requests, raw PDF upload, response coercion |
| Builder UI | `artifacts/adventure-zone/src/pages/ContractBuilderPage.tsx`, `components/contracts/*` | Autofill review, arrangements, operational confirmations, preview, autosave, validation |
| Handoff/history | `ContractHandoffPage.tsx`, `contract-history-card.tsx`, `signed-contract-upload.tsx`, `coi-next-action.tsx` | Adobe checklist, manual status, file history, completed upload, COI recovery |
| Entry/settings | `EventProfilePage.tsx`, `BookingDetailPage.tsx`, `SettingsContractsPage.tsx`, `App.tsx` | Profile booking choice, booking shortcut, signer/insurance defaults, routes |

## API contract

Implement these owner-only endpoints. All UUID path parameters use Zod validation and all mutation bodies reject unknown fields.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/contracts/settings` | Read current signer/insurance defaults and feature state |
| `PATCH` | `/contracts/settings` | Update future-draft defaults |
| `GET` | `/organizations/:organizationId/contracts` | List contract history and eligible bookings for a profile |
| `GET` | `/bookings/:bookingId/contracts` | List versions and current unfinished draft |
| `POST` | `/bookings/:bookingId/contract-draft` | Create or resume the one unfinished draft |
| `GET` | `/contract-drafts/:draftId` | Load normalized draft, readiness, preview, and source labels |
| `PATCH` | `/contract-drafts/:draftId` | Autosave an expected revision of normalized builder values |
| `POST` | `/contract-drafts/:draftId/finalize` | Validate, freeze snapshot, generate/store PDF, return version |
| `POST` | `/contracts/:contractVersionId/replacement` | Create a draft based on a finalized version |
| `GET` | `/contracts/:contractVersionId` | Read immutable snapshot, status, files, transitions, and COI state |
| `POST` | `/contracts/:contractVersionId/file/open` | Return a five-minute signed URL for a selected file revision |
| `POST` | `/contracts/:contractVersionId/confirm-adobe-sent` | Confirm manual Adobe handoff and advance state |
| `PUT` | `/contracts/:contractVersionId/signed-file` | Store a PDF as a new signed-file revision; do not complete yet |
| `POST` | `/contracts/:contractVersionId/signed-file/:fileId/confirm` | Confirm completed agreement, coordinate status, and attempt COI draft |
| `POST` | `/contracts/:contractVersionId/coi-draft/retry` | Retry the same idempotent Gmail draft operation |

## Task 1: Add contract persistence and database invariants

**Files:**

- Create: `lib/db/migrations/20260908_contract_builder.sql`
- Modify: `lib/db/src/schema/index.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-schema.test.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-migration.pglite.test.ts`

- [ ] Write the failing schema-shape test.

```ts
import { describe, expect, it } from "vitest";
import {
  contractTemplates, contractSettings, contractDrafts, contractVersions,
  contractFiles, contractStatusEvents, contractCoiDrafts,
} from "@workspace/db";

describe("contract schema", () => {
  it("exports every contract aggregate table", () => {
    expect(contractTemplates.stableKey).toBeDefined();
    expect(contractSettings.internalSignerEmail).toBeDefined();
    expect(contractDrafts.revision).toBeDefined();
    expect(contractVersions.snapshot).toBeDefined();
    expect(contractFiles.kind).toBeDefined();
    expect(contractStatusEvents.toStatus).toBeDefined();
    expect(contractCoiDrafts.gmailDraftId).toBeDefined();
  });
});
```

- [ ] Run it and verify the missing exports fail.

Run: `pnpm --dir artifacts/api-server exec vitest run src/features/contracts/contract-schema.test.ts`

Expected: FAIL with missing contract schema exports.

- [ ] Add Drizzle tables and PostgreSQL constraints matching this shape:

  - `contract_templates`: UUID id, nonblank stable key, positive version, `draft|reviewed|active|retired` state, JSONB fixed/arrangement clauses, JSONB operational defaults/render metadata, source provenance, effective/created timestamps, creator; unique `(stable_key, version)` and one active row per stable key.
  - `contract_settings`: singleton text key `default`, signer name/email/order, insurance name/email, updated actor/time; enforce signer order `2` and valid nonblank names/emails at the API boundary.
  - `contract_drafts`: UUID id, booking/organization/template FKs, arrangement enum text, JSONB normalized values, JSONB validation state, integer revision, finalized timestamp, last editor/timestamps; partial unique index allowing one draft with a null finalized timestamp per booking.
  - `contract_versions`: UUID id, booking/organization/template/draft FKs, positive version number, status enum text, immutable JSONB snapshot, rendered legal text, signer snapshot, predecessor/superseding self-FKs, creator/timestamps; unique `(booking_id, version_number)`.
  - `contract_files`: UUID id, contract-version FK, `unsigned_generated|signed_completed` kind, positive revision, storage key, `application/pdf`, byte size, SHA-256, original filename, actor/time, confirmation timestamp; unique `(contract_version_id, kind, revision)` and `(contract_version_id, sha256_hex)`.
  - `contract_status_events`: UUID id, contract-version FK, from/to status, actor, timestamp, idempotency key, JSONB context; unique idempotency key.
  - `contract_coi_drafts`: one row per contract version, recipient/subject/body snapshots, `details_needed|prepared|created|retryable_error|manual_review` state, Google connection/draft/message IDs, last safe error, idempotency key, attempt count/timestamps; unique contract-version FK and idempotency key.

- [ ] Write the PGlite migration test to apply the SQL to a fresh database, prove defaults for Dave/Sara, prove one open draft per booking, and prove duplicate COI idempotency keys are rejected.

```ts
expect(settings.rows[0]).toMatchObject({
  internal_signer_name: "Dave Gordon",
  internal_signer_order: 2,
  insurance_recipient_name: "Sara Toone",
  insurance_recipient_email: "sara@protectiveins.net",
});
await expect(insertSecondOpenDraft()).rejects.toThrow();
await expect(insertDuplicateCoiKey()).rejects.toThrow();
```

- [ ] Run both tests and verify they pass.

Run: `pnpm --dir artifacts/api-server exec vitest run src/features/contracts/contract-schema.test.ts src/features/contracts/contract-migration.pglite.test.ts`

- [ ] Commit.

```bash
git add lib/db/migrations/20260908_contract_builder.sql lib/db/src/schema/index.ts artifacts/api-server/src/features/contracts/contract-schema.test.ts artifacts/api-server/src/features/contracts/contract-migration.pglite.test.ts
git commit -m "feat: add contract workflow schema"
```

## Task 2: Define normalized contract values, validation, and autofill

**Files:**

- Create: `artifacts/api-server/src/features/contracts/contract-types.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-validation.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-validation.test.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-autofill.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-autofill.test.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-source-repository.ts`

- [ ] Write failing tests for all three arrangements and shared date/operational/signer rules.

```ts
it.each([
  ["guaranteed_fee", { totalFeeCents: 500000, depositCents: 250000, balanceCents: 250000 }],
  ["pay_for_play", { eventShareBasisPoints: 1000, settlementTiming: "End of final operating day", ticketAuthority: "Adventure Zone" }],
  ["guarantee_plus_percentage", { guaranteeCents: 300000, depositCents: 100000, balanceCents: 200000, eventShareBasisPoints: 500, percentageBase: "Gross ticket sales above $8,000", ticketAuthority: "Adventure Zone" }],
])("accepts complete %s terms", (arrangement, commercialTerms) => {
  expect(validateContractValues(completeValues({ arrangement, commercialTerms })).errors).toEqual([]);
});

it("rejects an inconsistent guaranteed balance", () => {
  expect(validateContractValues(completeValues({
    arrangement: "guaranteed_fee",
    commercialTerms: { totalFeeCents: 500000, depositCents: 250000, balanceCents: 200000 },
  })).errors).toContainEqual(expect.objectContaining({ path: "commercialTerms.balanceCents" }));
});
```

- [ ] Run the validation test and verify it fails for missing modules.

Run: `pnpm --dir artifacts/api-server exec vitest run src/features/contracts/contract-validation.test.ts`

- [ ] Implement `ContractValues`, arrangement-specific discriminated unions, `ContractSigner`, `ContractReadiness`, and `validateContractValues(values)` using cents and basis points. Require explicit booleans or text for every operational term; validate date order, signer identity/order, percentage base, fee arithmetic, and override reason for unusual arrival/departure.

- [ ] Run the validation test and verify it passes.

- [ ] Write the failing autofill tests. Cover booking primary contact precedence, organization primary fallback, no arbitrary fallback, selected package names/count, venue address, and settings snapshots.

```ts
expect(buildContractAutofill(source).values.eventSigner).toEqual({
  name: "Pat Organizer",
  role: "Event Director",
  email: "pat@example.com",
  phone: "307-555-0100",
  order: 1,
});
expect(buildContractAutofill({ ...source, bookingPrimaryContact: null, organizationPrimaryContact: null }).missing)
  .toContain("eventSigner");
```

- [ ] Implement `ContractSourceRepository.load(bookingId)` to query booking, organization, booking primary contact, organization primary contact, primary phone, package selections/templates, physical attraction total, and travel leg. Keep travel leg as labeled internal context and never render it as a party obligation.

- [ ] Run both focused tests.

Run: `pnpm --dir artifacts/api-server exec vitest run src/features/contracts/contract-validation.test.ts src/features/contracts/contract-autofill.test.ts`

- [ ] Commit.

```bash
git add artifacts/api-server/src/features/contracts/contract-types.ts artifacts/api-server/src/features/contracts/contract-validation.ts artifacts/api-server/src/features/contracts/contract-validation.test.ts artifacts/api-server/src/features/contracts/contract-autofill.ts artifacts/api-server/src/features/contracts/contract-autofill.test.ts artifacts/api-server/src/features/contracts/contract-source-repository.ts
git commit -m "feat: validate and autofill contract terms"
```

## Task 3: Add the reviewed template source and deterministic legal-text renderer

**Files:**

- Create: `artifacts/api-server/src/features/contracts/contract-template-v1.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-template-service.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-template-service.test.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-renderer.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-renderer.test.ts`
- Create: `artifacts/api-server/src/features/contracts/fixtures/guaranteed-fee.snapshot.ts`
- Create: `artifacts/api-server/src/features/contracts/fixtures/pay-for-play.snapshot.ts`
- Create: `artifacts/api-server/src/features/contracts/fixtures/guarantee-plus-percentage.snapshot.ts`

- [ ] Write a failing template test proving an active version is selected, old versions remain readable, unreviewed copy cannot activate, and each clause records source provenance.

```ts
expect(selectActiveTemplate(templates, "adventure-zone-standard").version).toBe(1);
expect(() => activateTemplate({ ...template, state: "draft" })).toThrow("CONTRACT_TEMPLATE_REVIEW_REQUIRED");
expect(template.sourceProvenance).toEqual(expect.arrayContaining([
  expect.objectContaining({ filename: "Meeteetse Annual Labor Day Celebration 2026 Contract.docx" }),
  expect.objectContaining({ filename: "Stone Age Stampede Dinosaur CO 2026.docx" }),
]));
```

- [ ] Transcribe the shared and arrangement-specific wording from these reviewed Gmail sources into structured clauses in `contract-template-v1.ts`:

  - Gmail message `1a048f5b4dab9d4f`, attachment `Meeteetse Annual Labor Day Celebration 2026 Contract.docx` for pay-for-play and event-percentage language.
  - Gmail message `19c35c5a26d576ad`, attachment `Stone Age Stampede Dinosaur CO 2026.docx` for guaranteed fee, deposit/balance, and shared operating language.

  Preserve party obligations and punctuation; replace only event-specific values with typed render tokens. Mark the seed `reviewed`, not `active`, until the rendered acceptance PDFs receive line-by-line owner review. Do not infer the third arrangement: compose it only from the already reviewed guarantee clauses plus reviewed percentage clauses, with an explicit rendered percentage base.

  If either named source attachment is unavailable to the implementing worker, stop Task 3 and request that exact attachment from the owner. Do not reconstruct legal wording from the design summary or memory.

- [ ] Implement template selection/activation and persist the seed idempotently by `(stable_key, version)`.

- [ ] Write failing renderer tests for branch exclusion, HTML escaping, signature order, and stable text output.

```ts
const rendered = renderContract(payForPlaySnapshot);
expect(rendered.text).toContain("10%");
expect(rendered.text).not.toContain("$5,000.00 guaranteed fee");
expect(rendered.text.indexOf("Pat Organizer")).toBeLessThan(rendered.text.indexOf("Dave Gordon"));
expect(renderContract(payForPlaySnapshot)).toEqual(renderContract(payForPlaySnapshot));
```

- [ ] Implement `renderContract(snapshot): { title: string; sections: RenderedSection[]; text: string }`. Use explicit section ordering and token substitution; reject unknown/missing tokens; normalize line endings; escape user text for any HTML preview output.

- [ ] Run the focused tests.

Run: `pnpm --dir artifacts/api-server exec vitest run src/features/contracts/contract-template-service.test.ts src/features/contracts/contract-renderer.test.ts`

- [ ] Commit.

```bash
git add artifacts/api-server/src/features/contracts/contract-template-v1.ts artifacts/api-server/src/features/contracts/contract-template-service.ts artifacts/api-server/src/features/contracts/contract-template-service.test.ts artifacts/api-server/src/features/contracts/contract-renderer.ts artifacts/api-server/src/features/contracts/contract-renderer.test.ts artifacts/api-server/src/features/contracts/fixtures
git commit -m "feat: add reviewed contract template renderer"
```

## Task 4: Implement draft resume, autosave, finalization, and replacement rules

**Files:**

- Create: `artifacts/api-server/src/features/contracts/contract-repository.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-draft-service.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-draft-service.test.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-versioning.pglite.test.ts`

- [ ] Write failing service tests for create/resume, optimistic revision checks, finalization readiness, immutable snapshot creation, and replacement.

```ts
expect((await service.start({ bookingId, actorId })).reused).toBe(false);
expect((await service.start({ bookingId, actorId })).reused).toBe(true);
await expect(service.save({ draftId, expectedRevision: 1, values, actorId }))
  .resolves.toMatchObject({ revision: 2 });
await expect(service.save({ draftId, expectedRevision: 1, values, actorId }))
  .rejects.toMatchObject({ code: "CONTRACT_DRAFT_STALE" });
await expect(service.finalize({ draftId: incompleteId, actorId }))
  .rejects.toMatchObject({ code: "CONTRACT_NOT_READY" });
```

- [ ] Run and verify the tests fail.

Run: `pnpm --dir artifacts/api-server exec vitest run src/features/contracts/contract-draft-service.test.ts src/features/contracts/contract-versioning.pglite.test.ts`

- [ ] Implement repository interfaces and transactions:

  - `start` locks the booking, resumes its unfinished draft, or snapshots current autofill/settings/template.
  - `save` requires the expected revision, preserves the draft on validation errors, and returns readiness.
  - `finalize` locks draft/booking, revalidates, allocates the next booking version number, stores immutable snapshot/rendered text/signers, and marks the draft finalized.
  - `replacement` clones the finalized snapshot into a new editable draft, records predecessor intent, and never edits the prior version.
  - Finalization is idempotent for the same finalized draft ID.

- [ ] Add PGlite concurrency coverage proving two finalization calls cannot allocate the same version and a replacement links predecessor/superseding rows atomically.

- [ ] Run the focused tests and verify they pass.

- [ ] Commit.

```bash
git add artifacts/api-server/src/features/contracts/contract-repository.ts artifacts/api-server/src/features/contracts/contract-draft-service.ts artifacts/api-server/src/features/contracts/contract-draft-service.test.ts artifacts/api-server/src/features/contracts/contract-versioning.pglite.test.ts
git commit -m "feat: add contract draft and version lifecycle"
```

## Task 5: Generate and protect unsigned contract PDFs

**Files:**

- Modify: `artifacts/api-server/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `artifacts/api-server/src/features/contracts/contract-pdf-service.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-pdf-service.test.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-file-service.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-file-service.test.ts`
- Modify: `artifacts/api-server/src/features/contracts/contract-draft-service.ts`

- [ ] Add `pdf-lib` to the API package.

Run: `pnpm --filter @workspace/api-server add pdf-lib`

- [ ] Write a failing PDF test that generates a real PDF and checks its header, page count, agreement title, and two signature/date areas through the renderer's layout model.

```ts
const result = await generateContractPdf(guaranteedFeeSnapshot);
expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe("%PDF-");
expect(result.pageCount).toBeGreaterThanOrEqual(2);
expect(result.layout.signatureBlocks.map((block) => block.name)).toEqual(["Pat Organizer", "Dave Gordon"]);
expect(result.layout.signatureBlocks.every((block) => block.hasDateLine)).toBe(true);
```

- [ ] Implement `generateContractPdf` with `pdf-lib`, standard embedded fonts, explicit margins/page breaks, page numbers, stable metadata derived from the immutable snapshot, and signature/date lines. Never fetch remote assets during generation.

- [ ] Write failing file-service tests for SHA-256 keys, generated upload, five-minute signed URL, signed-file revision increments, PDF-header validation, MIME/size rejection, duplicate checksum reuse, and object cleanup after metadata failure.

- [ ] Implement `ContractObjectStorage` by reusing the existing `SourceDocumentObjectStorage` interface and `GoogleCloudSourceDocumentObjectStorage`; use keys `contracts/{organizationId}/{contractVersionId}/{kind}/{revision}-{sha256}.pdf`.

- [ ] Integrate PDF generation/storage inside finalization so the transaction cannot expose `ready_for_adobe` until unsigned file metadata is committed. If object storage succeeds and database commit fails, delete the new object.

- [ ] Run focused tests.

Run: `pnpm --dir artifacts/api-server exec vitest run src/features/contracts/contract-pdf-service.test.ts src/features/contracts/contract-file-service.test.ts src/features/contracts/contract-draft-service.test.ts`

- [ ] Commit.

```bash
git add artifacts/api-server/package.json pnpm-lock.yaml artifacts/api-server/src/features/contracts/contract-pdf-service.ts artifacts/api-server/src/features/contracts/contract-pdf-service.test.ts artifacts/api-server/src/features/contracts/contract-file-service.ts artifacts/api-server/src/features/contracts/contract-file-service.test.ts artifacts/api-server/src/features/contracts/contract-draft-service.ts
git commit -m "feat: generate protected contract PDFs"
```

## Task 6: Expose the owner-only contract API behind the feature flag

**Files:**

- Create: `artifacts/api-server/src/features/contracts/contract-feature-enabled.ts`
- Create: `artifacts/api-server/src/routes/contracts.ts`
- Create: `artifacts/api-server/src/routes/contracts.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] Write failing route tests for flag-off `404`, owner boundary, safe validation errors, draft start/resume, autosave revision conflicts, finalization, listing, replacement, and signed URL response.

```ts
process.env.CONTRACT_BUILDER_ENABLED = "true";
await request(app).post(`/bookings/${bookingId}/contract-draft`).expect(201);
await request(app).patch(`/contract-drafts/${draftId}`).send({ expectedRevision: 1, values }).expect(200);
await request(app).post(`/contract-drafts/${draftId}/finalize`).expect(201);
expect(openResponse.body.url).toMatch(/^https:\/\//);
expect(JSON.stringify(openResponse.body)).not.toContain("storageKey");
```

- [ ] Run and verify route tests fail.

Run: `pnpm --dir artifacts/api-server exec vitest run src/routes/contracts.test.ts`

- [ ] Implement `isContractBuilderEnabled(value = process.env.CONTRACT_BUILDER_ENABLED)` and inject services into `createContractsRouter` so route tests use fakes. Map domain errors to `400`, stale revisions to `409`, missing rows to `404`, and storage/Gmail failures to `503` without leaking tokens, storage keys, or raw provider errors.

- [ ] Mount `contractsRouter` after `requireOwnerMiddleware` in `routes/index.ts`.

- [ ] Run route tests and API typecheck.

Run: `pnpm --dir artifacts/api-server exec vitest run src/routes/contracts.test.ts && pnpm --filter @workspace/api-server typecheck`

- [ ] Commit.

```bash
git add artifacts/api-server/src/features/contracts/contract-feature-enabled.ts artifacts/api-server/src/routes/contracts.ts artifacts/api-server/src/routes/contracts.test.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat: expose owner contract API"
```

## Task 7: Build the mobile-first contract builder and profile/booking entry points

**Files:**

- Create: `artifacts/adventure-zone/src/features/contracts/contract-types.ts`
- Create: `artifacts/adventure-zone/src/features/contracts/contract-client.ts`
- Create: `artifacts/adventure-zone/src/features/contracts/contract-client.test.ts`
- Create: `artifacts/adventure-zone/src/pages/ContractBuilderPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ContractBuilderPage.test.tsx`
- Create: `artifacts/adventure-zone/src/components/contracts/contract-action.tsx`
- Create: `artifacts/adventure-zone/src/components/contracts/contract-arrangement-fields.tsx`
- Create: `artifacts/adventure-zone/src/components/contracts/contract-operational-fields.tsx`
- Create: `artifacts/adventure-zone/src/components/contracts/contract-preview.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/BookingDetailPage.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

- [ ] Write failing client tests for each endpoint plus raw PDF upload. Ensure the upload overrides the JSON default header.

```ts
await client.uploadSignedPdf(versionId, file);
expect(fetch).toHaveBeenCalledWith(expect.stringContaining(`/contracts/${versionId}/signed-file`), expect.objectContaining({
  method: "PUT",
  headers: expect.objectContaining({ "Content-Type": "application/pdf" }),
  body: file,
}));
```

- [ ] Implement client DTOs and requests; parse dates at the page boundary and preserve integer cents/basis points.

- [ ] Write failing UI tests covering profile booking choice, booking preselection, continue-draft copy, all three arrangement branches, visible missing fields, operational confirmations, debounced revision autosave, preview, and blocked generation.

```tsx
fireEvent.change(screen.getByLabelText("Contract arrangement"), { target: { value: "pay_for_play" } });
expect(screen.getByLabelText("Event percentage" )).toBeInTheDocument();
expect(screen.queryByLabelText("Guaranteed fee")).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "Generate contract" })).toBeDisabled();
```

- [ ] Implement one-column mobile sections for identity/event, arrangement, operations, COI details, signers, and preview. Show source labels beside autofilled fields; never auto-select a non-primary contact. Autosave only after a successful server revision response and show `Saving`, `Saved`, or actionable error state.

- [ ] Add `/contracts/drafts/:draftId` to `App.tsx`. Add `Create contract`/`Continue draft` to `EventProfilePage.tsx`; when multiple bookings are eligible, open a selector. Add the same action to `BookingDetailPage.tsx` with booking preselected. Hide actions when the API reports the flag off.

- [ ] Run UI tests and frontend typecheck.

Run: `pnpm --dir artifacts/adventure-zone exec vitest run src/features/contracts/contract-client.test.ts src/pages/ContractBuilderPage.test.tsx && pnpm --filter @workspace/adventure-zone typecheck`

- [ ] Commit.

```bash
git add artifacts/adventure-zone/src/features/contracts artifacts/adventure-zone/src/pages/ContractBuilderPage.tsx artifacts/adventure-zone/src/pages/ContractBuilderPage.test.tsx artifacts/adventure-zone/src/components/contracts artifacts/adventure-zone/src/pages/EventProfilePage.tsx artifacts/adventure-zone/src/pages/BookingDetailPage.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat: add profile contract builder"
```

## Task 8: Add Adobe handoff, manual lifecycle, history, and booking coordination

**Files:**

- Create: `artifacts/api-server/src/features/contracts/contract-lifecycle-service.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-lifecycle-service.test.ts`
- Modify: `artifacts/api-server/src/routes/contracts.ts`
- Create: `artifacts/adventure-zone/src/pages/ContractHandoffPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ContractHandoffPage.test.tsx`
- Create: `artifacts/adventure-zone/src/components/contracts/contract-history-card.tsx`
- Create: `artifacts/adventure-zone/src/components/contracts/contract-history-card.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/BookingDetailPage.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

- [ ] Write failing lifecycle tests for allowed transitions, rejected jumps, idempotent Adobe confirmation, supersession, one activity/audit per transition, and booking non-regression.

```ts
await service.confirmAdobeSent({ contractVersionId, actorId, idempotencyKey: `adobe-sent:${contractVersionId}` });
expect(repo.setBookingStatus).toHaveBeenCalledWith(bookingId, "pending_contract");
await service.confirmAdobeSent({ contractVersionId: confirmedBookingVersionId, actorId, idempotencyKey: `adobe-sent:${confirmedBookingVersionId}` });
expect(repo.setBookingStatus).not.toHaveBeenCalledWith(confirmedBookingId, "pending_contract");
expect(activity.recordTransition).toHaveBeenCalledTimes(2);
```

- [ ] Implement explicit transition guards for `ready_for_adobe → sent_for_signature → partially_signed|completed|declined|cancelled` plus supersession. Compare booking states through a named rank/terminal-state function, not string ordering. Record contract status event, activity, audit, and permitted booking update in one database transaction.

- [ ] Add `confirm-adobe-sent` and contract detail/history behavior to the route.

- [ ] Write failing handoff UI tests for download/open PDF, copy agreement/signers, event signer first, Dave second, Adobe link opening in a new tab, signature/date reminder, and required `I sent it through Adobe` confirmation.

```ts
expect(screen.getByText("1. Pat Organizer")).toBeInTheDocument();
expect(screen.getByText("2. Dave Gordon")).toBeInTheDocument();
expect(screen.getByRole("link", { name: "Open Adobe Request e-signatures" })).toHaveAttribute("target", "_blank");
```

- [ ] Use Adobe's public Acrobat Sign request page URL from a single constant and keep the file/recipient handoff explicit: open/download PDF, copy agreement name, copy each signer, open Adobe, confirm placement of signature/date fields, then confirm sent. Do not claim the file or recipients were injected into Adobe.

- [ ] Add `/contracts/:contractVersionId/handoff` and history cards on both profile and booking pages. Show every immutable version, status, unsigned file, predecessor/superseding link, and next action.

- [ ] Run focused tests.

Run: `pnpm --dir artifacts/api-server exec vitest run src/features/contracts/contract-lifecycle-service.test.ts src/routes/contracts.test.ts && pnpm --dir artifacts/adventure-zone exec vitest run src/pages/ContractHandoffPage.test.tsx src/components/contracts/contract-history-card.test.tsx`

- [ ] Commit.

```bash
git add artifacts/api-server/src/features/contracts/contract-lifecycle-service.ts artifacts/api-server/src/features/contracts/contract-lifecycle-service.test.ts artifacts/api-server/src/routes/contracts.ts artifacts/adventure-zone/src/pages/ContractHandoffPage.tsx artifacts/adventure-zone/src/pages/ContractHandoffPage.test.tsx artifacts/adventure-zone/src/components/contracts/contract-history-card.tsx artifacts/adventure-zone/src/components/contracts/contract-history-card.test.tsx artifacts/adventure-zone/src/pages/EventProfilePage.tsx artifacts/adventure-zone/src/pages/BookingDetailPage.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat: add Adobe contract handoff tracking"
```

## Task 9: Store signed PDF revisions and confirm completion safely

**Files:**

- Modify: `artifacts/api-server/src/features/contracts/contract-file-service.ts`
- Modify: `artifacts/api-server/src/features/contracts/contract-file-service.test.ts`
- Modify: `artifacts/api-server/src/features/contracts/contract-lifecycle-service.ts`
- Create: `artifacts/api-server/src/features/contracts/contract-completion.pglite.test.ts`
- Modify: `artifacts/api-server/src/routes/contracts.ts`
- Create: `artifacts/adventure-zone/src/components/contracts/signed-contract-upload.tsx`
- Create: `artifacts/adventure-zone/src/components/contracts/signed-contract-upload.test.tsx`

- [ ] Add failing file tests proving declared PDF MIME, `%PDF-` header bytes, 20 MB maximum, nonempty bytes, version ownership, checksum reuse, and incrementing signed revisions.

```ts
await expect(service.storeSigned({ mimeType: "application/pdf", bytes: new TextEncoder().encode("not pdf") }))
  .rejects.toMatchObject({ code: "CONTRACT_PDF_HEADER_INVALID" });
expect((await service.storeSigned(validPdf)).revision).toBe(1);
expect((await service.storeSigned(secondValidPdf)).revision).toBe(2);
```

- [ ] Implement raw upload as storage only. Return filename, checksum, size, revision, and unconfirmed state; keep every prior signed revision.

- [ ] Write the failing PGlite completion test proving confirmation locks the version/file, marks only that file confirmed, transitions the contract to completed, advances only eligible bookings to `contract_received`, and creates one event/activity/audit under repeated requests.

- [ ] Implement `confirmSignedFile` with idempotency key `signed-confirm:{contractVersionId}:{fileId}`. Refuse files from another version and refuse unrecognized lifecycle origins. Commit completion before invoking the separately recoverable COI orchestration in Task 10.

- [ ] Add raw upload and confirmation routes with `415`, `413`, `400`, and `409` mappings.

- [ ] Write failing UI tests requiring selected filename/version review and a checkbox reading `I confirm this is the completed signed agreement` before confirmation.

- [ ] Implement the upload dialog, progress/error recovery, signed revision list, and completed-state refresh.

- [ ] Run focused tests.

Run: `pnpm --dir artifacts/api-server exec vitest run src/features/contracts/contract-file-service.test.ts src/features/contracts/contract-completion.pglite.test.ts src/routes/contracts.test.ts && pnpm --dir artifacts/adventure-zone exec vitest run src/components/contracts/signed-contract-upload.test.tsx`

- [ ] Commit.

```bash
git add artifacts/api-server/src/features/contracts/contract-file-service.ts artifacts/api-server/src/features/contracts/contract-file-service.test.ts artifacts/api-server/src/features/contracts/contract-lifecycle-service.ts artifacts/api-server/src/features/contracts/contract-completion.pglite.test.ts artifacts/api-server/src/routes/contracts.ts artifacts/adventure-zone/src/components/contracts/signed-contract-upload.tsx artifacts/adventure-zone/src/components/contracts/signed-contract-upload.test.tsx
git commit -m "feat: store and confirm signed contracts"
```

## Task 10: Create exactly one editable, unsent COI Gmail draft

**Files:**

- Create: `artifacts/api-server/src/features/contracts/coi-draft-service.ts`
- Create: `artifacts/api-server/src/features/contracts/coi-draft-service.test.ts`
- Create: `artifacts/api-server/src/features/contracts/coi-draft.pglite.test.ts`
- Modify: `artifacts/api-server/src/features/contracts/contract-lifecycle-service.ts`
- Modify: `artifacts/api-server/src/routes/contracts.ts`
- Create: `artifacts/adventure-zone/src/components/contracts/coi-next-action.tsx`
- Create: `artifacts/adventure-zone/src/components/contracts/coi-next-action.test.tsx`

- [ ] Write failing copy/readiness tests. Use the exact recent Adventure Zone structure evidenced by Gmail messages `1a063512dc7b0221` and `1a0491a8ceb2608c`: short Desiree/Adventure Zone introduction, exact user-supplied additional-insured wording, event dates, certificate-holder name/address, and Adventure Zone signature block.

```ts
expect(buildCoiDraft(completeCoi)).toMatchObject({
  to: "sara@protectiveins.net",
  subject: "COI Request for Stone Age Stampede – Dinosaur CO 2026",
});
expect(buildCoiDraft(completeCoi).body).toContain(completeCoi.additionalInsuredWording);
expect(evaluateCoiReadiness({ ...completeCoi, additionalInsuredWording: "" }).missing)
  .toContain("additionalInsuredWording");
```

- [ ] Implement `buildCoiDraft` without generative AI. Normalize display dates and mailing lines but preserve additional-insured wording exactly. Default to settings snapshot `Sara Toone <sara@protectiveins.net>` while allowing future settings changes only for future contract drafts.

- [ ] Write failing orchestration tests for:

  - missing COI details → `details_needed`, no Gmail call, completed contract remains completed;
  - successful draft → one `createGmailDraft({ raw })`, persisted Gmail IDs, never a send call;
  - repeated completion/retry → existing created link returned, no duplicate Gmail call;
  - known provider rejection → `retryable_error`;
  - uncertain provider result → `manual_review` and no blind retry;
  - Gmail failure never rolls back contract completion.

- [ ] Implement a `CoiGmailDraftProvider` using `GoogleConnectionRepository.createGmailDraftClient()` and the existing Gmail raw-message encoding pattern. Reserve idempotency key `contract-coi:{contractVersionId}` before the network call. Persist recipient/subject/body evidence and re-check it under lock before calling Gmail.

- [ ] Call COI orchestration after signed-file completion commits. Add the retry route; manual-review responses instruct the owner to check Gmail before retrying.

- [ ] Write failing UI tests for `Review COI draft`, `COI details needed`, `Retry COI draft`, and manual-review messaging. Do not render a `Send` action.

- [ ] Implement next-action UI on contract history/detail and refresh it after upload confirmation or retry. For a created draft, open `https://mail.google.com/mail/u/0/#drafts/{gmailMessageId}` in a new tab; also show the recipient and subject so the owner can locate it manually if Gmail changes its URL behavior.

- [ ] Run focused tests.

Run: `pnpm --dir artifacts/api-server exec vitest run src/features/contracts/coi-draft-service.test.ts src/features/contracts/coi-draft.pglite.test.ts src/features/contracts/contract-completion.pglite.test.ts src/routes/contracts.test.ts && pnpm --dir artifacts/adventure-zone exec vitest run src/components/contracts/coi-next-action.test.tsx`

- [ ] Commit.

```bash
git add artifacts/api-server/src/features/contracts/coi-draft-service.ts artifacts/api-server/src/features/contracts/coi-draft-service.test.ts artifacts/api-server/src/features/contracts/coi-draft.pglite.test.ts artifacts/api-server/src/features/contracts/contract-lifecycle-service.ts artifacts/api-server/src/routes/contracts.ts artifacts/adventure-zone/src/components/contracts/coi-next-action.tsx artifacts/adventure-zone/src/components/contracts/coi-next-action.test.tsx
git commit -m "feat: draft COI requests after signed contracts"
```

## Task 11: Add owner settings, perform acceptance review, and verify rollout safety

**Files:**

- Create: `artifacts/adventure-zone/src/pages/SettingsContractsPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/SettingsContractsPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/api-server/src/routes/contracts.ts`
- Modify: `docs/superpowers/specs/2026-09-08-contract-builder-adobe-handoff-design.md`
- Create: `docs/acceptance/contract-builder-v1-checklist.md`

- [ ] Write failing settings tests for initial Dave/Sara values, valid edits, invalid signer email, fixed signing order 2, and the statement that settings affect future drafts only.

```tsx
expect(await screen.findByDisplayValue("Dave Gordon")).toBeInTheDocument();
expect(screen.getByDisplayValue("Sara Toone")).toBeInTheDocument();
expect(screen.getByDisplayValue("sara@protectiveins.net")).toBeInTheDocument();
expect(screen.getByText(/future contract drafts only/i)).toBeInTheDocument();
```

- [ ] Implement settings GET/PATCH with audit history, then add `/settings/contracts` and an `Contracts & signing` card to Admin Tools. Do not expose signature upload controls.

- [ ] Create the acceptance checklist with three fully named cases:

  1. Stone Age Stampede / Dinosaur, Colorado — guaranteed fee, deposit, and remaining balance.
  2. Meeteetse Annual Labor Day Celebration — pay-for-play and event percentage.
  3. A controlled duplicate test booking — guarantee plus percentage, built only from the reviewed component clauses.

  For each case record reviewer/date and pass/fail for party names, venue/address, event/arrival/departure dates, commercial arithmetic, percentage base, operational clauses, event signer first, Dave second, two signature/date areas, PDF readability, and version retrieval. The checklist must also record one signed-PDF test and confirm exactly one editable, unsent Gmail draft to Sara.

- [ ] Before activating template v1, compare the rendered guaranteed and pay-for-play PDFs line by line against the two Gmail source attachments. Record any intentional normalization in the acceptance checklist. Activate only after the owner records approval; otherwise leave the template reviewed and keep the feature flag off.

- [ ] Run a placeholder and unsafe-copy scan.

Run: `rg -n 'TODO|TBD|FIXME|lorem|\{\{|\[insert|sendGmail|sendDraft|signatureImage' artifacts/api-server/src/features/contracts artifacts/api-server/src/routes/contracts.ts artifacts/adventure-zone/src/features/contracts artifacts/adventure-zone/src/components/contracts artifacts/adventure-zone/src/pages/ContractBuilderPage.tsx artifacts/adventure-zone/src/pages/ContractHandoffPage.tsx artifacts/adventure-zone/src/pages/SettingsContractsPage.tsx`

Expected: no unresolved template placeholders, automatic send calls, or signature-image storage. Approved token syntax may exist only in the reviewed template source and must have a renderer test for every token.

- [ ] Run the complete feature tests, typechecks, and build.

```bash
pnpm --dir artifacts/api-server exec vitest run src/features/contracts src/routes/contracts.test.ts
pnpm --dir artifacts/adventure-zone exec vitest run src/features/contracts src/components/contracts src/pages/ContractBuilderPage.test.tsx src/pages/ContractHandoffPage.test.tsx src/pages/SettingsContractsPage.test.tsx
pnpm typecheck
pnpm build
```

- [ ] Run the existing booking, event-profile, Google Workspace draft, source-file, and activity/audit regression tests.

```bash
pnpm --dir artifacts/api-server exec vitest run src/routes/bookings.test.ts src/features/lead-intake/gmail-draft-service.test.ts src/features/business-sources/source-document-file-service.test.ts src/features/activities
pnpm --dir artifacts/adventure-zone exec vitest run src/pages/BookingDetailPage.assistant-context.test.tsx src/pages/EventProfilePage.organization-membership.test.tsx
```

- [ ] Review `git diff --check`, confirm no secrets or source contract attachments are committed, and document environment rollout as `CONTRACT_BUILDER_ENABLED=false` until the acceptance checklist is signed.

- [ ] Commit.

```bash
git add artifacts/adventure-zone/src/pages/SettingsContractsPage.tsx artifacts/adventure-zone/src/pages/SettingsContractsPage.test.tsx artifacts/adventure-zone/src/App.tsx artifacts/api-server/src/routes/contracts.ts docs/superpowers/specs/2026-09-08-contract-builder-adobe-handoff-design.md docs/acceptance/contract-builder-v1-checklist.md
git commit -m "feat: finish contract workflow rollout controls"
```

## Final review gate

- [ ] Confirm every API endpoint in this plan has authorization, success, validation, conflict, and safe-failure coverage.
- [ ] Confirm every status transition and external side effect has a stable idempotency key.
- [ ] Confirm DTO field names match from Drizzle row → server service → route JSON → client type → React form.
- [ ] Confirm finalized snapshots and all PDF revisions remain retrievable after profile, booking, or settings edits.
- [ ] Confirm no contract or COI text is fabricated when source data is absent.
- [ ] Confirm Adobe handoff copy says what the app actually does: prepare/download/copy/open/confirm.
- [ ] Confirm Gmail contains one draft and no sent message after the completed-upload acceptance test.
- [ ] Confirm Dave's saved Adobe signature remains solely in Adobe and is not represented as CRM data.
- [ ] Confirm the worktree is clean and the implementation commits are reviewable in task order.
