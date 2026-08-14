# Organization hierarchy final fix wave

Date: 2026-08-13

## Scope

Final broad-review remediation for the organization parent/location hierarchy on
`codex/organization-location-hierarchy`, starting from
`208ce7b72d6120187cb1bc26abcc64115a20b32b`.

## Fixes

1. Mirrored frontend event-profile reads now use the same canonical ownership
   precedence as the API: explicit organization, otherwise booking ownership,
   otherwise active contact association. Regression coverage asserts the
   organization/booking/contact null-precedence that prevents shared-contact
   activity and follow-up leakage.
2. Family decisions now execute in one serializable database transaction.
   Proposal review rows and standalone candidates are locked in deterministic
   order, candidates are rediscovered under those locks, hierarchy changes and
   audit records use transaction primitives, and the proposal is updated or
   deleted in that same transaction. Tests cover rollback when proposal deletion
   fails and repeated create-parent decisions.
3. Exact-name profiles with multiple distinct complete city/region pairs are
   surfaced as `ambiguous_location_candidate` even without a shared website.
   They are never preselected or included in bulk destructive merge, while the
   three manual outcomes remain available. Blank/same locations and same-address
   records are not mislabeled. Overlapping strong subsets collapse into one
   larger ambiguous review.
4. Proposed family rows are revalidated under shared review/candidate locks
   before merge. Website, address, or ACT evidence changes remove a stale
   proposal and allow an ordinary merge. Discovery also reconciles obsolete
   proposed rows, while preserving `not_related` decisions.

## Verification

GitHub Actions run
[31729319033](https://github.com/epivene/adventure-zone-command-center/actions/runs/31729319033)
at product head `b4929f8149b18ec9ecd106c18f3a1a6177154648` completed successfully:

- Focused frontend hierarchy regressions: 9 passed.
- Focused API family/transaction regressions: 23 passed.
- Full API suite: 1,048 passed, 53 skipped.
- Full frontend suite: 194 passed.
- Database and shared declaration builds: passed.
- API and frontend TypeScript checks: passed.
- API and frontend production builds: passed.

The full API suite used a 20-second Vitest timeout because the unrelated
16,252-row manifest-digest stress test exceeded Vitest's default five seconds
on the hosted runner; it passed without product changes.

The temporary branch-only verification workflow was removed after the green
run.

## Fix Wave 2

A subsequent concurrency and classification review identified two additional
edge cases. They were corrected after the first report:

1. Exact-name protection now applies to the entire name bucket whenever at
   least two distinct complete city/region pairs exist. Repeated complete
   locations and blank/incomplete members remain in that single ambiguous
   review, so no member can be preselected or sent through bulk merge.
   Same-address buckets and buckets without geographic divergence remain
   excluded.
2. Proposal persistence, proposal decisions, and merge guards now acquire the
   same transaction-scoped PostgreSQL advisory lock before reading or writing
   review rows or locking organizations. This removes the absent-row race:
   proposal-first makes merge wait and observe the proposal; merge-first makes
   persistence wait, observe missing/moved candidates, and remove or skip the
   proposal without deadlock.

GitHub Actions run
[31729994183](https://github.com/epivene/adventure-zone-command-center/actions/runs/31729994183)
at product head `04ca4775cc4a34ed4fd5b532e373cedef95e1bb7`
completed successfully:

- Focused frontend ambiguity tests: 9 passed.
- Focused API discovery/concurrency tests: 26 passed, 1 PostgreSQL integration
  test skipped because CI does not provide `TEST_DATABASE_URL`.
- Full API suite: 1,051 passed, 54 skipped.
- Full frontend suite: 196 passed.
- Shared declarations and API/frontend TypeScript checks: passed.
- API and frontend production builds: passed.

The gated PostgreSQL integration test uses two real pooled connections to prove
both advisory-lock interleavings. It runs automatically when a disposable
`TEST_DATABASE_URL` is available; always-on tests verify that both production
flows acquire the advisory lock before review and organization row work.

## Fix Wave 3

A final review refined same-address ambiguity and discovery snapshot safety:

1. Once an exact-name bucket contains at least two distinct complete
   city/region pairs, the entire bucket is now an
   `ambiguous_location_candidate` even when normalized street addresses
   repeat. Repeated addresses are shown as manual-review evidence; they still
   block the strong automatic family suggestion, but can never make the records
   eligible for destructive merge.
2. `findDuplicates` is now read-only with respect to existing family review
   rows. It no longer attempts eager stale-proposal deletion from an unlocked
   discovery snapshot. Authoritative stale-proposal cleanup remains in the
   merge transaction after the shared advisory lock and current-data
   revalidation.
3. A production-path interleaving regression pauses `findDuplicates` after
   its old duplicate snapshot, persists a proposal, resumes discovery, and
   proves the newer proposal is not deleted.

GitHub Actions run
[31730635702](https://github.com/epivene/adventure-zone-command-center/actions/runs/31730635702)
at verification head `4b916e45f881a99f77e1b1508eb48f80b037d5ee`
completed successfully:

- Focused frontend regressions: 10 passed.
- Focused API regressions: 26 passed.
- Full API suite: 1,053 passed, 54 skipped.
- Full frontend suite: 197 passed.
- Shared declarations and API/frontend TypeScript checks: passed.
- API and frontend production builds: passed.


## Fix Round 4

The final re-review identified two remaining edge cases, both covered by
regressions before the production changes:

1. Stale family-review cleanup now commits before the API returns its refresh
   conflict. The serializable transaction returns a stale outcome after deleting
   the review row, then the service raises `HierarchyConflictError` outside the
   committed cleanup boundary. Missing candidates and expanded buckets both use
   this path, so a rolled-back exception can no longer resurrect the stale row.
2. Merge revalidation now locks and evaluates the current complete standalone
   organization snapshot. An old A+B proposal is stale when the current bucket
   is A+B+C. Under the shared advisory lock, the old proposal is deleted and an
   overlapping current proposal is inserted before the merge is blocked; the
   merge transaction commits that replacement before returning the conflict, so
   there is no unprotected merge window.
3. Every exact-name bucket containing at least two distinct complete city/region
   pairs is classified as `ambiguous_location_candidate`, even when the entire
   bucket also passes the strong shared-website matcher. Strong website evidence
   remains visible, while the whole bucket stays manual-only and excluded from
   destructive bulk merge.

GitHub Actions run
[31763823038](https://github.com/epivene/adventure-zone-command-center/actions/runs/31763823038)
at product/test head `80b518e13746a48124c4dd0f123f5c329c8a6d4c`
completed successfully:

- Focused frontend regressions: 11 passed.
- Focused API family/transaction regressions: 32 passed.
- Full API suite: 1,057 passed, 54 skipped.
- Full frontend suite: 198 passed.
- Shared declarations and API/frontend TypeScript checks: passed.
- API and frontend production builds: passed.

The temporary branch-only verification workflow was removed after the green
run.
