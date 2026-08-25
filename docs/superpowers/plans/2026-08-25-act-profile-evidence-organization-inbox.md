# ACT Profile Evidence and Organization Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show preserved ACT Description/Business Card evidence for a selected lead profile and allow a verified organization inbox without inventing a person.

**Architecture:** Add a pure, fail-closed ACT text extractor and a read-only evidence repository that joins the selected CRM organization through existing ACT external links to the latest complete company detail snapshot. Extend the existing lead-review API, policy, persistence, client, and mobile review component with an explicit `organization_inbox` mode.

**Tech Stack:** TypeScript, Express, PostgreSQL/Drizzle, Zod, React, Vitest, Testing Library, PGlite.

**Spec:** `docs/superpowers/specs/2026-08-25-act-history-aware-lead-email-design.md`

## Global Constraints

- ACT source snapshots remain immutable.
- Only complete company detail snapshots may supply Description/Business Card evidence.
- Extract only string leaves whose normalized terminal key is `description`, ends in `description`, is `businesscard`, or ends in `businesscard`.
- Return the exact JSON property path and ACT source/version identifiers with every extracted value.
- Never create or overwrite a CRM person, email address, or role from extracted text.
- An organization inbox requires explicit recipient and suitability confirmation.
- Organization-inbox greetings are `Hi,`; no contact name or role is fabricated.
- Changing profile, recipient, recipient mode, or evidence invalidates previous confirmation.
- `DO NOT SEND` remains a later hard gate and is never weakened here.

---

### Task 1: Extract ACT Description and Business Card evidence safely

**Files:**
- Create: `artifacts/api-server/src/features/lead-intake/act-profile-evidence-extractor.ts`
- Test: `artifacts/api-server/src/features/lead-intake/act-profile-evidence-extractor.test.ts`

**Interfaces:**
- Consumes: `unknown` archived detail JSON and `{ sourceRecordId: string; sourceVersionId: string }`.
- Produces:

```ts
export type ActProfileTextEvidence = {
  sourceRecordId: string;
  sourceVersionId: string;
  sourcePath: string;
  kind: "description" | "business_card";
  originalText: string;
  emails: string[];
};

export function extractActProfileTextEvidence(
  rawSnapshot: unknown,
  source: { sourceRecordId: string; sourceVersionId: string },
): ActProfileTextEvidence[];
```

- [ ] **Step 1: Write the failing extractor tests**

```ts
it("extracts Alamosa description text and a normalized unique email", () => {
  expect(extractActProfileTextEvidence(
    { Description: "Society Hall Annual Celebration | Societyhall@gmail.com" },
    { sourceRecordId: "source-1", sourceVersionId: "version-1" },
  )).toEqual([{
    sourceRecordId: "source-1",
    sourceVersionId: "version-1",
    sourcePath: "$.Description",
    kind: "description",
    originalText: "Society Hall Annual Celebration | Societyhall@gmail.com",
    emails: ["societyhall@gmail.com"],
  }]);
});

it("ignores an email in an unrelated property", () => {
  expect(extractActProfileTextEvidence(
    { Notes: "unverified@example.com" },
    { sourceRecordId: "source-1", sourceVersionId: "version-1" },
  )).toEqual([]);
});
```

Also cover nested eligible keys, Business Card key normalization, malformed addresses, duplicate addresses, arrays, blank text, and non-object input.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/act-profile-evidence-extractor.test.ts
```

Expected: FAIL because the extractor module does not exist.

- [ ] **Step 3: Implement the minimal pure extractor**

Normalize only property names, recurse through objects/arrays while carrying a JSON path, accept eligible terminal keys, extract syntactically valid email tokens, lowercase them, and preserve first-seen order. Do not search text below an ineligible terminal property.

- [ ] **Step 4: Run focused tests and typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/act-profile-evidence-extractor.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: all focused tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/lead-intake/act-profile-evidence-extractor.ts artifacts/api-server/src/features/lead-intake/act-profile-evidence-extractor.test.ts
git commit -m "feat: extract ACT profile contact evidence"
```

---

### Task 2: Load the latest complete ACT company detail for a CRM organization

**Files:**
- Create: `artifacts/api-server/src/features/lead-intake/act-profile-evidence-repository.ts`
- Test: `artifacts/api-server/src/features/lead-intake/act-profile-evidence-repository.pglite.test.ts`
- Modify: `artifacts/api-server/src/routes/lead-intake.ts`
- Test: `artifacts/api-server/src/routes/lead-intake.test.ts`

**Interfaces:**
- Consumes: organization UUID.
- Uses existing active `actSourceAssignments` to organizations, legacy `actExternalLinks` (`entityType = organization`, `sourceEntityType = company`) as a migration-link fallback, `actSourceRecords`, and `actSourceRecordVersions`.
- Produces:

```ts
export type LeadProfileEvidence = {
  organization: { id: string; name: string; city: string | null; region: string | null; phone: string | null; website: string | null };
  contacts: Array<{ id: string; firstName: string; lastName: string; email: string | null; role: string | null; jobTitle: string | null }>;
  actText: ActProfileTextEvidence[];
  emailCandidates: Array<{ email: string; sourceRecordId: string; sourceVersionId: string; sourcePath: string }>;
};

export class ActProfileEvidenceRepository {
  constructor(database: DrizzleDatabase);
  load(organizationId: string): Promise<LeadProfileEvidence | null>;
}
```

- [ ] **Step 1: Write failing repository tests**

Seed one organization, one active contact, an active ACT source assignment, a legacy ACT external company link, a list snapshot, and two complete detail versions per linked source. Assert that `load()` returns the newest detail version for every uniquely linked company source, ignores list snapshots and superseded assignments, includes profile/contact details, deduplicates email candidates, and returns an empty `actText` array when no complete detail exists. Assert that a consolidated organization returns `null`.

- [ ] **Step 2: Run the repository test and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/act-profile-evidence-repository.pglite.test.ts
```

Expected: FAIL because `ActProfileEvidenceRepository` is missing.

- [ ] **Step 3: Implement the read-only repository**

Resolve company source identities first from non-superseded `actSourceAssignments` targeting the organization and then from `actExternalLinks.actRecordId = actSourceRecords.actRecordId` for legacy imported profiles. Deduplicate by `actSourceRecords.id`. For every linked source, select the newest version where `snapshotScope = 'detail'` and the source identity has `archiveCompleteness = 'complete'`, ordered by `fetchedAt DESC, id DESC`. Pass only those selected `rawSnapshot` values to `extractActProfileTextEvidence()`.

- [ ] **Step 4: Add the evidence endpoint and route test**

Add:

```text
GET /api/lead-intake/organizations/:organizationId/evidence
```

Return `{ evidence: LeadProfileEvidence }`, `400` for a malformed UUID, and `404` for a missing/consolidated organization. The endpoint must not return arbitrary raw snapshots.

- [ ] **Step 5: Run focused API tests and typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/act-profile-evidence-repository.pglite.test.ts src/routes/lead-intake.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/lead-intake/act-profile-evidence-repository.ts artifacts/api-server/src/features/lead-intake/act-profile-evidence-repository.pglite.test.ts artifacts/api-server/src/routes/lead-intake.ts artifacts/api-server/src/routes/lead-intake.test.ts
git commit -m "feat: expose ACT profile evidence for lead review"
```

---

### Task 3: Persist and validate organization-inbox recipient mode

**Files:**
- Create: `lib/db/migrations/20260825_lead_organization_inbox.sql`
- Modify: `lib/db/src/lead-intake-schema.ts`
- Modify: `artifacts/api-server/src/features/lead-intake/lead-intake-input.ts`
- Test: `artifacts/api-server/src/features/lead-intake/lead-intake-input.test.ts`
- Modify: `artifacts/api-server/src/features/lead-intake/lead-review-policy.ts`
- Test: `artifacts/api-server/src/features/lead-intake/lead-review-policy.test.ts`
- Modify: `artifacts/api-server/src/features/lead-intake/lead-review-service.ts`
- Test: `artifacts/api-server/src/features/lead-intake/lead-review-service.pglite.test.ts`

**Interfaces:**
- Extend `contactMode` to `"existing" | "manual" | "organization_inbox"`.
- In organization-inbox mode, `contactId`, trimmed `contactName`, and trimmed `contactRole` must all be absent; recipient, evidence, `recipientConfirmed`, and `introductionSuitable` remain required.
- Persist `selectedContactId = null`, `confirmedContactName = null`, and `confirmedContactRole = null` for organization inboxes.

- [ ] **Step 1: Write failing schema and policy tests**

```ts
it("accepts a confirmed organization inbox without a person", () => {
  const result = evaluateLeadReview({
    ...validDecision,
    contactMode: "organization_inbox",
    contactId: null,
    contactName: "",
    contactRole: "",
    recipientEmail: "societyhall@gmail.com",
  });
  expect(result).toEqual({ verified: true, blockers: [] });
});
```

Also assert rejection when organization-inbox mode includes a person ID/name/role, when recipient confirmation is false, or when evidence is missing. Preserve existing/manual behavior.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/lead-intake-input.test.ts src/features/lead-intake/lead-review-policy.test.ts src/features/lead-intake/lead-review-service.pglite.test.ts
```

Expected: FAIL because the enum and policy do not recognize `organization_inbox`.

- [ ] **Step 3: Add the migration and Drizzle constraint change**

Replace the contact-mode check with:

```sql
CHECK (contact_mode IS NULL OR contact_mode IN ('existing','manual','organization_inbox'))
```

Do not add a synthetic contact row or organization-level email column.

- [ ] **Step 4: Implement validation and persistence**

Add blocker `organization_inbox_person_fields_present`. Update `LeadReviewService.confirm()` so only existing mode checks membership/email equality and only organization-inbox mode stores person fields as null. Keep optimistic concurrency and evidence replacement atomic.

- [ ] **Step 5: Run migration, focused tests, and typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake/lead-intake-input.test.ts src/features/lead-intake/lead-review-policy.test.ts src/features/lead-intake/lead-review-service.pglite.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS, including the existing/manual regression cases.

- [ ] **Step 6: Commit**

```bash
git add lib/db/migrations/20260825_lead_organization_inbox.sql lib/db/src/lead-intake-schema.ts artifacts/api-server/src/features/lead-intake/lead-intake-input.ts artifacts/api-server/src/features/lead-intake/lead-intake-input.test.ts artifacts/api-server/src/features/lead-intake/lead-review-policy.ts artifacts/api-server/src/features/lead-intake/lead-review-policy.test.ts artifacts/api-server/src/features/lead-intake/lead-review-service.ts artifacts/api-server/src/features/lead-intake/lead-review-service.pglite.test.ts
git commit -m "feat: verify organization inbox recipients"
```

---

### Task 4: Show ACT evidence and organization-inbox selection in lead review

**Files:**
- Modify: `artifacts/adventure-zone/src/features/lead-intake/lead-intake-client.ts`
- Test: `artifacts/adventure-zone/src/features/lead-intake/lead-intake-client.test.ts`
- Modify: `artifacts/adventure-zone/src/components/lead-intake/lead-contact-date-review.tsx`
- Test: `artifacts/adventure-zone/src/components/lead-intake/lead-contact-date-review.test.tsx`

**Interfaces:**
- Add `getProfileEvidence(organizationId: string): Promise<LeadProfileEvidence>`.
- Extend `LeadImportReviewRow.contactMode` and review state to include `organization_inbox`.
- Selecting an ACT email fills `recipientEmail`, `emailSourceKind = "act_description"`, and `emailSource = "act:<sourceRecordId>:version:<sourceVersionId>:path:<sourcePath>"`.

- [ ] **Step 1: Write failing client/component tests**

Test that selecting Alamosa loads its phone, website, zero contacts, preserved ACT text, and `societyhall@gmail.com`. Test that choosing Organization inbox clears contact ID/name/role, previews `Hi,`, leaves confirmation unchecked, and submits `contactMode: "organization_inbox"`. Test that changing the email/profile/mode clears both confirmation checkboxes.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/lead-intake/lead-intake-client.test.ts src/components/lead-intake/lead-contact-date-review.test.tsx --maxWorkers=1
```

Expected: FAIL because profile evidence and organization-inbox controls are missing.

- [ ] **Step 3: Implement client types and evidence loading**

Keep profile search unchanged. After profile selection, call the new evidence endpoint and render explicit loading, empty, and failure states. Do not use the extracted email until the reviewer selects it.

- [ ] **Step 4: Implement the mobile review UI**

Render three recipient choices: Existing contact, Organization inbox, and Manual person. Show evidence cards with original text, source label, and selectable email chips. In organization-inbox mode hide person fields and render a greeting preview containing exactly `Hi,`.

- [ ] **Step 5: Run focused tests, typecheck, and build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/lead-intake/lead-intake-client.test.ts src/components/lead-intake/lead-contact-date-review.test.tsx --maxWorkers=1
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS and production build exits 0.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/features/lead-intake/lead-intake-client.ts artifacts/adventure-zone/src/features/lead-intake/lead-intake-client.test.ts artifacts/adventure-zone/src/components/lead-intake/lead-contact-date-review.tsx artifacts/adventure-zone/src/components/lead-intake/lead-contact-date-review.test.tsx
git commit -m "feat: review ACT inbox evidence on leads"
```

---

### Task 5: Verify the complete checkpoint

**Files:**
- Modify only if verification exposes a defect in files already named above.

**Interfaces:**
- No new interface; this task verifies the integrated checkpoint.

- [ ] **Step 1: Run the focused regression suite**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/lead-intake src/routes/lead-intake.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/lead-intake src/components/lead-intake --maxWorkers=1
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

Expected: all commands exit 0.

- [ ] **Step 2: Perform live acceptance testing after deployment**

Open Week 3 lead review, search/select `Alamosa ARTs Festival (Alamosa) CO`, confirm its existing profile details are visible, confirm the archived text contains `Society Hall Annual Celebration | Societyhall@gmail.com`, select the organization inbox, verify the greeting is `Hi,`, and confirm no contact name/role is created.

- [ ] **Step 3: Commit verification-only fixes, if any**

```bash
git add artifacts/api-server/src/features/lead-intake artifacts/api-server/src/routes/lead-intake.ts artifacts/adventure-zone/src/features/lead-intake artifacts/adventure-zone/src/components/lead-intake lib/db/src/lead-intake-schema.ts lib/db/migrations/20260825_lead_organization_inbox.sql
git commit -m "fix: close ACT lead evidence verification gaps"
```

Skip this commit when verification required no code changes.
