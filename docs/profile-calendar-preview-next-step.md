# Profile calendar preview: implementation boundary

Inspected upstream main at eb931afb1ac73ac3bdbae3ce83c47f449ee04cbc on 2026-10-16.
No open PR matching calendar was returned. Existing calendar branches are present; their existence alone does not establish active work. Local unpublished changes could not be inspected. This change is isolated from them.

## Existing paths
- BookingDetailPage.tsx mounts BookingCalendarSendButton.
- ProfileLegOperations already resolves profile, season and explicit booking selection.
- operational-calendar-client.ts exposes a booking-ID-only sync POST.
- OperationalCalendarSyncService reuses links, searches exact existing events and routes ambiguous matches to review.
- OperationalCalendarProjectionRepository defaults reservation windows to two days before / one teardown day after, and copies booking notes into additionalInfo.
- booking-date-repairs-api.ts already provides sourced endpoint evidence, preview fingerprints, expiration, blocked impacts and exact-preview application.

## Smallest safe next slice
Add a profile entry point that selects an existing booking explicitly. Reuse the date-evidence review machinery, with a read-only calendar preview contract that returns verified event name, packages, configured destination, venue, operating dates, setup/teardown dates, source references/revisions and existing event links.

Quick actions calculate suggestions from verified dates only; they do not turn defaults into evidence. Missing values stay empty. Keep public operating dates separate from the reservation window and handle Google's exclusive all-day end explicitly.

Saving must verify the exact preview/source revisions and preserve a stable retry identity. Reconcile existing provider events before retrying uncertain writes; retain linked-event reuse, concurrency protection and audit snapshots. Keep conflicts and unresolved checks separate from calendar descriptions; do not copy arbitrary internal notes or infer capacity.

The current sync endpoint is not a preview: it writes reservation windows before calling the provider. It accepts no preview values or revision. Therefore a frontend-only editable dialog would not safely guarantee that what was reviewed is what gets saved. No such dialog is introduced in this patch.

## Validation before completing the feature
Test explicit booking/year selection, missing/conflicting sources, month/year/leap-day date actions, inclusive/exclusive ends, stale preview rejection, concurrent saves, provider-success/receipt-failure retries, existing links, partial results and public-description separation. Review the UI against the actual app once supported browser access returns. Do not create production calendar events as a test.

## This patch
Fix only the current false-success result handling. Review-required and zero-result responses no longer display Sent, and repeated sends are blocked in that state with a link to the existing calendar settings/review page. Tests cover zero-write review, partial completion and zero-result synced responses.

Seven extracted resultMessage cases passed in the tool JavaScript runtime. React/Vitest and TypeScript builds have not run locally. The supported browser runtime is unavailable and the shared checkout is inaccessible; neither was bypassed. This patch does not add provider readback or claim the full requested preview is implemented.
