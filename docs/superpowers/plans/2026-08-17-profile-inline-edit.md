# Profile Inline Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the simplified profile surface directly editable in place on both full-profile and slide-in views, while keeping the existing profile/contact APIs and deeper CRM tools intact.

**Architecture:** Add one shared phone presentation helper and one shared `ProfileInlineEditor` that owns edit state, profile-field drafts, primary-contact drafts, save/cancel behavior, and mutation sequencing. `SimpleFullProfile` and `ProfileDetailSheet` consume the shared editor/presentation helpers so both surfaces behave consistently. Profile saves reuse `PATCH /event-profiles/:id`; contact saves reuse the existing `/contacts/:id` GET + PUT contract.

**Tech Stack:** React, TypeScript, Wouter, existing `apiGet`/`apiPatch`/`apiPut` auth helpers, Vitest + Testing Library, Tailwind CSS.

## Global Constraints

- Full profiles and the profile slide-in show a clear **Edit** action in the top-right near Actions/Open full.
- Edit mode stays on the same screen and shows **Save** and **Cancel**.
- Existing permissions and validation remain authoritative.
- No database schema change.
- No replacement of note/follow-up/event editing flows.
- No removal of Advanced profile tools.
- A normal 10-digit US number displays as `(xxx) xxx-xxxx`; an 11-digit value beginning with `1` uses the same local form; international/extensions are preserved safely.
- Phone formatting is presentation-first and must not destructively rewrite imported raw values merely for appearance.
- Website appears alongside phone and email in the primary contact row when present.

---

### Task 1: Shared phone/contact presentation helpers

**Files:**
- Create: `artifacts/adventure-zone/src/features/contacts/phone-display.ts`
- Create: `artifacts/adventure-zone/src/features/contacts/phone-display.test.ts`

**Interfaces:**
- Produces: `formatPhoneDisplay(value: string | null | undefined): string | null`
- Produces: `phoneHref(value: string | null | undefined): string | null`

- [ ] **Step 1: Write failing formatter tests**

```ts
import { describe, expect, it } from "vitest";
import { formatPhoneDisplay, phoneHref } from "./phone-display";

describe("phone display", () => {
  it("formats ordinary US numbers", () => {
    expect(formatPhoneDisplay("9705473100")).toBe("(970) 547-3100");
    expect(formatPhoneDisplay("1-970-547-3100")).toBe("(970) 547-3100");
    expect(phoneHref("(970) 547-3100")).toBe("tel:+19705473100");
  });

  it("preserves extension and international values safely", () => {
    expect(formatPhoneDisplay("970-547-3100 ext 22")).toBe("970-547-3100 ext 22");
    expect(formatPhoneDisplay("+44 20 7946 0958")).toBe("+44 20 7946 0958");
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter adventure-zone test -- src/features/contacts/phone-display.test.ts`
Expected: FAIL because `phone-display.ts` does not exist.

- [ ] **Step 3: Implement the minimal helper**

```ts
export function formatPhoneDisplay(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  if (/\b(?:ext\.?|x)\s*\d+/i.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10 || raw.startsWith("+") && !raw.startsWith("+1")) return raw;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

export function phoneHref(value: string | null | undefined) {
  const raw = value?.trim();
  if (!raw) return null;
  if (/\b(?:ext\.?|x)\s*\d+/i.test(raw)) return `tel:${raw.replace(/\s+/g, "")}`;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return `tel:${raw}`;
}
```

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `pnpm --filter adventure-zone test -- src/features/contacts/phone-display.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/features/contacts/phone-display.ts artifacts/adventure-zone/src/features/contacts/phone-display.test.ts
git commit -m "feat: format profile phone numbers consistently"
```

### Task 2: Shared inline profile editor and mutation flow

**Files:**
- Create: `artifacts/adventure-zone/src/components/profiles/profile-inline-editor.tsx`
- Create: `artifacts/adventure-zone/src/components/profiles/profile-inline-editor.test.tsx`

**Interfaces:**
- Consumes: `formatPhoneDisplay`, existing `apiGet`, `apiPatch`, `apiPut`.
- Produces: `ProfileInlineEditor({ profile, onSaved, onCancel }: { profile: EventProfile; onSaved: () => Promise<void> | void; onCancel?: () => void })`.

- [ ] **Step 1: Write failing tests for Save, Cancel, and failed-save retention**

Create tests that render the editor with a profile containing a primary contact and assert:

```ts
expect(screen.getByLabelText("Profile name")).toHaveValue("16th Street Fair (Denver) CO");
expect(screen.getByLabelText("Website")).toHaveValue("https://example.com");
expect(screen.getByLabelText("Phone")).toHaveValue("7207277467");
```

On Save, assert `apiPatch("/event-profiles/profile-1", ...)` is called for profile fields. Mock `apiGet("/contacts/contact-1")` and assert `apiPut("/contacts/contact-1", { contact, phones })` is used for contact changes. Assert `onSaved` is called only after both operations succeed. On Cancel, assert no mutation helper is called. On a rejected mutation, assert the entered value remains in the input and an alert is visible.

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm --filter adventure-zone test -- src/components/profiles/profile-inline-editor.test.tsx`
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement draft state and profile/contact save sequencing**

The component must expose ordinary fields in-place:

```ts
type ProfileDraft = {
  name: string;
  phone: string;
  website: string;
  address1: string;
  address2: string;
  city: string;
  region: string;
  postalCode: string;
};
```

For the selected primary contact, load `/contacts/:id` when edit mode starts and expose existing contact fields supported by `ContactEditPage`: first name, last name, organization name, job title, email, phone, address lines, city, region, postal code, plus the existing phones array. Save the profile draft via `apiPatch`; save changed contact data via `apiPut`. Do not create a new API.

- [ ] **Step 4: Keep errors local and preserve entered values**

Use `saving` to disable duplicate Save submissions. On failure, keep draft state untouched and render:

```tsx
<p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>
```

- [ ] **Step 5: Run focused test and verify GREEN**

Run: `pnpm --filter adventure-zone test -- src/components/profiles/profile-inline-editor.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/profiles/profile-inline-editor.tsx artifacts/adventure-zone/src/components/profiles/profile-inline-editor.test.tsx
git commit -m "feat: add inline profile editor"
```

### Task 3: Full profile inline Edit mode and contact row

**Files:**
- Modify: `artifacts/adventure-zone/src/components/profiles/simple-full-profile.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Test: `artifacts/adventure-zone/src/pages/EventProfilePage.simple-layout.test.ts`
- Create: `artifacts/adventure-zone/src/components/profiles/simple-full-profile.inline-edit.test.tsx`

**Interfaces:**
- Consumes: `ProfileInlineEditor`, `formatPhoneDisplay`, `phoneHref`.
- Changes `SimpleFullProfile` props to accept `onProfileSaved?: () => Promise<void> | void` while preserving existing `profile` prop.

- [ ] **Step 1: Write failing full-profile surface tests**

Assert view mode contains a top-right button named `Edit`, and contact presentation contains a formatted `(720) 727-7467`, email, and website in the same contact-method container. Click Edit and assert profile inputs plus Save/Cancel replace the display header without navigation.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter adventure-zone test -- src/components/profiles/simple-full-profile.inline-edit.test.tsx src/pages/EventProfilePage.simple-layout.test.ts`
Expected: FAIL because Edit and shared contact presentation are absent.

- [ ] **Step 3: Add Edit/View mode to `SimpleFullProfile`**

Add `editing` state. In view mode, place a clear `Edit` button next to `ProfileActionsMenu`. In edit mode, render `ProfileInlineEditor` instead of the identity/contact header. Save calls `onProfileSaved`, exits edit mode only after successful refresh, and Cancel exits without saving.

- [ ] **Step 4: Put website beside phone/email and format phone display**

Render phone, email, website as one flex-wrapped contact-method row. Use `normalizeExternalWebsite` for the website `href`, `formatPhoneDisplay` for visible phone text, and `phoneHref` for `tel:` links. If there is no primary-contact phone, fall back to `profile.place.phone` without showing duplicate numbers.

- [ ] **Step 5: Wire page refresh after inline Save**

Update `EventProfilePage` to pass `onProfileSaved={loadProfile}` into `SimpleFullProfile`. Keep Advanced profile tools unchanged.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `pnpm --filter adventure-zone test -- src/components/profiles/simple-full-profile.inline-edit.test.tsx src/pages/EventProfilePage.simple-layout.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/profiles/simple-full-profile.tsx artifacts/adventure-zone/src/components/profiles/simple-full-profile.inline-edit.test.tsx artifacts/adventure-zone/src/pages/EventProfilePage.tsx artifacts/adventure-zone/src/pages/EventProfilePage.simple-layout.test.ts
git commit -m "feat: edit full profiles inline"
```

### Task 4: Slide-in profile inline Edit mode

**Files:**
- Modify: `artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.tsx`
- Modify: `artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.test.tsx`

**Interfaces:**
- Consumes: `ProfileInlineEditor`, `formatPhoneDisplay`, `phoneHref`.
- Keeps existing `ProfileDetailSheet` external props stable.

- [ ] **Step 1: Extend failing sheet test**

Mock a loaded profile and assert the sheet header/surface exposes `Edit`. Click Edit and verify `ProfileInlineEditor` fields render without changing route or requiring Open full. Assert the normal contact row shows formatted phone, email, and website.

- [ ] **Step 2: Run focused test and verify RED**

Run: `pnpm --filter adventure-zone test -- src/components/profiles/profile-detail-sheet.test.tsx`
Expected: FAIL on missing Edit / website / formatted phone behavior.

- [ ] **Step 3: Add inline editor to the sheet**

Reuse the same shared component. After Save, reload the sheet's existing `/event-profiles/:id` data, preserve the currently selected Overview/Notes/Events tab where practical, and return to view mode. Keep Open full and Actions intact.

- [ ] **Step 4: Run focused test and verify GREEN**

Run: `pnpm --filter adventure-zone test -- src/components/profiles/profile-detail-sheet.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.tsx artifacts/adventure-zone/src/components/profiles/profile-detail-sheet.test.tsx
git commit -m "feat: edit profile drawer inline"
```

### Task 5: Regression and compatibility pass

**Files:**
- Test existing relevant profile/contact suites; no production file change unless a regression is exposed.

**Interfaces:**
- Verifies the new editor uses existing APIs and does not remove existing routes/tools.

- [ ] **Step 1: Run focused profile/contact suites**

Run:
```bash
pnpm --filter adventure-zone test -- \
  src/features/contacts/phone-display.test.ts \
  src/components/profiles/profile-inline-editor.test.tsx \
  src/components/profiles/simple-full-profile.inline-edit.test.tsx \
  src/components/profiles/profile-detail-sheet.test.tsx \
  src/pages/EventProfileEditPage.test.tsx \
  src/pages/EventProfilePage.simple-layout.test.ts \
  src/pages/ContactDetailPage.test.tsx
```
Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter adventure-zone typecheck`
Expected: exit 0.

- [ ] **Step 3: Run build**

Run: `pnpm --filter adventure-zone build`
Expected: exit 0.

- [ ] **Step 4: Manual/mobile acceptance checklist**

Verify:
- Open a profile slide-in -> phone displays `(xxx) xxx-xxxx` -> website sits beside phone/email.
- Tap Edit -> change profile name/location/website/contact details -> Save -> values refresh in place.
- Tap Edit -> change text -> Cancel -> original values return.
- Force a failed Save -> inline error appears and entered text remains.
- Open full profile -> same Edit behavior works.
- Notes, Events, Actions, Open full, Advanced profile tools, and contact/profile deep routes still work.

- [ ] **Step 5: Commit any test-only cleanup if needed**

```bash
git add artifacts/adventure-zone/src
git commit -m "test: verify profile inline editing"
```
