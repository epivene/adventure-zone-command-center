# Profile calendar preview

Draft implementation following the externally merged status fix in PR #1053. Based on main c78da33d840d33b0a2612ca71c1a270839c3cc66 after checking intervening changes; the reminder worker's files are preserved. The shared checkout was neither read again nor modified.

## Owner workflow
Open Add to calendar beside the profile notes, choose the saved booking explicitly, and load its facts. Verified operating dates and saved name, venue, leg, packages and configured operational calendar are shown. Existing verified reservation dates prefill setup/teardown. Missing values remain empty. Two days before and One day after calculate editable calendar buffers from verified operating dates.

Refresh preview after editing, review each create/update/reuse entry and acknowledge it before saving. Booking facts are edited through the existing booking screen, not invented in this dialog. All package entries use the existing configured operational calendar; this does not add arbitrary destination calendars or booking creation.

## Evidence and save boundary
Reuse BookingDateRepairRepository and its resolved endpoint/source revisions. Missing, conflicting, changed or unavailable source proof blocks saving. Operating dates use existing Denver date semantics; Google all-day end is exclusive. Calendar buffers cannot shorten proved event or reservation windows and do not change booking/contract windows or certify resource availability.

A durable owner-bound preview expires after 15 minutes. Apply compares exact source fingerprint and connection identity, locks the preview and booking, serializes booking saves, and rechecks links and provider state. Stable booking/package Google IDs reconcile uncertain creation responses and avoid duplicate insertion after lost receipts. Existing links and etags are reused; all listing pages are checked within a bounded search. Potential unlinked matches require review rather than automatic creation.

Provider readback must match every rendered field and event ID before a receipt is committed. Retrying the same committed preview returns its receipt. Partial or uncertain provider writes remain retriable through the same preview; a source or provider conflict requires renewed review. There is no distributed transaction across Google and PostgreSQL: a provider write can exist after an app transaction fails, which is why deterministic identities and readback reconciliation are required.

Private link snapshots and audit history retain sources, revisions, preview, actor, before-state and receipt. Calendar descriptions contain operating dates and venue, not arbitrary internal booking notes. Legacy sync will not overwrite reviewed calendar buffers. Import preserves reviewed entries and routes external changes to review instead of promoting calendar buffers into contract facts.

## Files and schema
- ProfileCalendarAction and its client: profile entry point, date suggestions, preview and explicit save.
- ProfileCalendarPreviewService and calendar-preview-model: evidence, preview/apply, duplicate checks, provider verification.
- Existing operational client, sync and import: stable IDs and reviewed-entry protection.
- 20261016_profile_calendar_previews.sql: preview and receipt storage, registered with the normal migration runner. No business-record backfill.

## Verification and limitations
Added model tests, service tests with explicitly mocked database boundaries, frontend interaction tests and a legacy sync ownership regression. Added them to Calendar Route Handoff CI. Existing false-success tests remain in the PR.

In isolated writable scratch, 15 date/identity/readback helper assertions passed and nine TypeScript-only files parsed using Node's built-in syntax stripper. This is not a typecheck or full test suite; the stripper does not support constructor parameter properties or TSX. No React/Vitest, database-concurrency, migration or full build run is claimed. A bounded isolated TypeScript dependency install failed with getaddrinfo ENOTFOUND registry.npmjs.org; no network or permission workaround was attempted.

GitHub's initial PR check runs failed with no steps or logs in inspected jobs. Check-run metadata exposes annotation URLs, but the connector rejects annotation reads with INVALID_ARGUMENT (unsupported endpoint). Billing is therefore not established. Local browser inspection remains unavailable. Keep this PR draft until executable CI, database concurrency coverage and browser review are completed.

No production booking/payment/calendar records were changed. No merge or deployment was performed.
