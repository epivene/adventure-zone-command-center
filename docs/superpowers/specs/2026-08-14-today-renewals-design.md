# Today: Next Season / Renewals Design

**Status:** Approved design, pending implementation planning
**Date:** 2026-08-14

## Goal

Keep the Today dashboard focused on current-season booking work while still preserving visibility into next-season follow-ups and renewals.

Renewal work must not be mixed into **Needs Follow-up Plan** in a way that makes a completed or past event look like unfinished current-season booking work.

## Current behavior

The Today dashboard currently has one **Needs Follow-up Plan** section for bookings that do not have a future incomplete follow-up. This is appropriate for active current-season leads, but it becomes confusing when a booking is finished for this year and the only remaining work is to contact the customer about next year.

Bookings with status `completed` are already excluded from the active-status follow-up-plan query. However, bookings in `renewal_due`, past-dated bookings still carrying another active status, or other next-season follow-up cases can still surface in a way that looks like current-season work.

## Design

### 1. Keep current-season work in Needs Follow-up Plan

**Needs Follow-up Plan** should represent work that is still active for the current event or current season.

It should not include bookings that are clearly in a next-season or renewal phase.

The section copy should continue to communicate that these are active bookings that still need a future action.

### 2. Add Next Season / Renewals

Add a separate **Next Season / Renewals** section to the Today dashboard.

This section remains visible all year so renewal work is never hidden completely, but it is collapsed by default when nothing is near enough to require attention.

The collapsed control should include the total number of renewal items, for example:

`Next Season / Renewals (18)`

Opening the section shows the renewal items and their next follow-up dates.

### 3. Classification rules

A booking belongs in **Next Season / Renewals** when any of these conditions applies:

- the booking status is `renewal_due`;
- the booking is `completed` and has a future incomplete follow-up intended for another season/year;
- the event date has passed and its remaining future follow-up is clearly post-event or next-season work rather than unresolved work for the completed event.

A booking must not appear in both **Needs Follow-up Plan** and **Next Season / Renewals** at the same time.

Where classification could be ambiguous, the explicit booking status and the actual follow-up record should take precedence over guessing from dates alone.

The existing follow-up record is the source of truth for when renewal work should surface. This feature must not create, delete, reschedule, or otherwise mutate a follow-up merely because the dashboard classifies it as renewal work.

### 4. Thirty-day prominence rule

The renewal section uses a **30-day attention window** based on the actual future follow-up due date.

When all renewal items are more than 30 days away:

- the section remains visible;
- it stays collapsed by default;
- it shows the total count but does not compete visually with current-season work.

When one or more renewal follow-ups are due within the next 30 days:

- the section becomes prominent;
- it should open automatically on initial Today-page load, or otherwise visibly indicate that renewal work is coming due;
- the header should show how many renewal items are coming up soon, for example `2 renewals coming up soon`.

Overdue renewal follow-ups are also considered prominent and should remain visible until completed or rescheduled.

The 30-day calculation must use the same business timezone/date utilities already used by the Today dashboard.

### 5. Ordering

Within **Next Season / Renewals**, order items by follow-up due date, earliest first.

Overdue renewal items come before future renewal items.

Ties should use a stable secondary ordering so the list does not jump between reloads.

### 6. User interaction

The user can manually expand or collapse **Next Season / Renewals** at any time.

Auto-opening for an item inside the 30-day attention window only establishes the initial page state. It must not fight the user after they manually collapse the section during the current page visit.

Each renewal item should link to the same booking or event-profile context already used by Today so the user can review the event and manage its follow-up normally.

### 7. Data behavior

The Today API should return current-season follow-up-plan items and renewal items as distinct collections instead of making the frontend guess solely from presentation data.

The renewal payload should include enough information to render:

- booking/event name;
- booking status;
- organization/contact context used by existing Today links;
- next renewal follow-up due date;
- whether that follow-up is overdue or within the 30-day attention window;
- existing booking operations summary where applicable.

Existing Today counts for active leads and follow-ups should retain their current meanings unless a count explicitly represents renewal work.

### 8. Edge cases

- A completed booking with no future renewal follow-up does not need to appear in the renewal section merely because it is completed.
- A `renewal_due` booking with no future follow-up should appear in the renewal section as needing a renewal plan rather than being pushed back into current-season **Needs Follow-up Plan**.
- A past-dated booking that is genuinely unfinished for the current event should remain current-season work; passing the event date alone is not sufficient to classify it as renewal work.
- Completing or deleting a renewal follow-up should immediately remove or reclassify the item on the next Today refresh according to the remaining data.
- Rescheduling a renewal follow-up across the 30-day boundary should update its prominence on refresh.

## Error handling

If renewal data cannot be loaded independently, the Today dashboard should still render its primary current-season sections where practical and show a clear inline error for the renewal section rather than making the entire dashboard unusable.

No dashboard classification operation should mutate booking status or follow-up records.

## Testing

Implementation should include focused regression tests covering:

1. active current-season booking without a future action appears in **Needs Follow-up Plan**;
2. `renewal_due` booking is excluded from current-season **Needs Follow-up Plan** and appears in **Next Season / Renewals**;
3. completed booking with a future renewal follow-up appears only in the renewal section;
4. completed booking with no renewal follow-up is not surfaced unnecessarily;
5. ambiguous past-dated but still-current work remains in the current-season bucket;
6. renewal more than 30 days away is non-prominent/collapsed by default;
7. renewal within 30 days is prominent and initially expanded;
8. overdue renewal is prominent;
9. items are ordered by due date with stable tie-breaking;
10. classification never changes or deletes the underlying follow-up;
11. frontend manual collapse remains respected after initial auto-open.

## Non-goals

This change does not introduce a separate yearly season calendar, automatically create next-year bookings, guess renewal dates from last year's event date, or alter the existing follow-up scheduling workflow.

The actual follow-up due date remains the source of truth for when a renewal becomes actionable.
