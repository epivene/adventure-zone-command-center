# Event Profiles and Five9 Workspace — Task 5 Report

## Result

The release gate now verifies the complete `10 Mile Pride` event-profile migration and its local-only, idempotent apply. The workflow suite verifies the caller path from Today through the selected profile context to a completed call, replacement follow-up, and booking-status update.

## Coverage

- Three normalized `10 Mile Pride` / Breckenridge source companies consolidate to one canonical profile proposal.
- Shared and unique contacts are retained; conflicting source phones and notes remain in merged profile-history evidence, with all duplicate source IDs preserved.
- A distinct Frisco `10 Mile Pride Festival` is the only pending possible duplicate.
- Safe new Contacts and Place-Person children of an exact duplicate group are automatically approved; unrelated/ambiguous work remains outside that policy.
- The approved local Command Center batch applies five operations, has one queued near-match, and replays without changing counts or relationships.
- A recording Act! mutator proves neither initial apply nor replay writes to Act!.
- The focused workflow proves Today’s Contact/booking/follow-up IDs survive the profile handoff and Call Service completes the current follow-up, creates the next one with the same parent IDs, and changes the booking to `pending_contract`.

## RED evidence

The strengthened release fixture initially failed with both Place-Person proposals still `pending`, demonstrating that the exact place was auto-approved but its required new Contacts and relationships were not. The review policy was then narrowed to approve only direct, issue-free new Contact and Place-Person descendants of an exact duplicate group. The fixture passed after that change.

## Verification

| Command | Outcome |
| --- | --- |
| `npx vitest run tests/integration/act-migration-release.test.ts tests/integration/event-profile-workflow.test.tsx tests/unit/act-migration-auto-review.test.ts tests/unit/event-profile-workspace.test.tsx tests/unit/today-event-profile-links.test.tsx` | PASS — 5 files, 9 tests |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS with 15 pre-existing warnings in unrelated migration/relationship test files |
| `git diff --check` | PASS |

## PostgreSQL release gate

`CRM_TEST_DATABASE_URL` was not configured in this environment, so the PostgreSQL-backed release suite was intentionally not run. Before rollout, provision a disposable database URL and run the project’s CRM database release suite; do not treat skipped database tests as production verification.

## Verified rollout sequence

1. Complete and verify the immutable source snapshot.
2. Confirm automatic exact-group review leaves only genuine possible duplicates queued.
3. Start and finish the local Command Center batch, then replay it and compare stable counts/relationships.
4. Verify the caller path from Today to the selected event profile, Call Workspace, replacement follow-up, and booking state.
5. Run the PostgreSQL release suite with a disposable `CRM_TEST_DATABASE_URL` before production rollout.

## Round 1 follow-up — stateful persistence evidence

The release fixture no longer uses Map/Set-only assertions. Its stateful local Command Center target persists the canonical profile’s merged phones, notes, contact source provenance, Contact records, and Place-Person relationships; the same target is passed to the real `ActMigrationApplyService`. A read-only Act adapter spy is checked on every target call and after replay.

The calling workflow now uses a stateful profile/call repository. Call completion updates the stored activity, marks the original follow-up complete, creates the replacement follow-up, and changes the booking status. The test reloads the event profile from that repository and rerenders the workspace to assert the saved note, completed/replacement follow-ups, selected context, and `pending_contract` booking state.

Round 1 verification remains green: 5 focused files, 9 tests, typecheck, and diff checks pass. `CRM_TEST_DATABASE_URL` remains unavailable, so PostgreSQL execution is still explicitly gated.
