# Business Sources + Office Template Authoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make protected Business Source files directly viewable, refresh Adventure Zone standard templates/scripts from Sticky Notes plus Amy’s real outreach style, and let Office Coordinator users safely create private reusable templates from email drafts with protected merge fields and owner oversight.

**Architecture:** Extend the existing `communication_templates` model and Office email/template APIs rather than creating a second template subsystem. Add explicit template ownership, keep company/shared/private permission checks in the repository/service layer, reuse the current template renderer for final drafts, and add a focused token-safe authoring model for Office private templates. Business Source viewing reuses the existing signed-file open endpoint.

**Tech Stack:** TypeScript, React/Vite, Express, PostgreSQL/Drizzle, Zod, Wouter, Vitest/Testing Library, existing Office auth and communication-template renderer.

**Spec:** `docs/superpowers/specs/2026-08-24-business-sources-office-templates-design.md`

## Global Constraints

- Original source files remain evidence and are never silently rewritten or treated as operational truth merely because they exist.
- Adventure Zone Sticky Notes is the primary wording source for standard templates/scripts.
- Amy’s real sent-email patterns refine tone, sequencing, and practical variations but do not override reviewed business facts.
- Changing facts such as names, dates, prices, duration, package data, and additional-insured details render from approved placeholders/current structured data whenever practical.
- Standard template cleanup is light: spelling, punctuation, grammar, consistent naming, placeholders, readable paragraphing, and removal of obsolete event-specific details.
- Company templates cannot be overwritten by Office Coordinator users.
- Office-created templates are private to the creating Office account by default.
- Owner/admin can view, edit, archive, and promote Office-created templates.
- Office Coordinator users still cannot send email; template authoring must not expand send permissions.
- Office users cannot invent arbitrary placeholder names.
- Server-side validation must reject unknown or malformed placeholders even if client protection is bypassed.
- Final email drafts containing unresolved `{{...}}` placeholders remain blocked from submission.
- Guided-call wording changes may alter only speakable/coach text, never dispositions, branches, or workflow destinations.
- Private source binaries must never be committed to Git.

---

### Task 1: Surface protected Business Source files directly on source cards

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/business-sources/source-document-file-card.tsx`
- Test: `artifacts/adventure-zone/src/components/business-sources/source-document-file-card.test.tsx`
- Test: `artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.test.tsx`

**Interfaces:**
- Reuse existing `POST /business-sources/:documentId/file/open` signed-link endpoint.
- Produce a reusable `openSourceDocument(documentId: string): Promise<void>` helper or equivalent callback so the card header and file-management detail use the same authenticated open behavior.

- [ ] **Step 1: Write a failing source-card visibility test**

Assert a source record with `hasFile=true` and file metadata renders an immediately visible `View file` action without opening the details disclosure.

```tsx
expect(screen.getByRole("button", { name: /view file/i })).toBeVisible();
expect(screen.getByText(/uploaded/i)).toBeVisible();
```

Also assert a record with no file does not render `View file`.

- [ ] **Step 2: Run the focused tests and confirm RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/business-sources/source-document-file-card.test.tsx src/pages/SettingsBusinessSourcesPage.test.tsx
```

Expected: FAIL because file opening is currently only rendered inside the expandable file-management section.

- [ ] **Step 3: Extract/reuse the protected open behavior**

Keep the existing request exactly authenticated through `apiPost`:

```ts
const { url } = await apiPost<{ url: string }>(
  `/business-sources/${documentId}/file/open`,
  {},
);
if (!url) throw new Error("The protected document did not return a signed file link.");
window.open(url, "_blank", "noopener,noreferrer");
```

Do not expose `storage_reference`, permanent storage URLs, or storage-provider internals in the UI.

- [ ] **Step 4: Add visible file metadata/action to the main source card**

Show original filename, approximate file size when metadata exists, uploaded status, and `View file`. Keep upload/replace/remove inside the existing details section so destructive file management remains secondary.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/business-sources/source-document-file-card.test.tsx src/pages/SettingsBusinessSourcesPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.tsx artifacts/adventure-zone/src/components/business-sources/source-document-file-card.tsx artifacts/adventure-zone/src/components/business-sources/source-document-file-card.test.tsx artifacts/adventure-zone/src/pages/SettingsBusinessSourcesPage.test.tsx
git commit -m "feat: surface business source file viewing"
```

---

### Task 2: Add explicit template ownership and creator provenance

**Files:**
- Create: `lib/db/migrations/20260824_office_template_ownership.sql`
- Modify: `lib/db/src/business-source-schema.ts`
- Modify: `lib/db/src/office-coordinator-schema.ts` only if FK ordering/export constraints require it
- Modify: `artifacts/api-server/src/db/schema.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-types.ts`
- Test: `artifacts/api-server/src/features/communication-templates/communication-template-ownership-schema.test.ts`

**Interfaces:**

Add these ownership values:

```ts
export const communicationTemplateOwnerKindValues = [
  "company",
  "shared_office",
  "office_user",
] as const;
export type CommunicationTemplateOwnerKind =
  (typeof communicationTemplateOwnerKindValues)[number];
```

Add columns:

```text
owner_kind text NOT NULL DEFAULT 'company'
owner_office_account_id uuid NULL REFERENCES office_accounts(id) ON DELETE SET NULL
created_by_kind text NOT NULL DEFAULT 'system'
created_by_id uuid NULL
source_template_id uuid NULL REFERENCES communication_templates(id) ON DELETE SET NULL
```

Use checks so `owner_kind='office_user'` requires `owner_office_account_id IS NOT NULL`, while `company` and `shared_office` require it to be null.

- [ ] **Step 1: Write the failing schema contract test**

```ts
expect(communicationTemplates.ownerKind).toBeDefined();
expect(communicationTemplates.ownerOfficeAccountId).toBeDefined();
expect(communicationTemplates.createdByKind).toBeDefined();
expect(communicationTemplates.sourceTemplateId).toBeDefined();
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates/communication-template-ownership-schema.test.ts
```

- [ ] **Step 3: Implement migration + Drizzle schema**

Backfill all existing rows as `owner_kind='company'`, `created_by_kind='system'`. Add indexes:

```text
(state, owner_kind)
(owner_office_account_id, state)
(source_template_id)
```

- [ ] **Step 4: Extend template record/seed types**

`CommunicationTemplateRecord` must expose:

```ts
ownerKind: CommunicationTemplateOwnerKind;
ownerOfficeAccountId: string | null;
createdByKind: "system" | "owner" | "office_user";
createdById: string | null;
sourceTemplateId: string | null;
```

System seeds remain `company` owned.

- [ ] **Step 5: Run schema/type tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates/communication-template-ownership-schema.test.ts
pnpm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add lib/db/migrations/20260824_office_template_ownership.sql lib/db/src/business-source-schema.ts lib/db/src/office-coordinator-schema.ts artifacts/api-server/src/db/schema.ts artifacts/api-server/src/features/communication-templates/communication-template-types.ts artifacts/api-server/src/features/communication-templates/communication-template-ownership-schema.test.ts
git commit -m "feat: add communication template ownership"
```

---

### Task 3: Centralize template visibility, mutation permissions, and safe duplication

**Files:**
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-repository.ts`
- Create: `artifacts/api-server/src/features/communication-templates/communication-template-permissions.ts`
- Test: `artifacts/api-server/src/features/communication-templates/communication-template-permissions.test.ts`
- Test: `artifacts/api-server/src/features/communication-templates/communication-template-repository.test.ts`

**Interfaces:**

Produce:

```ts
export function canOfficeUseTemplate(
  template: CommunicationTemplateRecord,
  officeAccountId: string,
): boolean;

export function canOfficeMutateTemplate(
  template: CommunicationTemplateRecord,
  officeAccountId: string,
): boolean;
```

Rules:

```text
company       -> Office can use only when active + office-safe; cannot mutate
shared_office -> Office can use when active; cannot mutate
office_user   -> creator/owner account can use draft/reviewed/active private rows and can mutate own rows; other Office accounts cannot see/use them
owner/admin   -> can list/manage all rows
```

Repository additions:

```ts
listForOffice(officeAccountId: string): Promise<CommunicationTemplateRecord[]>;
createPrivateForOffice(input): Promise<CommunicationTemplateRecord>;
updatePrivateForOffice(templateId, officeAccountId, patch): Promise<CommunicationTemplateRecord>;
archivePrivateForOffice(templateId, officeAccountId): Promise<CommunicationTemplateRecord>;
duplicateForOffice(sourceTemplateId, officeAccountId, input): Promise<CommunicationTemplateRecord>;
promoteToShared(templateId, actorId: string): Promise<CommunicationTemplateRecord>;
```

- [ ] **Step 1: Write failing permission tests**

Cover company/shared/own-private/other-private visibility and mutation separately.

```ts
expect(canOfficeMutateTemplate(company, amyId)).toBe(false);
expect(canOfficeUseTemplate(company, amyId)).toBe(true);
expect(canOfficeMutateTemplate(amysPrivate, amyId)).toBe(true);
expect(canOfficeUseTemplate(amysPrivate, otherOfficeId)).toBe(false);
```

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates/communication-template-permissions.test.ts src/features/communication-templates/communication-template-repository.test.ts
```

- [ ] **Step 3: Implement pure permission helpers first**

Keep permission logic out of React/routes so all APIs enforce the same rule.

- [ ] **Step 4: Implement repository methods transactionally**

`duplicateForOffice` must create a new row with:

```ts
ownerKind: "office_user",
ownerOfficeAccountId: officeAccountId,
createdByKind: "office_user",
createdById: officeAccountId,
sourceTemplateId: source.id,
state: "active",
accessScope: "office",
```

Do not modify the source row.

- [ ] **Step 5: Implement owner promotion without losing creator provenance**

For a private Office template, promotion changes only:

```ts
ownerKind: "shared_office",
ownerOfficeAccountId: null,
```

Keep `createdByKind`, `createdById`, and `sourceTemplateId` unchanged.

- [ ] **Step 6: Run repository/permission tests and typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates/communication-template-permissions.test.ts src/features/communication-templates/communication-template-repository.test.ts
pnpm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/communication-templates/communication-template-repository.ts artifacts/api-server/src/features/communication-templates/communication-template-permissions.ts artifacts/api-server/src/features/communication-templates/communication-template-permissions.test.ts artifacts/api-server/src/features/communication-templates/communication-template-repository.test.ts
git commit -m "feat: enforce template ownership permissions"
```

---

### Task 4: Validate protected placeholder source text on every template mutation

**Files:**
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-types.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-renderer.ts`
- Create: `artifacts/api-server/src/features/communication-templates/communication-template-authoring.ts`
- Test: `artifacts/api-server/src/features/communication-templates/communication-template-authoring.test.ts`

**Interfaces:**

Produce:

```ts
export function validateAuthoredTemplateText(input: {
  subjectTemplate: string | null;
  bodyTemplate: string;
}): {
  placeholders: TemplatePlaceholder[];
};
```

Use the existing `allowedTemplatePlaceholders` as the only vocabulary. Reject malformed or unknown tokens with a stable `INVALID_TEMPLATE_PLACEHOLDER` error.

- [ ] **Step 1: Write failing validation tests**

```ts
expect(() => validateAuthoredTemplateText({
  subjectTemplate: "Hi {{contactName}}",
  bodyTemplate: "Come to {{eventName}}",
})).not.toThrow();

expect(() => validateAuthoredTemplateText({
  subjectTemplate: null,
  bodyTemplate: "Hi {{contacName}}",
})).toThrow("INVALID_TEMPLATE_PLACEHOLDER");
```

Also reject partial braces such as `{{contactName}` and arbitrary `{{favoriteColor}}`.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates/communication-template-authoring.test.ts
```

- [ ] **Step 3: Implement token extraction + malformed-token detection**

Do not silently strip unknown placeholders. Mutation must fail so the saved template can never contain a typoed merge field.

- [ ] **Step 4: Return normalized placeholder metadata from validation**

Repository create/update methods from Task 3 must set `allowedPlaceholders` from validated serialized content instead of accepting a client-provided array.

- [ ] **Step 5: Run tests/typecheck and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates/communication-template-authoring.test.ts
pnpm run typecheck
git add artifacts/api-server/src/features/communication-templates/communication-template-types.ts artifacts/api-server/src/features/communication-templates/communication-template-renderer.ts artifacts/api-server/src/features/communication-templates/communication-template-authoring.ts artifacts/api-server/src/features/communication-templates/communication-template-authoring.test.ts
git commit -m "feat: validate protected template placeholders"
```

---

### Task 5: Expand Office template APIs for private authoring and duplication

**Files:**
- Modify: `artifacts/api-server/src/routes/office-communication-templates.ts`
- Modify: `artifacts/api-server/src/routes/office-email-drafts.ts` only if draft-template provenance update is required
- Test: `artifacts/api-server/src/routes/office-communication-templates.test.ts`

**Interfaces:**

Keep:

```text
GET  /office/communication-templates
POST /office/communication-templates/:templateId/render
```

Add:

```text
POST  /office/communication-templates
PATCH /office/communication-templates/:templateId
POST  /office/communication-templates/:templateId/archive
POST  /office/communication-templates/:templateId/duplicate
```

Create/update payload:

```ts
{
  name: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
}
```

Do not accept `ownerKind`, `ownerOfficeAccountId`, `accessScope`, `createdByKind`, or arbitrary placeholder arrays from Office clients.

- [ ] **Step 1: Write failing API authorization tests**

Test two Office accounts. Amy can create/update/archive her own private template, cannot mutate company/shared/other-user templates, and cannot see another Office user’s private template.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/office-communication-templates.test.ts
```

- [ ] **Step 3: Update Office list response**

Return fields needed by the composer:

```ts
{
  id,
  code,
  name,
  category,
  subjectTemplate,
  bodyTemplate,
  requiredPlaceholders,
  ownerKind,
  editableByOffice,
  sourceTemplateId,
}
```

List company/shared + signed-in user’s private templates only.

- [ ] **Step 4: Add create/update/archive/duplicate routes**

Every mutation calls the Task 3 repository methods and Task 4 validation; do not duplicate authorization logic in route conditionals.

- [ ] **Step 5: Fix rendering lookup to use Office visibility**

The render endpoint must allow an Office user’s own active private template, company office-safe active templates, and shared active templates while rejecting another coordinator’s private template.

- [ ] **Step 6: Run route tests and typecheck**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/office-communication-templates.test.ts
pnpm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/routes/office-communication-templates.ts artifacts/api-server/src/routes/office-email-drafts.ts artifacts/api-server/src/routes/office-communication-templates.test.ts
git commit -m "feat: add Office private template APIs"
```

---

### Task 6: Build the protected placeholder authoring editor

**Files:**
- Create: `artifacts/adventure-zone/src/components/office/office-template-editor.tsx`
- Create: `artifacts/adventure-zone/src/components/office/protected-template-text.tsx`
- Create: `artifacts/adventure-zone/src/features/office/template-authoring.ts`
- Test: `artifacts/adventure-zone/src/components/office/office-template-editor.test.tsx`
- Test: `artifacts/adventure-zone/src/features/office/template-authoring.test.ts`

**Interfaces:**

Represent authored content as text + atomic tokens in UI, serialized to normal template strings at API boundaries.

```ts
export type TemplateSegment =
  | { kind: "text"; value: string }
  | { kind: "token"; token: TemplatePlaceholder };

export function parseTemplateSegments(value: string): TemplateSegment[];
export function serializeTemplateSegments(segments: TemplateSegment[]): string;
```

- [ ] **Step 1: Write failing parser/serializer tests**

```ts
expect(parseTemplateSegments("Hi {{contactName}}," )).toEqual([
  { kind: "text", value: "Hi " },
  { kind: "token", token: "contactName" },
  { kind: "text", value: "," },
]);
expect(serializeTemplateSegments(parseTemplateSegments("Hi {{contactName}},")))
  .toBe("Hi {{contactName}},");
```

- [ ] **Step 2: Write failing interaction tests for atomic tokens**

Assert the token appears as one UI element labeled `Contact Name`; users can remove the whole token and insert another approved token, but no text input exists for editing the token’s internal name.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/office/template-authoring.test.ts src/components/office/office-template-editor.test.tsx
```

- [ ] **Step 4: Implement segment parser/serializer**

Only parse tokens from the approved placeholder vocabulary. Unknown serialized source should display a validation error and remain unsavable rather than being converted to plain text silently.

- [ ] **Step 5: Implement the focused editor UI**

Fields:

```text
Template name
Subject
Body
Insert field palette
Preview
Save / Cancel
```

Use accessible chip/button controls for tokens rather than a contenteditable implementation that permits partial deletion.

- [ ] **Step 6: Add preview rendering with current context values supplied by parent**

Preview is visual only; saving serializes protected placeholders, not the current person/event values.

- [ ] **Step 7: Run component/unit tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/office/template-authoring.test.ts src/components/office/office-template-editor.test.tsx
git add artifacts/adventure-zone/src/components/office/office-template-editor.tsx artifacts/adventure-zone/src/components/office/protected-template-text.tsx artifacts/adventure-zone/src/features/office/template-authoring.ts artifacts/adventure-zone/src/components/office/office-template-editor.test.tsx artifacts/adventure-zone/src/features/office/template-authoring.test.ts
git commit -m "feat: add protected Office template editor"
```

---

### Task 7: Add draft-to-template replacement suggestions

**Files:**
- Create: `artifacts/adventure-zone/src/features/office/template-replacement-suggestions.ts`
- Modify: `artifacts/adventure-zone/src/components/office/office-template-editor.tsx`
- Test: `artifacts/adventure-zone/src/features/office/template-replacement-suggestions.test.ts`

**Interfaces:**

Produce:

```ts
export type TemplateReplacementSuggestion = {
  literal: string;
  token: TemplatePlaceholder;
  label: string;
};

export function suggestTemplateReplacements(input: {
  subject: string;
  body: string;
  context: {
    contactName?: string | null;
    eventName?: string | null;
    eventCity?: string | null;
    eventState?: string | null;
    eventDates?: string | null;
    packageName?: string | null;
    packagePrice?: string | null;
    packageDuration?: string | null;
  };
}): TemplateReplacementSuggestion[];
```

- [ ] **Step 1: Write failing suggestion tests**

Given `Hi Judith` and current contact `Judith`, suggest `Judith -> {{contactName}}`. Given a current event name occurring in the draft, suggest `{{eventName}}`. Do not suggest blank values or substrings inside unrelated words.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/office/template-replacement-suggestions.test.ts
```

- [ ] **Step 3: Implement deterministic literal matching**

Use current known profile/contact/package values only. Do not use AI/fuzzy guessing for protected-field replacement.

- [ ] **Step 4: Present each suggestion explicitly in the template editor**

Example UI copy:

```text
Replace “Judith” with Contact Name?
[Replace] [Keep literal]
```

No silent transformation.

- [ ] **Step 5: Run tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/office/template-replacement-suggestions.test.ts src/components/office/office-template-editor.test.tsx
git add artifacts/adventure-zone/src/features/office/template-replacement-suggestions.ts artifacts/adventure-zone/src/features/office/template-replacement-suggestions.test.ts artifacts/adventure-zone/src/components/office/office-template-editor.tsx
git commit -m "feat: suggest safe template merge fields"
```

---

### Task 8: Integrate Save/Edit Template into Amy’s existing email composer

**Files:**
- Modify: `artifacts/adventure-zone/src/components/office/office-email-editor.tsx`
- Modify: `artifacts/adventure-zone/src/pages/OfficeEmailDraftsPage.tsx` only if additional profile context must be passed down
- Test: `artifacts/adventure-zone/src/components/office/office-email-editor.template-authoring.test.tsx`

**Interfaces:**

Add Office editor behavior:

```text
custom/blank draft -> Save as Template
own private template -> Edit Template
company/shared template -> Save as My Template
```

The current draft subject/body remain unchanged unless the coordinator explicitly re-applies the saved template.

- [ ] **Step 1: Write failing button-mode tests**

Assert button labels for blank, own-private, and company/shared template origins.

- [ ] **Step 2: Write a failing “current draft becomes template input” test**

Type custom subject/body, click `Save as Template`, and assert `OfficeTemplateEditor` receives the current text rather than blank seed text.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/office/office-email-editor.template-authoring.test.tsx
```

- [ ] **Step 4: Add authoring state without disturbing draft persistence**

Do not reuse the draft `busy` state for template editing. Template save failures must preserve both the email draft text and unsaved template-editor text.

- [ ] **Step 5: Wire create/update/duplicate Office API calls**

For company/shared source templates, call `/duplicate`; never PATCH the source template. For own private templates, PATCH the private row.

- [ ] **Step 6: Refresh the available template list after save**

The newly created private template should immediately appear in `Start from template` for the signed-in coordinator.

- [ ] **Step 7: Preserve final-draft unresolved-token guard**

Keep:

```ts
const unresolvedToken = /\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/;
```

or a stricter equivalent. `Submit Email` stays disabled while unresolved serialized placeholders remain in the actual email draft.

- [ ] **Step 8: Run Office editor tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/office/office-email-editor*.test.tsx
git add artifacts/adventure-zone/src/components/office/office-email-editor.tsx artifacts/adventure-zone/src/pages/OfficeEmailDraftsPage.tsx artifacts/adventure-zone/src/components/office/office-email-editor.template-authoring.test.tsx
git commit -m "feat: let Office save private email templates"
```

---

### Task 9: Add owner/admin visibility, grouping, and promotion controls

**Files:**
- Modify: `artifacts/api-server/src/routes/communication-templates.ts`
- Modify: `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx`
- Test: `artifacts/api-server/src/routes/communication-templates.test.ts`
- Test: `artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.test.tsx`

**Interfaces:**

Owner list response includes ownership/provenance fields. Add owner route:

```text
POST /communication-templates/:templateId/promote-shared
```

Admin UI groups/filters:

```text
Adventure Zone Templates
Shared Office Templates
Coordinator Templates
Archived
```

- [ ] **Step 1: Write failing owner API tests**

Owner sees company/shared/all private rows and can promote a private template. Office ownership/creator provenance remains present after promotion.

- [ ] **Step 2: Write failing admin UI grouping tests**

Assert private rows render under `Coordinator Templates` with creator display label; company templates render under `Adventure Zone Templates`; shared rows under `Shared Office Templates`.

- [ ] **Step 3: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/communication-templates.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/SettingsCommunicationTemplatesPage.test.tsx
```

- [ ] **Step 4: Add promotion endpoint**

Owner only. Reject promotion of already-company rows and missing templates with clear 4xx errors.

- [ ] **Step 5: Update Admin Communication Templates UI**

Actions for private coordinator templates:

```text
Edit
Archive
Make shared template
```

Do not expose Office account password/login-secret data; creator display name is sufficient.

- [ ] **Step 6: Run route/UI tests and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/communication-templates.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/SettingsCommunicationTemplatesPage.test.tsx
git add artifacts/api-server/src/routes/communication-templates.ts artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.tsx artifacts/api-server/src/routes/communication-templates.test.ts artifacts/adventure-zone/src/pages/SettingsCommunicationTemplatesPage.test.tsx
git commit -m "feat: manage coordinator templates from Admin"
```

---

### Task 10: Refresh Adventure Zone standard template seeds from Sticky Notes + Amy usage

**Files:**
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-seed.ts`
- Modify: `artifacts/api-server/src/features/communication-templates/communication-template-repository.ts`
- Create: `artifacts/api-server/src/features/communication-templates/communication-template-seed-refresh.test.ts`
- Modify: source/provenance notes only as needed; never commit source binary

**Interfaces:**

Keep stable template codes where their job is unchanged. Add stable codes for missing source-supported jobs, including at minimum:

```text
wrong_person_forward
insurance_liability_response
not_this_year_thank_you
```

Keep existing useful codes such as:

```text
new_event_intro
past_customer_rebooking
follow_up_next_season
coi_information_request
ride_inspector_request
internal_coi_request
```

- [ ] **Step 1: Write source-fidelity regression tests before changing copy**

The tests should require recognizable source/Amy patterns without copying entire source documents. Examples:

```ts
expect(byCode.get("new_event_intro")?.bodyTemplate)
  .toContain("My name is {{senderName}}");
expect(byCode.get("new_event_intro")?.bodyTemplate)
  .toContain("We’d love to come to your {{eventName}}");
expect(byCode.get("wrong_person_forward")?.bodyTemplate)
  .toMatch(/forward.*right person/i);
expect(byCode.get("insurance_liability_response")?.bodyTemplate)
  .toMatch(/additional(?:ly)? insured/i);
```

Also assert price/duration are placeholders rather than literal old source values where the template is reusable.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates/communication-template-seed-refresh.test.ts
```

- [ ] **Step 3: Recraft standard copy using the approved source order**

Use Sticky Notes wording as the base, Amy’s actual sent emails to preserve her natural sequencing, and structured placeholders for current facts. Do not rewrite into generic corporate language.

For the main outreach, preserve the recognizable structure:

```text
Hi {{contactName}},

My name is {{senderName}}, and I work with Dave. We represent The Adventure Zone — America’s Best Inflatable Carnival! We’d love to come to your {{eventName}}!

[package/attraction description using placeholders/current reviewed data]
...
```

Do not hard-code `$9,000`, `1-4 days`, or other changing package facts when the template can render `{{packagePrice}}` / `{{packageDuration}}`.

- [ ] **Step 4: Add the approved administrative/reply templates**

Include source-grounded wording for:

```text
Insurance / liability concern response
Certificate of Insurance information request
Internal COI request
Ride / inflatable inspector request
Thank you / not this year / keep us in mind
Wrong person / please forward
```

Do not expose owner-only internal inspector/insurance request templates to Office unless explicitly office-safe.

- [ ] **Step 5: Implement explicit safe seed refresh instead of `onConflictDoNothing` for known system rows**

Add a seed revision marker or known-source-note revision check so only system-owned company templates still matching the previous seed provenance are updated. Never overwrite owner-edited rows or coordinator templates.

Example rule:

```ts
if (
  existing.ownerKind === "company" &&
  existing.createdByKind === "system" &&
  existing.sourceNote === PREVIOUS_SYSTEM_SOURCE_NOTE
) {
  // safe known-seed refresh
}
```

- [ ] **Step 6: Preserve Sticky Notes provenance**

Each standard template keeps `sourceDocumentId` pointing to `ADVENTURE ZONE STICKY NOTES.docx.pdf` and a concise source note explaining that wording was lightly normalized and corroborated against Amy’s real outreach patterns.

- [ ] **Step 7: Run seed tests/typecheck and commit**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/communication-templates/communication-template-seed*.test.ts
pnpm run typecheck
git add artifacts/api-server/src/features/communication-templates/communication-template-seed.ts artifacts/api-server/src/features/communication-templates/communication-template-repository.ts artifacts/api-server/src/features/communication-templates/communication-template-seed-refresh.test.ts
git commit -m "refactor: restore source-grounded Adventure Zone templates"
```

---

### Task 11: Selectively align guided-call wording with approved source language

**Files:**
- Inspect/modify only the existing guided call wording module(s), expected under `artifacts/adventure-zone/src/features/calls/` and/or API call-script feature files
- Test: existing guided call graph/branch tests
- Add: focused source-wording regression test only for nodes actually changed

**Interfaces:**
- No graph interface changes.
- No disposition/action destination changes.
- Only `say` / `coach` strings may change.

- [ ] **Step 1: Identify only call nodes whose purpose matches source material**

Candidates include initial introduction, wrong-person handling, insurance concern, budget/space response, and follow-up-later language. Do not touch unrelated strong existing call wording.

- [ ] **Step 2: Write wording + graph-invariance tests first**

For each changed node, assert the intended recognizable wording plus unchanged branch target IDs/dispositions.

- [ ] **Step 3: Run focused tests and verify RED for wording only**

Use the existing guided-call Vitest command/file names discovered in the repo before editing.

- [ ] **Step 4: Make minimal speakable wording refinements**

Keep each live-call turn normally one or two sentences before pausing. Prefer the current call wording whenever it is clearer than the source.

- [ ] **Step 5: Run all guided-call tests and commit**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/features/calls/*test*
git add artifacts/adventure-zone/src/features/calls artifacts/api-server/src/features/calls
git commit -m "refactor: align selected call wording with business sources"
```

If no guided-call nodes benefit from a source-based change after inspection, record that result in the PR description and make no code commit for this task.

---

### Task 12: Full regression, permission, and production verification

**Files:**
- Modify tests only if final integration reveals stale contracts
- No feature expansion in this task

**Interfaces:**
- Verifies the completed system as one workflow.

- [ ] **Step 1: Run focused Business Sources + template API suites**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/business-sources/*test* src/features/communication-templates/*test* src/routes/communication-templates.test.ts src/routes/office-communication-templates.test.ts
```

- [ ] **Step 2: Run focused frontend suites**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/business-sources/*test* src/components/office/*template*test* src/components/office/office-email-editor*test* src/pages/SettingsCommunicationTemplatesPage.test.tsx
```

- [ ] **Step 3: Run Office Coordinator regression tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/Office*test* src/components/office/*test*
pnpm --filter @workspace/api-server exec vitest run src/features/office/*test* src/routes/office-*test*
```

Verify explicitly that Office can save/submit but no Office route sends mail.

- [ ] **Step 4: Run typecheck and production builds**

```bash
pnpm run typecheck
pnpm --filter @workspace/adventure-zone build
pnpm --filter @workspace/api-server build
```

- [ ] **Step 5: Run source-binary safety check**

```bash
git diff --name-only main...HEAD | grep -Ei '\.(pdf|docx|xlsx|xls|png|jpg|jpeg)$' && exit 1 || true
```

Expected: no private source binary files in the diff.

- [ ] **Step 6: Inspect final diff for permission and source-scope regressions**

Confirm:

```text
Business Sources uses signed open URLs only.
Office cannot mutate company/shared/other-user private templates.
Office cannot send email.
Owner can manage/promote private templates.
Unknown template tokens are rejected server-side.
Rendered drafts remain editable snapshots.
Standard template copy preserves Sticky Notes/Amy voice and current facts via placeholders.
No CRM records are changed by template authoring.
```

- [ ] **Step 7: Commit any verification-only contract adjustments**

```bash
git add -A
git commit -m "test: verify Office template authoring workflow"
```

Only create this commit if verification required test/contract adjustments; otherwise leave the verified feature commits unchanged.
