# Leg Auto-Assignment and David Calendar Sync Design

**Date:** 2026-08-28

## Goal

Make qualified potentials and confirmed bookings land on the correct travel leg with minimal manual work, while preserving the Adventure Zone team's familiar Google Calendar workflow. The app becomes the source of truth going forward; David's operational Google Calendar becomes a synchronized mirror of confirmed operations.

## Scope

This design covers two connected behaviors:

1. Suggesting or auto-assigning a travel leg when a lead becomes a real potential.
2. Importing David's existing operational Google Calendar and then syncing confirmed app bookings back to that calendar in a familiar format.

Cold/new outreach is explicitly outside auto-assignment. A lead becomes eligible only after a positive reply or other evidence that it is a genuine potential.

---

## 1. Lead qualification and leg assignment trigger

A new outreach record does not require a travel leg.

Leg suggestion begins when the lead becomes a **qualified potential**, for example after a positive reply, request for pricing, request to check dates, meaningful interest, or another booking-oriented response.

Confirmed bookings must always have a leg.

If a qualified potential cannot be confidently placed, the app shows **Needs leg assignment** and leaves the choice to the user.

Manual assignment is always allowed and overrides any automatic recommendation.

---

## 2. Leg selection priority

Leg assignment uses this priority order.

### Priority 1: Same event, same leg as last year

If the same event profile was handled by a leg in the previous season and that leg is still active, that leg gets first priority.

The app should display a short reason such as:

> Suggested: Kristy — Handled this event in 2025

If the prior leg is no longer active or is operationally impossible for the new dates, fall back to route scoring.

### Priority 2: Operational feasibility

For each active leg, inspect the confirmed route immediately before and after the potential event.

A leg must have enough room for travel, setup, operation, teardown, and onward travel. As a planning rule, the candidate should normally have roughly **3–4 days of breathing room** around the relevant event block.

The system should use the full operational reserved window, not only the public event date.

If the move is not realistically possible, that leg is ineligible for auto-assignment.

### Priority 3: Balance workload

Among feasible legs, prefer a balanced distribution of **distinct confirmed operational events**.

Multiple packages at one event do not count as multiple events for workload balancing.

The balancing goal is to avoid one leg receiving nearly every new opportunity merely because it is slightly closer.

### Priority 4: Route fit and distance

Use driving fit as a tiebreaker among similarly loaded eligible legs.

Evaluate how naturally the event sits between the leg's surrounding confirmed stops, including travel time from the previous stop and onward to the next stop where applicable.

The chosen explanation should be visible to the user, for example:

> Suggested: Hulk — 5-day gap available · lighter route load · best route fit

If route information is incomplete or scores are too close, do not guess. Leave the event in **Needs leg assignment**.

---

## 3. Long-travel warnings

Travel time is part of feasibility and must also be surfaced as a user-facing warning.

- Under 8 hours: normal travel.
- 8–12 hours: **Long travel**.
- Over 12 hours: **Major travel concern**.

A long drive may still be recommended when the available time makes it realistic.

The system should consider both raw drive time and the number of days available. An 8-hour move with several open days is less concerning than the same move with only one day.

If the available gap is not sufficient for the move plus setup/teardown requirements, the leg is ineligible rather than merely flagged.

---

## 4. David Google Calendar connection

Connect the operational calendar associated with **TheAdventureZone12@gmail.com** as its own Google Workspace calendar source.

Do not merge its identity with Amy's `zone.pirate.warrior@gmail.com` source. Each connection/source retains its own calendar identity and sync checkpoint.

The existing Google Workspace archive/projection system should be extended rather than replaced.

Initial calendar access should support reading David's current upcoming operational events so the app can reconstruct and repair the current schedule.

---

## 5. Initial import of David's existing operational calendar

The import should match calendar entries to existing CRM/event profiles before creating anything new.

### Matching rules

Use event name, city/state, event dates, manager/leg prefix, and description fields as matching evidence.

If a strong existing profile match exists, update that profile rather than creating a duplicate.

If multiple Google rows represent the same event because different packages are scheduled there, they should map to one CRM event profile with multiple packages.

Only create a new event profile when no reasonable existing match exists.

### Status interpretation

Plain manager-prefixed operational rows such as:

`KRISTY Eastern Montana Fair - Miles City MT (Zone)`

are treated as operational booked/confirmed events.

Special prefixes remain special:

- `PLACEHOLDER` -> placeholder/held, not confirmed.
- `CANCELLED` -> cancelled.
- `NEED CONTACT`, `NEED CONTACT & PH`, and similar research/action wording -> not confirmed.

The importer must not blindly mark every calendar event as confirmed.

### Leg/manager parsing

The leading calendar title token may identify the assigned leg/manager, including names such as Kristy, Hulk, Dave, Dave2, Mikey, Angel, and others used operationally.

This imported assignment can repair missing leg fields in the app.

---

## 6. Actual event dates vs operational reserved block

David's calendar contains two different date concepts and both must be preserved.

### Actual public event dates

Use the `EVENT DATES` field in the calendar description as the event's actual public operating dates when present.

### Operational reserved dates

Use the Google Calendar event bar's start/end span as the leg's reserved operational block, which may include travel, setup, teardown, or route movement.

Example:

- Calendar block: Sep 10–13
- `EVENT DATES`: Sep 12

The CRM should store the actual event as Sep 12 while reserving Sep 10–13 for route planning and availability.

Leg feasibility calculations must use the operational reserved block.

---

## 7. Calendar description parsing

Where present, parse labeled fields from David's event description into structured CRM data without discarding the original source text.

Supported labels should include at least:

- CONTACT
- EVENT DATES
- EVENT ADDRESS / MAILING
- ATTRACTION LIST
- ADDITIONAL INFO
- PAYMENT INFO
- INVOICE SENT
- CONTRACT SIGNED
- DEPOSIT RECEIVED
- AMOUNT DUE UPON ARRIVAL

Payment, contract, and deposit state remain separate from booking confirmation. For example, a confirmed operational booking may still have `CONTRACT SIGNED: Pending`.

---

## 8. App becomes source of truth going forward

After the historical/current cleanup, confirmed booking data should originate primarily in the app.

The Google Calendar becomes a synchronized operational mirror so David can continue using the familiar schedule view.

Cold leads and unqualified outreach are never pushed to David's calendar.

Qualified potentials remain in the app/map but are not sent to David's confirmed operational calendar unless explicitly represented as placeholders by the user.

---

## 9. App -> David Calendar sync format

When a booking is confirmed or materially changed, sync it to David's calendar using a title and description format close to the team's existing style.

Example title:

`MIKEY Blanding City Fall Festival - Blanding UT (Zone)`

Keep manager/leg first, then event name, city/state, and package shorthand.

The calendar description should remain human-readable and familiar, using fields such as:

- CONTACT
- EVENT DATES
- EVENT ADDRESS / MAILING
- ATTRACTION LIST
- ADDITIONAL INFO
- PAYMENT INFO
- INVOICE SENT
- CONTRACT SIGNED
- DEPOSIT RECEIVED
- AMOUNT DUE UPON ARRIVAL

The operational Google bar should cover the reserved travel/setup/teardown block, while `EVENT DATES` reflects the actual public dates.

---

## 10. Multiple packages at one event

The CRM keeps one event profile with multiple package assignments.

To preserve David's familiar calendar appearance, the sync may create separate Google Calendar bars per package for the same event when that matches current operational practice.

Every package-row Google event must link back to the same CRM event profile.

Workload balancing counts the underlying event once.

---

## 11. Stable sync identity and duplicate prevention

Store the Google Calendar event ID for every synchronized row.

Subsequent app edits update the same Google event rather than creating a new duplicate.

For multi-package bookings, store one Google event identity per synchronized package row.

Initial import should also retain the source Google event IDs so future sync can adopt existing rows instead of replacing them.

---

## 12. Controlled two-way sync

Use a controlled two-way model rather than unrestricted last-write-wins synchronization.

### App-owned fields

The app is authoritative for core booking/profile data going forward.

### Manual changes made on David's Google Calendar

Meaningful changes such as dates, location, leg/manager, package, or status should be detected and shown as a **Calendar change detected** review item.

Do not silently overwrite important CRM values from a manual calendar edit.

Harmless formatting/text-only changes may be reconciled automatically when safe.

This avoids the app and Google Calendar repeatedly overwriting each other.

---

## 13. Map and route behavior

Qualified potentials with an assigned/suggested leg may appear on the planning map.

Potential events remain visually distinct from confirmed bookings and do not become confirmed route-line stops merely because a leg was suggested.

Confirmed route geometry remains based on confirmed operational stops.

The map should surface long-travel warnings and any manual-assignment-needed state where useful.

---

## 14. User controls and explainability

The event profile should expose:

- Assigned leg
- Suggested leg when different/unconfirmed
- Why the leg was suggested
- Travel warning if applicable
- Previous-year ownership evidence when used
- Manual override control
- Google Calendar sync status for confirmed bookings
- Calendar change review state when a manual Google edit is detected

The system should prefer short, understandable explanations over opaque numeric scores.

---

## 15. Failure and uncertainty behavior

Never silently guess when key route or matching data is missing.

Examples:

- No usable location -> Needs location / no auto-assignment.
- No meaningful surrounding route -> Needs leg assignment unless previous-year ownership is reliable.
- Two legs score nearly the same -> Needs leg assignment.
- Google event cannot be confidently matched -> Calendar import review item.
- Google API failure -> retain CRM state, show sync error, retry safely.

A sync failure must never delete the CRM event or remove its assigned leg.

---

## 16. Testing requirements

Tests should cover at least:

1. Cold lead remains unassigned.
2. Positive/qualified potential triggers leg evaluation.
3. Prior-year leg wins when still feasible.
4. Prior-year leg falls back when inactive/impossible.
5. Infeasible legs are excluded by operational gap.
6. Workload balancing is based on distinct events, not package rows.
7. Route fit breaks close workload ties.
8. 8-hour travel triggers Long travel.
9. 12+ hour travel triggers Major travel concern.
10. Unrealistic travel gap makes a leg ineligible.
11. Ambiguous scoring returns Needs leg assignment.
12. Manual override remains authoritative.
13. David calendar manager prefix maps to an active leg.
14. Plain operational entries import as confirmed.
15. PLACEHOLDER/CANCELLED/action entries do not import as confirmed.
16. Multiple package rows merge into one CRM event profile.
17. EVENT DATES are stored separately from the Google reserved block.
18. Existing profiles are updated instead of duplicated.
19. App -> Google sync preserves familiar title/description structure.
20. Existing Google event IDs are reused on later updates.
21. Manual Google changes create review items rather than silently overwriting core CRM fields.
22. Google failure leaves CRM data intact.

---

## Acceptance criteria

The design is successful when:

- New cold outreach does not clutter leg routes.
- Genuine potentials receive a useful leg recommendation automatically when enough data exists.
- Same-event historical ownership is preserved where practical.
- Route assignments remain reasonably balanced across active legs.
- Travel/setup feasibility prevents impossible auto-assignments.
- Drives of 8+ hours are visibly flagged.
- David's current operational calendar can be imported without creating obvious duplicate profiles.
- Actual event dates and operational travel blocks remain distinct.
- Confirmed app bookings sync back to David's calendar in a format the team recognizes.
- Multiple packages remain one CRM event while still supporting multiple familiar calendar rows.
- The app becomes authoritative without making David abandon his existing Google Calendar workflow.
