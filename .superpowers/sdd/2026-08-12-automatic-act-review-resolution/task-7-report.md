# Task 7 report: end-to-end automatic cleanup verification

## Outcome

- Added a real PostgreSQL integration flow from `complete_with_issues` through automatic review, rebuilt safe-default approval, and apply. It proves that no profile or external source link exists before apply, an interruption after decision commit is recovered by replaying the same request, durable decisions/request rows remain exact-once, and replaying apply creates no duplicate profiles.
- The PostgreSQL flow compares per-table row counts, total JSON byte lengths, and canonical row hashes for `act_source_records`, `act_source_record_versions`, and `act_replacement_observations` before cleanup, before apply, after apply, and after apply replay.
- Unsupported input is asserted absent from apply operations while its exact raw snapshot remains queryable. Remaining PostgreSQL review rows are the real duplicate-name, conflicting-evidence, and required-unresolved cases; the stale-version and changed-conflict production boundaries remain covered by the adjacent gated negative integration test.
- Added a non-database production-boundary integration that projects a rebuilt `complete_with_issues` manifest, approves only its dependency-closed safe operations with `ActApprovalService`, proves all four unsafe categories are held exactly (duplicate exact names, conflicting evidence, stale field proof, and required unresolved relationship), and applies only the safe organization/contact with the real coordinator/service/repository boundary.
- Added a page integration from cleanup through rebuilt approval and batch apply. It verifies the rebuilt digest and approval key cross each client boundary in order without loading the full manifest into the browser.
- Audited the automatic-review API projection and logging. Existing route tests already prove raw source/decision/candidate/operation data is absent from the response. New adapter behavior tests prove successful and failed logs contain only bounded run/request metadata, counts/status, and error code; raw error text containing an email and phone is not logged. Rebuild lease renewal/cleanup errors were changed from raw error logging to the same bounded shape.

## TDD evidence

The new logging contracts were first observed RED against production behavior:

```text
$ pnpm --filter @workspace/api-server exec vitest run src/features/act-replacement/review-sql-adapter.test.ts

Test Files  1 failed (1)
Tests  2 failed | 67 passed (69)
```

Both failures were the intended missing production boundary: no bounded completion/failure log call existed. After implementation:

```text
Test Files  1 passed (1)
Tests  69 passed (69)
Exit status 0
```

The production-review test was also run before its fixture used the valid `safe_create` proof contract. That test failed closed with zero approved operations; after correcting the test input to the production proof contract, the focused suite passed 32/32. No production relaxation was made.

## Final verification

Exact focused backend command from the brief:

```text
$ pnpm --filter @workspace/api-server test -- automatic-review-resolver.test.ts review-command-service.test.ts review-sql-adapter.test.ts act-replacement.test.ts one-time-import.integration.test.ts production-review.test.ts

Test Files  51 passed | 1 skipped (52)
Tests  836 passed | 52 skipped (888)
Exit status 0
```

The package script forwards the trailing names after `--` in a way that still runs the full API suite, so this is also the fresh full-API result. `TEST_DATABASE_URL` was absent. The real-PostgreSQL cases remain present and gated; the focused one-time-import suite separately loaded successfully with 1 passed / 4 skipped.

Frontend page and full suite:

```text
$ pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx
Test Files  1 passed (1)
Tests  47 passed (47)
Exit status 0

$ pnpm --filter @workspace/adventure-zone exec vitest run
Test Files  9 passed (9)
Tests  88 passed (88)
Exit status 0
```

Builds:

```text
$ pnpm --filter @workspace/api-server build
dist/index.mjs  3.2mb
Exit status 0

$ pnpm --filter @workspace/adventure-zone build
1904 modules transformed; built in 7.68s
Exit status 0
```

The frontend build retained the known sourcemap-location and large-chunk warnings.

Typecheck baseline isolation:

```text
$ pnpm --filter @workspace/api-server typecheck
src/features/act-migration/activity-import-service.test.ts(64,3): error TS2322
Exit status 2
```

This is the known unrelated optional `listNotesForContact` mock mismatch. No Task 7 file produced a diagnostic.

```text
$ pnpm --filter @workspace/adventure-zone typecheck
src/features/activities/activity-repository.ts:70,95,216
src/features/contacts/contact-repository.ts:524,546
src/pages/OrganizationsPage.tsx:119
Exit status 1
```

These are the same unrelated frontend baselines recorded by Task 6. Workspace `pnpm typecheck` exited 1 after reproducing that frontend baseline; library and scripts typechecks passed. The API typecheck was run separately to expose and record its independent known baseline rather than hiding it behind the recursive early exit.

## Remaining concern

- A live PostgreSQL verification could not run because `TEST_DATABASE_URL` was not configured. The test uses the disposable production schema, organizer, SQL command/reader stores, approval service, and Drizzle apply repository, and is gated for the normal database-enabled CI lane.
- Workspace typecheck cannot be claimed globally green until the unrelated baselines above are repaired by their owning work.

## Fix round 1/5: immutable profiles, real unsafe remainder, exact IDs, and bounded codes

### Findings addressed

- The disposable-PostgreSQL recovery flow now snapshots Natalie’s complete relevant profile fields plus byte/count/digest snapshots of `organizations`, `contacts`, `organization_contacts`, and `act_external_links`. It compares them before cleanup, after the interrupted decision commit, after recovery/replay, and after both safe and explicit reviewed approval. Natalie remains `Local Director` through every pre-apply stage. The reviewed operation is then explicitly approved and applied after the safe closure, at which point—and only then—her stable row ID changes to `job_title = 'ACT Director'`.
- Apply replay now compares stable imported organization/contact/external-link IDs and values, as well as Natalie’s stable existing ID/value projection, rather than relying only on counts.
- Interruption/recovery now records all durable decision IDs and the automatic request ID. It asserts total decision rows (not only active rows), distinct ID counts, the same five decision IDs in the recovered result, the same one request ID after completed replay, and the same IDs after apply replay.
- Added a non-PostgreSQL production-boundary fixture built from archived rows and real local candidates. Archive normalization/matching produces duplicate-name, conflicting-direct-evidence, exact field-conflict, and required missing-relationship outcomes. The real automatic resolver captures the field decision; a simulated concurrent local edit occurs before the real manifest rebuild. The real reader then returns exactly four rows and literal reasons: `insufficient_independent_context_clues`, `conflicting_contact_identity`, `field_conflict:jobTitle`, and required `unresolved_exact_relationship`.
- Fixed stale overwrite reconstruction: `hasImmutableOverwriteProof` now requires the stored source and local fingerprints to still match the current source and local values. A concurrent local edit therefore remains a field-conflict review row and cannot become an overwrite operation.
- Automatic-review error codes now pass a strict bounded safe-code rule: lowercase letter first, then lowercase letters/digits/underscores only, maximum 64 characters. PII-bearing and oversized codes fall back to `automatic_review_failed` and are absent from captured logs.

### RED to GREEN

Unsafe logging codes were observed RED before the production rule:

```text
Test Files  1 failed (1)
Tests  2 failed | 69 passed (71)
```

Both failures showed the unsafe code emitted verbatim. After the bounded-code change:

```text
Test Files  1 passed (1)
Tests  71 passed (71)
```

The concurrent-edit manifest regression was observed RED before fingerprint validation:

```text
Test Files  1 failed (1)
Tests  1 failed | 25 passed (26)

Expected awaiting_review/field_conflict; received ready with an overwrite.
```

After validating current local/source fingerprints:

```text
Test Files  1 passed (1)
Tests  26 passed (26)
```

Combined focused API boundaries passed with 131 passed / 4 PostgreSQL-gated skipped tests. The real unsafe-remainder test also passed alone with the other 32 production-review tests skipped.

### Final fix-round verification

The exact brief command, which executes the complete API suite in this package, was rerun alone:

```text
$ pnpm --filter @workspace/api-server test -- automatic-review-resolver.test.ts review-command-service.test.ts review-sql-adapter.test.ts act-replacement.test.ts one-time-import.integration.test.ts production-review.test.ts

Test Files  51 passed | 1 skipped (52)
Tests  840 passed | 52 skipped (892)
Exit status 0
```

An earlier run launched concurrently with six other build/test/typecheck processes had one unrelated `manifest-digest.test.ts` 5-second performance timeout (839 passed / 52 skipped). The required isolated rerun above passed and is the authoritative result.

```text
$ pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx
Tests  47 passed (47)
Exit status 0

$ pnpm --filter @workspace/adventure-zone exec vitest run
Tests  88 passed (88)
Exit status 0
```

API and frontend builds passed. The frontend build retained its existing sourcemap-location and large-chunk warnings.

API typecheck again reported only `activity-import-service.test.ts(64,3)` and no fix-round diagnostic. Frontend typecheck reported only the established activity/contact repository and `OrganizationsPage.tsx:119` baselines. Workspace typecheck reproduced the API baseline first; libraries and scripts passed.

`TEST_DATABASE_URL` remained absent, so the expanded disposable-PostgreSQL case compiled and stayed gated for database-enabled CI. The production archive/matcher/resolver/rebuild/reader unsafe-remainder boundary ran without PostgreSQL.

## Fix round 2/5: one dependency-closed approval

### Finding and correction

The PostgreSQL flow previously applied the automatic safe approval before applying an explicit reviewed approval. That sequence is invalid: the safe apply exhausts its approval and moves the run to `complete`, while batch claim deliberately accepts only `ready_to_apply`, `applying`, or `complete_with_issues`. The second approval therefore could not be claimed and its overwrite/replay assertions were unreachable.

The flow now keeps the safe-default approval as a pre-apply boundary check, then creates one explicit approval selecting the safe operations plus the reviewed overwrite. Production `ActApprovalService` computes one dependency-closed approval (including the overwrite's safe link dependency), and the coordinator applies and replays only that combined approval. Natalie remains `Local Director` before apply, changes to `ACT Director` on apply, and the same stable target profile IDs and values remain after replay.

A non-PostgreSQL characterization exercises the real approval service, apply coordinator, apply service, and in-memory production repositories. Its RED form deliberately applied safe and reviewed approvals sequentially and failed on the second claim with `apply_run_not_claimable`:

```text
Test Files  1 failed (1)
Tests  1 failed | 33 skipped (34)
```

The corrected one-approval form passed:

```text
Test Files  1 passed (1)
Tests  1 passed | 33 skipped (34)
```

It asserts the real approval closure, a complete run after its one batch, and exact replay stability for target row IDs and values. The combined production-review and gated integration files passed with 35 passed / 4 PostgreSQL-gated skipped tests.

### Final fix-round verification

The exact focused-backend command again exercised the full API suite:

```text
$ pnpm --filter @workspace/api-server test -- automatic-review-resolver.test.ts review-command-service.test.ts review-sql-adapter.test.ts act-replacement.test.ts one-time-import.integration.test.ts production-review.test.ts

Test Files  51 passed | 1 skipped (52)
Tests  841 passed | 52 skipped (893)
Exit status 0
```

Frontend verification and builds:

```text
$ pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx
Tests  47 passed (47)
Exit status 0

$ pnpm --filter @workspace/adventure-zone exec vitest run
Tests  88 passed (88)
Exit status 0

$ pnpm --filter @workspace/api-server build
Exit status 0

$ pnpm --filter @workspace/adventure-zone build
1904 modules transformed; built in 5.18s
Exit status 0
```

The frontend build retained the established sourcemap-location and large-chunk warnings. API typecheck reported only the known `activity-import-service.test.ts(64,3)` optional `listNotesForContact` mismatch. Frontend typecheck reported only the established activity/contact repository and `OrganizationsPage.tsx:119` errors. Workspace typecheck stopped on that API baseline after libraries and scripts passed; no Fix 2 file produced a diagnostic.

`TEST_DATABASE_URL` remained absent. The corrected disposable-PostgreSQL scenario is present and gated, while the approval/coordinator/apply transition that caught the defect now runs without PostgreSQL.
