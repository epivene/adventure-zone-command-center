# Task 1: Make unsupported fields non-blocking

## Implementation

Removed the early `awaiting_review` outcome and `continue` for materially populated unsupported normalized fields in `buildActOrganizeManifest`. The builder still emits an `unsupported_field` issue and diagnostic for every such field, then continues through the normal supported-operation builder. The final outcome remains `ready` unless a relationship or field-conflict issue blocks it.

Added `unsupportedNormalizedFields` to the `record_provenance` operation payload so normalized unsupported-field diagnostics remain available alongside the existing archived source paths. The existing `normalized: null` branch remains an `unsupported` outcome with no operations.

## Files changed

- `artifacts/api-server/src/features/act-replacement/manifest-builder.ts`
- `artifacts/api-server/src/features/act-replacement/manifest-builder.test.ts`
- `.superpowers/sdd/2026-08-08-act-import-safe-bulk-review/task-1-report.md`

## RED

Command:

```text
pnpm --filter @workspace/api-server test -- manifest-builder.test.ts
```

Before the implementation change, the classifier tests failed as expected:

```text
Test Files  1 failed | 36 passed | 3 skipped (40)
Tests       2 failed | 437 passed | 46 skipped (485)
```

The supported company and unsupported timeline were still classified as `awaiting_review` instead of `ready`, with no supported operations. This demonstrated the failure was the unsupported-field blocking control flow, not a test setup error. The whole-record `normalized: null` test remained blocked.

During self-review, an additional provenance-payload assertion was added. The same command then failed with:

```text
Test Files  1 failed | 36 passed | 3 skipped (40)
Tests       1 failed | 438 passed | 46 skipped (485)
```

That failure confirmed the normalized unsupported-field names were not yet retained in provenance diagnostics.

## GREEN

After each minimal implementation change, the focused command passed:

```text
pnpm --filter @workspace/api-server test -- manifest-builder.test.ts
Test Files  37 passed | 3 skipped (40)
Tests       439 passed | 46 skipped (485)
```

## Full API suite

Final verification command:

```text
pnpm --filter @workspace/api-server test
Test Files  37 passed | 3 skipped (40)
Tests       439 passed | 46 skipped (485)
```

The full suite was refreshed after the self-review provenance-payload addition; the earlier full-suite run had the same counts.

## Self-review findings

- Unsupported normalized fields remain diagnostics only; supported create/link/fill/provenance operations are retained.
- Whole unsupported records still exit through the existing `normalized: null` or unknown-kind blocked paths with no operations.
- The writable-field allow-list and populated-local-field conflict checks were not changed, preserving overwrite safety.
- The builder remains pure; no archive data is mutated, and the normalized source payload remains in the operation payload.
- `git diff --check` passed.
- No concerns identified within Task 1 scope.
