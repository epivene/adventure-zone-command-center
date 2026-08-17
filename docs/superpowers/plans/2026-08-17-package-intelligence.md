# Package Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Follow test-driven development: write the failing test, run it, implement the minimum change, re-run, then commit.

**Goal:** Replace the old rigid package-count behavior with editable advisory ranges, clearer attraction categories, flexible multi-package sections, and deterministic source-linked historical comparison signals.

**Architecture:** Keep the existing `packageTemplates`, booking package selections, resource assignments, resource package tags, and conflict engine. Extend package templates additively, treat `baseAttractionCount` as the suggested/default count for backward compatibility, add advisory min/max fields, and add an explicit resource package-count category. Historical comparison is a read-only service over canonical bookings/resources and never mutates the current booking.

**Tech Stack:** TypeScript, React, Vite, Express, Drizzle ORM/PostgreSQL, Zod, Vitest/Testing Library.

## Global constraints

- Adventure Zone starts at suggested `10`, normal range `10–12`.
- Preserve package stable codes and existing foreign keys. Rename display names only: existing Weekend Warriors-style record becomes `Warrior's Playground`; existing Pirates spelling becomes `Pirate's Rebellion` if applicable.
- Warrior's Playground starts suggested/range `5–5`; Pirate's Rebellion starts suggested/range `3–3`. Admin UI supports widening those ranges later without code changes.
- A count outside a guideline is allowed and saved normally. Do not require `attractionTotalApprovalReason` solely because a count is outside the package range.
- Keep the existing legacy `bookings.attractionTotalApprovalReason` column for historical compatibility. New package UI does not require or populate it for guideline deviations.
- Package selections do not imply exact equipment.
- A physical resource counts once even if attributed to multiple package sections.
- `main_attraction` contributes to package guideline comparisons; `game_extra` and `special_shared` do not.
- Paintball should be `special_shared` and retain its existing movable/resource conflict behavior.
- Historical comparison outputs are advisory and source-linked.
- No automatic copy-forward from a previous booking.

## Migration

Use `lib/db/migrations/044_package_intelligence.sql` unless current `main` has occupied prefix 044 before implementation starts; in that case shift to the next unused prefix and update `lib/db/src/migrations.ts` consistently before coding.

## File map

### Shared database

- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/044_package_intelligence.sql`
- Modify: `lib/db/src/migrations.ts`
- Create: `lib/db/src/package-intelligence-schema.test.ts`

### Server package domain

- Modify: `artifacts/api-server/src/features/packages/package-types.ts`
- Modify: `artifacts/api-server/src/features/packages/package-input.ts`
- Modify: `artifacts/api-server/src/features/packages/package-policy.ts`
- Modify: `artifacts/api-server/src/features/packages/package-repository.ts`
- Modify: `artifacts/api-server/src/features/packages/package-service.ts`
- Modify/Create focused package tests beside those files following current repository convention.
- Create: `artifacts/api-server/src/features/packages/package-history.ts`
- Create: `artifacts/api-server/src/features/packages/package-history.test.ts`
- Modify: `artifacts/api-server/src/routes/bookings.ts`
- Modify: relevant booking route tests.

### Frontend package domain/UI

- Modify mirrored pure files:
  - `artifacts/adventure-zone/src/features/packages/package-types.ts`
  - `artifacts/adventure-zone/src/features/packages/package-input.ts`
  - `artifacts/adventure-zone/src/features/packages/package-policy.ts`
  - `artifacts/adventure-zone/src/features/packages/package-repository.ts` where frontend types/models mirror server data.
- Modify: `artifacts/adventure-zone/src/components/packages/package-template-editor.tsx`
- Modify: package template editor tests.
- Modify: `artifacts/adventure-zone/src/components/bookings/package-resource-editor.tsx`
- Modify/Create: package resource editor tests.
- Create: `artifacts/adventure-zone/src/components/bookings/package-history-signals.tsx`
- Create: `artifacts/adventure-zone/src/components/bookings/package-history-signals.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/BookingDetailPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/SettingsPackagesResourcesPage.tsx` only as needed for typed data.

## Task 1: Convert package total policy from validation to advisory guidance

### Interfaces

Update the package summary shape in both server and frontend copies:

```ts
export type PackageTemplateSummary = {
  id: string;
  code: string;
  name: string;
  baseAttractionCount: number;
  minimumAttractionCount: number;
  maximumAttractionCount: number;
};

export type AttractionTotalPolicy = {
  suggested: number | null;
  minimum: number | null;
  maximum: number | null;
  advisoryMessage: string | null;
};
```

Keep `validateSharedAttractionTotal()` only for structural requirements: if packages are selected and the existing workflow still requires a physical total, it may return `TOTAL_REQUIRED`. Remove `APPROVAL_REASON_REQUIRED` from package-range validation.

### Steps

- [ ] **Step 1: Write failing policy tests.**

Add/modify tests to prove:

1. Adventure Zone template with `10/10/12` returns suggested 10 and range 10–12.
2. A single Warrior's Playground `5/5/5` returns 5–5.
3. A single Pirate's Rebellion `3/3/3` returns 3–3.
4. A multi-package selection returns a useful aggregate advisory without enforcing a cap. The aggregate must be derived from selected package guidelines rather than the old hard-coded `10–12` branch.
5. `physicalAttractionTotal: 14` is valid without an approval reason.
6. `physicalAttractionTotal: 9` is valid without an approval reason.
7. Missing total behavior remains whatever current booking contract requires when packages are selected.

- [ ] **Step 2: Run focused tests and confirm failure.**

```bash
pnpm exec vitest run artifacts/api-server/src/features/packages/package-policy.test.ts
```

If the existing test filename differs, run the colocated package policy test file returned by repository search; do not create a duplicate suite just for naming convenience.

- [ ] **Step 3: Implement advisory policy.**

Change `getAttractionTotalPolicy()` so it reads fields from templates. For multiple selected packages, calculate an aggregate guideline by summing package suggestions/min/max because package sections now represent independent sold package scale. Physical-resource counting remains separate, so this aggregate is only a package-level guide and must be labeled accordingly.

Remove the range-based approval-reason branch from `validateSharedAttractionTotal()`.

- [ ] **Step 4: Remove `APPROVAL_REASON_REQUIRED` from `PackageConfigurationError`.**

Update `PackageService.configureBooking()` so a normal out-of-range total does not fail. Continue accepting the legacy `attractionTotalApprovalReason` property in the request contract during this release for API compatibility, but normalize it to `null` for new package-editor saves unless another explicit workflow supplied a meaningful legacy note.

- [ ] **Step 5: Run focused server tests and mirrored frontend tests.**

```bash
pnpm exec vitest run artifacts/api-server/src/features/packages/package-policy.test.ts artifacts/api-server/src/features/packages/package-service.test.ts
pnpm exec vitest run artifacts/adventure-zone/src/features/packages/package-policy.test.ts
```

- [ ] **Step 6: Commit.**

```bash
git add artifacts/api-server/src/features/packages artifacts/adventure-zone/src/features/packages
git commit -m "fix: make package ranges advisory"
```

## Task 2: Add package guideline/business fields and resource count categories

### Schema additions

Extend `package_templates` with:

```ts
minimumAttractionCount: integer("minimum_attraction_count").notNull()
maximumAttractionCount: integer("maximum_attraction_count").notNull()
customerDescription: text("customer_description")
bookingTalkingPoints: text("booking_talking_points")
operationalRequirements: text("operational_requirements")
setupNotes: text("setup_notes")
```

Add check constraints:

- minimum > 0
- maximum >= minimum
- base/suggested > 0

Extend `resources` with:

```ts
packageCountCategory: text("package_count_category")
  .$type<"main_attraction" | "game_extra" | "special_shared">()
  .default("main_attraction")
  .notNull()
```

Add a validity check for the three values.

### Migration/backfill rules

`044_package_intelligence.sql` must:

1. add the package guideline/business columns safely,
2. backfill min/max from existing `base_attraction_count`,
3. set Adventure Zone min/max to 10/12 by stable code,
4. keep Warrior package stable code unchanged but update display name to `Warrior's Playground`, base/min/max 5/5/5,
5. keep Pirate package stable code unchanged but update display name to `Pirate's Rebellion`, base/min/max 3/3/3,
6. add `resources.package_count_category`,
7. classify paintball by stable resource code as `special_shared`,
8. classify obvious existing game resources as `game_extra` only where current stable category/tag data identifies them deterministically; otherwise default to `main_attraction` and let admin correct them in settings rather than guessing,
9. leave historical booking/resource assignments intact.

### Steps

- [ ] **Step 1: Add failing schema contract tests** in `lib/db/src/package-intelligence-schema.test.ts` asserting all new columns/check intent and stable exports.

- [ ] **Step 2: Run the schema test.**

```bash
pnpm exec vitest run lib/db/src/package-intelligence-schema.test.ts
```

Expected: fail because fields do not exist.

- [ ] **Step 3: Modify Drizzle schema and write migration SQL.**

Do not drop `base_attraction_count` or `attraction_total_approval_reason` in this release.

- [ ] **Step 4: Register migration** in `lib/db/src/migrations.ts` with a marker that confirms both `package_templates.minimum_attraction_count` and `resources.package_count_category` exist.

- [ ] **Step 5: Add migration preservation test** if current migration tests support disposable database execution. Assert preexisting package selections, booking IDs, resource assignments, and resource-package attributions remain unchanged.

- [ ] **Step 6: Run DB tests and typecheck.**

```bash
pnpm exec vitest run lib/db/src/package-intelligence-schema.test.ts
pnpm run typecheck
```

- [ ] **Step 7: Commit.**

```bash
git add lib/db
git commit -m "feat: add package guideline fields"
```

## Task 3: Extend package settings repository/input/service

### Updated admin input

Update both server/frontend Zod schemas:

```ts
export const packageTemplateInputSchema = z.object({
  id: canonicalUuid,
  name: z.string().trim().min(1).max(100),
  baseAttractionCount: z.number().int().positive(),
  minimumAttractionCount: z.number().int().positive(),
  maximumAttractionCount: z.number().int().positive(),
  customerDescription: nullableTrimmedString,
  bookingTalkingPoints: nullableTrimmedString,
  operationalRequirements: nullableTrimmedString,
  setupNotes: nullableTrimmedString,
  active: z.boolean(),
}).strict().superRefine((input, ctx) => {
  if (input.maximumAttractionCount < input.minimumAttractionCount) {
    ctx.addIssue({ code: "custom", message: "Maximum must be at least the minimum." });
  }
});
```

Extend resource settings input/model with `packageCountCategory`.

### Steps

- [ ] **Step 1: Write failing input tests** for min/max validation, text trimming/null normalization, and allowed resource categories.
- [ ] **Step 2: Write failing repository tests** verifying all new package fields persist and audit before/after snapshots include them.
- [ ] **Step 3: Implement repository reads/writes** in server `package-repository.ts` and resource settings repository.
- [ ] **Step 4: Keep stable package codes read-only.** No UI/service action may rename codes.
- [ ] **Step 5: Run focused tests.**

```bash
pnpm exec vitest run artifacts/api-server/src/features/packages/package-input.test.ts artifacts/api-server/src/features/packages/package-repository.test.ts
```

- [ ] **Step 6: Commit.**

```bash
git add artifacts/api-server/src/features/packages artifacts/adventure-zone/src/features/packages
 git commit -m "feat: edit package guidelines and knowledge"
```

## Task 4: Update Package & Resources settings UI

### User experience

Each package form should show:

- name,
- suggested count,
- normal minimum,
- normal maximum,
- customer description,
- booking talking points,
- operational requirements,
- setup notes,
- active toggle.

Use plain-language helper text: “These are normal guidelines. Bookings can still go above or below this range.”

Resource editor gets a select/radio for:

- Main attraction
- Carnival game / extra
- Special / shared equipment

### Steps

- [ ] **Step 1: Write failing component tests** proving range fields render/save and no wording implies a hard cap.
- [ ] **Step 2: Add resource category UI test** proving paintball can be `special_shared`.
- [ ] **Step 3: Implement `PackageTemplateEditor` changes.** Keep mobile form layout readable; do not turn settings into a giant table.
- [ ] **Step 4: Implement resource category control** in the existing inventory editor.
- [ ] **Step 5: Run UI tests.**

```bash
pnpm exec vitest run artifacts/adventure-zone/src/components/packages/package-template-editor.test.tsx artifacts/adventure-zone/src/components/resources/resource-inventory-editor.test.tsx
```

- [ ] **Step 6: Run frontend typecheck.**

```bash
pnpm --filter @workspace/adventure-zone run typecheck
```

- [ ] **Step 7: Commit.**

```bash
git add artifacts/adventure-zone/src/components artifacts/adventure-zone/src/pages/SettingsPackagesResourcesPage.tsx
git commit -m "feat: expand package settings"
```

## Task 5: Make booking package UI section-based and non-blocking

### Behavior

The booking package editor must stop presenting one out-of-range approval textarea. Instead:

- selected packages appear as package cards/sections,
- each card shows `current main attractions / normal range`,
- resources attributed to that package appear inside/under its section,
- games/extras are summarized separately,
- special/shared resources are summarized separately,
- an unusual package count shows a soft amber informational message,
- Save remains enabled.

Do not duplicate a physical resource when it appears in multiple package attribution sections; the overall resources section remains the physical truth.

### Steps

- [ ] **Step 1: Write failing component tests** for a 14-attraction Adventure Zone booking saving without an approval reason.
- [ ] **Step 2: Add test for combined packages** proving independent package cards and no duplicated physical total.
- [ ] **Step 3: Add test for category summaries** proving game and special/shared resources do not appear in main-attraction target count.
- [ ] **Step 4: Refactor `package-resource-editor.tsx`** into small internal/package components if needed; keep one public component and avoid unrelated page refactors.
- [ ] **Step 5: Remove “Out-of-range approval reason” field from normal package UI.** If legacy data contains an old reason, display it read-only in history/detail only if currently exposed elsewhere; do not erase it.
- [ ] **Step 6: Run focused UI and service tests.**
- [ ] **Step 7: Commit.**

```bash
git add artifacts/adventure-zone/src/components/bookings artifacts/adventure-zone/src/features/packages
git commit -m "feat: show flexible package sections"
```

## Task 6: Add deterministic package history comparison service

### Server contract

Create `package-history.ts` with:

```ts
export type PackageHistorySource = {
  bookingId: string;
  eventStartAt: string | null;
  label: string;
};

export type PackageHistorySignal =
  | {
      kind: "usual_package_mix";
      packageNames: string[];
      sourceBookingIds: string[];
    }
  | {
      kind: "main_attraction_difference";
      previousCount: number;
      currentCount: number;
      difference: number;
      sourceBookingId: string;
    }
  | {
      kind: "missing_prior_resource";
      resourceId: string;
      resourceName: string;
      sourceBookingId: string;
    }
  | {
      kind: "usual_event_month";
      month: number;
      sampleBookingIds: string[];
    };

export type PackageHistoryComparison = {
  currentBookingId: string;
  signals: PackageHistorySignal[];
  sources: PackageHistorySource[];
};
```

### Matching scope

Find prior bookings using the strongest canonical relationship available in this order:

1. same event family if current booking/profile resolves to one,
2. same organization,
3. no comparison if neither relationship is available.

Do not fuzzy-match names inside this service.

### Signal rules

- `usual_package_mix`: require at least two prior bookings with the same normalized package set OR one immediately prior booking when fewer than two historical bookings exist; label weaker evidence in UI accordingly.
- `main_attraction_difference`: compare current saved total with most recent prior booking that has a physical total.
- `missing_prior_resource`: only flag notable `special_shared` resources from the most recent prior booking, initially including paintball; do not nag for every ordinary inflatable.
- `usual_event_month`: require at least two prior bookings in the same month.

### Steps

- [ ] **Step 1: Write failing pure/service tests** for each signal and no-history/no-relation cases.
- [ ] **Step 2: Implement repository query** with only the fields required for comparison.
- [ ] **Step 3: Implement pure signal derivation** separately from DB query so it is easy to test.
- [ ] **Step 4: Add booking route payload** at a field such as `packageHistoryComparison` rather than adding a second standalone fetch unless payload size becomes material.
- [ ] **Step 5: Test that deleted/archived/inapplicable records do not generate misleading signals according to existing booking status conventions.
- [ ] **Step 6: Commit.**

```bash
git add artifacts/api-server/src/features/packages artifacts/api-server/src/routes/bookings.ts
git commit -m "feat: compare prior package history"
```

## Task 7: Surface history signals on booking detail

### UI

Create `PackageHistorySignals` with plain-language cards such as:

- “Last year had 12 main attractions; this booking has 9.”
- “Paintball was included on the most recent booking.”
- “They usually book Adventure Zone + Pirate's Rebellion.”

Each card has a small `Based on previous booking` link/action where the existing UI can navigate to that booking. Do not call these facts “AI insights”; they are deterministic history comparisons.

### Steps

- [ ] **Step 1: Write failing component tests** for each signal type and source booking link.
- [ ] **Step 2: Implement the component** with compact mobile layout.
- [ ] **Step 3: Add it to `BookingDetailPage.tsx`** near package/resources, not as a new top-level navigation area.
- [ ] **Step 4: Verify no signal automatically changes package selections/resources.
- [ ] **Step 5: Run page/component tests and typecheck.**
- [ ] **Step 6: Commit.**

```bash
git add artifacts/adventure-zone/src/components/bookings artifacts/adventure-zone/src/pages/BookingDetailPage.tsx
git commit -m "feat: show package history signals"
```

## Task 8: Release verification

- [ ] Run all package/resource/server tests impacted by this release.
- [ ] Run database/schema/migration tests.
- [ ] Run root typecheck:

```bash
pnpm run typecheck
```

- [ ] Build app/server using current repository build command:

```bash
pnpm run build
```

- [ ] Manually verify these cases in the running app:
  1. Adventure Zone 11 shows normal.
  2. Adventure Zone 14 shows a soft advisory and saves normally.
  3. Adventure Zone + Pirate's Rebellion show separate sections.
  4. Carnival game is separated from main attraction target.
  5. Paintball is special/shared and still participates in resource conflict behavior.
  6. Previous-year signal appears but does not alter current selections.
  7. Package names display `Warrior's Playground` and `Pirate's Rebellion` while existing historical records remain linked.

- [ ] Check `git diff main...HEAD` for accidental unrelated refactors.
- [ ] Commit any verification-only fixes separately.

## Release completion

Open a PR from `feature/package-intelligence` to `main`. Do not start the Booking Assistant branch until this release has merged, because Release 2 consumes the new package guideline/history contracts.
