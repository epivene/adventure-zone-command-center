# Event Wrap-Up, Rating & Calculators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one post-event Event Wrap-Up workflow that lets a leg manager rate an event, reconcile cash, confirm finance completeness, and see transparent Direct Profit and Estimated True Profit while admin can review, override documented allocations, and close/reopen wrap-ups.

**Architecture:** Reuse existing booking, trip, finance, mileage, receipt, crew, and aftermath data as source-of-truth inputs. Add a small persisted wrap-up record plus admin-only override/adjustment records, and keep all calculator math in a server/domain calculation service rather than React. Managers operate only on bookings belonging to their authenticated leg; admin gets an all-leg review queue and override controls.

**Tech Stack:** React 19, TypeScript, Express, Drizzle/PostgreSQL, Vitest, existing manager auth/session middleware, existing booking/trip/finance/receipt/crew repositories.

## Global Constraints

- Manager leg scope is derived from the authenticated manager session; never trust a client-supplied leg ID.
- Each event occurrence has one wrap-up with status `draft`, `submitted`, or `reviewed`.
- Rating stays simple: one numeric 0–5 star score plus one freeform notes field.
- Event/event-family profiles show the average across rated occurrences; unrated occurrences are excluded.
- Settlement formula: `Expected cash = cash income + other cash income - cash expenses` and `Over/Short = actual cash - expected cash`.
- Direct Profit = revenue - direct expenses - allocated travel/fuel +/- direct adjustments.
- Estimated True Profit = Direct Profit - crew wages - overhead +/- true-profit adjustments.
- Missing payroll/overhead data must produce an incomplete true-profit result, not silently assume zero.
- Multi-event trip travel allocation defaults to deterministic mileage-based allocation and remains explainable in the UI.
- Admin overrides require a reason and preserve the automatic value alongside the applied override.
- Do not double-count fuel as both a direct expense and allocated travel cost.
- Draft save may succeed with incomplete settlement/receipt information; submit runs completeness validation.
- Reuse existing receipt/expense workflows; do not create a duplicate receipt system.
- No calculator may expose only a final number; every result needs a source breakdown.
- No second app or database.

---

## File Structure

### Server/domain

- Create `artifacts/api-server/src/features/leg-manager/event-wrap-up-repository.ts`
  - persisted wrap-up lifecycle, travel overrides, overhead, manual adjustments.
- Create `artifacts/api-server/src/features/leg-manager/event-wrap-up-calculation.ts`
  - pure settlement/travel/direct-profit/true-profit math.
- Create `artifacts/api-server/src/features/leg-manager/event-wrap-up-calculation.test.ts`
  - formula, allocation, incomplete-data, no-double-counting tests.
- Create `artifacts/api-server/src/features/leg-manager/event-wrap-up-service.ts`
  - manager/admin authorization, source loading, submission validation, review/reopen.
- Create `artifacts/api-server/src/features/leg-manager/event-wrap-up-service.test.ts`
  - ownership/lifecycle/rating/profile-average tests.
- Create `artifacts/api-server/src/routes/leg-manager-wrap-ups.ts`
  - manager load/save/submit endpoints.
- Create `artifacts/api-server/src/routes/event-wrap-up-admin.ts`
  - admin queue, review/reopen, allocation/overhead/adjustment endpoints.
- Modify `artifacts/api-server/src/routes/index.ts`
  - mount manager routes before owner middleware and admin routes after owner middleware.

### Manager UI

- Create `artifacts/adventure-zone/src/components/manager/event-wrap-up-rating.tsx`
- Create `artifacts/adventure-zone/src/components/manager/event-wrap-up-settlement.tsx`
- Create `artifacts/adventure-zone/src/components/manager/event-wrap-up-profitability.tsx`
- Create `artifacts/adventure-zone/src/components/manager/event-wrap-up-finance-check.tsx`
- Create `artifacts/adventure-zone/src/pages/ManagerEventWrapUpPage.tsx`
- Create `artifacts/adventure-zone/src/pages/ManagerEventWrapUpPage.test.tsx`
- Modify manager routing/navigation entry points to link completed/post-event bookings into the wrap-up.

### Admin UI/profile integration

- Create `artifacts/adventure-zone/src/components/routes/event-wrap-up-review-queue.tsx`
- Create `artifacts/adventure-zone/src/components/routes/event-wrap-up-review-queue.test.tsx`
- Create `artifacts/adventure-zone/src/pages/EventWrapUpAdminPage.tsx`
- Modify booking/event detail presentation to surface stars, wrap-up status, profit summary, and cash discrepancy.
- Modify event profile/event-family aggregation to surface average rating.
- Modify manager/route CI workflow to include the new focused tests.

---

### Task 1: Add pure calculator math and deterministic mileage allocation

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/event-wrap-up-calculation.ts`
- Create: `artifacts/api-server/src/features/leg-manager/event-wrap-up-calculation.test.ts`

**Interfaces:**

```ts
export type WrapUpCalculationInput = {
  revenue: { cashCents: number; nonCashCents: number; otherCashCents: number };
  directExpenses: Array<{ id: string; amountCents: number; paymentSource: string; countsAsAllocatedTravel: boolean }>;
  travel: {
    tripMiles: number | null;
    allocatedMiles: number;
    mpg: number | null;
    fuelPricePerGallon: number | null;
    actualAllocatedFuelCostCents: number | null;
    overrideMiles: number | null;
    overrideCostCents: number | null;
  };
  actualCashOnHandCents: number | null;
  directAdjustmentsCents: number;
  crewWagesCents: number | null;
  overheadCents: number | null;
  trueProfitAdjustmentsCents: number;
};

export function calculateEventWrapUp(input: WrapUpCalculationInput): EventWrapUpCalculation;
export function allocateTripMiles(input: { segmentMiles: number[]; stopCount: number }): number[];
```

- [ ] **Step 1: Write failing formula tests**

Cover exactly:

```ts
it("calculates cash over/short separately from non-cash revenue", () => {
  const result = calculateEventWrapUp(baseInput({
    revenue: { cashCents: 180000, nonCashCents: 90000, otherCashCents: 5000 },
    directExpenses: [{ id: "cash-expense", amountCents: 12000, paymentSource: "adventure_zone_cash", countsAsAllocatedTravel: false }],
    actualCashOnHandCents: 171500,
  }));
  expect(result.settlement.expectedCashCents).toBe(173000);
  expect(result.settlement.differenceCents).toBe(-1500);
  expect(result.directProfit.revenueCents).toBe(275000);
});

it("returns incomplete true profit when crew wages are unknown", () => {
  const result = calculateEventWrapUp(baseInput({ crewWagesCents: null, overheadCents: 25000 }));
  expect(result.trueProfit.profitCents).toBeNull();
  expect(result.trueProfit.incompleteReasons).toContain("Crew wage cost is incomplete");
});
```

Add cases for direct-profit adjustments, true-profit adjustments, admin travel override, positive overage, and no-double-counting when a fuel expense is already represented by allocated travel.

- [ ] **Step 2: Write failing mileage-allocation tests**

Use a deterministic first-release rule: each route segment is attributed to the destination stop it services; start-to-first goes to stop 1, stop-to-stop goes to the destination stop, and final-stop-to-end is attributed to the final stop.

```ts
expect(allocateTripMiles({ segmentMiles: [100, 60, 40], stopCount: 2 })).toEqual([100, 100]);
```

- [ ] **Step 3: Run focused tests and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-wrap-up-calculation.test.ts
```

- [ ] **Step 4: Implement pure calculation functions**

The returned result must include source breakdown fields, applied vs automatic miles, fuel basis, manual adjustments, and incomplete reasons.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-wrap-up-calculation.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/features/leg-manager/event-wrap-up-calculation*
git commit -m "feat: add event wrap-up calculator math"
```

---

### Task 2: Persist wrap-ups, ratings, overrides, overhead, and adjustments

**Files:**
- Create: `artifacts/api-server/src/features/leg-manager/event-wrap-up-repository.ts`
- Create: `artifacts/api-server/src/features/leg-manager/event-wrap-up-service.ts`
- Create: `artifacts/api-server/src/features/leg-manager/event-wrap-up-service.test.ts`

**Interfaces:**

```ts
export type EventWrapUpStatus = "draft" | "submitted" | "reviewed";

export type EventWrapUp = {
  id: string;
  bookingId: string;
  legId: string;
  tripId: string | null;
  status: EventWrapUpStatus;
  ratingStars: number | null;
  ratingNotes: string | null;
  actualCashOnHandCents: number | null;
  cashDifferenceNote: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
```

Repository schema uses idempotent `ensureSchema()` and creates:
- `event_wrap_ups` unique on `booking_id`;
- `event_travel_allocation_overrides` unique on `(booking_id, trip_id)`;
- `event_profit_adjustments` append-only;
- `event_overhead_allocations` one applied row per booking.

- [ ] **Step 1: Write failing lifecycle/authorization tests**

Cover:
- manager may create/update wrap-up for own-leg booking;
- manager is rejected for another leg;
- draft save allows missing settlement values;
- submit rejects missing required event identity/settlement explanation policy fields;
- admin review moves `submitted -> reviewed`;
- admin reopen moves `reviewed -> draft` and preserves audit history;
- manager cannot set `reviewed`.

- [ ] **Step 2: Add rating-average service test**

```ts
it("averages rated occurrences and excludes unrated ones", async () => {
  await store.saveRating(booking2026, 5, "Strong year");
  await store.saveRating(booking2027, 3, "Weather hurt turnout");
  await store.saveRating(booking2028, null, null);
  expect(await service.averageRatingForFamily(familyId)).toEqual({ average: 4, count: 2 });
});
```

- [ ] **Step 3: Run service test and verify RED**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-wrap-up-service.test.ts
```

- [ ] **Step 4: Implement repository + service**

The service must load the booking's authoritative `travelLegId`, never accept manager leg authority from the body, and preserve all admin override reasons/actors/timestamps.

- [ ] **Step 5: Add source-data change strategy**

Choose and implement **recalculate + flag changed after review**. Store a reviewed source fingerprint made from finance/travel input IDs+updated timestamps at review time. When loading a reviewed wrap-up, recompute the fingerprint; if different, return `sourceDataChanged: true` without silently changing status.

- [ ] **Step 6: Run service tests and verify GREEN**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-wrap-up-service.test.ts src/features/leg-manager/event-wrap-up-calculation.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/leg-manager/event-wrap-up-repository.ts artifacts/api-server/src/features/leg-manager/event-wrap-up-service*
git commit -m "feat: persist event wrap-ups and ratings"
```

---

### Task 3: Add manager/admin APIs and source-data adapters

**Files:**
- Create: `artifacts/api-server/src/routes/leg-manager-wrap-ups.ts`
- Create: `artifacts/api-server/src/routes/event-wrap-up-admin.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify/reuse existing finance/trip/crew repositories only where needed to expose normalized source inputs.

**Manager endpoints:**

```http
GET  /manager/wrap-ups/:bookingId
PUT  /manager/wrap-ups/:bookingId
POST /manager/wrap-ups/:bookingId/submit
```

**Admin endpoints:**

```http
GET  /event-wrap-up-admin
GET  /event-wrap-up-admin/:bookingId
PUT  /event-wrap-up-admin/:bookingId
POST /event-wrap-up-admin/:bookingId/review
POST /event-wrap-up-admin/:bookingId/reopen
PUT  /event-wrap-up-admin/:bookingId/travel-allocation
PUT  /event-wrap-up-admin/:bookingId/overhead
POST /event-wrap-up-admin/:bookingId/adjustments
DELETE /event-wrap-up-admin/:bookingId/adjustments/:adjustmentId
```

- [ ] **Step 1: Write failing manager route tests**

Assert own-leg load/save/submit succeeds and cross-leg returns `403`.

- [ ] **Step 2: Write failing admin route tests**

Assert admin can load all submitted wrap-ups, apply travel override only with a reason, set overhead with a reason, add signed adjustments with a reason, review, and reopen.

- [ ] **Step 3: Implement normalized source adapter**

Reuse existing finance/mileage/trip/crew records to produce:
- revenue breakdown;
- direct booking expenses;
- cash-paid expenses;
- receipt completeness warnings;
- trip segment miles;
- vehicle MPG;
- latest applicable fuel-price context / actual fuel purchases;
- crew wage total when available.

Do not create duplicate income/expense rows.

- [ ] **Step 4: Implement routes and mount them correctly**

Manager route mounts before owner middleware and uses manager auth middleware. Admin route mounts after owner middleware.

- [ ] **Step 5: Run API verification**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-wrap-up-calculation.test.ts src/features/leg-manager/event-wrap-up-service.test.ts src/routes/leg-manager-wrap-ups.test.ts src/routes/event-wrap-up-admin.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/routes/leg-manager-wrap-ups* artifacts/api-server/src/routes/event-wrap-up-admin* artifacts/api-server/src/routes/index.ts artifacts/api-server/src/features/leg-manager
git commit -m "feat: add event wrap-up APIs"
```

---

### Task 4: Build the manager Event Wrap-Up screen

**Files:**
- Create: `artifacts/adventure-zone/src/components/manager/event-wrap-up-rating.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/event-wrap-up-settlement.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/event-wrap-up-finance-check.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/event-wrap-up-profitability.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerEventWrapUpPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ManagerEventWrapUpPage.test.tsx`
- Modify manager routing and post-event/event-detail links.

- [ ] **Step 1: Write failing page test**

```tsx
it("shows one mobile-friendly wrap-up flow with rating, money check, receipts, travel share and both profit results", async () => {
  render(<ManagerEventWrapUpPage />);
  expect(await screen.findByText("How did it go?")).toBeInTheDocument();
  expect(screen.getByText("Money check")).toBeInTheDocument();
  expect(screen.getByText("Receipts & expenses")).toBeInTheDocument();
  expect(screen.getByText("Travel share")).toBeInTheDocument();
  expect(screen.getByText("Direct profit")).toBeInTheDocument();
  expect(screen.getByText("Estimated true profit")).toBeInTheDocument();
});
```

- [ ] **Step 2: Add rating test**

Assert a manager can choose 0–5 stars, leave notes blank, save draft, edit later, and never sees a return-recommendation field.

- [ ] **Step 3: Implement settlement UI**

Show cash income sources, cash expenses, expected cash, actual cash input, and explicit `$X short` / `$X over` wording. Non-cash revenue remains visible separately.

- [ ] **Step 4: Implement finance-completeness UI**

Render receipt/expense warnings from the API with direct links back to the existing receipt/expense screens. Draft saving remains enabled despite warnings.

- [ ] **Step 5: Implement profitability breakdown accordions**

Direct Profit breakdown shows revenue, direct expenses, allocated miles, MPG/fuel basis, travel cost, adjustments, result.

Estimated True Profit breakdown shows Direct Profit, crew wages, overhead, true-profit adjustments, result or incomplete reasons.

- [ ] **Step 6: Implement Save draft / Submit wrap-up**

Submission surfaces server validation errors inline and changes the page to a submitted/read-only-ish state while still allowing admin review later.

- [ ] **Step 7: Add manager route**

Use a route such as `/manager/events/:bookingId/wrap-up` and link completed/post-event event cards to it.

- [ ] **Step 8: Run manager UI tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerEventWrapUpPage.test.tsx src/pages/ManagerRoutePage.test.tsx
```

- [ ] **Step 9: Commit**

```bash
git add artifacts/adventure-zone/src/components/manager/event-wrap-up-* artifacts/adventure-zone/src/pages/ManagerEventWrapUpPage* artifacts/adventure-zone/src/App.tsx
git commit -m "feat: add manager event wrap-up workflow"
```

---

### Task 5: Add admin review/override UI and profile rating integration

**Files:**
- Create: `artifacts/adventure-zone/src/components/routes/event-wrap-up-review-queue.tsx`
- Create: `artifacts/adventure-zone/src/components/routes/event-wrap-up-review-queue.test.tsx`
- Create: `artifacts/adventure-zone/src/pages/EventWrapUpAdminPage.tsx`
- Modify admin navigation/routes.
- Modify booking/event detail summary.
- Modify event profile/event-family profile rating aggregation display.

- [ ] **Step 1: Write failing review queue test**

Assert submitted rows show event, leg, date, stars, over/short, Direct Profit, Estimated True Profit or incomplete warning, receipt warnings, and submitted time.

- [ ] **Step 2: Implement full admin wrap-up page**

Admin may edit occurrence stars/notes, actual cash/discrepancy note, travel override, overhead, and manual adjustments; each accounting override UI requires a reason.

- [ ] **Step 3: Implement review/reopen controls**

Review records reviewer/time and source fingerprint. If a reviewed wrap-up later loads with `sourceDataChanged: true`, show a prominent `Source finance/travel data changed after review` warning and a Reopen action.

- [ ] **Step 4: Add booking/event summary badges**

Show occurrence stars, wrap-up status, Direct Profit, Estimated True Profit when complete, and cash discrepancy warning.

- [ ] **Step 5: Add profile average rating**

Show average stars + count across rated occurrences on the event/event-family profile. Keep occurrence notes attached to occurrences; do not concatenate notes into the average.

- [ ] **Step 6: Run admin/profile tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-wrap-up-review-queue.test.tsx src/pages/EventWrapUpAdminPage.test.tsx src/pages/EventProfilePage.test.tsx
```

Use the actual existing profile-page test filename if the repository names it differently; update the CI command to that verified path.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/routes/event-wrap-up-review-queue* artifacts/adventure-zone/src/pages/EventWrapUpAdminPage* artifacts/adventure-zone/src/pages artifacts/adventure-zone/src/App.tsx
git commit -m "feat: add admin event wrap-up review"
```

---

### Task 6: Full verification and CI coverage

**Files:**
- Modify: `.github/workflows/calendar-route-handoff-ci.yml`

- [ ] **Step 1: Add focused API tests to CI**

Add:
- `event-wrap-up-calculation.test.ts`
- `event-wrap-up-service.test.ts`
- `leg-manager-wrap-ups.test.ts`
- `event-wrap-up-admin.test.ts`

- [ ] **Step 2: Add focused frontend tests to CI**

Add:
- `ManagerEventWrapUpPage.test.tsx`
- `event-wrap-up-review-queue.test.tsx`
- `EventWrapUpAdminPage.test.tsx`
- the verified event/event-family profile rating test path.

- [ ] **Step 3: Run complete focused verification**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/event-wrap-up-calculation.test.ts src/features/leg-manager/event-wrap-up-service.test.ts src/routes/leg-manager-wrap-ups.test.ts src/routes/event-wrap-up-admin.test.ts

pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerEventWrapUpPage.test.tsx src/components/routes/event-wrap-up-review-queue.test.tsx src/pages/EventWrapUpAdminPage.test.tsx src/pages/ManagerRoutePage.test.tsx
```

- [ ] **Step 4: Run existing manager finance/travel regressions**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/leg-manager/finance-repository.test.ts src/features/leg-manager/manager-map-data.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerOperationsPage.test.tsx src/components/routes/travel-leg-manager-cards.test.tsx
```

- [ ] **Step 5: Run production builds and workspace typecheck**

```bash
pnpm --filter @workspace/adventure-zone run build
pnpm --filter @workspace/api-server run build
pnpm run typecheck
```

- [ ] **Step 6: Final manual verification**

Verify:
1. Manager can open only an own-leg event wrap-up.
2. Manager can save a draft with incomplete receipts.
3. 0–5 stars + notes save and edit correctly; no return-recommendation control exists.
4. Cash example `$1,842 expected / $1,817 actual` displays `$25 short`.
5. Card/non-cash revenue affects profit but not physical expected cash.
6. Multi-event trip allocation displays automatic miles per event and applied override when admin changes it.
7. A fuel purchase is not counted twice.
8. Direct Profit and Estimated True Profit both expose complete breakdowns.
9. Missing payroll produces `Estimated true profit unavailable` plus an incomplete reason rather than a fake zero-cost result.
10. Submit moves draft to submitted; manager cannot mark reviewed.
11. Admin queue shows submitted wrap-ups and can review/reopen.
12. Admin travel/overhead/manual overrides require a reason.
13. Source finance changes after review trigger the changed-after-review warning.
14. Event/event-family profile average stars exclude unrated occurrences and update after an occurrence edit.

- [ ] **Step 7: Commit CI changes**

```bash
git add .github/workflows/calendar-route-handoff-ci.yml
git commit -m "test: verify event wrap-up workflow"
```
