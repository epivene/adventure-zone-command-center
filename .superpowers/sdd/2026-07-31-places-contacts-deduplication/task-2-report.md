# Task 2 report — idempotent deduplicated place apply

## Delivered

- Persisted Task 1 duplicate-place metadata with each stored migration proposal, including a forward migration.
- Added canonical target identity and full grouped source IDs to apply-manifest entries.
- Reconciled unresolved dependencies into manifest-pending work, so approved children of an unresolved canonical place are not queued as permanently blocked operations.
- Tightened stable-link reconciliation: each source key must resolve to exactly one canonical target; ambiguous links fail closed.
- Expanded stable-link lookup to supply all source-identity links to manifest validation.
- Added coverage for canonical provenance, unresolved canonical dependencies, ambiguous links, duplicate-place entity idempotency, and duplicate-source relationship idempotency.

## Files changed

- `db/schema.ts`
- `db/migrations/0011_place_duplicate_provenance.sql`
- `db/migrations/meta/_journal.json`
- `features/act-migration/apply-types.ts`
- `features/act-migration/apply-manifest.ts`
- `features/act-migration/apply-repository.ts`
- `features/act-migration/preview-repository.ts`
- `tests/unit/act-migration-apply-manifest.test.ts`
- `tests/integration/act-migration-apply-repository.test.ts`
- `tests/integration/act-migration-entity-apply.test.ts`
- `tests/integration/act-migration-relationship-apply.test.ts`

## Test-first evidence

The new manifest tests were run before implementation and failed for the intended missing behavior:

```text
Tests  3 failed | 5 passed (8)
```

They specifically showed the absent canonical manifest fields, runnable child relationship despite an unresolved canonical place, and acceptance of an ambiguous stable link.

## Validation

```text
npx vitest run tests/unit/act-migration-apply-manifest.test.ts tests/unit/act-migration-preview.test.ts tests/integration/act-migration-apply-repository.test.ts tests/integration/act-migration-entity-apply.test.ts tests/integration/act-migration-relationship-apply.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000
Test Files  2 passed | 3 skipped (5)
Tests       10 passed | 11 skipped (21)

npm run typecheck
exit 0

git diff --check
exit 0
```

The PostgreSQL integration suites were skipped because `CRM_TEST_DATABASE_URL` is not configured and there is no `.env` file in this worktree. The tests construct isolated schemas from the migration journal and are ready to run against the configured disposable database.

## Self-review

- Stored duplicate metadata is included in both preview and apply structural proposal reconstruction, preserving the Task 1 digest contract across the database boundary.
- Canonical source IDs are sorted before manifest hashing, keeping repeated manifest construction deterministic.
- Dependency disposition is propagated to a fixed point, so nested children of unresolved or rejected work remain pending too.
- Ambiguous source links are rejected before any batch is inserted; a source key must have one link of the expected target type and local ID.
- Existing unique relationship and external-link boundaries continue to provide the final write-level idempotency protection; new tests assert one canonical organization with both source links and one active place-contact row on retry.

## Concerns

- Disposable PostgreSQL validation could not run locally because no `CRM_TEST_DATABASE_URL` was supplied. This is the only outstanding verification gap.
- `ActMigrationApplyService` already processes claimed operations serially and the repository ranks organizations before contacts and relationships; no orchestration code change was necessary for the canonical-place ordering requirement.
