# Task 5 implementation report

## Scope and commit

- Starting point: completed Task 4 at `44b4389`.
- Implementation commit: `ef6d163 feat(act-review): add automatic cleanup endpoint`.
- Modified the three files required by the brief:
  - `artifacts/api-server/src/routes/act-replacement.ts`
  - `artifacts/api-server/src/routes/act-replacement.test.ts`
  - `artifacts/api-server/src/features/act-replacement/production-review.ts`

## Delivered behavior

- Added authenticated `POST /api/migration/act-replacement/runs/:runId/automatic-review`.
- The request body is strict and accepts only a canonical 64-character lowercase digest and a non-empty request key of at most 200 characters. Client-supplied actor, owner, source IDs, and any other fields are rejected.
- Server configuration and the owner/database-scoped `findOwnedRun` lookup complete before `resolveAutomatically` can execute. The command actor is always `context.requestedBy`.
- The success response contains only the fixed automatic-resolution counters, bounded remaining-review issue-code counts, the rebuilt digest, and scalar workflow status. Decisions, reviewed operation IDs, source/snapshot fields, candidate IDs, workflow operations, and apply-batch details are not projected.
- After the command, the route reads the remaining manual-review page, workflow summary, and final owner/database-scoped published manifest. The command, remaining-review, workflow, and final published digests must all match. A missing or differing value returns only `409 { code: "review_generation_changed" }`, so a mixed-generation body is never emitted.
- Existing domain errors retain their status/code mapping, including stale `manifest_digest_mismatch` as 409. A missing review dependency and a real lazy production-runtime initialization failure map to the bounded `503 review_unavailable` response. Failed lazy initialization is evicted from the runtime cache so a later request can retry initialization.
- The production lazy command proxy forwards `resolveAutomatically` to the scoped `ReviewCommandService`; its scope key remains source-database plus owner.

## TDD evidence

The route tests were added before production changes. The first focused command failed only because the route did not exist:

```text
$ pnpm --filter @workspace/api-server test -- act-replacement.test.ts

Test Files  1 failed | 50 passed | 1 skipped (52)
Tests  19 failed | 806 passed | 51 skipped (876)
Exit status 1

Expected failure: every new authenticated endpoint behavior received the absent-route 404.
```

The 19 failing cases covered strict body rejection, server configuration, owner scoping and call order, actor injection, bounded success projection, command/remaining/workflow/published digest disagreement and missing digests, stale-domain conflict mapping, review-runtime unavailability, and real in-memory replay.

After the endpoint and lazy-runtime boundary were implemented, the genuinely focused route command passed:

```text
$ pnpm --filter @workspace/api-server exec vitest run src/routes/act-replacement.test.ts

Test Files  1 passed (1)
Tests  78 passed (78)
Exit status 0
```

The replay regression uses `InMemoryReviewCommandStore` and the real `ReviewCommandService` through two HTTP requests. It asserts one active durable decision and exactly one rebuild, rather than asserting behavior of a command mock.

## Final verification

Full API suite:

```text
$ pnpm --filter @workspace/api-server test

Test Files  51 passed | 1 skipped (52)
Tests  826 passed | 51 skipped (877)
Exit status 0
```

The exact brief command was rerun immediately before the implementation commit. In this package, the argument after `--` does not narrow Vitest, so it executed the same full API suite and produced the same 826 passed / 51 skipped result:

```text
$ pnpm --filter @workspace/api-server test -- act-replacement.test.ts

Test Files  51 passed | 1 skipped (52)
Tests  826 passed | 51 skipped (877)
Exit status 0
```

Production build:

```text
$ pnpm --filter @workspace/api-server build

dist/index.mjs  3.2mb
esbuild Done in 227ms
Exit status 0
```

API typecheck:

```text
$ pnpm --filter @workspace/api-server typecheck

artifacts/api-server/src/features/act-migration/activity-import-service.test.ts(64,3): error TS2322
Exit status 2
```

The sole diagnostic is the pre-existing unrelated `ActMigrationSourceClient` test mock whose optional `listNotesForContact` is not assignable to the now-required method. TypeScript reported no Task 5 diagnostic. The same baseline issue was recorded by Task 4.

Diff hygiene:

```text
$ git diff --check
(no output)
Exit status 0
```

## Remaining concern

- Workspace/API typecheck cannot be claimed green until the unrelated activity-import test mock at `activity-import-service.test.ts:64` is updated by its owning work.

## Fix round 1/5: owner scope, filtered reasons, and error precedence

### Root causes

- `LazyReviewRuntime` retained both database and owner in its cache key, but `DrizzleActReviewReader` accepted only `sourceDatabaseKey`. Its `getManifest()` and bounded `readReviewPage()` run predicates therefore discarded the owner before querying.
- `readReviewPage()` returned a filtered `total` but only a global `summary.issueCounts`. The endpoint paired those different populations when constructing `remainingReview`.
- The endpoint invoked `requireReview()` before validating the run ID/body or deriving server context and ownership. Because `requireReview()` writes its 503 response immediately, it inverted error precedence and could then attempt a second response for an invalid run ID.

### RED

The fix-round route and SQL regressions were added before production changes:

```text
$ pnpm --filter @workspace/api-server exec vitest run \
    src/routes/act-replacement.test.ts \
    src/features/act-replacement/review-sql-adapter.test.ts

Test Files  2 failed (2)
Tests  7 failed | 143 passed (150)
Exit status 1
```

The failures independently proved:

- `getManifest` and every bounded review-page query omitted `requestedBy`;
- an issue on a non-needs-review outcome leaked into the endpoint reasons;
- unavailable review wiring incorrectly won over invalid UUID, malformed body, unconfigured context, and foreign ownership.

The manifest test initially asserted the stored digest for empty rows, but the adapter correctly canonicalizes durable rows. That assertion was corrected to check the real owner-predicate behavior, then rerun and observed failing specifically because the SQL parameters were `[run, act-db]` without `owner`.

### GREEN implementation

- Split the SQL reader into an internal base used by separately actor-validated command flows and an exported `DrizzleActReviewReader` whose scope requires both `sourceDatabaseKey` and non-empty `requestedBy`.
- Owner-scoped run predicates now protect `ownsRun()`/`getManifest()`, the bounded summary query, and the filtered count/page queries. Production construction already passes the complete owner scope.
- Added `filteredIssueCounts` to `ReviewPage`. In-memory reads derive it from exactly the filtered outcomes. The SQL reader derives total and bounded reason counts together in one `filtered_outcomes` CTE, applying the same state/issue/search and owner predicates.
- The endpoint now uses only `filteredIssueCounts` for `remainingReview.reasons` and continues whitelisting the six bounded issue codes.
- The endpoint now evaluates run ID, exact body, server context, and `findOwnedRun` in that order, requiring the review runtime only immediately before the command. Combined unavailable-review regressions also assert that the Express rejected-handler is never reached.
- Added a real in-memory review-reader regression where a ready outcome carries `unsupported_field`; it remains visible in the global diagnostic summary but is excluded from the needs-review total and filtered reason counts.

Focused GREEN:

```text
$ pnpm --filter @workspace/api-server exec vitest run \
    src/routes/act-replacement.test.ts \
    src/features/act-replacement/review-sql-adapter.test.ts \
    src/features/act-replacement/review-reader.test.ts

Test Files  3 passed (3)
Tests  162 passed (162)
Exit status 0
```

Fix commit:

```text
72a8e4b fix(act-review): scope automatic review projection
```

### Fix-round verification

```text
$ pnpm --filter @workspace/api-server test

Test Files  51 passed | 1 skipped (52)
Tests  833 passed | 51 skipped (884)
Exit status 0
```

```text
$ pnpm --filter @workspace/api-server build

dist/index.mjs  3.2mb
esbuild Done in 157ms
Exit status 0
```

```text
$ pnpm --filter @workspace/api-server typecheck

artifacts/api-server/src/features/act-migration/activity-import-service.test.ts(64,3): error TS2322
Exit status 2
```

Typecheck again reported only the pre-existing unrelated optional `listNotesForContact` test-mock incompatibility, with no Task 5 diagnostic.

```text
$ git diff --check
(no output)
Exit status 0
```
