# Booking date repairs

This feature is for the authenticated owner. Open **Settings → Event Date Coverage → Booking date repairs**. Managers and bosses retain their existing read scope and see date evidence without owner repair controls.

## Review a historical booking

1. Filter the review queue by verified season or reason. Unknown seasons remain in the unfiltered review queue; imported sales dates never establish a season.
2. Select the exact booking. Check its booking ID, profile ID, commercial status, packages, assignments and source IDs. Same-profile bookings for different seasons remain separate.
3. Review the raw public and reservation endpoints and their classifications. An incomplete public or reservation window remains unresolved.
4. Choose saved evidence for each endpoint. Selecting evidence does not apply a change.
5. Enter values, classifications, explicit date semantics and the reason. Create a preview.
6. Review every old/new endpoint, evidence reference and impact. Apply only the reviewed, unblocked preview. The result includes an immutable receipt.

Use **Create a separate season booking** to open the existing profile booking flow when the evidence is for a different season. Do not repurpose a historical sales opportunity.

## Evidence rules

- Saved notes must belong to the exact booking, or be a profile-level note on its exact profile. A note assigned to a sibling booking is not selectable.
- Accepted business documents must have an accepted current blob/version and a saved link to the exact booking/profile. Date values must appear as explicit ISO dates in saved document notes; attachment parsing is not part of this workflow.
- Notes/document notes must explicitly contain the proposed ISO date or timestamp. Confirm and save unambiguous date evidence first when an agreement uses prose dates.
- Confirmed, active, independently verified Event Date Coverage facts can prove their saved public endpoints. A fact without an end does not invent an end.
- Accepted calendar reviews can prove saved Google reservation dates. Public dates require explicitly parsed EVENT DATES. Google reservation fallback does not establish public dates.
- Committed planning receipts can prove their saved reservation endpoints.
- Immutable ACT opportunity snapshots support sales/import classification only. Estimated/actual close dates never prove event dates.

Source and endpoint revisions and the actor are resolved on the server. Clients cannot supply replacement actor/revision values. Missing, deleted, quarantined, out-of-scope or changed sources are rejected.

## Dates and clearing

Public event dates and operational reservations are independent. Choose `inclusive_date` for an occupied calendar day, `exclusive_date` for a non-occupied end boundary, or `instant` for an explicitly timed ISO timestamp. Display and overlap calculations use America/Denver, including daylight-saving transitions.

Year 9999, impossible calendar dates, reversed ranges, sales-only endpoints and unverified values never create an effective reservation. Independently proved partial dates may place a review card in a known season, but never create a continuous overlap bar.

Classification preserves canonical values unless the owner explicitly selects **clear**. A reservation row can be cleared only as a whole: both endpoints must be explicitly classified and cleared. No missing reservation endpoint is invented.

Confirming a source or normalizing its timestamp encoding does not move an unchanged verified window. A different verified start season requires a separate booking. The legacy demand/commitment action cannot edit public dates; use this saved-source workflow.

Material changes are blocked while active holds, staffing, equipment, trips or committed plans remain, and for changes to an already verified confirmed/signed window. Use the existing explicit reconciliation flow first. Repair never shortens an obligation or silently rewrites crew, equipment, hold or route windows.

## Preview expiry, stale data and retries

Previews last 30 minutes and do not change bookings or create reservations. Apply re-reads booking/window/source revisions and operational facts under the existing allocation mutex. Changed evidence, an expired preview, or a changed active-hold set (including natural hold expiry) returns 409. The screen retains the draft and requires a fresh preview.

An identical retry with the same request key returns its original receipt, including after preview expiry. A reused key with a different payload is rejected. Date writes, appended evidence, receipt, audit and planning/allocation invalidation are atomic. Failed source checks or audit persistence commit no repair.

Commercial status, packages, notes, sibling bookings and history are preserved. No batch rollover, deletion, leg reassignment, customer message or paid provider request is part of this feature.

## Migration and verification

The additive migration is `lib/db/migrations/20261002_booking_date_provenance.sql`. Startup requires the evidence resolver and tables before planning/capacity writers run. Migration replay never rewrites existing booking rows. Existing records without explicit provenance enter conservative review; there is no automatic historical backfill.

The focused GitHub Actions workflow uses Node 22, frozen pnpm dependencies, PGlite query/rollback regressions and a disposable PostgreSQL 16 database for actual allocation-lock races. Package typecheck diagnostics and ACT failures are compared with pinned base `37e71787153018ee366acf642537de97858fdc81`; new failures block delivery.

Verification results are recorded in the approved plan's progress ledger and draft PR. Authenticated browser checks at 360px, 768px and desktop are **unverified** because this execution environment exposes no supported authenticated browser runtime. Component tests do not substitute for those visual checks.

No live corrections, merge or deployment were performed. Public dates for the 18 historical sentinel records still require source review before individual corrections. Equipment/crew onboarding and historical duplicate reconciliation remain separate work.
