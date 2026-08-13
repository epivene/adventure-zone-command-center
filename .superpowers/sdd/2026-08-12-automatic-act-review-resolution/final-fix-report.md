# Final whole-branch fix report

## Outcome

- Trusted exact existing targets (`exact_external_link`, `manual_assignment`, and rebuilt `manual_review`) remain available for field-conflict proof and relationship processing, but no redundant `duplicate_identity: link_existing` decision is emitted unless the record has an actual ambiguous or slotless-unassigned identity issue.
- A fresh field decision can transactionally replace an active `use_source` decision only when its immutable source/local proof is stale against the currently locked conflict. A valid `use_source`, `keep_local`, or other conflicting active decision remains protected by `decision_already_active`.
- Supersession preserves the prior durable row, actor, reviewed values, and fingerprints, with exactly one active replacement.

## Strict RED -> GREEN evidence

Tests were changed before production code.

Initial focused RED:

```text
$ pnpm --filter @workspace/api-server exec vitest run \
    src/features/act-replacement/automatic-review-resolver.test.ts \
    src/features/act-replacement/review-command-service.test.ts

Test Files  2 failed (2)
Tests       11 failed | 88 passed (99)
```

The resolver regressions received redundant `link_existing`; the mixed service case failed `decision_not_applicable`; the stale replacement failed `decision_already_active`.

Additional focused RED proved that a slotted `unassigned` relationship must not reopen trusted exact identity review, and that an automatic rerun initially collided with the stale active field decision.

Focused GREEN after implementation:

```text
$ pnpm --filter @workspace/api-server exec vitest run \
    src/features/act-replacement/automatic-review-resolver.test.ts \
    src/features/act-replacement/review-command-service.test.ts \
    src/features/act-replacement/review-sql-adapter.test.ts \
    src/features/act-replacement/production-review.test.ts \
    src/features/act-replacement/one-time-import.integration.test.ts \
    src/routes/act-replacement.test.ts

Test Files  6 passed (6)
Tests       291 passed | 5 skipped (296)
```

PostgreSQL-gated production regressions cover:

- a ready exact external link plus other review rows and an exact-linked field conflict, completing cleanup without an identity decision;
- automatic field decision commit, concurrent local edit before rebuild, visible stale conflict, fresh manual replacement, exactly one active decision, and two-row audit history.

`TEST_DATABASE_URL` was absent, so these cases compiled and registered but remained gated.

## Full verification

```text
$ pnpm --filter @workspace/api-server test
Test Files  51 passed | 1 skipped (52)
Tests       848 passed | 53 skipped (901)
```

```text
$ pnpm --filter @workspace/adventure-zone exec vitest run
Test Files  9 passed (9)
Tests       88 passed (88)
```

Focused client/page UI: 2 files passed, 49/49. Migration/schema/integration contracts: 3 files passed, 15 passed / 8 PostgreSQL-gated skipped.

Both API and frontend production builds passed. The frontend build retained the established sourcemap-location and large-chunk warnings. `git diff --check`, library typecheck, and scripts typecheck passed.

Separate documented typecheck baselines were unchanged:

- API: only `activity-import-service.test.ts(64,3)` optional `listNotesForContact` mock mismatch.
- Frontend: only existing activity/contact repository timeline typing and `OrganizationsPage.tsx:119` callback mismatch.

## Remaining concern

- The two disposable-PostgreSQL regressions require the database-enabled CI lane for live execution because this workspace has no `TEST_DATABASE_URL`.
