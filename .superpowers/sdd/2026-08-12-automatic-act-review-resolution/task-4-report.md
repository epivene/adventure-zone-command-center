# Task 4 recovery report

## Scope and commits

- Authoritative worktree: `/workspace/scratch/2d7b4cca3992/repo-restored/.worktrees/automatic-act-review-resolution-restored`
- Starting point: completed Tasks 1–3 at `1b22bd50a1f6066f0a591028052ea5a411d55b84`.
- Recovered implementation commits: `3315d37` through `49a1fa3` (full Task 4 diff: `1b22bd5..49a1fa3`).
- Commits:
  - `3315d37 feat(act-review): persist automatic cleanup atomically`
  - `f817b8b fix(act-review): version canonical manifest digests`
  - `49a1fa3 fix(act-review): harden legacy rebuild recovery`
- Recovery references, reapplied with `apply_patch`: `e43db81`, `bf2a6e7`, and `e1f691f` from the preserved Task 10 repository, plus `review-b5be6ae..e43db81.diff` for the initial package.

## Delivered behavior

- The SQL review adapter now locks the owned run and participating sources, reloads lock-sensitive state, validates the protected manifest digest, derives and validates heterogeneous automatic decisions inside one transaction, and records one durable bulk-review request.
- Decision insertion and request persistence roll back together. The organizer rebuild begins only after commit; rebuild failure leaves a pending request which a retry can recover without duplicating decisions.
- Matching replays reconstruct their summary from durable decisions and operation rows. Fingerprint mismatches still return `request_replay_mismatch`.
- Migration `020_act_automatic_review_recovery.sql` adds the durable recovery columns and constraints needed by the request lifecycle.
- Strict manifest-row JSON validation occurs before hashing. Canonical digests are identified by the nullable `canonical-json-v1` version introduced by forward-only migration `021_act_manifest_digest_version.sql`; the schema and migration registry expose the same contract.
- One shared code-unit operation comparator defines builder output, `outcome.operationKeys`, and durable reconstruction order. A multi-operation recovery regression protects this equivalence.
- Null-version legacy digests are accepted only after exact insertion-order legacy recomputation over protected data. A no-decision legacy transaction upgrades digest and version atomically; a decision-bearing transaction retains the pre-decision digest/version until the organizer publishes the rebuilt canonical digest.
- Stale-marker recovery verifies the exact pre-decision legacy/canonical state after locking current sources. Changed-digest pending recovery completes only when the run is ready, locked source versions are current, durable operations canonically hash to the run digest, and a separate decision-aware protected recomputation agrees. A genuine post-rebuild crash therefore does not trigger a second rebuild or duplicate a decision.
- Error paths for a missing or non-ready rebuild release only the lease token owned by the current request.
- The PostgreSQL scenario includes 24 A-noise records, the original exact Natalie record at old-window position 25, a later duplicate at 26, and 6 Z-noise records. The expected final current reviewable count is three, discriminating the full-history ranking from the obsolete windowed query.

## TDD evidence

### Recovered Task 4 package

The recovered adapter/integration tests were applied before implementation.

```text
$ pnpm --filter @workspace/api-server test -- review-sql-adapter.test.ts one-time-import.integration.test.ts

Test Files  1 failed | 49 passed | 2 skipped (52)
Tests  4 failed | 769 passed | 51 skipped (824)
Exit status 1

Expected failures: production automatic review still returned automatic_review_unavailable.
```

After the initial implementation:

```text
Test Files  50 passed | 2 skipped (52)
Tests  773 passed | 51 skipped (824)
Exit status 0
```

The first preserved review package added 12 failing regressions before its implementation; the same suite then passed with 50 test files, 781 passed tests, and 51 skipped tests. The second preserved review package added six failing regressions before its implementation; the resulting suite passed with 51 test files, 787 passed tests, and 51 skipped tests.

### Canonical digest and ordering foundation

Five new regressions failed before implementation: two malformed JSONB cases, split operation ordering, missing digest-version migration, and missing version publication.

Focused GREEN command:

```text
$ pnpm --filter @workspace/api-server exec vitest run \
    src/features/act-replacement/manifest-builder.test.ts \
    src/features/act-replacement/manifest-digest.test.ts \
    src/features/act-replacement/organize-schema-contract.test.ts \
    src/features/act-replacement/review-sql-adapter.test.ts

Test Files  4 passed (4)
Tests  103 passed | 3 skipped
Exit status 0
```

### Legacy and pending-rebuild hardening

Six new recovery regressions failed before implementation: unverified legacy compatibility, arbitrary manifest tampering, unsafe legacy upgrade timing, missing/current-source fencing, incorrect lease cleanup, and an unnecessary second rebuild after a post-rebuild crash.

Focused GREEN command:

```text
$ pnpm --filter @workspace/api-server exec vitest run \
    src/features/act-replacement/manifest-digest.test.ts \
    src/features/act-replacement/review-sql-adapter.test.ts

Test Files  2 passed (2)
Tests  73 passed
Exit status 0
```

## Final verification

Broader focused builder/digest/adapter/organizer/integration/schema suite:

```text
$ pnpm --filter @workspace/api-server exec vitest run \
    src/features/act-replacement/manifest-builder.test.ts \
    src/features/act-replacement/manifest-digest.test.ts \
    src/features/act-replacement/review-command-service.test.ts \
    src/features/act-replacement/review-sql-adapter.test.ts \
    src/features/act-replacement/production-organizer.test.ts \
    src/features/act-replacement/production-review.test.ts \
    src/features/act-replacement/one-time-import.integration.test.ts \
    src/features/act-replacement/organize-schema-contract.test.ts

Test Files  8 passed (8)
Tests  193 passed | 6 skipped
Exit status 0
```

Migration-focused suite:

```text
$ pnpm --filter @workspace/api-server exec vitest run \
    src/db/act-review-migrations.test.ts \
    src/features/act-replacement/organize-schema-contract.test.ts \
    src/features/act-replacement/one-time-import.integration.test.ts

Test Files  3 passed (3)
Tests  15 passed | 6 skipped
Exit status 0
```

Full API suite:

```text
$ pnpm --filter @workspace/api-server test

Test Files  51 passed | 1 skipped (52)
Tests  798 passed | 51 skipped (849)
Exit status 0
```

API production build:

```text
$ pnpm --filter @workspace/api-server build

esbuild Done in 200ms
Exit status 0
```

Dependency-first workspace typecheck:

```text
$ pnpm run typecheck

artifacts/api-server/src/features/act-migration/activity-import-service.test.ts(64,3): error TS2322
Exit status 2
```

All libraries compiled first, and the typecheck reported no Task 4 errors. The single remaining failure is an unrelated pre-existing mock contract: its optional `listNotesForContact` member is not assignable to the required `ActMigrationSourceClient` method at `activity-import-service.test.ts:64`.

Diff hygiene:

```text
$ git diff --check 1b22bd5..49a1fa3
(no output)
Exit status 0
```

## PostgreSQL environment note

`TEST_DATABASE_URL` was absent in this workspace. The six PostgreSQL integration cases, including the 32-row old-window discriminator, were therefore registered but skipped. Their schema setup applies both migrations 020 and 021. The non-PostgreSQL API, adapter, digest, builder, migration-contract, and organizer suites all passed as recorded above.

## Remaining concern

- The PostgreSQL integration fixture still needs one execution in an environment with `TEST_DATABASE_URL` configured.
- Workspace-wide typecheck cannot be claimed green until the unrelated ACT migration test mock at `activity-import-service.test.ts:64` is corrected by its owning task.
- The completion-review subagent could not perform its independent inspection because its required CodeRabbit CLI is not installed. Policy rejected the tool's remote installer in this read-only review. A local requirement-by-requirement audit found no additional Task 4 defect, but this is not a substitute for the unavailable independent review.

## Fix round 1/5: historical legacy ordering, atomic publication, and nested JSONB

### Root causes

- The canonical builder began sorting each source's operations before creating `outcome.operationKeys`. Null-version verification then serialized that new representation, which cannot reproduce a historical multi-operation outcome whose keys retained builder insertion order.
- `DrizzleProductionOrganizerStore.persistManifest()` committed outcomes and operations before `complete()` published the run digest and phase in a separate statement/transaction. An uncertain commit or process failure in that gap left post-decision rows under the pre-decision run digest until the organizer lease expired.
- Durable manifest JSONB readers validated array containers but not their members. Non-string dependency/warning entries passed through, malformed issue members could leak a `TypeError`, and candidate entries were not required to be objects.

### RED

Tests were added before the fixes for historical multi-operation verification, atomic organizer publication, removal of the separate completion call, same-request recovery after an uncertain atomic publication, and four requested malformed members.

```text
$ pnpm --filter @workspace/api-server exec vitest run \
    src/features/act-replacement/manifest-digest.test.ts \
    src/features/act-replacement/production-organizer.test.ts \
    src/features/act-replacement/review-sql-adapter.test.ts

Test Files  3 failed (3)
Tests  12 failed | 75 passed (87)
Exit status 1
```

Seven failures were the intended missing behaviors: four malformed-member rejections, historical legacy ordering, atomic SQL publication, and the organizer's obsolete separate completion call. Five additional failures exposed that the shared pending-request test harness had prematurely marked every existing fixture canonical; that harness setup was corrected before implementation. The same-request uncertain-commit regression then exercised the already-required changed-digest recovery branch while the atomic-publication tests drove the missing production guarantee.

Candidate-object validation was then isolated as its own RED cycle:

```text
$ pnpm --filter @workspace/api-server exec vitest run \
    src/features/act-replacement/manifest-digest.test.ts

Test Files  1 failed (1)
Tests  1 failed | 13 passed (14)
Exit status 1

AssertionError: expected manifestFromRows() to reject candidates: [null]
```

### GREEN implementation

- Added `buildLegacyActOrganizeManifest()`, which executes the pre-change builder representation: per-source outcome keys and automatic-review proof inputs retain insertion order, global operations keep the historical comparator order, and the manifest uses the original row-by-row JSON digest.
- Protected null-version verification now independently rebuilds both canonical and historical representations from locked archived sources. It compares durable rows to the canonical rebuild and recomputes the historical JSON digest rather than trusting a supplied digest field. The zero-decision upgrade regression uses two operations whose historical and canonical outcome-key orders differ; tampering still fails closed.
- Manifest persistence now updates outcomes, operations, stale rows, run phase, canonical digest/version, and organizer lease ownership inside one transaction. `ProductionActOrganizer` no longer invokes the old separate completion step. If the transaction commits but the caller observes an error, the same request releases its own request lease and immediately finalizes from strictly verified changed-digest state without a second rebuild or decision.
- Durable arrays now require string members where specified, issue members must be valid objects with typed nested fields, and candidate members must be objects. All malformed cases return `manifest_row_invalid` rather than leaking coercion or a `TypeError`.

Focused GREEN:

```text
$ pnpm --filter @workspace/api-server exec vitest run \
    src/features/act-replacement/manifest-builder.test.ts \
    src/features/act-replacement/manifest-digest.test.ts \
    src/features/act-replacement/production-organizer.test.ts \
    src/features/act-replacement/production-review.test.ts \
    src/features/act-replacement/review-command-service.test.ts \
    src/features/act-replacement/review-sql-adapter.test.ts \
    src/features/act-replacement/one-time-import.integration.test.ts \
    src/features/act-replacement/organize-schema-contract.test.ts

Test Files  8 passed (8)
Tests  200 passed | 6 skipped (206)
Exit status 0
```

Full API GREEN:

```text
$ pnpm --filter @workspace/api-server test

Test Files  51 passed | 1 skipped (52)
Tests  805 passed | 51 skipped (856)
Exit status 0
```

Build and types:

```text
$ pnpm --filter @workspace/api-server build

esbuild Done in 167ms
Exit status 0

$ pnpm --filter @workspace/api-server typecheck

activity-import-service.test.ts(64,3): error TS2322
Exit status 2
```

The typecheck contains no Task 4 error. Its sole failure remains the unrelated pre-existing optional `listNotesForContact` test mock described above. `TEST_DATABASE_URL` remains absent, so the PostgreSQL integration cases stayed gated in this round.
