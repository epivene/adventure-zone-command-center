# Today Renewals Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate next-season renewal work from current-season follow-up-plan work on Today, while keeping renewals visible year-round and automatically prominent only when a dated renewal is overdue or within 30 business-calendar days.

**Architecture:** Add a focused renewal-classification/query unit beside the existing Today follow-up query, then extend the Today dashboard contract with a distinct renewals collection and isolated renewal-load error. Keep `Needs Follow-up Plan` current-season only by excluding `renewal_due`; the API performs deterministic renewal classification, and a new React section owns collapsed/expanded presentation without mutating bookings or follow-ups.

**Tech Stack:** TypeScript, Express, Drizzle ORM/PostgreSQL, React, Wouter, Vitest, Testing Library, pnpm.

## Global Constraints

- Classification is deterministic: a booking is renewal work only when status is `renewal_due`, or status is `completed` and it has an incomplete follow-up.
- A past event date alone must never classify an active booking as renewal work.
- A booking must not appear in both **Needs Follow-up Plan** and **Next Season / Renewals**.
- Existing follow-up records remain the source of truth; Today classification must not create, delete, reschedule, complete, or otherwise mutate them.
- **Next Season / Renewals** is visible all year and collapsed by default when no dated renewal is overdue or within 30 days.
- A dated renewal due within 30 business-calendar days, including today, is prominent; overdue dated renewals are also prominent.
- A `renewal_due` booking with no incomplete follow-up is shown as **Needs renewal plan**, but that undated item does not trigger automatic expansion.
- Dated renewal items sort overdue first, then current/future by due date, then stable booking/follow-up identifiers; undated **Needs renewal plan** items sort after dated items.
- The 30-day calculation uses the existing `America/Chicago` business-date convention.
- A renewal-load failure must not prevent the primary Today dashboard sections from rendering when those sections loaded successfully.
- Tests are written and observed failing before production changes.

---

## File Structure

- Create `artifacts/api-server/src/features/follow-ups/renewal-query.ts`: deterministic renewal classification, 30-day attention calculation, ordering, and Drizzle renewal loading.
- Create `artifacts/api-server/src/features/follow-ups/renewal-query.test.ts`: focused classification/query behavior tests.
- Modify `artifacts/api-server/src/features/follow-ups/today-query.ts`: exclude `renewal_due` from current-season plan work, expose renewal data in the Today contract, isolate renewal-load errors, and enrich renewals with booking operations.
- Create `artifacts/api-server/src/features/follow-ups/today-query.test.ts`: dashboard orchestration tests, including renewal-load failure isolation.
- Create `artifacts/adventure-zone/src/components/today/renewals-section.tsx`: mobile-friendly collapsed/expanded renewal section.
- Create `artifacts/adventure-zone/src/components/today/renewals-section.test.tsx`: initial-open, manual-collapse, ordering/copy, and error rendering tests.
- Modify `artifacts/adventure-zone/src/pages/TodayPage.tsx`: coerce renewal date payloads and render the new section below current-season dashboard work.
- Create `artifacts/adventure-zone/src/pages/TodayPage.test.tsx`: API-to-page regression proving current-season and renewal buckets render separately.

---

### Task 1: Add deterministic renewal classification and loading

**Files:**
- Create: `artifacts/api-server/src/features/follow-ups/renewal-query.ts`
- Create: `artifacts/api-server/src/features/follow-ups/renewal-query.test.ts`

**Interfaces:**
- Consumes: `bookings`, `followUps`, `BookingStatus`, `Probability`, `BookingOperationsSummary`, `businessDateKey`, and `businessDayBounds`.
- Produces: `RenewalAttention = "overdue" | "soon" | "later" | "needs_plan"`.
- Produces: `RenewalItem`.
- Produces: `classifyRenewalAttention(dueAt: Date | null, now: Date): RenewalAttention`.
- Produces: `sortRenewalItems(items: RenewalItem[]): RenewalItem[]`.
- Produces: `listRenewals(db, now): Promise<RenewalItem[]>`.

- [ ] **Step 1: Write failing pure classification tests**

Create `renewal-query.test.ts` with fixed business-calendar dates. The first tests must establish the exact 30-day boundary and no-date behavior:

```ts
import { describe, expect, it } from "vitest";
import {
  classifyRenewalAttention,
  sortRenewalItems,
  type RenewalItem,
} from "./renewal-query";

const now = new Date("2026-08-15T03:00:00.000Z");

it("marks an overdue dated renewal as overdue", () => {
  expect(
    classifyRenewalAttention(new Date("2026-08-13T17:00:00.000Z"), now),
  ).toBe("overdue");
});

it("marks a renewal exactly 30 business-calendar days away as soon", () => {
  expect(
    classifyRenewalAttention(new Date("2026-09-13T17:00:00.000Z"), now),
  ).toBe("soon");
});

it("keeps a renewal 31 business-calendar days away quiet", () => {
  expect(
    classifyRenewalAttention(new Date("2026-09-14T17:00:00.000Z"), now),
  ).toBe("later");
});

it("uses needs_plan for an undated renewal item", () => {
  expect(classifyRenewalAttention(null, now)).toBe("needs_plan");
});
```

Add ordering coverage with one overdue item, one near-term item, one later item, and one undated item. Assert stable tie-breaking by `dueAt`, then `followUpId ?? ""`, then `id`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/follow-ups/renewal-query.test.ts
```

Expected: FAIL because `renewal-query.ts` does not exist.

- [ ] **Step 3: Implement the public renewal types and 30-day calculation**

Use these public shapes:

```ts
import type { BookingStatus, Probability } from "@/features/bookings/booking-types";
import type { BookingOperationsSummary } from "@/features/bookings/booking-operations-summary";

export type RenewalAttention = "overdue" | "soon" | "later" | "needs_plan";

export type RenewalItem = {
  id: string;
  organizationId: string | null;
  primaryContactId: string | null;
  name: string;
  status: BookingStatus;
  probability: Probability;
  followUpId: string | null;
  dueAt: Date | null;
  attention: RenewalAttention;
  operations?: BookingOperationsSummary | null;
};
```

Calculate the 30-day boundary by business-date key rather than adding 30 × 24 hours to a timestamp, so DST cannot move the boundary by a calendar day:

```ts
function addDaysToDateKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

export function classifyRenewalAttention(
  dueAt: Date | null,
  now: Date,
): RenewalAttention {
  if (!dueAt) return "needs_plan";
  const todayKey = businessDateKey(now);
  const dueKey = businessDateKey(dueAt);
  if (dueKey < todayKey) return "overdue";
  return dueKey <= addDaysToDateKey(todayKey, 30) ? "soon" : "later";
}
```

A renewal due today counts as `soon` so it auto-opens with other near-term work.

- [ ] **Step 4: Add failing repository-level classification tests**

In the same test file, use PGlite with only the booking/follow-up columns needed by the query. Seed these cases:

```text
A: active `possible`, old event date, no follow-up        -> not a renewal
B: `renewal_due`, future incomplete follow-up            -> renewal, dated
C: `renewal_due`, overdue incomplete follow-up           -> renewal, overdue
D: `renewal_due`, no incomplete follow-up                -> renewal, needs_plan
E: `completed`, future incomplete follow-up              -> renewal, dated
F: `completed`, overdue incomplete follow-up             -> renewal, overdue
G: `completed`, completed follow-up only                 -> not a renewal
H: `declined`, future incomplete follow-up               -> not a renewal
```

Snapshot the `follow_ups` rows before and after `listRenewals()` and assert equality so the query proves read-only behavior.

- [ ] **Step 5: Run repository tests and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/follow-ups/renewal-query.test.ts
```

Expected: pure tests PASS, repository tests FAIL because `listRenewals` is not implemented.

- [ ] **Step 6: Implement `listRenewals` as read-only queries**

Select only qualifying bookings. A completed booking qualifies only when it has an incomplete follow-up; event date is deliberately absent from this condition:

```ts
const candidateCondition = or(
  eq(bookings.status, "renewal_due"),
  and(
    eq(bookings.status, "completed"),
    exists(
      db
        .select({ id: followUps.id })
        .from(followUps)
        .where(and(
          eq(followUps.bookingId, bookings.id),
          isNull(followUps.completedAt),
        )),
    ),
  ),
);
```

Load candidate bookings with only the fields needed by `RenewalItem`. Then load incomplete follow-ups for those candidate booking IDs ordered by `dueAt`, `id`.

For each booking, the earliest incomplete follow-up is the renewal date source. A `renewal_due` booking with no incomplete follow-up remains as an undated needs-plan item:

```ts
const open = groupedFollowUps.get(booking.id) ?? [];
const selected = open[0] ?? null;

const item: RenewalItem = {
  id: booking.id,
  organizationId: booking.organizationId,
  primaryContactId: booking.primaryContactId,
  name: booking.name,
  status: booking.status,
  probability: booking.probability,
  followUpId: selected?.id ?? null,
  dueAt: selected?.dueAt ?? null,
  attention: classifyRenewalAttention(selected?.dueAt ?? null, now),
};
```

Because completed bookings only enter the candidate set when an incomplete follow-up exists, they cannot become undated needs-plan items.

- [ ] **Step 7: Implement stable renewal ordering**

Use an explicit attention rank only to put overdue first and undated last; current/future dated items are ordered together by date:

```ts
const attentionRank: Record<RenewalAttention, number> = {
  overdue: 0,
  soon: 1,
  later: 1,
  needs_plan: 2,
};

export function sortRenewalItems(items: RenewalItem[]) {
  return [...items].sort((left, right) => {
    const rank = attentionRank[left.attention] - attentionRank[right.attention];
    if (rank !== 0) return rank;
    const leftDue = left.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightDue = right.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    const followUpTie = (left.followUpId ?? "").localeCompare(right.followUpId ?? "");
    return followUpTie || left.id.localeCompare(right.id);
  });
}
```

Return `sortRenewalItems(items)` from `listRenewals`.

- [ ] **Step 8: Run focused tests and API typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/follow-ups/renewal-query.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add artifacts/api-server/src/features/follow-ups/renewal-query.ts artifacts/api-server/src/features/follow-ups/renewal-query.test.ts
git commit -m "feat: classify next-season renewal work"
```

---

### Task 2: Separate renewal data in the Today API contract

**Files:**
- Modify: `artifacts/api-server/src/features/follow-ups/today-query.ts`
- Create: `artifacts/api-server/src/features/follow-ups/today-query.test.ts`

**Interfaces:**
- Consumes: `RenewalItem`, `listRenewals` from Task 1.
- Produces: `currentSeasonPlanStatuses`.
- Produces: `TodayDashboard.renewals: RenewalItem[]`.
- Produces: `TodayDashboard.renewalTotal: number`.
- Produces: `TodayDashboard.renewalProminentCount: number`.
- Produces: `TodayDashboard.renewalError: string | null`.
- Extends: `TodayDashboardRepository.listRenewals(now: Date): Promise<RenewalItem[]>`.

- [ ] **Step 1: Write failing Today dashboard orchestration tests**

Import the future public status list directly:

```ts
import {
  currentSeasonPlanStatuses,
  getTodayDashboard,
  type TodayDashboardRepository,
} from "./today-query";

it("keeps renewal_due out of Needs Follow-up Plan statuses", () => {
  expect(currentSeasonPlanStatuses).not.toContain("renewal_due");
  expect(currentSeasonPlanStatuses).toContain("new_lead");
});
```

Create a fake `TodayDashboardRepository` whose methods return one current plan booking and two renewals. Assert:

```ts
expect(result.needsFollowUpPlan.map((item) => item.id)).toEqual(["current-booking"]);
expect(result.renewals.map((item) => item.id)).toEqual([
  "renewal-soon",
  "renewal-later",
]);
expect(result.renewalTotal).toBe(2);
expect(result.renewalProminentCount).toBe(1);
expect(result.renewalError).toBeNull();
```

Add a failure-isolation test where only `listRenewals()` rejects:

```ts
expect(result.needsFollowUpPlan).toHaveLength(1);
expect(result.renewals).toEqual([]);
expect(result.renewalError).toBe("Could not load next-season renewals.");
```

- [ ] **Step 2: Run Today tests and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/follow-ups/today-query.test.ts
```

Expected: FAIL because the dashboard has no renewal fields/repository method yet.

- [ ] **Step 3: Make `Needs Follow-up Plan` current-season only**

Replace the existing `activeStatuses` declaration with:

```ts
export const currentSeasonPlanStatuses = bookingStatusValues.filter(
  (status) =>
    !["declined", "cancelled", "completed", "renewal_due"].includes(status),
);
```

Use `currentSeasonPlanStatuses` in `needsFollowUpPlanCondition`. This guarantees a `renewal_due` booking cannot appear in both sections.

Do not add any `startsAt` exclusion; a past-dated booking with an active non-renewal status remains current-season work.

- [ ] **Step 4: Extend the Today repository and dashboard types**

Add this method to `TodayDashboardRepository`:

```ts
listRenewals(now: Date): Promise<RenewalItem[]>;
```

Add these fields to `TodayDashboard`:

```ts
renewals: RenewalItem[];
renewalTotal: number;
renewalProminentCount: number;
renewalError: string | null;
```

Wire `createDrizzleTodayDashboardRepository(db)` to Task 1:

```ts
listRenewals(now) {
  return listRenewals(db, now);
},
```

- [ ] **Step 5: Load renewals without letting renewal errors sink Today**

Keep the primary dashboard queries in the main `Promise.all`, but convert renewal loading into a resolved result object:

```ts
const renewalPromise = source.listRenewals(now)
  .then((items) => ({ items, error: null as string | null }))
  .catch(() => ({
    items: [] as RenewalItem[],
    error: "Could not load next-season renewals.",
  }));

const [counts, followUpResult, nextCallRecord, planResult, upcoming, renewalResult] =
  await Promise.all([
    source.getCounts(endToday),
    source.listOpenFollowUps({
      page: followUpPage,
      pageSize: TODAY_FOLLOW_UP_PAGE_SIZE,
      now,
    }),
    source.findNextCall(now),
    source.listNeedsFollowUpPlan(endToday, {
      page: planPage,
      pageSize: TODAY_PLAN_PAGE_SIZE,
    }),
    source.listUpcomingEvents(startToday, TODAY_UPCOMING_EVENT_LIMIT),
    renewalPromise,
  ]);
```

Set these fields on the returned dashboard:

```ts
renewals: renewalResult.items,
renewalTotal: renewalResult.items.length,
renewalProminentCount: renewalResult.items.filter(
  (item) => item.attention === "overdue" || item.attention === "soon",
).length,
renewalError: renewalResult.error,
```

`needs_plan` deliberately does not count as prominent because undated items do not auto-open.

- [ ] **Step 6: Enrich renewals with existing booking operations**

Add renewal booking IDs to the existing deduplicated `bookingIds` array:

```ts
...dashboard.renewals.map(({ id }) => id),
```

Then add the renewal mapping to the enrichment return object:

```ts
renewals: dashboard.renewals.map((renewal) => ({
  ...renewal,
  operations: withOperations(renewal.id),
})),
```

Do not change the meaning of `followUpCount`, `newLeadCount`, or `contractCount`.

- [ ] **Step 7: Add the operations-enrichment regression**

In `today-query.test.ts`, provide a batch operations provider returning a known summary for a renewal booking. Assert:

```ts
expect(result.renewals[0]?.operations).toEqual(renewalSummary);
expect(result.visibleRouteWarningCount).toBe(expectedDistinctRouteWarnings);
```

Use two warnings with the same route-warning ID across visible dashboard items and assert the count remains deduplicated.

- [ ] **Step 8: Run Today tests and API typecheck**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/follow-ups/renewal-query.test.ts src/features/follow-ups/today-query.test.ts
pnpm --filter @workspace/api-server typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add artifacts/api-server/src/features/follow-ups/today-query.ts artifacts/api-server/src/features/follow-ups/today-query.test.ts
git commit -m "feat: separate renewals on today dashboard"
```

---

### Task 3: Build the collapsed Next Season / Renewals section

**Files:**
- Create: `artifacts/adventure-zone/src/components/today/renewals-section.tsx`
- Create: `artifacts/adventure-zone/src/components/today/renewals-section.test.tsx`

**Interfaces:**
- Consumes: renewal payloads whose `dueAt` has already been coerced to `Date | null` by TodayPage.
- Consumes: `eventProfileHref`, `BookingOperations`, `BookingOperationsSummary`, and `BUSINESS_TIME_ZONE`.
- Produces: `RenewalsSection({ renewals, total, prominentCount, error })`.

- [ ] **Step 1: Write failing component tests**

Use JSDOM and Testing Library:

```ts
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

afterEach(cleanup);
```

Cover these behaviors:

```text
1. later only     -> header says Next Season / Renewals (1), aria-expanded=false
2. soon           -> initially expanded, shows 1 renewal coming up soon
3. overdue        -> initially expanded, item badge says Overdue
4. needs_plan only-> initially collapsed; after opening says Needs renewal plan
5. manual collapse after auto-open remains collapsed after rerender with same props
6. error          -> inline role=alert while header remains usable
```

- [ ] **Step 2: Run component tests and verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/today/renewals-section.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the component props and one-time initial state**

Use:

```ts
export type RenewalSectionItem = {
  id: string;
  organizationId: string | null;
  primaryContactId: string | null;
  name: string;
  status: string;
  followUpId: string | null;
  dueAt: Date | null;
  attention: "overdue" | "soon" | "later" | "needs_plan";
  operations?: BookingOperationsSummary | null;
};

type RenewalsSectionProps = {
  renewals: RenewalSectionItem[];
  total: number;
  prominentCount: number;
  error: string | null;
};
```

Initial expansion must be state initialization, not an effect:

```ts
const [open, setOpen] = useState(() => prominentCount > 0);
```

Do not add an effect that reopens the section after a manual collapse.

- [ ] **Step 4: Implement the collapsed header and attention copy**

The header button exists even when `total === 0`:

```tsx
<button
  aria-expanded={open}
  className="flex w-full items-center justify-between gap-3 text-left"
  onClick={() => setOpen((value) => !value)}
  type="button"
>
  <span className="text-xl font-bold">Next Season / Renewals ({total})</span>
  <span aria-hidden>{open ? "−" : "+"}</span>
</button>
```

Compute overdue and soon counts from `renewals`. If any dated renewal is overdue, use attention copy such as `2 renewals need attention`; otherwise use `2 renewals coming up soon`. The singular form must read naturally.

For item badges use:

```text
overdue    -> Overdue
soon       -> Within 30 days
later      -> no urgency badge
needs_plan -> Needs renewal plan
```

- [ ] **Step 5: Implement renewal links and dates**

Use the same event-profile linking pattern as Today:

```ts
const href = eventProfileHref({
  organizationId: item.organizationId,
  contactId: item.primaryContactId,
  bookingId: item.id,
  followUpId: item.followUpId,
  action: item.followUpId ? "follow-up" : undefined,
}) ?? `/bookings/${item.id}`;
```

Format dated renewals with `BUSINESS_TIME_ZONE`. Render one stacked card per renewal rather than a horizontal table so the section remains comfortable on Android/mobile widths.

- [ ] **Step 6: Run component tests and frontend typecheck**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/today/renewals-section.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/today/renewals-section.tsx artifacts/adventure-zone/src/components/today/renewals-section.test.tsx
git commit -m "feat: add today renewals section"
```

---

### Task 4: Integrate renewals into Today and verify the complete flow

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/TodayPage.test.tsx`

**Interfaces:**
- Consumes: `/today` fields `renewals`, `renewalTotal`, `renewalProminentCount`, and `renewalError` from Task 2.
- Consumes: `RenewalsSection` from Task 3.
- Produces: Today screen with current-season plan work and next-season work visibly separated.

- [ ] **Step 1: Write the failing TodayPage regression**

Mock `/today` with one `new_lead` in `needsFollowUpPlan` and one later renewal in `renewals`. Mock `/calls/config` with assisted calling disabled.

Assert after load:

```ts
expect(screen.getByText("Current Fair Lead")).toBeInTheDocument();
expect(screen.getByRole("button", {
  name: /Next Season \/ Renewals \(1\)/,
})).toHaveAttribute("aria-expanded", "false");
expect(screen.queryByText("County Fair Renewal")).not.toBeInTheDocument();
```

Click the renewal header and assert `County Fair Renewal` appears while `Current Fair Lead` remains visible in **Needs Follow-up Plan**.

Add a second test with a `soon` renewal and assert the renewal item is visible without clicking.

- [ ] **Step 2: Run TodayPage test and verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/TodayPage.test.tsx
```

Expected: FAIL because TodayPage does not render `RenewalsSection`.

- [ ] **Step 3: Coerce renewal dates from the API**

Add:

```ts
function coerceRenewals(items: any[]) {
  return (items ?? []).map((renewal) => ({
    ...renewal,
    dueAt: renewal.dueAt ? new Date(renewal.dueAt) : null,
  }));
}
```

After the existing follow-up coercion:

```ts
const renewals = coerceRenewals(dashboard.renewals ?? []);
```

- [ ] **Step 4: Render renewals below the current-season grid**

Import `RenewalsSection` and place it after the existing **Needs Follow-up Plan / Upcoming events** grid, not inside the current-season plan card:

```tsx
<RenewalsSection
  error={dashboard.renewalError ?? null}
  prominentCount={dashboard.renewalProminentCount ?? 0}
  renewals={renewals}
  total={dashboard.renewalTotal ?? renewals.length}
/>
```

Do not change SummaryCards counts, the calling queue, Today trips, or upcoming-events behavior.

- [ ] **Step 5: Add the independent renewal-error page regression**

Return a valid dashboard with:

```ts
renewals: [],
renewalTotal: 0,
renewalProminentCount: 0,
renewalError: "Could not load next-season renewals.",
```

Assert the Today heading and **Needs Follow-up Plan** still render, and the renewal section contains a `role="alert"` with that message.

- [ ] **Step 6: Run all focused feature tests**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/follow-ups/renewal-query.test.ts src/features/follow-ups/today-query.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/components/today/renewals-section.test.tsx src/pages/TodayPage.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Run full typecheck and production build**

Run:

```bash
pnpm run typecheck
pnpm run build
```

Expected: both commands exit 0. This feature requires no new environment variable and no database migration because it only reads/classifies existing bookings and follow-ups.

- [ ] **Step 8: Manual behavior check on a local or staging Today page**

Verify:

```text
1. Active current-season booking without future action -> Needs Follow-up Plan only.
2. renewal_due + far future follow-up                -> Renewals collapsed.
3. renewal_due + due within 30 days                  -> Renewals initially open.
4. renewal_due + overdue incomplete follow-up        -> Renewals initially open, Overdue.
5. renewal_due + no incomplete follow-up             -> Needs renewal plan; no auto-open by itself.
6. completed + future incomplete follow-up           -> Renewals only.
7. completed + overdue incomplete follow-up          -> Renewals only, remains prominent.
8. completed + no incomplete follow-up               -> Not shown in Renewals.
9. past-dated active non-renewal booking              -> stays current-season; date alone does not move it.
```

After manually collapsing a prominent renewal section, interact elsewhere on Today and confirm it stays collapsed for the rest of that page visit.

- [ ] **Step 9: Commit**

```bash
git add artifacts/adventure-zone/src/pages/TodayPage.tsx artifacts/adventure-zone/src/pages/TodayPage.test.tsx
git commit -m "feat: separate current and next-season work on today"
```

- [ ] **Step 10: Final branch verification**

Run:

```bash
git status --short
pnpm run typecheck
pnpm run build
```

Expected: clean working tree; typecheck and build PASS.

Open a PR with this summary:

```text
- Keeps renewal_due work out of Needs Follow-up Plan.
- Adds year-round collapsed Next Season / Renewals.
- Auto-opens only for overdue or within-30-day dated renewals.
- Keeps undated renewal plans visible but non-prominent.
- Preserves all booking/follow-up data; dashboard classification is read-only.
- Isolates renewal-load errors from the rest of Today.
```
