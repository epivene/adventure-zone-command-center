# Event Wrap-Up, Rating & Calculators Design

## Goal

Create one coherent post-event workflow that lets a leg manager close out an event, rate it, reconcile money, confirm receipts/expenses, and see both direct and estimated true profitability without re-entering data already captured elsewhere in the system.

The system should also give admin transparent, auditable control over travel-cost allocation, overhead assumptions, manual adjustments, and final review/closure.

## Product direction

Use a single **Event Wrap-Up** experience as the primary workflow after an event. The calculators are reusable underlying services/components, but managers should not need to hunt through separate pages to finish one event.

The wrap-up combines:

1. Overall event rating and notes.
2. Settlement/cash reconciliation.
3. Receipt and expense completeness checks.
4. Mileage/fuel/travel allocation.
5. Direct-profit calculation.
6. Estimated true-profit calculation.
7. Draft/submission/review state.

## Scope and permissions

### Manager scope

- A manager can create and edit wrap-ups only for events assigned to their authenticated travel leg.
- A manager never chooses another leg in order to rate or close out an event.
- Managers cannot read or edit another leg's private wrap-up data except where existing cross-leg financial/admin visibility explicitly allows it.
- Managers may save drafts and submit completed wrap-ups.

### Admin scope

Admin can:

- view all event wrap-ups;
- edit or correct wrap-up data;
- review submitted wrap-ups;
- adjust travel-cost allocation;
- set or change overhead assumptions;
- add documented manual financial adjustments;
- reopen a previously reviewed/closed wrap-up;
- mark a wrap-up reviewed/closed.

Any admin override that changes calculated profitability must preserve an explanation/audit trail.

## Wrap-up lifecycle

Each event occurrence has one wrap-up record with these states:

- `draft` — manager/admin is still working on it;
- `submitted` — manager indicates closeout is ready for admin review;
- `reviewed` — admin has reviewed and closed the wrap-up.

Admin may reopen a reviewed wrap-up, returning it to `draft` or a dedicated reopened state if the implementation benefits from one. The first release may use `draft` plus audit history rather than introducing a fourth persisted status.

Saving a draft must never require every receipt or settlement field to be complete.

Submitting should run completion validation and clearly tell the manager what is missing.

## Event rating

### Rating model

Each completed event occurrence may store:

- `ratingStars`: numeric 0–5 rating;
- `ratingNotes`: freeform notes.

The rating intentionally stays simple. There are no category sub-ratings and no separate return-recommendation field.

The star value itself is the overall verdict; notes explain context.

### Who may edit

- Admin may add or edit any occurrence rating.
- The manager assigned to that event's leg may add or edit the rating.
- A manager cannot rate an event owned by another leg.

### Average rating on profiles

Do not overwrite the historical occurrence ratings.

Event/event-family profile views should show the **average star rating across all rated occurrences**.

Example:

- 2026 occurrence: 5 stars
- 2027 occurrence: 3 stars
- profile average: 4.0 stars

Notes remain attached to the occurrence that generated them. A profile may show the most recent rating note first, but the average is computed only from numeric ratings.

If an occurrence's rating is edited, the average should reflect the updated value.

## Event Wrap-Up screen

The manager-facing wrap-up should be mobile-friendly and ordered around the actual post-event task rather than accounting terminology.

Recommended sections:

1. **Event summary** — event name/date/location, leg, trip context.
2. **How did it go?** — 0–5 stars + notes.
3. **Money check** — expected cash, actual cash, over/short, non-cash totals.
4. **Receipts & expenses** — completeness/warnings and links to missing items.
5. **Travel share** — mileage/fuel allocation for this event.
6. **Profitability** — Direct profit and Estimated true profit with expandable breakdowns.
7. **Finish** — Save draft / Submit wrap-up.

The screen should reuse existing income, expense, mileage, fuel, receipt, trip, and booking records whenever possible. Do not make a manager enter the same number twice merely because two calculators use it.

## Settlement / cash calculator

### Purpose

Answer a simple operational question after the event: **How much physical cash should be on hand, and does the actual count match?**

### Inputs sourced automatically

Where existing records support it, calculate:

- cash collected from event income;
- other cash income tied to the event;
- cash-paid event expenses;
- cash-paid fuel/travel expenses allocated to the event when appropriate.

Card/Square/other non-cash revenue must remain visible but separate from the physical cash count.

### Formula

```text
Expected cash on hand
= Cash collected
+ Other cash income
- Cash expenses paid out
```

The manager enters:

- `actualCashOnHand`;
- optional `cashDifferenceNote`.

Then calculate:

```text
Over / Short = Actual cash on hand - Expected cash on hand
```

Examples:

- expected $1,842; actual $1,817 -> $25 short;
- expected $1,842; actual $1,900 -> $58 over.

Display the sign and wording clearly; do not rely on the user interpreting a raw negative number.

### Discrepancy behavior

A nonzero difference does not automatically block draft save.

Submission may require an explanation when the difference exceeds a configurable materiality threshold. For first release, a simple nonzero discrepancy-note warning is acceptable; admin can decide whether to require stricter thresholds later.

## Revenue model for calculators

Total event revenue should be derived from existing event income/payment records.

At minimum, expose a breakdown such as:

- cash;
- card/Square;
- checks/other;
- other event income;
- total revenue.

The system should clearly distinguish **total earned revenue** from **physical cash expected on hand**.

## Direct profit calculator

### Formula

```text
Direct profit
= Total event revenue
- Direct event expenses
- Allocated travel/fuel cost
+/- Direct manual adjustments
```

### Direct event expenses

Use expenses tied directly to the event/booking where possible, including ordinary event purchases and other event-specific costs already recorded in manager finance.

Do not include crew wages or general overhead here; those belong in Estimated true profit.

### Direct manual adjustments

Admin may add an adjustment when a real cost/revenue item cannot be represented correctly by existing records.

Each adjustment requires:

- amount;
- direction/category;
- reason;
- actor;
- timestamp.

Managers may suggest/correct factual inputs but should not silently change accounting assumptions or admin-only allocation rules.

## Estimated true profit calculator

### Formula

```text
Estimated true profit
= Direct profit
- Crew wages/payroll
- Allocated overhead
+/- True-profit manual adjustments
```

This number is explicitly an estimate when payroll or overhead inputs are incomplete.

### Crew wages/payroll

Use actual worker/payroll/time data when available.

If exact wage cost is unavailable, the result should say that crew cost is incomplete rather than quietly assuming zero and presenting an overly precise “true profit.”

### Overhead

Keep first-release overhead flexible rather than building a full accounting ledger.

Supported concepts may include:

- fixed per-event overhead;
- per-day/trip overhead;
- admin-entered allocation;
- other documented adjustment.

Admin should be able to configure/override the event's applied overhead with a required note.

The result breakdown must identify the source of the overhead deduction.

## Route / fuel calculator

### Core route calculation

Use the trip's actual or estimated miles and the applicable vehicle MPG/fuel price context.

Typical estimated fuel cost:

```text
Estimated gallons = Allocated miles / MPG
Estimated fuel cost = Estimated gallons * Fuel price per gallon
```

Prefer actual fuel purchases where they can be meaningfully associated with the trip/event, while retaining estimated values as planning/context.

Do not double-count the same fuel purchase as both an event expense and an allocated trip cost.

## Multi-event trip allocation

When one trip contains multiple events, travel/fuel cost should be allocated automatically using **mileage-based allocation**, not an even split.

### Default allocation

The implementation should calculate each event's travel share from route geometry/segment mileage around the ordered trip stops.

The exact algorithm should be deterministic and explainable. A reasonable first-release method is to attribute route segment mileage to the event destination it services, including a fair treatment of the trip's start/end legs.

The breakdown must show each event's allocated miles and percentage/share so admin can understand the result.

### Manual allocation override

Admin may override an event's automatic travel allocation.

An override requires:

- override miles and/or cost/share, depending on final implementation;
- explanation/reason;
- actor and timestamp.

The UI should show both:

- automatic calculated allocation;
- applied allocation after override.

This allows unusual routes, equipment detours, overnight positioning, or shared travel to be handled without hiding the original calculation.

## Receipts and expense completeness

The wrap-up should not duplicate the existing receipt/expense system; it should summarize its status.

Examples of useful checks:

- expense has no receipt where one is expected;
- receipt uploaded but expense not categorized/reviewed;
- manager indicates there were no additional expenses;
- pending/unreviewed expense entries remain;
- cash expense affects expected-cash calculation.

The manager should be able to jump directly to the relevant receipt/expense entry to fix it.

Draft save remains allowed with warnings.

Submission should clearly surface unresolved items; whether a missing receipt hard-blocks submission can initially remain an admin policy rather than a fixed rule.

## Calculator transparency

No calculator should expose only a mysterious final number.

Every important result should be expandable/tappable into a breakdown.

### Settlement breakdown

Show:

- cash income sources;
- cash expenses;
- expected cash;
- actual cash;
- over/short.

### Direct profit breakdown

Show:

- total event revenue;
- direct event expenses;
- allocated miles;
- MPG/fuel price basis;
- allocated travel/fuel cost;
- manual adjustments;
- direct profit.

### Estimated true profit breakdown

Show:

- direct profit;
- crew wage cost;
- overhead allocation;
- true-profit adjustments;
- estimated true profit;
- any incomplete-data warning.

The user must be able to tell where every deduction/addition came from.

## Suggested data model

The exact schema may reuse mature existing finance/aftermath tables when appropriate. Avoid duplicating established records.

### Event wrap-up

Conceptual model:

```ts
type EventWrapUp = {
  id: string;
  bookingId: string;
  legId: string;
  tripId: string | null;
  status: "draft" | "submitted" | "reviewed";
  ratingStars: number | null; // 0-5
  ratingNotes: string | null;
  actualCashOnHandCents: number | null;
  cashDifferenceNote: string | null;
  submittedAt: Date | null;
  submittedBy: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

### Travel allocation override

Conceptual model:

```ts
type EventTravelAllocationOverride = {
  bookingId: string;
  tripId: string;
  automaticMiles: number;
  overrideMiles: number | null;
  overrideCostCents: number | null;
  reason: string;
  updatedBy: string;
  updatedAt: Date;
};
```

Only create a persisted override row when admin actually overrides the automatic calculation.

### Profit adjustment

Conceptual model:

```ts
type EventProfitAdjustment = {
  id: string;
  bookingId: string;
  scope: "direct" | "true_profit";
  amountCents: number; // signed
  label: string;
  reason: string;
  createdBy: string;
  createdAt: Date;
};
```

### Overhead allocation

May be stored on the wrap-up, a reusable configuration table, or an existing finance settings model if one already fits. Do not create a duplicate overhead settings system if the codebase already has one.

## Derived calculation service

Keep calculator math out of React components and route handlers.

Create one server/domain calculation layer that consumes normalized finance/trip/wrap-up inputs and returns a transparent calculation result.

Conceptual result:

```ts
type EventWrapUpCalculation = {
  settlement: {
    cashIncomeCents: number;
    cashExpensesCents: number;
    expectedCashCents: number;
    actualCashCents: number | null;
    differenceCents: number | null;
  };
  travel: {
    automaticMiles: number;
    appliedMiles: number;
    fuelPricePerGallon: number | null;
    mpg: number | null;
    allocatedFuelCostCents: number | null;
    source: "automatic" | "admin_override";
  };
  directProfit: {
    revenueCents: number;
    directExpenseCents: number;
    travelCostCents: number;
    adjustmentsCents: number;
    profitCents: number;
  };
  trueProfit: {
    directProfitCents: number;
    crewWagesCents: number | null;
    overheadCents: number | null;
    adjustmentsCents: number;
    profitCents: number | null;
    incompleteReasons: string[];
  };
};
```

When a required true-profit component is unknown, prefer `profitCents: null` plus an incomplete reason over silently treating missing data as zero.

## API boundaries

### Manager API

Manager endpoints derive `legId` from the authenticated manager session.

A manager should be able to:

- load their own event wrap-up;
- save/update their own event wrap-up draft;
- save/edit stars and notes for their own event;
- enter actual cash and discrepancy note;
- submit the wrap-up;
- view the resulting settlement/direct/estimated-profit breakdown for their event.

The API must verify the booking belongs to the authenticated leg.

### Admin API

Admin endpoints may:

- load any event wrap-up/calculation;
- edit wrap-up values;
- adjust travel allocation;
- add/remove documented profit adjustments;
- configure/apply overhead;
- review/close;
- reopen;
- edit occurrence rating.

Admin list views should support finding submitted/unreviewed wrap-ups.

## Profile integration

### Booking/event occurrence

The booking/event detail should show:

- current occurrence star rating;
- wrap-up status;
- direct profit when available;
- estimated true profit when available;
- cash discrepancy warning when relevant;
- link to full wrap-up.

### Event profile / event family

Show average star rating across all rated occurrences.

Also consider later rollups such as average direct profit or lifetime revenue, but these are not required for the first wrap-up release unless the existing profile aggregation makes them trivial.

## Admin review experience

Admin needs a concise queue for submitted wrap-ups.

A queue item should summarize:

- event;
- leg/manager;
- event date;
- stars;
- cash over/short;
- direct profit;
- estimated true profit or incomplete-data warning;
- missing receipt/expense warnings;
- submitted time.

Opening it shows the full breakdown and review/override controls.

Reviewing/closing should preserve the underlying raw records and calculation inputs; it should not freeze or duplicate all source finance data unless necessary for audit requirements.

If source data changes after review, the app should either recalculate and flag the wrap-up as changed or preserve a reviewed snapshot plus a clear “source data changed” warning. The implementation plan should choose one explicit strategy and test it.

## Validation and error behavior

- Rating must be between 0 and 5.
- Rating notes may be blank.
- Actual cash must be a valid nonnegative monetary amount when entered.
- Signed admin adjustments are allowed but require a reason.
- MPG and fuel prices used in calculations must be positive when present.
- Allocation overrides require a reason.
- A manager cannot submit a wrap-up for another leg.
- A manager cannot mark their own wrap-up admin-reviewed.
- Failed receipt/photo loads must not block the calculator itself.
- Calculator APIs should return source-specific warnings rather than generic “calculation failed” whenever possible.

## Testing

### Authorization

- manager can load/save/submit only events assigned to their leg;
- manager cannot rate or close another leg's event;
- admin can access all wrap-ups;
- manager cannot perform admin allocation/overhead/review overrides.

### Rating

- manager/admin can store 0–5 stars + notes;
- editing an occurrence rating updates the profile average;
- unrated occurrences are excluded from the average;
- no return-recommendation/category-rating fields appear.

### Settlement

- expected cash formula uses only physical cash flows;
- card/non-cash revenue does not inflate expected cash on hand;
- cash expenses reduce expected cash;
- actual minus expected produces correct over/short sign;
- discrepancy note persists.

### Travel allocation

- multi-event trip distributes mileage deterministically;
- allocation totals reconcile to the allocatable trip mileage;
- override changes applied allocation without destroying automatic value;
- override requires reason;
- fuel cost uses applied miles, MPG, and applicable fuel price;
- no fuel double-counting between trip allocation and direct expenses.

### Direct profitability

- revenue minus direct expenses minus travel plus adjustments equals direct profit;
- crew payroll and overhead do not affect direct profit.

### Estimated true profitability

- subtracts crew wage/payroll cost;
- subtracts applied overhead;
- applies true-profit adjustments;
- missing payroll/overhead produces an incomplete result rather than a falsely precise profit.

### Workflow/UI

- wrap-up opens as draft for an eligible completed event;
- draft saves with incomplete sections;
- submission surfaces missing required items;
- submitted wrap-up appears in admin review queue;
- admin can review/close and reopen;
- manager cannot review/close;
- calculator breakdowns show source rows and formulas;
- mobile manager screen remains usable without horizontal scrolling.

## Non-goals

This feature does not:

- build a full general-ledger accounting system;
- replace payroll software;
- introduce a public gas-price API;
- require managers to allocate overhead manually;
- create category-based event ratings;
- add a separate return-recommendation field;
- overwrite prior occurrence ratings;
- split the experience into separate manager apps/databases.

## Success criteria

After an event, the assigned manager can open one **Event Wrap-Up**, give the event 0–5 stars and notes, reconcile expected vs. actual cash, resolve or acknowledge expense/receipt issues, and see transparent Direct Profit and Estimated True Profit numbers derived mostly from data already recorded during the trip/event.

Admin can review the same closeout, understand every number, correct unusual travel allocation or overhead with documented reasons, and close/reopen the wrap-up without losing auditability.

Event/event-family profiles show an average star rating across rated occurrences, while each occurrence retains its own rating and notes.