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
