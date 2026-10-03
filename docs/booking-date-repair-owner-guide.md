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
- Immutable ACT opportunity snapshots linked to the exact booking through archived external links or imported-field origins are selectable even when the booking has no endpoint evidence. Snapshot/database/version identity and linkage revisions are checked on Apply. They support sales/import classification only. Estimated/actual close dates never prove event dates.

Source and endpoint revisions and the actor are resolved on the server. Clients cannot supply replacement actor/revision values. Missing, deleted, quarantined, out-of-scope or changed sources are rejected.

## Dates and clearing

Public event dates and operational reservations are independent. Choose `inclusive_date` for an occupied calendar day, `exclusive_date` for a non-occupied end boundary, or `instant` for an explicitly timed ISO timestamp. Display and overlap calculations use America/Denver, including daylight-saving transitions.

Instant timestamps require clock hours 00–23, minutes/seconds 00–59 and offsets smaller than 16 hours in both preview and SQL readers. Year 9999, impossible calendar dates, reversed ranges, sales-only endpoints and unverified values never create an effective reservation. Independently proved partial dates may place a review card in a known season, but never create a continuous overlap bar.

Classification preserves canonical values unless the owner explicitly selects **clear**. A reservation row can be cleared only as a whole: both endpoints must be explicitly classified and cleared. No missing reservation endpoint is invented.

Confirming a source or normalizing its timestamp encoding does not move an unchanged verified window. A different verified start season requires a separate booking. The legacy demand/commitment action cannot edit public dates; use this saved-source workflow.

Material changes are blocked while active holds, staffing, equipment, trips or committed plans remain. Resolve each actual obligation through its existing owner controls, then create a fresh preview. For a changed previously verified signed window, the preview shows the prior proved public/reservation dates and all remaining obligation IDs. Review the proposed dates and saved sources, choose **Reconcile signed window and preview again**, then review and **Apply reviewed repair**. This explicit reconciliation is bound to that preview, exact prior/proposed windows, source revisions and operational snapshot; changed evidence or obligations requires a fresh preview. Signed status is preserved, and a proved window cannot be cleared through this action. Repair never silently rewrites crew, equipment, hold or route windows.

Other commitments with unknown dates produce a capacity-review warning without preventing independently sourced date facts from being saved. Repair those bookings sequentially. This does not approve availability or allocate capacity: planning/readiness continues to report unknown commitments until their separate source review is complete.

## Preview expiry, stale data and retries

Previews last 30 minutes and do not change bookings or create reservations. Apply re-reads booking/window/source revisions and operational facts under the existing allocation mutex. Changed evidence, an expired preview, or a changed active-hold set (including natural hold expiry) returns 409. The screen retains the draft and requires a fresh preview.

An identical retry with the same request key returns its original receipt, including after preview expiry. A reused key with a different payload is rejected. Date writes, appended evidence, receipt, audit and planning/allocation invalidation are atomic. Failed source checks or audit persistence commit no repair.

Commercial status, packages, notes, sibling bookings and history are preserved. No batch rollover, deletion, leg reassignment, customer message or paid provider request is part of this feature.

## Migration and verification

The additive migration is `lib/db/migrations/20261002_booking_date_provenance.sql`. Startup requires the evidence resolver and tables before planning/capacity writers run. Migration replay never rewrites existing booking rows. Existing records without explicit provenance enter conservative review; there is no automatic historical backfill.

The focused GitHub Actions workflow uses Node 22, frozen pnpm dependencies, PGlite query/rollback regressions and a disposable PostgreSQL 16 database for actual allocation-lock races. Package typecheck diagnostics, ACT failures and calendar/capacity failures are compared with pinned base `37e71787153018ee366acf642537de97858fdc81`; new failures block delivery.

Verification results are recorded in the approved plan's progress ledger and draft PR. Authenticated browser checks at 360px, 768px and desktop remain **unverified**. The current draft has no runnable authenticated preview available here. Component tests do not substitute for those visual checks.

No live corrections, merge or deployment were performed. Public dates for the 18 historical sentinel records still require source review before individual corrections. Equipment/crew onboarding and historical duplicate reconciliation remain separate work.

### Verification checkpoint

GitHub Actions run `36975066885` verifies the Native implementation. Package checks introduce **zero new diagnostics** (API: 104 inherited; frontend: 127 inherited), and both application builds pass. Focused backend/owner-route tests: 94/94; frontend visibility, repair UI and role evidence: 22/22. The operations job also passes shared contracts 6/6, planning 123/123, frontend planning 32/32, operations API 79/79 and connected views 73/73. Both compatibility baseline gates pass.

The broad suites retain two baseline ACT failures (phone fixture missing organization_locations; quote-sensitive migration-contract assertion) and three baseline outreach failures (missing boss_accounts.session_version fixture; two active-pursuit rerank cases). These are disclosed rather than hidden. Authenticated responsive browser checks remain unverified as described above.

Final review found four Important workflow/source/parity issues; one RED→GREEN fix pass addresses them. Run36975066885 attempt2 passes all listed suites. Attempt1 hit an intermittent immediate assistant-context assertion; the unchanged retry passed. The ACT broad gate's missing collection/runtime/multiplicity/cause checks are a deferred Minor; the capacity gate includes those checks. This was the earlier pinned-base checkpoint; the current-main verification below supersedes its integration limit. See the final review record and chronological progress Rulings for details.

### October 3 current-main verification

Current main through #994 (Today call list), #995 (season-planning connector reads), and #996 (automatic-reply next-step review) is integrated into the same draft. Tested code `0482d01cb2fd25bc7f6567d41a990dfe75fb9c88`: [Booking Date Repairs run 37134301922](https://github.com/epivene/adventure-zone-command-center/actions/runs/37134301922) and [Connected Leg Operations run 37134302033](https://github.com/epivene/adventure-zone-command-center/actions/runs/37134302033) pass.

Repair/backend 94/94, repair UI 22/22, call list 36/36, automatic-reply review 54/54, shared contracts 6/6, planning 123/123, planning UI 32/32, operations reads 85/85 and connected views 73/73 pass. Both production builds and zero-new diagnostic comparisons pass (104 API, 127 frontend inherited errors). The two/three known ACT and calendar/capacity baseline failures remain unchanged. The database-backed privacy regression uses 30 seconds after two workflows reproduced its 5-second timeout; all assertions are unchanged. Initial failures remain in the progress ledger.

The current-main integration gap is closed. Other repository workflows remain non-green; authenticated responsive visual checks remain outstanding. This is still a draft, with no deployment or live corrections.
