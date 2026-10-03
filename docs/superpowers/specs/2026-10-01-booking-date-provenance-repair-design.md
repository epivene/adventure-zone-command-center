# Booking date provenance and repair design
Date: October 1, 2026 (America/Denver)
Status: Approved in conversation October 2, 2026. Implementation and verification tracked in the linked plan and draft PR #993; delivery remains draft-only.

## Purpose
Make schedules and leg planning distinguish real public event dates, real operational reservations, unknown imported dates and sales milestones. Give the owner an evidence-backed before/after repair preview. Preserve leads, commercial status, history and commitments.

## Verified problem
The current ACT opportunity normalizer maps estimatedCloseDate to startsAt and actualCloseDate to endsAt. The connector operational-read SQL takes raw COALESCE of operational and booking endpoints; a 9999 endpoint therefore overlaps every subsequent season. A frontend booking-list helper already normalizes sentinel ends, but that rule does not cover the operational SQL or establish start-date provenance. New leg-planning validation rejects sentinel dates but does not repair existing records.

The audited 2027 overlap result contained two 2027-start rows and 18 2026-start new-lead rows ending in 9999. History includes estimated-close changes and opportunity-creation milestones. These are evidence for source review, not proof of public event dates. Pikes Peak or Bust has booked-client evidence despite a sentinel lead row. A profile name/status alone cannot select a repair.

## Selected approach
Use additive date provenance and a reviewed per-booking repair workflow. Reuse Event Date Coverage navigation/status styling and existing booking/leg-operation panels. Alternatives rejected: rewriting every sentinel end to its start invents event duration; merely hiding rows leaves bad reservation calculations and future imports intact.

## Shared date semantics
Represent raw timestamps separately from effective date evidence. Each public and operational endpoint has provenance classified as verified_event, verified_reservation, sales_milestone, unknown_import or unresolved_conflict, with source references and date semantics. A 9999 year, impossible/reversed interval or sales-only source cannot establish an event/reservation window.

Keep public event dates independent from travel/setup/teardown reservations. Preserve verified longer reservations and Google all-day exclusive-end semantics. Do not infer provenance from an ACT link alone: a later manual or Google update can supply real event dates.

Provide a shared resolver and equivalent parameterized SQL policy for schedule/map, connector booking/allocation reads, profile date summaries and leg-readiness calculations. Preserve raw endpoints in responses; expose effective endpoints, evidence state and review reasons additively. Do not silently turn a partly known window into a one-day event.

A complete verified window can enter overlap calculations. Partial or unresolved windows are discoverable in a date-review/undated queue, and a known verified season may show an unresolved card without drawing a continuous reservation. Unknown commitments are never counted as free capacity: conflict/readiness responses state incomplete evidence and block a definitive availability verdict. Both sentinel-tainted imported operational windows and public dates need review; fixing only the public end is insufficient.

## Future imports
Stop copying ACT close dates into public event endpoints. Retain sales dates as explicitly labeled import provenance and unchanged raw snapshots. Verified event/reservation source fields must be separately mapped. Flag unknown dates for review without fabricating dates or changing imported commercial status. Preserve source identities, duplicate protections and replay behavior.

## Review and save flow
Owner opens Date Coverage > Booking date repairs, filters by season/reason and selects an exact booking/profile/source identity. The screen shows raw public and reserved dates, source type/IDs, commercial status, package selections and related assignments. Evidence may link to saved source snapshots, notes, emails, agreements, calendar entries or independently verified public sources; the app makes no automatic paid research calls.

Actions:
- Classify an imported endpoint as a sales milestone/unknown, preserving its original value in evidence.
- Propose verified public dates for the exact historical season.
- Propose a separately evidenced operational reservation.
- Leave unresolved when evidence conflicts. A separate season creates its own dated record through the existing booking flow, rather than reusing the old opportunity.

Preview shows each exact old/new field, preserved raw values, reason, source references, inclusive/exclusive semantics and impacts on schedule/route/readiness. Clearing unsupported canonical endpoints is permitted only in an explicit reviewed proposal. Material date changes to records with committed staffing/equipment/holds require the existing reservation transaction boundary and re-evaluation; the UI cannot bypass approvals or shorten obligations silently.

Preview creates no reservation and applies no booking mutation. Apply requires owner authentication, the preview ID, exact booking/window/source revisions, actor identity and stable request key. Recompute impacts inside a transaction; reject stale evidence with 409 and require a fresh preview. Audit append-only old/new values and sources; apply dates/provenance atomically or not at all. Identical retries return the original committed receipt; mismatched retries reject. No delete, bulk rollover, leg reassignment, commercial-status change or correspondence.

No connector booking-date write tool or permission expansion is included. Owner app routes supply preview/apply. Connector reads gain additive provenance/review fields with stable paging.

## Data and integration
Add endpoint provenance and immutable repair/audit storage through an additive migration. Preserve ACT/calendar source snapshots. Determine exact table/column reuse during implementation planning after reading existing source-link, audit and reservation schemas; do not introduce duplicate source stores. Existing booking rows remain untouched at migration time and legacy missing provenance resolves conservatively.

Refresh affected profile, booking, schedule/map, route and readiness queries after successful apply. Failed apply preserves the owner's draft; stale reads cannot overwrite current selection/unsaved edits. Manager/boss reads retain current scope and expose no owner repair action.

## Acceptance checks
1. The 18 audited sentinel rows remain retrievable for review but no longer span the 2027 season as valid reservations.
2. Sales milestones import into labeled provenance, not public event dates.
3. Genuine cross-year bookings and verified Google exclusive windows still overlap correctly through Denver DST boundaries.
4. Unknown evidence does not produce a claim that a leg or set is free.
5. Same-profile multi-season and multi-package bookings preserve identities/history; review requires an exact selection.
6. Stale revisions, unauthorized apply, mismatched request keys, concurrent reservation changes and audit failure cannot partially commit.
7. Existing signed-booking status, package allocations, notes and follow-ups survive repair.
8. Integration tests exercise real SQL filters, reservation locking and atomic rollback; interface tests cover preview/apply and draft preservation.
9. Confirm 360px, 768px and desktop usability using a supported authenticated browser; blocked checks remain explicitly unverified.

## Delivery boundary
Deliver implementation as a draft PR with migrations, focused tests/build evidence and onboarding instructions. No merge/deploy, live mass repair, customer email or paid provider calls. Applying individual live corrections requires verified evidence through the completed owner review flow.

## Remaining factual limits
Public event dates are not yet independently verified for all 18 records. Complete older history/source review precedes live correction. Real equipment/crew onboarding and historical duplicate reconciliation are separate work.
