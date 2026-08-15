# Today Upcoming/Post-Event Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep confirmed upcoming/in-progress events only in Upcoming Events, then return them to Needs Follow-up Plan the next business day after the event ends as clearly labeled post-event work, without hiding possible/interested leads that still need booking work.

**Architecture:** Make the classification at the Today dashboard query boundary so it is correct even when Upcoming Events is limited to five rows. Use `coalesce(ends_at, starts_at)` as the effective event end for confirmed bookings, compare it with the current America/Chicago business-day start, and keep existing future-follow-up suppression. Expose a small `planReason` discriminator to the web UI so past confirmed events are labeled as post-event follow-up rather than merely `Confirmed`.

**Tech Stack:** TypeScript, Drizzle ORM/PostgreSQL, PGlite, Vitest, React, Testing Library.

## Global Constraints

- Confirmed + event still upcoming/in progress appears in Upcoming Events only.
- A confirmed event becomes eligible for Needs Follow-up Plan beginning the next business day after its effective event end.
- Effective event end is `endsAt` when present, otherwise `startsAt`.
- Possible/interested/new-lead/etc. bookings remain eligible for Needs Follow-up Plan even when they have a future event date.
- Confirmed bookings with no event date remain eligible for Needs Follow-up Plan because there is no known event milestone.
- Existing future incomplete follow-up logic remains authoritative: a booking that already has a future incomplete action is not shown as needing a plan.
- No booking, follow-up, or event data is mutated by this dashboard classification.

---

### Task 1: Add database-level classification tests and query rule

**Files:**
- Create: `artifacts/api-server/src/features/follow-ups/today-upcoming-post-event.test.ts`
- Modify: `artifacts/api-server/src/features/follow-ups/today-query.ts`

**Interfaces:**
- Consumes: `businessDayBounds(now)` and existing `bookings.startsAt`, `bookings.endsAt`, `bookings.status`, and `followUps` records.
- Produces: `needsFollowUpPlanCondition(futureBoundary: Date, startToday: Date)` and an updated `upcomingEventsCondition(startToday: Date)` that keeps a multi-day event visible through its end date.

- [ ] **Step 1: Write the failing PGlite test**

Create a small PostgreSQL fixture with the full booking columns selected by the Drizzle repository plus `follow_ups`. Seed these cases around August 15, 2026:

```ts
const cases = {
  confirmedFuture: "...001",
  confirmedToday: "...002",
  confirmedMultiDay: "...003",
  confirmedPast: "...004",
  possibleFuture: "...005",
  confirmedUndated: "...006",
  confirmedPastWithFutureAction: "...007",
};
```

Assertions:

```ts
expect(needsPlanIds).not.toContain(cases.confirmedFuture);
expect(needsPlanIds).not.toContain(cases.confirmedToday);
expect(needsPlanIds).not.toContain(cases.confirmedMultiDay);
expect(needsPlanIds).toContain(cases.confirmedPast);
expect(needsPlanIds).toContain(cases.possibleFuture);
expect(needsPlanIds).toContain(cases.confirmedUndated);
expect(needsPlanIds).not.toContain(cases.confirmedPastWithFutureAction);
```

Also assert the multi-day confirmed event is still in Upcoming Events while its `endsAt` is today or later.

- [ ] **Step 2: Run the focused API test and verify it fails**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/follow-ups/today-upcoming-post-event.test.ts
```

Expected: FAIL because current Needs Follow-up Plan ignores event dates and Upcoming Events only checks `startsAt >= startToday`.

- [ ] **Step 3: Implement the minimal SQL classification**

Update the helper to accept the business-day start:

```ts
export function needsFollowUpPlanCondition(
  futureBoundary: Date,
  startToday: Date,
) {
  const serializedFutureBoundary = futureBoundary.toISOString();
  const serializedStartToday = startToday.toISOString();
  const effectiveEventEnd = sql<Date | null>`coalesce(${bookings.endsAt}, ${bookings.startsAt})`;

  return and(
    inArray(bookings.status, currentSeasonPlanStatuses),
    sql`(
      ${bookings.status} <> 'confirmed'
      or ${effectiveEventEnd} is null
      or ${effectiveEventEnd} < ${serializedStartToday}
    )`,
    notExists(sql`(
      select 1 from ${followUps}
      where ${followUps.bookingId} = ${bookings.id}
        and ${followUps.completedAt} is null
        and ${followUps.dueAt} >= ${serializedFutureBoundary}
    )`),
  );
}
```

Inside `listNeedsFollowUpPlan`, derive the matching business-day start from the exclusive `futureBoundary` before building the condition:

```ts
const startToday = businessDayBounds(new Date(futureBoundary.getTime() - 1)).start;
const condition = needsFollowUpPlanCondition(futureBoundary, startToday);
```

Keep multi-day events in Upcoming Events through their end date:

```ts
export function upcomingEventsCondition(startToday: Date) {
  return sql`coalesce(${bookings.endsAt}, ${bookings.startsAt}) >= ${startToday.toISOString()}`;
}
```

Order Upcoming Events by `startsAt` as today.

- [ ] **Step 4: Run the focused test and verify it passes**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/follow-ups/today-query.ts artifacts/api-server/src/features/follow-ups/today-upcoming-post-event.test.ts
git commit -m "fix: separate upcoming confirmed events from follow-up plans"
```

---

### Task 2: Mark post-event plan items explicitly in the API

**Files:**
- Modify: `artifacts/api-server/src/features/follow-ups/today-query.ts`
- Modify: `artifacts/api-server/src/features/follow-ups/today-query.test.ts`

**Interfaces:**
- Produces: `FollowUpPlanItem.planReason: "needs_action" | "post_event"`.
- `post_event` means a confirmed booking whose effective end (`endsAt ?? startsAt`) is before the current business-day start.

- [ ] **Step 1: Add a failing orchestration test**

Add `endsAt?: Date | null` to the booking record type fixture support. Create a past confirmed booking and have the fake repository return it from `listNeedsFollowUpPlan`.

Assert:

```ts
expect(result.needsFollowUpPlan[0]).toMatchObject({
  status: "confirmed",
  planReason: "post_event",
});
```

Keep the existing `currentBooking` as a future-dated `new_lead` and assert it remains `planReason: "needs_action"`; this prevents accidentally suppressing all future-dated leads.

- [ ] **Step 2: Run the focused Today query test and verify it fails**

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/follow-ups/today-query.test.ts
```

Expected: FAIL because `planReason` does not exist yet.

- [ ] **Step 3: Add the plan-reason data contract**

Update the types:

```ts
export type TodayDashboardBookingRecord = {
  // existing fields
  startsAt: Date | null;
  endsAt?: Date | null;
  // existing fields
};

export type FollowUpPlanItem = {
  // existing fields
  planReason: "needs_action" | "post_event";
};
```

When mapping `planResult.records`, compute:

```ts
const effectiveEventEnd = booking.endsAt ?? booking.startsAt;
const planReason =
  booking.status === "confirmed" &&
  effectiveEventEnd !== null &&
  effectiveEventEnd < startToday
    ? "post_event"
    : "needs_action";
```

Return `planReason` with the item. Do not mutate booking status.

- [ ] **Step 4: Run the Today query tests and verify they pass**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/features/follow-ups/today-query.ts artifacts/api-server/src/features/follow-ups/today-query.test.ts
git commit -m "feat: label post-event follow-up plans"
```

---

### Task 3: Show post-event purpose clearly on Today

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.test.tsx`

**Interfaces:**
- Consumes: `booking.planReason` from `/today`.
- Produces: visible `Post-event follow-up` copy and aftermath guidance for post-event items.

- [ ] **Step 1: Add a failing UI test**

Add a dashboard fixture containing:

```ts
{
  ...currentBooking,
  id: "post-event-id",
  name: "Eastern Montana Fair",
  status: "confirmed",
  planReason: "post_event",
}
```

Assert the Today screen renders:

```ts
expect(screen.getByText("Post-event follow-up")).toBeInTheDocument();
expect(screen.getByText(/aftermath summary/i)).toBeInTheDocument();
```

And retain a normal lead fixture with `planReason: "needs_action"` that still renders its normal status rather than post-event copy.

- [ ] **Step 2: Run the focused UI test and verify it fails**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/TodayPage.test.tsx
```

Expected: FAIL because the page currently only renders `booking.status`.

- [ ] **Step 3: Render the post-event label and purpose**

Change the section description from only active leads to copy that covers both categories, for example:

```tsx
<p className="mt-1 text-sm text-slate-600">
  Active leads and post-event wrap-ups without a future action.
</p>
```

For each booking, render:

```tsx
{booking.planReason === "post_event" ? (
  <div className="mt-1 text-sm text-slate-600">
    <span className="font-semibold text-slate-700">Post-event follow-up</span>
    <span> · Add the aftermath summary, how it went, and decide when to contact them for next year.</span>
  </div>
) : (
  <span className="ml-2 text-sm capitalize text-slate-600">
    {booking.status.replaceAll("_", " ")}
  </span>
)}
```

Keep the Event Profile link and BookingOperations rendering unchanged.

- [ ] **Step 4: Run the UI test and verify it passes**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/pages/TodayPage.tsx artifacts/adventure-zone/src/pages/TodayPage.test.tsx
git commit -m "feat: explain post-event follow-up work on Today"
```

---

### Task 4: Regression verification and branch completion

**Files:**
- No product files unless verification exposes a regression.

- [ ] **Step 1: Run focused API tests**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/features/follow-ups/today-upcoming-post-event.test.ts \
  src/features/follow-ups/today-query.test.ts \
  src/features/follow-ups/renewal-query.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused Today UI tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/pages/TodayPage.test.tsx \
  src/components/today/renewals-section.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run frontend typecheck and both builds**

```bash
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: PASS. Do not use the known unrelated full API workspace typecheck failures as evidence against this focused fix; if a scoped API typecheck is needed, configure it only for the touched follow-up query slice.

- [ ] **Step 4: Review the diff for the exact business rules**

Confirm:

```text
confirmed future/today/in-progress => Upcoming Events only
confirmed past => Needs Follow-up Plan as Post-event follow-up
endsAt wins over startsAt
future-dated possible/interested/new lead => still Needs Follow-up Plan
confirmed undated => still Needs Follow-up Plan
future incomplete follow-up => suppresses Needs Follow-up Plan
```

- [ ] **Step 5: Complete the branch through PR review/merge after verification**

Do not claim completion until the fresh verification commands/checks are green.