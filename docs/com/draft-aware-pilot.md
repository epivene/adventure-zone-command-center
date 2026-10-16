# Three-customer draft-aware sync

The Emails page contains a cached pilot view for Laramie County Fair (Cheyenne), Preston downtown outreach and Strawberry Days (Glenwood Springs). The existing hourly reconciliation loop checks only their three approved thread/account/profile tuples. Check now runs the same bounded sync, with a 60-second per-thread cooldown and a three-minute database lease to prevent overlapping requests. Reading the panel does not fetch Gmail.

Gmail is read-only in this service. Current draft text is displayed separately from sent/received mail. A changed draft message ID is linked to the already-verified profile without deleting the previous mapping. Missing drafts are not treated as sent; waiting requires a new message carrying SENT. Bounces and newer incoming replies take precedence over older drafts. The panel displays saved owner decisions and existing open follow-ups separately from observed email state. No notes, follow-ups, reminder rules, Gmail labels, drafts or sends are edited by the pilot.

The additive migration creates google_pilot_sync and append-only google_pilot_sync_history and seeds exactly three previously authorized tuples for the existing Gmail connection. Content-identical checks do not duplicate history. Account changes, conflicting profile links and Gmail failures retain the last good snapshot and show a sync problem. The mapping inserts and snapshot/history writes share one atomic SQL statement; no network request holds a database transaction open. Old labels are not used to identify profiles.

This is an hourly pilot, not push-based Gmail sync. It follows the three existing conversations; unrelated/new threads are not automatically enrolled. Moving a draft to a different thread requires review. It does not certify draft content as approved or dismiss a reminder. Attachments remain in the existing archive workflow; this pilot does not repeatedly download them. A missing draft is displayed for review rather than inferred as a send.

## Validation

- New classifier regressions cover draft edits, missing drafts, confirmed manual sends, new replies, repeated reply observations, bounces and retained owner decisions.
- PGlite integration uses the real migration and save SQL: repeated reads, draft replacement mappings, retained revision history, identity conflicts, current-account guard, and cached view/open-follow-up output.
- Owner-only route guards reject unauthenticated reads/writes and unsupported payloads.
- UI test verifies current draft, owner decision, open follow-up and last-good information on error.
- Targeted API suite: 25 passed; UI pilot: 1 passed. API and frontend production builds passed.
- Full API and frontend suites were started but interrupted after the unrestricted parallel run caused heavy resource use. API failures observed in organize-schema-contract, manager-map-data, drizzle-apply-repository, ai-suggestions, location-repository.pglite, act-recovery.e2e.pglite and convention-campaign-template-seed. No claim of a passing full suite.
- A bounded Google Workspace run completed: 457 passed, 10 failed across 108 files. The thread-detail contract failure introduced by the new labelIds field was corrected and its regression passed. Remaining failures were: contact-vs-event-precedence (ambiguous match); gmail-draft (extra threadId field); matched-email-correction-service (query expectation); profile-email-archive-repository (replacement-thread fixture); review-assignment-diagnostics (three diagnostic expectations); workspace-schema-contract (CRLF text comparison); operational-calendar-app-window (missing transaction mock). These were not changed by this pilot.
- Full API/frontend typechecks remain failing with repository-wide diagnostics; the pilot-specific fixture type mismatch was corrected. See local work/draft-pilot-*.log for captured results.

## Rollback

Revert the pilot code/worker hook to stop checks; retain both new tables and all mapping/history records. Do not run destructive down migrations or remove old mappings. No customer email is required to test these scenarios: simulated mail fixtures cover sending and bouncing.
