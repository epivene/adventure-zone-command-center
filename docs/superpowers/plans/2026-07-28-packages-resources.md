# Packages and Resources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one booking select multiple package labels while retaining one correct physical-attraction total, assign real resources, approve special requests, and detect paintball/equipment conflicts.

**Architecture:** Pure package and conflict policies remain independent of persistence. Transactional services store package selections, totals, requests, assignments, and audited overrides. Booking screens compose focused editors instead of expanding the existing core booking form into one crowded component.

**Tech Stack:** Next.js 16 App Router and server actions, React 19, TypeScript 6, Drizzle ORM/PostgreSQL, Clerk owner authorization, Zod 4, Vitest/Testing Library, Playwright.

## Global Constraints

- Initial templates are Adventure Zone 10, Weekend Warriors 5, and Pirates Rebellion 3.
- A booking may select multiple packages; package bases are never summed automatically.
- A multi-package booking suggests 10 and normally accepts 10–12 physical attractions.
- Out-of-range totals remain possible only with an approval reason.
- A physical attraction counts once even when attributed to multiple packages.
- Package attribution is inferred from resource tags and can be manually overridden.
- Specific requests use add-to-count, replace-included, or note-only and remain pending until approved or declined.
- Approving an add request never silently changes the saved physical total.
- Paintball is a movable shared resource tagged to Weekend Warriors and counted once.
- Conflict overrides require a reason, stay visible as overridden, and are audited.
- Every mutation requires `requireOwner()` and server-side validation.
- This plan runs after the CRM plan and owns migration `0007`; agents do not run schema tasks from different plans in parallel.

---

## File Structure

- `features/packages/package-types.ts` — template, selection, attribution, and request types.
- `features/packages/package-policy.ts` — pure total, attribution, and request rules.
- `features/packages/package-input.ts` — Zod inputs.
- `features/packages/package-repository.ts` — package/request persistence.
- `features/packages/package-service.ts` — transactional booking configuration.
- `features/resources/resource-types.ts` — inventory, reservation, and warning contracts.
- `features/resources/resource-conflicts.ts` — deterministic conflict detection.
- `features/resources/resource-repository.ts` — inventory and assignment persistence.
- `features/resources/resource-service.ts` — assignment and override transactions.
- `components/bookings/package-resource-editor.tsx` — booking package/total/assignment editor.
- `components/bookings/special-request-editor.tsx` — request and approval workflow.
- `components/bookings/resource-warning-list.tsx` — visible active/overridden warnings.

### Task 1: Implement package rules as pure policy

**Files:**

- Create: `features/packages/package-types.ts`
- Create: `features/packages/package-policy.ts`
- Create: `tests/unit/package-policy.test.ts`

**Interfaces:**

- Produces:

```ts
export const specialRequestTreatmentValues = [
  "add_to_count",
  "replace_included",
  "note_only",
] as const;

export const requestApprovalStatusValues = [
  "needs_approval",
  "approved",
  "declined",
] as const;

export type PackageTemplateSummary = {
  id: string;
  code: string;
  name: string;
  baseAttractionCount: number;
};

export function getAttractionTotalPolicy(
  packages: readonly PackageTemplateSummary[],
): { suggested: number | null; minimum: number | null; maximum: number | null };

export function validateSharedAttractionTotal(input: {
  packages: readonly PackageTemplateSummary[];
  physicalAttractionTotal: number | null;
  approvalReason: string | null;
}): Result<void, { code: "TOTAL_REQUIRED" | "APPROVAL_REASON_REQUIRED" }>;

export function packageAttributionForResource(input: {
  selectedPackageIds: readonly string[];
  resourcePackageIds: readonly string[];
  manualPackageIds: readonly string[] | null;
}): { packageTemplateId: string; source: "inferred" | "manual" }[];
```

- [ ] **Step 1: Write the failing rule tests**

Assert Adventure Zone suggests 10, Weekend Warriors 5, Pirates Rebellion 3,
two/three packages suggest 10 with range 10–12, 9/13 require a reason, one
resource counts once, manual attribution replaces inference, and only an
approved add-to-count request contributes a delta of one.

- [ ] **Step 2: Run the focused test**

Run:

```bash
npx vitest run tests/unit/package-policy.test.ts
```

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement the minimum pure functions**

Represent a deliberate empty manual attribution as `[]`; use `null` to mean
infer. Do not read the database or mutate booking totals from these functions.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run tests/unit/package-policy.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/packages/package-types.ts features/packages/package-policy.ts tests/unit/package-policy.test.ts
git commit -m "feat: add package attraction rules"
```

### Task 2: Add package and resource schema

**Files:**

- Modify: `db/schema.ts`
- Modify: `db/seed.ts`
- Create: `db/migrations/0007_packages_resources.sql`
- Create: `db/migrations/meta/0007_snapshot.json`
- Modify: `db/migrations/meta/_journal.json`
- Modify: `tests/unit/schema-contract.test.ts`
- Modify: `tests/unit/seed-runner-contract.test.ts`
- Modify: `scripts/preflight-daily-operations-migration.sh`
- Modify: `docs/operations/daily-operations-migration.md`
- Create: `tests/integration/package-resource-migration.test.ts`

**Interfaces:**

- Consumes: completed CRM migration `0006`
- Produces: `packageTemplates`, `bookingPackageSelections`,
  `bookingSpecialRequests`, `resources`, `resourcePackageTags`,
  `bookingResourceAssignments`, `bookingResourcePackageAttributions`, and
  `resourceConflictOverrides`

- [ ] **Step 1: Write failing schema, seed, and preservation tests**

Assert:

```ts
expect(bookings.physicalAttractionTotal).toBeDefined();
expect(bookings.attractionTotalApprovalReason).toBeDefined();
expect(packageTemplates.code).toBeDefined();
expect(bookingPackageSelections.bookingId).toBeDefined();
expect(resources.countsAsAttraction).toBeDefined();
expect(bookingResourceAssignments.resourceId).toBeDefined();
```

The migration test starts with legacy bookings and asserts their IDs, notes,
contacts, and Act! links survive with a null physical total.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
npx vitest run tests/unit/schema-contract.test.ts tests/unit/seed-runner-contract.test.ts tests/integration/package-resource-migration.test.ts
```

Expected: FAIL because tables/defaults do not exist.

- [ ] **Step 3: Add the package/resource migration**

Add checked/unique tables and columns from the design. Use stable seed codes:

```ts
{ code: "adventure_zone", name: "Adventure Zone", baseAttractionCount: 10 }
{ code: "weekend_warriors", name: "Weekend Warriors", baseAttractionCount: 5 }
{ code: "pirates_rebellion", name: "Pirates Rebellion", baseAttractionCount: 3 }
{ code: "paintball_trailer", name: "Paintball trailer", category: "trailer",
  countsAsAttraction: true, movable: true }
```

Tag paintball with Weekend Warriors. Seed idempotently by stable code. Do not
infer packages from legacy booking notes.

- [ ] **Step 4: Extend preflight and operations documentation**

Preflight rejects incompatible existing stable codes. The operations document
requires encrypted backup, disposable restore rehearsal, migration, seed,
row-count/constraint verification, and database restore instead of destructive
reverse SQL.

- [ ] **Step 5: Run migration and regression checks**

Run:

```bash
npx vitest run tests/unit/schema-contract.test.ts tests/unit/seed-runner-contract.test.ts tests/integration/package-resource-migration.test.ts
bash scripts/preflight-daily-operations-migration.sh
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add db scripts/preflight-daily-operations-migration.sh docs/operations/daily-operations-migration.md tests
git commit -m "feat: add package and resource schema"
```

### Task 3: Add transactional package and request services

**Files:**

- Create: `features/packages/package-input.ts`
- Create: `features/packages/package-repository.ts`
- Create: `features/packages/package-service.ts`
- Create: `tests/unit/package-input.test.ts`
- Create: `tests/integration/package-repository.test.ts`
- Create: `tests/integration/package-service.test.ts`

**Interfaces:**

- Consumes: package policy and new schema
- Produces:

```ts
export type ConfigureBookingPackagesInput = {
  bookingId: string;
  packageTemplateIds: string[];
  physicalAttractionTotal: number | null;
  attractionTotalApprovalReason: string | null;
  manualAttributions: {
    bookingResourceAssignmentId: string;
    packageTemplateIds: string[] | null;
  }[];
};

export class PackageService {
  configureBooking(
    input: ConfigureBookingPackagesInput,
  ): Promise<Result<BookingPackageSummary, PackageConfigurationError>>;

  addSpecialRequest(input: AddSpecialRequestInput):
    Promise<Result<BookingSpecialRequest, PackageConfigurationError>>;

  decideSpecialRequest(input: DecideSpecialRequestInput):
    Promise<Result<BookingSpecialRequest, PackageConfigurationError>>;
}
```

- [ ] **Step 1: Write failing validation and transaction tests**

Cover two packages with total 11, duplicate prevention, inactive/unknown
templates, foreign assignment IDs, out-of-range reason, rollback on audit
failure, pending add/replace/note requests, one-time approve/decline, and legacy
null totals.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run tests/unit/package-input.test.ts tests/integration/package-repository.test.ts tests/integration/package-service.test.ts
```

Expected: FAIL because services are missing.

- [ ] **Step 3: Implement package transactions**

`configureBooking()` locks the booking, verifies active package IDs and
assignment ownership, replaces selections/attributions, stores the total/reason,
and writes one audit entry. Request decisions lock a still-pending row and write
their audit. Approval changes the displayed suggestion only; it never rewrites
the saved total.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run tests/unit/package-input.test.ts tests/integration/package-repository.test.ts tests/integration/package-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/packages tests/unit/package-input.test.ts tests/integration/package-repository.test.ts tests/integration/package-service.test.ts
git commit -m "feat: add booking package configuration"
```

### Task 4: Add resource assignments and deterministic conflict detection

**Files:**

- Create: `features/resources/resource-types.ts`
- Create: `features/resources/resource-input.ts`
- Create: `features/resources/resource-conflicts.ts`
- Create: `features/resources/resource-repository.ts`
- Create: `features/resources/resource-service.ts`
- Create: `tests/unit/resource-conflicts.test.ts`
- Create: `tests/integration/resource-repository.test.ts`
- Create: `tests/integration/resource-service.test.ts`

**Interfaces:**

- Produces:

```ts
export interface TransferTimeLookup {
  estimateMinutes(
    from: ResourceReservation,
    to: ResourceReservation,
  ): Promise<{ minutes: number; source: "live" | "cached" | "manual" } | null>;
}

export async function detectResourceConflicts(input: {
  reservations: readonly ResourceReservation[];
  physicalAttractionTotal: number | null;
  assignedAttractionCount: number;
  transferTimeLookup: TransferTimeLookup;
}): Promise<ResourceWarning[]>;

export class ResourceService {
  configureBookingAssignments(
    input: ConfigureBookingResourcesInput,
  ): Promise<Result<BookingResourceSummary, ResourceError>>;

  acknowledgeConflict(
    input: AcknowledgeResourceConflictInput,
  ): Promise<Result<void, ResourceError>>;
}
```

- [ ] **Step 1: Write failing conflict and transaction tests**

Cover overlapping setup/event/teardown windows, nonoverlap, paintball transfer
gap, missing route/location warning, count mismatch, unavailable resource,
duplicate prevention, audited override, changed-conflict fingerprint, and
rollback on audit failure.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run tests/unit/resource-conflicts.test.ts tests/integration/resource-repository.test.ts tests/integration/resource-service.test.ts
```

Expected: FAIL because resource files do not exist.

- [ ] **Step 3: Implement warnings and assignment transactions**

Use warning codes:

```ts
type ResourceWarningCode =
  | "RESOURCE_OVERLAP"
  | "PAINTBALL_TRANSFER_TIME"
  | "TRANSFER_TRIP_MISSING"
  | "RESOURCE_LOCATION_UNKNOWN"
  | "ATTRACTION_TOTAL_MISMATCH"
  | "RESOURCE_UNAVAILABLE";
```

Build a deterministic `conflictKey` from code, resource ID, sorted assignment
IDs, and the relevant time/location fingerprint. Missing travel data produces a
warning, never zero minutes. An old override cannot hide a changed conflict.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run tests/unit/resource-conflicts.test.ts tests/integration/resource-repository.test.ts tests/integration/resource-service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/resources tests/unit/resource-conflicts.test.ts tests/integration/resource-repository.test.ts tests/integration/resource-service.test.ts
git commit -m "feat: add resource assignments and conflicts"
```

### Task 5: Build package and inventory settings

**Files:**

- Create: `app/(private)/settings/packages-resources/page.tsx`
- Create: `app/(private)/settings/packages-resources/actions.ts`
- Create: `components/packages/package-template-editor.tsx`
- Create: `components/resources/resource-inventory-editor.tsx`
- Modify: `components/navigation/app-shell.tsx`
- Create: `tests/unit/package-resource-settings.test.tsx`
- Create: `tests/unit/package-resource-actions.test.ts`

**Interfaces:**

- Consumes: package/resource repositories
- Produces:

```ts
updatePackageTemplateAction(input: PackageTemplateInput): Promise<ActionResult>
upsertResourceAction(input: ResourceInput): Promise<ActionResult>
```

- [ ] **Step 1: Write failing settings and action tests**

Assert owner checks, server parsing, readable errors, package activation,
resource name/category/tags/normal leg/movability/setup/teardown/status, and
archive/deactivate instead of delete.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run tests/unit/package-resource-settings.test.tsx tests/unit/package-resource-actions.test.ts
```

Expected: FAIL because settings do not exist.

- [ ] **Step 3: Implement settings UI and actions**

Use active legs only for new normal-leg selections while retaining archived leg
labels on historical resources. Revalidate settings, bookings, routes, and
Today after writes.

- [ ] **Step 4: Run focused tests, lint, and typecheck**

Run:

```bash
npx vitest run tests/unit/package-resource-settings.test.tsx tests/unit/package-resource-actions.test.ts
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/'(private)'/settings/packages-resources components/packages components/resources components/navigation tests/unit
git commit -m "feat: add package and resource settings"
```

### Task 6: Integrate packages/resources into bookings and operational summaries

**Files:**

- Create: `features/bookings/booking-operations-summary.ts`
- Create: `components/bookings/package-resource-editor.tsx`
- Create: `components/bookings/special-request-editor.tsx`
- Create: `components/bookings/resource-warning-list.tsx`
- Modify: `features/bookings/booking-repository.ts`
- Modify: `features/calls/call-workspace-query.ts`
- Modify: `features/follow-ups/today-query.ts`
- Modify: `app/(private)/bookings/actions.ts`
- Modify: `app/(private)/bookings/[bookingId]/page.tsx`
- Modify: `app/(private)/bookings/[bookingId]/edit/page.tsx`
- Create: `tests/unit/package-resource-editor.test.tsx`
- Create: `tests/e2e/booking-packages-resources.spec.ts`
- Modify: `tests/e2e/booking-flow.spec.ts`

**Interfaces:**

- Produces for Call Workspace and Today:

```ts
export type BookingOperationsSummary = {
  packageNames: string[];
  sharedAttractionTotal: number | null;
  pendingRequestCount: number;
  leg: { id: string; name: string; color: string } | null;
  warnings: Array<{
    id: string;
    kind: "package" | "resource" | "route" | "fuel";
    severity: "warning" | "blocking";
    message: string;
    href: string;
  }>;
};

export interface BookingOperationsSummaryProvider {
  getForBooking(bookingId: string): Promise<BookingOperationsSummary>;
}
```

- [ ] **Step 1: Write failing component and end-to-end tests**

Cover Adventure Zone + Weekend Warriors displaying `2 packages · 11
attractions`, editable suggestion, out-of-range approval, inferred/manual
attribution, pending special requests, paintball counted once, warnings,
reasoned overrides, responsive layout, and keyboard labels/focus.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run tests/unit/package-resource-editor.test.tsx
```

Expected: FAIL because booking components do not exist.

- [ ] **Step 3: Implement focused booking forms and server actions**

Keep package/resource forms beside the existing `BookingForm`; do not move
package inference or conflicts into that component. Actions call the domain
services, return typed errors, and revalidate booking detail/edit, Today, and
Routes. Wire `BookingOperationsSummaryProvider` into the Call Workspace and
Today so pending requests and resource warnings appear without those consumers
querying package/resource tables directly.

- [ ] **Step 4: Run complete package/resource verification**

Run:

```bash
npm test
npm run lint
npm run typecheck
npm run build
npm run test:e2e -- tests/e2e/booking-packages-resources.spec.ts tests/e2e/booking-flow.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/bookings features/calls/call-workspace-query.ts features/follow-ups/today-query.ts components/bookings app/'(private)'/bookings tests
git commit -m "feat: add packages and resources to bookings"
```
