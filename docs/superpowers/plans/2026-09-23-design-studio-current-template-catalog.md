# Design Studio Current Template Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old Design Studio content with an accurate email, contract, and proposal catalog and let profiles own reusable year-over-year document drafts.

**Architecture:** Keep package facts in `package_templates`, keep Foam Party in an approved add-on policy, and seed versioned catalog templates by stable keys. Instantiate templates on the server into profile-linked Design Studio projects so current facts are snapshotted while prior finalized versions remain immutable.

**Tech Stack:** TypeScript 5.9, React, Express, Drizzle/PostgreSQL, Zod, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-09-23-design-studio-current-template-catalog-design.md`

## Global Constraints

- Adventure Zone: $9,000, 10 attractions, optional marketing footprint 10,000–15,000 sq. ft.
- Warrior's Playground: $8,000, 5 attractions, optional marketing footprint 7,000–10,000 sq. ft.
- Pirate's Rebellion: $8,000, 3 attractions, optional marketing footprint 5,000–7,000 sq. ft.
- Mini Zone: $5,000, 5 attractions, optional marketing footprint 3,000–5,000 sq. ft.
- Foam Party is a $3,500 add-on, never a package.
- Standard contracts omit package footprints.
- Insurance copy says “fully insured” without a fixed limit.
- Email body copy contains no em dashes.
- No template action sends or signs anything; selection creates a draft.
- Sent, used, archived, and finalized versions remain immutable.
- Preserve the Design Studio ownership boundary and revision-safe autosave behavior.

## Review Focus

- A contact or booking from another organization must be rejected when instantiating a profile template; test in Task 4.
- A catalog reseed at the same or lower revision must not overwrite a newer active template; test in Task 3.
- Reusing a historical document must clear dates and negotiated terms while preserving the source document; test in Task 5.
- Archived templates/projects must stay hidden from ordinary lists without being deleted; test in Tasks 2 and 4.
- A package fact change after project creation must not rewrite the project snapshot; test in Task 4.

---

### Task 1: Correct the approved package and add-on facts

**Files:**
- Modify: `artifacts/api-server/src/features/packages/package-defaults.ts`
- Modify: `artifacts/api-server/src/features/packages/package-defaults.test.ts` (or create if absent)
- Create: `artifacts/api-server/src/features/packages/current-offer-catalog.ts`
- Create: `artifacts/api-server/src/features/packages/current-offer-catalog.test.ts`
- Create: `lib/db/migrations/20260923_current_template_offer_facts.sql`

**Interfaces:**
- Produces: `loadCurrentOfferCatalog(database): Promise<CurrentOfferCatalog>`
- Produces: `CurrentOfferCatalog.packages[code]` with name, price, attractions, footprint, descriptions
- Produces: `CurrentOfferCatalog.addOns.foamParty` with name and `priceCents: 350000`

- [ ] **Step 1: Write failing package-default tests**

Assert exact rates, attractions, and footprint text:

```ts
expect(REVIEWED_PACKAGE_DEFAULTS.adventure_zone.basePriceCents).toBe(900000);
expect(REVIEWED_PACKAGE_DEFAULTS.adventure_zone.operationalRequirements).toContain("10,000–15,000 sq ft");
expect(REVIEWED_PACKAGE_DEFAULTS.weekend_warriors.operationalRequirements).toContain("7,000–10,000 sq ft");
expect(REVIEWED_PACKAGE_DEFAULTS.pirates_rebellion.operationalRequirements).toContain("5,000–7,000 sq ft");
expect(REVIEWED_PACKAGE_DEFAULTS.mini_zone.basePriceCents).toBe(500000);
expect(REVIEWED_PACKAGE_DEFAULTS.mini_zone.operationalRequirements).toContain("3,000–5,000 sq ft");
```

- [ ] **Step 2: Run the targeted test and verify it fails for the stale footprints**

Run: `pnpm --filter @workspace/api-server test -- package-defaults.test.ts`  
Expected: FAIL on Adventure Zone, Warrior's Playground, Pirate's Rebellion, and Mini Zone footprint assertions.

- [ ] **Step 3: Update defaults and add the migration**

The migration must update matching active package rows without changing event-specific records. Use exact prices `900000, 800000, 800000, 500000` and the approved footprint sentences. Do not add footprint language to contract templates.

- [ ] **Step 4: Write and fail the current-offer catalog test**

The test must prove package rows come from the repository result and Foam Party is separate:

```ts
expect(catalog.packages.mini_zone.priceCents).toBe(500000);
expect(catalog.addOns.foamParty).toEqual({
  code: "foam_party",
  name: "Foam Party Add-On",
  priceCents: 350000,
});
expect("foam_party" in catalog.packages).toBe(false);
```

- [ ] **Step 5: Implement `loadCurrentOfferCatalog` and pass both test files**

Run the targeted tests, then the API-server test suite.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/packages lib/db/migrations/20260923_current_template_offer_facts.sql
git commit -m "fix: establish current package and add-on facts"
```

### Task 2: Add proposal and catalog lifecycle schema

**Files:**
- Modify: `lib/db/src/design-studio-schema.ts`
- Modify: `artifacts/adventure-zone/src/lib/design-studio-api.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.ts`
- Create: `lib/db/migrations/20260923_design_studio_template_catalog.sql`
- Create: `artifacts/api-server/src/features/design-studio/template-catalog-schema.test.ts`

**Interfaces:**
- Produces: Design type `proposal`
- Produces: active/archived template lifecycle
- Produces: project fields `sourceTemplateId`, `sourceCatalogRevision`, `documentYear`

- [ ] **Step 1: Write a failing schema contract test**

Assert `proposal` is accepted by DB and route schemas, design templates expose `catalogKey`, `catalogRevision`, `templateFamily`, `state`, `archivedAt`, and projects expose the three source/year fields.

- [ ] **Step 2: Run the schema test and verify the missing columns/type cause failure**

Run: `pnpm --filter @workspace/api-server test -- template-catalog-schema.test.ts`.

- [ ] **Step 3: Extend Drizzle and client types**

Add `proposal` to every Design Studio type/check list. Add explicit catalog columns and indexes. Add project source metadata with a foreign key from `source_template_id` to `design_templates.id` using `onDelete: "set null"`.

- [ ] **Step 4: Implement the archival migration**

The migration must:

```sql
UPDATE design_projects
SET status = 'archived', archived_at = COALESCE(archived_at, now()), updated_at = now()
WHERE status <> 'archived';

UPDATE design_templates
SET state = 'archived', archived_at = COALESCE(archived_at, now()), updated_at = now()
WHERE state <> 'archived';

UPDATE communication_templates
SET state = 'archived', updated_at = now()
WHERE state <> 'archived';
```

Add columns/checks before these updates. Preserve rows; do not delete.

- [ ] **Step 5: Pass schema and migration tests**

Add a migration assertion proving old rows are archived and still present.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/design-studio-schema.ts lib/db/migrations/20260923_design_studio_template_catalog.sql artifacts/adventure-zone/src/lib/design-studio-api.ts artifacts/api-server/src/routes/office-design-studio.ts artifacts/api-server/src/features/design-studio/template-catalog-schema.test.ts
git commit -m "feat: add Design Studio catalog lifecycle"
```

### Task 3: Seed the controlled replacement catalog

**Files:**
- Create: `artifacts/api-server/src/features/design-studio/current-template-catalog.ts`
- Create: `artifacts/api-server/src/features/design-studio/current-template-catalog.test.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/email-template-compiler.ts` only if placeholder registration is required

**Interfaces:**
- Produces: `ensureCurrentTemplateCatalog(database): Promise<void>`
- Produces: `CURRENT_EMAIL_TEMPLATES`
- Produces: generated `CURRENT_CONTRACT_TEMPLATES` from 3 arrangements × 5 package selections
- Produces: `CURRENT_PROPOSAL_TEMPLATES`

- [ ] **Step 1: Write failing catalog inventory tests**

Require these email keys:

```ts
[
 "email.general_first_outreach",
 "email.past_customer_return",
 "email.returning_customer_offer",
 "email.adventure_zone_focus",
 "email.warriors_focus",
 "email.pirates_focus",
 "email.mini_zone_focus",
 "email.no_reply_followup",
 "email.proposal_contract_followup",
 "email.after_convention",
 "email.after_event_review",
 "email.contract_ready",
 "email.signed_contract_received",
 "email.deposit_received",
]
```

Require 15 contract keys from arrangements `guaranteed_fee`, `pay_for_play`, `guarantee_plus_percentage` crossed with `adventure_zone`, `weekend_warriors`, `pirates_rebellion`, `mini_zone`, `multi_package`.

Require seven proposal keys: four prepaid package proposals plus pay-for-play, guarantee-plus-percentage, and multi-package/custom.

- [ ] **Step 2: Run and verify the catalog test fails**

Expected: module/catalog missing.

- [ ] **Step 3: Implement email definitions**

Use branded HTML, approved small header/footer, current links, “fully insured,” no em dashes, and Foam Party below package content where relevant. Store package and add-on placeholders instead of literal package prices.

- [ ] **Step 4: Implement contract and proposal definitions**

Contracts consume protected current clauses from `contract-template-v1.ts`, arrangement fields, and event placeholders. No standard contract definition may contain `sq ft`, `square feet`, or a footprint placeholder. Proposals may use marketing footprints.

- [ ] **Step 5: Implement revision-safe upsert**

Upsert by `catalogKey`. Update only when incoming revision is greater. Same/lower revisions leave the stored row untouched. Seed communication email templates by their stable `code` and Design Studio contract/proposal templates by `catalogKey`.

- [ ] **Step 6: Replace the old `seedTemplates()` call and pass tests**

Remove the generic five-row seeder. Call `ensureCurrentTemplateCatalog` before active template listing.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/design-studio/current-template-catalog* artifacts/api-server/src/routes/office-design-studio.ts
git commit -m "feat: seed current Design Studio template catalog"
```

### Task 4: Instantiate accurate profile-linked drafts

**Files:**
- Create: `artifacts/api-server/src/features/design-studio/template-instantiation-service.ts`
- Create: `artifacts/api-server/src/features/design-studio/template-instantiation-service.test.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.ts`
- Modify: `artifacts/adventure-zone/src/lib/design-studio-api.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio-routing.test.ts`

**Interfaces:**
- Consumes: `loadCurrentOfferCatalog`
- Produces: `instantiateTemplate({ accountId, templateId, organizationId, contactId?, bookingId?, documentYear })`
- Produces: `GET /office/design-studio/projects?linkedOrganizationId=<uuid>`
- Produces: `POST /office/design-studio/templates/:templateId/instantiate`

- [ ] **Step 1: Write failing service tests**

Cover: active template creates one linked project and v1 snapshot; archived template is rejected; foreign-organization contact/booking is rejected; package price/footprint snapshots are current; changing the package source afterward does not mutate the saved project; unresolved event fields stay blank/placeholders.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @workspace/api-server test -- template-instantiation-service.test.ts`.

- [ ] **Step 3: Implement transactional instantiation**

Validate ownership relationships, resolve current offers, render protected/template content, insert project plus first version plus smart-field snapshots in one transaction, and record an audit entry.

- [ ] **Step 4: Add routes and client methods**

Add:

```ts
designStudioApi.listForProfile(organizationId)
designStudioApi.instantiateTemplate(templateId, {
  linkedOrganizationId,
  linkedContactId,
  linkedBookingId,
  documentYear,
})
```

Ordinary template/project lists must default to active/non-archived rows.

- [ ] **Step 5: Pass targeted route/service tests and API suite**

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/design-studio/template-instantiation-service* artifacts/api-server/src/routes/office-design-studio* artifacts/adventure-zone/src/lib/design-studio-api.ts
git commit -m "feat: create profile-linked template drafts"
```

### Task 5: Add safe year-over-year reuse

**Files:**
- Create: `artifacts/api-server/src/features/design-studio/profile-document-reuse.ts`
- Create: `artifacts/api-server/src/features/design-studio/profile-document-reuse.test.ts`
- Modify: `artifacts/api-server/src/routes/office-design-studio.ts`
- Modify: `artifacts/adventure-zone/src/lib/design-studio-api.ts`

**Interfaces:**
- Produces: `reuseProfileDocument({ accountId, projectId, documentYear })`
- Produces: `POST /office/design-studio/projects/:projectId/use-for-new-year`

- [ ] **Step 1: Write failing reuse tests**

Given a sent 2027 project with customer/event dates, negotiated amount, percentage, deposit, due dates, and signature fields, assert reuse creates a distinct 2028 draft linked to the same organization, keeps reusable profile copy, refreshes current offer snapshots, clears reconfirmation fields, and leaves the 2027 project/version byte-for-byte unchanged.

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Implement a named reconfirmation-field policy**

Create an explicit set for event dates, schedule, negotiated price, percentage, deposit, due dates, availability claims, and signatures. Do not clear organization/contact identity or user-authored reusable profile notes.

- [ ] **Step 4: Add route/client and pass tests**

Return `409` if the source is an editable current draft; the normal action there is Edit, not year reuse.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/design-studio/profile-document-reuse* artifacts/api-server/src/routes/office-design-studio.ts artifacts/adventure-zone/src/lib/design-studio-api.ts
git commit -m "feat: reuse profile documents by year safely"
```

### Task 6: Replace the main Design Studio catalog UI

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/DesignStudioPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/DesignStudioPage.test.tsx`
- Remove active imports from: `artifacts/adventure-zone/src/lib/design-studio/canva-starters.ts` (file may remain for archived editor compatibility)
- Create: `artifacts/adventure-zone/src/components/design-studio/TemplateCatalog.tsx`
- Create: `artifacts/adventure-zone/src/components/design-studio/TemplateCatalog.test.tsx`

**Interfaces:**
- Consumes: active template list and instantiate API
- Produces: Email / Contract / Proposal tabs, search, package and arrangement filters

- [ ] **Step 1: Write failing UI tests**

Assert old cards (“Event flyer,” “Social story,” generic “Agreement outline”) are absent. Assert tabs show exact counts 14, 15, and 7. Assert archived templates are not rendered. Assert clicking a template creates a draft but does not call send/sign endpoints.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm --filter @workspace/adventure-zone test -- DesignStudioPage.test.tsx TemplateCatalog.test.tsx`.

- [ ] **Step 3: Implement the catalog surface**

Remove the oversized old Canva starter preview section. Keep active projects below the catalog, grouped by draft versus historical state. Use clear cards showing family, package, arrangement, and description without duplicating price constants in the client.

- [ ] **Step 4: Implement loading/empty/error/retry states and keyboard-accessible tabs**

- [ ] **Step 5: Pass targeted tests and the app suite**

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/pages/DesignStudioPage* artifacts/adventure-zone/src/components/design-studio/TemplateCatalog* artifacts/adventure-zone/src/lib/design-studio/canva-starters.ts
git commit -m "feat: replace Design Studio with current catalog"
```

### Task 7: Add the profile Design Studio picker and document shelf

**Files:**
- Create: `artifacts/adventure-zone/src/components/profiles/ProfileDesignStudioPicker.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/ProfileDesignStudioPicker.test.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/ProfileDesignDocuments.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/ProfileDesignDocuments.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/profiles/simple-full-profile.tsx`
- Modify: `artifacts/adventure-zone/src/components/profiles/simple-full-profile.email-compose.test.tsx`

**Interfaces:**
- Consumes: organization ID, primary contact ID, current booking ID/year
- Produces: profile modal picker and grouped linked-document actions

- [ ] **Step 1: Write failing profile workflow tests**

Assert the profile has a Design Studio button; modal retains profile context; choosing a template passes the organization/contact/booking IDs; successful creation opens the editor; linked documents group into Current drafts, Final/sent documents, Previous years; actions are Edit, View, and Use for new year as appropriate.

- [ ] **Step 2: Run and verify failure**

- [ ] **Step 3: Implement the picker**

Reuse `TemplateCatalog` in modal mode. Do not require event details before selection. On failure, keep the modal open and offer retry.

- [ ] **Step 4: Implement the document shelf**

Load by exact organization ID. Current editable drafts open with Edit. Historical/final rows open read-only. Use for new year asks only for the target year when it cannot be inferred.

- [ ] **Step 5: Pass targeted tests and the app suite**

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/profiles/ProfileDesign* artifacts/adventure-zone/src/components/profiles/simple-full-profile*
git commit -m "feat: manage Design Studio documents from profiles"
```

### Task 8: Full verification and release evidence

**Files:**
- Create: `docs/acceptance/design-studio-current-template-catalog.md`
- Modify tests only if verification reveals a real uncovered behavior; use a failing regression test before any fix

**Interfaces:**
- Consumes all prior tasks
- Produces release checklist and verification record

- [ ] **Step 1: Run focused suites**

```bash
pnpm --filter @workspace/api-server test -- package-defaults.test.ts current-offer-catalog.test.ts template-catalog-schema.test.ts current-template-catalog.test.ts template-instantiation-service.test.ts profile-document-reuse.test.ts
pnpm --filter @workspace/adventure-zone test -- DesignStudioPage.test.tsx TemplateCatalog.test.tsx ProfileDesignStudioPicker.test.tsx ProfileDesignDocuments.test.tsx
```

Expected: zero failures.

- [ ] **Step 2: Run full repository verification**

```bash
pnpm test
pnpm run typecheck
pnpm run build
```

Record every failure by name. Do not report success while any command is red.

- [ ] **Step 3: Verify catalog invariants with a database-backed acceptance test**

Assert 14 active emails, 15 active contracts, 7 active proposals; no old active templates/projects; archived rows still exist; prices/footprints match the spec; contract bodies contain no footprint text; Foam Party is add-on-only.

- [ ] **Step 4: Verify the user flow**

Open a profile, instantiate one email, one contract, and one proposal; edit and reload each; finalize a test document; reuse it for the next year; verify the prior year remains unchanged.

- [ ] **Step 5: Write the acceptance record and commit**

```bash
git add docs/acceptance/design-studio-current-template-catalog.md
git commit -m "docs: record Design Studio catalog acceptance"
```
