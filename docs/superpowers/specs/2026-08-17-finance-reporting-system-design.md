# Unified Finance & Reporting System Design

**Date:** 2026-08-17  
**Status:** Approved design, pending implementation plan  
**Project:** Adventure Zone Command Center

## Purpose

Adventure Zone Command Center already lets leg managers record income, expenses, mileage, cash activity, and receipt photos. The missing piece is the administrative accounting workflow: submitted finance records are currently summarized into totals, but admins cannot reliably inspect each submitted expense together with its receipt photo and details, correct mistakes with an audit trail, or roll the same source records into event, between-event travel, and season/tax reports.

This design creates one unified finance/reporting subsystem. Manager submissions remain the source records. Event reports, between-event travel reports, and season/tax reports are views over those records rather than copied accounting data.

## Goals

1. Preserve every manager finance submission as an inspectable accounting record.
2. Keep receipt image, expense details, submitter, timestamps, and assignment together.
3. Show event-linked expenses and receipt photos directly inside the existing admin Event Wrap-up.
4. Create first-class between-event travel reports for Event A → Event B.
5. Automatically assign otherwise-unassigned manager records to the correct between-event travel period when confidence is high.
6. Keep general/unassigned expenses valid and visible when automatic assignment is not appropriate.
7. Allow authorized admins to correct finance details and assignments without destroying the original submission history.
8. Build event, travel, and later season/tax reporting from the same underlying records.
9. Preserve report integrity by flagging finalized/reviewed reports when their source data changes.
10. Avoid duplicate finance rows when records are reassigned between General, Travel, and Event scopes.

## Non-goals for the first implementation

- Full bookkeeping/general-ledger software.
- Bank reconciliation or direct bank/card feeds.
- Payroll accounting.
- Filing taxes directly with a tax authority.
- Replacing the existing manager offline queue or receipt image upload flow unless required for correctness.
- Generating a polished PDF tax packet in the first release. The data model and report APIs must support that later.

## Core principle: one source record, many report views

A manager-submitted expense is one accounting record. It may be associated with:

- an event (`bookingId`),
- a trip and/or between-event travel segment (`tripId`, `tripSegmentId`), or
- no event/travel scope yet (General / Unassigned).

Changing the assignment updates the same record. It never clones the expense or receipt.

The same rule applies to mileage and other finance records where assignment is meaningful. Reports query the source records by their current scope.

## Existing foundation to reuse

The current system already has:

- `leg_expenses` with `legId`, `bookingId`, `tripId`, and `tripSegmentId` references,
- `leg_receipts` linked to expenses,
- receipt image upload status,
- event income,
- cash entries,
- mileage entries,
- trips and trip segments,
- manager event lifecycle/check-in data,
- event wrap-up calculations,
- manager/admin finance summary endpoints.

The new subsystem should extend these structures rather than introducing a parallel finance database.

## Finance record presentation model

Admin-facing finance APIs should return a normalized record view for each expense. At minimum:

- expense ID
- leg ID and leg name
- original manager/submitter identity where available
- original submission timestamp
- merchant
- category
- amount
- tax
- total
- payment source
- occurred date/time
- notes
- booking/event assignment
- trip assignment
- trip-segment assignment
- assignment source (`explicit`, `automatic`, `admin`, `unassigned`)
- assignment confidence/reason when automatic
- receipt ID
- receipt image status
- signed/readable receipt image URL when available
- created/updated timestamps
- whether admin corrections exist
- whether this record changed after a related report was finalized/reviewed

The receipt photo and expense details are presented as one finance item even though they remain separate underlying tables.

## Receipt image access

Manager receipt photos must be viewable by authorized admins from both:

1. the main Finance area, and
2. the related Event Wrap-up or Travel Report.

The API should generate short-lived signed read URLs through the existing object-storage abstraction. Missing/unavailable image enrichment must not make the entire finance record list fail; the record should still render with a clear image status and retry/reload option.

## Admin Finance workspace

The current Finance overview remains the top-level entry point, but expands beyond totals.

### Overview

Keep:

- combined income
- combined expenses
- settlement/net summary
- leg filtering/archive filtering

Add report-oriented filters:

- date range / year
- leg
- manager/submitter when available
- category
- payment source
- event
- travel segment
- assignment status (Event / Travel / General-Unassigned)
- receipt status (attached / missing / upload incomplete)

### Individual expense records

Below totals, render individual expandable finance records. A record should show the important details without requiring a second page, with an expanded section for:

- full notes
- receipt photo thumbnail/full-view action
- original submission information
- current assignment
- audit history
- admin edit controls

General/unassigned records receive a visible `General / Unassigned` scope instead of being hidden.

## Admin corrections and audit history

Admins may correct:

- merchant
- category
- amount
- tax
- payment source
- occurred date/time
- notes
- event assignment
- trip assignment
- trip-segment assignment

Corrections must not overwrite the historical truth of what the manager submitted.

### Audit model

Add a finance audit table (name can follow repository conventions) containing:

- audit ID
- finance record type (`expense` initially, extensible later)
- record ID
- admin actor identity
- changed at
- reason/note if required by policy
- previous values for changed fields
- new values for changed fields

The expense row contains the current effective values used in reporting. Audit rows preserve the prior states.

The UI should show a concise history such as:

- `Submitted by Kristy · Aug 17, 8:42 PM`
- `Category changed Fuel → Vehicle maintenance by Desiree · Aug 18`
- `Assignment changed General → Travel: Miles City → Billings`

## Assignment priority

Every expense gets a current reporting scope using the following priority:

1. **Explicit event/travel selection by manager** — preserve it.
2. **Admin assignment** — preserve until another explicit admin change.
3. **Automatic between-event travel assignment** — only when the record has no explicit event/travel assignment and a confident travel window exists.
4. **General / Unassigned** — fallback when confidence is insufficient.

Automatic assignment must never silently override an explicit booking/trip/segment reference.

## Between-event travel periods

Between-event travel is a first-class report scope representing movement from one event occurrence to the next for a leg.

Example:

`Miles City Fair → Billings Event`

A travel period is associated with:

- leg
- trip when available
- trip segment when available
- origin event
- destination event
- departure time
- arrival time
- origin location
- destination location
- assignment method/source

### Travel window boundaries

Preferred boundaries:

- **Start:** actual checkout/departure from Event A.
- **End:** actual arrival/check-in at Event B.

Fallback when lifecycle timestamps are unavailable:

- use the leg's route/trip ordering,
- use Event A end/scheduled departure context,
- use Event B start/scheduled arrival context,
- constrain the window so adjacent travel periods do not overlap unexpectedly.

If the system cannot confidently identify both sides of a travel period, records remain General / Unassigned.

## Automatic travel assignment algorithm

For each newly synced expense or mileage record lacking an explicit event/travel scope:

1. Identify the manager's leg.
2. Take the record's `occurredAt` timestamp.
3. Find candidate between-event travel windows for that leg containing the timestamp.
4. Prefer windows bounded by actual checkout/check-in lifecycle timestamps.
5. Otherwise use route/trip order plus scheduled event timing.
6. If exactly one sufficiently confident window matches, assign the relevant `tripId`/`tripSegmentId` and mark `assignmentSource = automatic` with a reason.
7. If multiple plausible windows overlap or no confident window exists, leave unassigned.

The assignment should be idempotent and safe to rerun after lifecycle/trip data changes.

### Re-evaluation

Automatic assignment may be re-evaluated when:

- delayed check-in/check-out data arrives,
- trip segments are created after an expense was submitted,
- route order changes before reports are finalized.

Do not automatically move a record after an admin has explicitly assigned it.

## Event report / Event Wrap-up integration

The existing admin Event Wrap-up becomes the primary inspection point for event-linked financial evidence.

Add an **Expenses & receipts** section showing each expense whose current `bookingId` is the event.

Each item displays:

- merchant
- date
- category
- amount + tax + total
- payment source
- manager/leg
- notes
- receipt image thumbnail/status
- open full receipt
- edit action for authorized admins

The existing profitability calculations continue to use the effective current finance values.

The current `Receipts: Complete / missing` summary remains useful but becomes a summary above the actual records rather than the only receipt information.

### Future Event Report action

Add a `View/Generate Event Report` action after the record layer is stable. The report includes:

- event identity and dates/location
- leg
- income
- expenses and receipt evidence
- cash settlement
- mileage/travel allocation
- adjustments/overhead
- profitability
- manager review/occurrence notes where appropriate

The first implementation may provide an HTML report view; export/PDF can follow later.

## Between-events Travel Report

A travel report represents one Event A → Event B movement period.

The report includes:

### Header

- leg
- origin event/location
- destination event/location
- departure timestamp and source (actual/fallback)
- arrival timestamp and source (actual/fallback)
- route/trip/segment identity

### Operational data

- starting/ending mileage when known
- recorded segment miles
- route-estimated miles when available
- mileage notes
- maintenance entries associated with the trip/segment where applicable

### Expenses

Group or filter by categories such as:

- Fuel
- RV park / lodging
- Food
- Vehicle maintenance
- Trailer maintenance
- Supplies
- Employee related
- Other

Every expense retains its receipt photo/evidence.

### Totals

- expense subtotal
- tax
- total travel spend
- totals by category
- totals by payment source
- mileage summary

Admin can edit/reassign individual source records directly from the travel report using the same finance correction workflow.

## General / Unassigned finance records

A finance submission is still valid if it is not tied to an event or a travel segment.

Examples:

- office/general supplies
- a purchase made outside a known travel window
- an expense submitted before route data is complete
- an ambiguous record the system should not guess about

These records appear in the Finance workspace under General / Unassigned and participate in season/tax reports.

Admin can later assign them to an event or travel segment without creating a duplicate.

## Season and tax reporting

After Event and Travel report foundations are working, add a season/tax reporting view over the same source records.

Filters should support:

- tax/calendar year
- custom date range
- leg
- manager
- category
- payment source
- event
- travel period
- assignment status
- receipt status

The view should provide:

- total expenses
- totals by category
- totals by payment source
- event-linked vs travel-linked vs general totals
- receipt completeness
- drill-down to every source expense and receipt

Export formats can be added incrementally (CSV first is reasonable; PDF/report packet later).

The reporting layer must never create independent expense copies. All totals derive from the current effective source records.

## Report lifecycle and source-data changes

Event and travel reports can be viewed live while activity is ongoing.

A report may later become `reviewed` or `finalized`.

When a source finance/travel record changes after review/finalization:

- retain the report's reviewed/finalized status metadata,
- mark it `source data changed` / `needs review`,
- show which source records changed,
- require admin review/re-finalization before treating it as current/final.

This follows the existing Event Wrap-up source-change pattern rather than silently rewriting a finalized accounting result.

## API design direction

Exact route names may be adjusted to match repository conventions, but the system should expose these capabilities:

### Admin finance records

- list/filter normalized finance records
- fetch one record with receipt + audit history
- update editable expense fields and assignments
- retry receipt image URL enrichment when necessary

### Event finance

- list normalized event-linked finance records for a booking
- include these records in the Event Wrap-up admin payload or a closely related endpoint

### Travel reporting

- list travel periods for a leg/trip/date range
- fetch one between-event travel report
- list records assigned to that travel segment
- trigger/re-run automatic assignment for unassigned records when appropriate

### Season/tax reporting

- aggregate filtered finance data
- drill down from aggregate totals to source records

## Data-model additions

Prefer minimal additions around the existing finance schema.

Likely additions:

1. **Finance audit table** for admin corrections.
2. **Assignment metadata** on finance records where needed:
   - assignment source
   - automatic assignment reason/confidence
   - assignment timestamp
3. If existing `tripSegments` are insufficient to represent travel window timing cleanly, extend trip-segment metadata rather than adding a duplicate travel-period table. A dedicated travel-period table should only be introduced if repository inspection during planning proves the segment model cannot safely express Event A → Event B windows.
4. Optional report-review metadata for travel reports, parallel to event wrap-up review behavior.

The implementation plan must inspect the actual current schema before choosing migration names or new columns.

## Permissions

- Leg managers can create their own finance submissions through the existing manager portal.
- Managers should not gain admin correction powers through this work.
- Authenticated admins can inspect receipt images and finance details.
- Authorized admins can edit effective values and assignments.
- Audit history is append-only from normal application flows.

## Failure behavior

Finance evidence must degrade gracefully.

- Receipt signed-URL failure: render expense details with `Receipt unavailable` rather than failing the entire page.
- Missing receipt: show `No receipt attached` and keep the expense visible.
- Automatic assignment ambiguity: leave General / Unassigned.
- One failed admin record enrichment: do not blank the whole finance list.
- Partial batch/report loading failure: show the affected section error with retry where possible.

This explicitly avoids repeating the prior all-or-nothing admin-page loading pattern that could make a whole section appear empty because one enrichment failed.

## Migration and backward compatibility

Existing finance records must remain valid.

For historical expenses:

- preserve current booking/trip/trip-segment references,
- infer `assignmentSource = explicit/legacy` where references already exist,
- leave records without references General / Unassigned initially,
- optionally run automatic travel assignment only where confidence rules are satisfied,
- do not fabricate receipt images for receipt rows whose upload never completed.

No destructive migration is required for the initial rollout.

## Implementation phases

### Release 1 — Finance evidence & admin corrections

- normalized admin expense/receipt view
- signed receipt image access
- individual records in Finance workspace
- General / Unassigned visibility
- admin editing + audit trail
- Event Wrap-up Expenses & receipts section

This release directly solves the immediate inability to inspect submitted receipts.

### Release 2 — Between-event travel reporting

- travel-window resolver using checkout → next check-in
- scheduled route fallback
- automatic expense/mileage assignment
- admin reassignment
- between-event Travel Report UI/API
- source-change/review behavior

### Release 3 — Season/tax reporting

- year/date/category/payment/leg filters
- aggregate totals and receipt completeness
- drill-down to source records
- export foundations (CSV first; richer report/PDF later)

## Testing strategy

Implementation should follow test-first development.

Required coverage includes:

### Finance record enrichment

- expense with uploaded receipt returns usable image evidence
- receipt enrichment failure does not remove expense
- missing receipt remains visible

### Event report assignment

- explicit `bookingId` appears on that Event Wrap-up
- event edit/reassignment moves the same source record rather than duplicating it

### Automatic travel assignment

- expense between actual checkout and next check-in assigns to that segment
- actual lifecycle timestamps outrank scheduled fallback
- scheduled route fallback works when lifecycle timestamps are absent
- ambiguous overlap remains unassigned
- explicit/admin assignment is never overwritten automatically
- delayed lifecycle data can assign previously unassigned records when safe

### Admin corrections

- current effective values update
- audit entry records before/after values and actor
- receipt remains linked after correction
- report source-change flag is raised when relevant finalized/reviewed source data changes

### Reporting

- Event Report totals reconcile to its source records
- Travel Report totals reconcile to its segment records
- General records remain in tax/season totals
- filtering never duplicates a source expense

## Success criteria

The subsystem is successful when:

1. An admin can open Finance and inspect every submitted manager expense, including receipt photo when available.
2. The same event-linked record is visible directly in Event Wrap-up with its receipt.
3. A general expense remains visible and reportable even without an event.
4. An expense incurred between two events is automatically assigned to the correct travel segment when checkout/check-in or reliable route timing makes that unambiguous.
5. Admin can correct a record and the original submission remains auditable.
6. Event and Travel reports reconcile exactly to their underlying source records.
7. Season/tax reporting can aggregate those same records without copying them.
8. A post-finalization source edit visibly requires report re-review.

## Approved product decisions

The following decisions were explicitly approved during design discussion:

- Receipt photos and expense details should be shown directly inside Event Wrap-up.
- A later View/Generate report action should use the same underlying records.
- Admins may edit submitted finance details and assignments.
- Original manager submission information/history must be preserved.
- Between-event travel reports are required.
- Expenses without explicit event/travel assignment should be automatically associated with a between-event travel period when confidence is high.
- Travel periods start at Event A checkout/departure and end at Event B arrival/check-in when those timestamps exist.
- Scheduled event/route order is the fallback when actual lifecycle timestamps are unavailable.
- Ambiguous records should remain General / Unassigned rather than being guessed into a report.
