# Task 3 recovery report

## Scope and commit

- Authoritative worktree: `/workspace/scratch/2d7b4cca3992/repo-restored/.worktrees/automatic-act-review-resolution-restored`
- Starting point: Task 1–2 integration at `690c7dd`.
- Recovered implementation commit: `8e8fe8255b910c7b7c21d7de59203bbb32e3ba41` (`feat(act-review): prepare automatic decision batches`).
- Reviewed recovery sources: `review-54b563e..7a202b7.diff`, then `review-7a202b7..b5be6ae.diff`.

## Recovered behavior

- Added proof-bound heterogeneous automatic decision inputs, transaction-boundary contract, result type, and envelope-bound deterministic request fingerprinting.
- The in-memory boundary derives proposals while the command owns the operation; it validates each generated decision using `validatedDecision`, including fresh locked-source/local proof for every `use_source` field.
- Decision ordering includes source, scope, field, relationship slot, target type/id, decision, and source version. Replays are keyed as a nested `(runId, requestKey)` tuple, avoiding colon-concatenation collisions, and revalidate the recomputed fingerprint.
- Multiple relationship slots no longer collide in the in-memory active-decision uniqueness check.
- Added the SQL adapter boundary. It deliberately returns `automatic_review_unavailable` (503), preserving the current task boundary until a production context-and-lock implementation is introduced.

## TDD evidence

The recovered service tests were introduced before implementation. Their RED command and observed output were:

```text
$ pnpm --filter @workspace/api-server test -- review-command-service.test.ts

Test Files  1 failed | 49 passed | 2 skipped (52)
Tests  9 failed | 759 passed | 49 skipped (817)
Exit status 1

TypeError: store.seedAutomaticReview is not a function
TypeError: automaticReviewRequestFingerprint is not a function
```

The nine failures were the newly recovered automatic-review cases and failed only because the automatic store boundary/fingerprint did not yet exist.

## Focused verification

Command:

```text
pnpm --filter @workspace/api-server test -- review-command-service.test.ts automatic-review-resolver.test.ts
```

Exact final output:

```text
$ vitest run -- review-command-service.test.ts automatic-review-resolver.test.ts

 RUN  v4.1.10 /workspace/scratch/2d7b4cca3992/repo-restored/.worktrees/automatic-act-review-resolution-restored/artifacts/api-server


 Test Files  50 passed | 2 skipped (52)
      Tests  768 passed | 49 skipped (817)
   Start at  05:09:13
   Duration  4.01s (transform 4.04s, setup 0ms, import 13.75s, tests 2.87s, environment 5ms)
```

Additional verification:

```text
$ git diff --check
(exit 0; no output)
```

## Self-review

- Mixed batch test covers `link_existing`, `keep_separate`, two `assign_parent`, `keep_unlinked`, two `use_source`, and `ignore_source` decisions.
- Tests cover deterministic ordering, fingerprint reordering/envelope binding, exact replay, tuple collision resistance, replay mismatch, stale manifest/source, duplicate target/manual review, concurrent local-field change, and empty no-op input validation.
- Package-wide `pnpm --filter @workspace/api-server typecheck` remains blocked before and outside this change by absent generated declarations such as `lib/db/dist/migrations.d.ts` (`TS6305`) and pre-existing schema export errors. The focused Vitest suite above transpiles and exercises all changed code paths.

## Concern / follow-up

Production SQL persistence intentionally exposes the new contract but rejects automatic execution with a 503. This matches the reviewed Task 3 recovery patch and prevents proposal generation outside the future production transaction/lock boundary.

## Fix round 1/5: `keep_separate` target and fingerprint ordering

### RED

Added two regressions before changing production code:

- The service-path mixed automatic batch now supplies `targetEntityType: "contact"` on the ambiguous source that resolves to `keep_separate`. It must persist and rebuild successfully, proving that projected target metadata does not leak into a targetless decision.
- A fingerprint reversal test includes otherwise-equal decisions that differ by `null` versus `""`, plus Unicode-distinct field names `"e\u0301"` and `"é"`.

Command:

```text
pnpm --filter @workspace/api-server test -- review-command-service.test.ts
```

Exact RED summary:

```text
Test Files  1 failed | 49 passed | 2 skipped (52)
Tests  4 failed | 765 passed | 49 skipped (818)
Exit status 1

Error: decision_target_not_allowed
AssertionError: expected '5b14a19829083bc2f1f22d83bb2e7c8211890…' to be '5adf781ebbf20f64ef7a6f6d92e44c764ab34…'
```

The batch regression failed because the existing resolver retained `source.targetEntityType`; the fingerprint regression failed because the old comparator treated `null` and `""` as equal and delegated string comparison to `localeCompare`.

### GREEN

- `keep_separate` now emits `targetEntityType: null` and `targetEntityId: null`.
- Automatic fingerprint ordering is a total code-unit order over a serialized tuple of source ID, scope, field, slot, target type/id, decision, and source version. Therefore every distinct serialized decision has a stable position, including null/empty and Unicode-distinct values.

Command:

```text
pnpm --filter @workspace/api-server test -- review-command-service.test.ts automatic-review-resolver.test.ts
```

Exact output:

```text
$ vitest run -- review-command-service.test.ts automatic-review-resolver.test.ts

 RUN  v4.1.10 /workspace/scratch/2d7b4cca3992/repo-restored/.worktrees/automatic-act-review-resolution-restored/artifacts/api-server


 Test Files  50 passed | 2 skipped (52)
      Tests  769 passed | 49 skipped (818)
   Start at  05:14:09
   Duration  4.29s (transform 4.45s, setup 0ms, import 14.69s, tests 3.19s, environment 7ms)
```
