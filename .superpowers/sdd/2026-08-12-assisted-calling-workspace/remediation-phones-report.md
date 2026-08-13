# Remediation report — ACT phone normalization and durable destination-level DNC

## Status

Completed on the exact synthetic baseline `373d1df254bba83348ccb8668fb67d2b01e27c27` in
`/workspace/scratch/fd194ce465dc/remediation-repo`. No remote writes, deployment,
feature enablement, or production migration were performed. `ASSISTED_CALLING_ENABLED`
remains `false` in `render.yaml`.

Implementation commit: `731ec81` (`fix: preserve canonical phone suppression`).

## Root-cause findings

1. `DrizzleApplyRepository` wrote only `contacts.phone` for ACT contact create,
   direct write, fill-missing, and reviewed-overwrite paths. It never co-wrote
   `contacts.normalized_phone`, so exact lookup and the migration-022 legacy
   trigger could receive a null or stale normalized value.
2. Migration 022 matched `contact_phones` by raw display text and copied
   `NEW.normalized_phone`. A formatting-only rewrite could therefore miss the
   existing canonical destination, insert a new unsuppressed row, and leave the
   suppressed row separate.
3. Ordinary phone replacement validated IDs, ownership, primary count, and
   suppressed-row mutation/removal, but did not validate canonical normalized
   destinations. New rows and edits could duplicate an existing or suppressed
   destination.
4. Schema metadata and the database had only a non-unique normalized-number
   index, so concurrent or non-repository writers had no durable per-contact
   duplicate barrier.
5. Existing migration-022 state required repair, not only future trigger
   replacement: clearing a legacy phone returned early and could leave a stale
   primary row; a sole canonical-matching row could retain display text that no
   longer matched `contacts.phone`.
6. The original rollout query used null-safe equality between two stored
   normalized columns. A normalizable nonblank raw phone could therefore pass
   when both stored values were null, and blank contacts with stale primary rows
   were not checked.

## TDD evidence

### Initial product RED — normalization, duplicates, migration, schema

Command:

```text
pnpm --filter @workspace/api-server exec vitest run src/features/contact-phones/contact-phone-repository.test.ts src/features/act-replacement/drizzle-apply-repository.test.ts src/db/act-review-migrations.test.ts
```

Expected failure evidence: 3 test files failed; 9 tests failed and 44 passed.

- ACT create SQL omitted `normalized_phone`.
- ACT update/clear SQL omitted `normalized_phone`.
- ACT fill-missing SQL omitted `normalized_phone`.
- ACT reviewed overwrite SQL omitted `normalized_phone`.
- New, formatting-only edited, and suppressed canonical duplicates all resolved
  instead of rejecting.
- Migration 023 was absent.
- The canonical per-contact unique index was absent from schema metadata.

Focused GREEN after the minimal implementation:

```text
pnpm --filter @workspace/api-server exec vitest run src/features/contact-phones/contact-phone-repository.test.ts src/features/act-replacement/drizzle-apply-repository.test.ts src/db/act-review-migrations.test.ts
```

Result: 3 files passed; 53 tests passed; 1 conditional PostgreSQL test skipped.

### HTTP 400 RED/GREEN

RED command:

```text
pnpm --filter @workspace/api-server exec vitest run src/routes/contacts.test.ts -t "returns an actionable 400"
```

Expected failure evidence: expected HTTP 400, received HTTP 500; 1 failed and 7
skipped. The duplicate message was not yet classified as a validation error.

GREEN command: the same focused command.

Result: 1 passed and 7 skipped.

### Migration partial-state idempotency RED/GREEN

RED command:

```text
pnpm --filter @workspace/api-server exec vitest run src/db/act-review-migrations.test.ts -t "registers additive canonical-phone repair"
```

Expected failure evidence: the migration contained `CREATE UNIQUE INDEX` rather
than `CREATE UNIQUE INDEX IF NOT EXISTS`, so a partial schema state could prevent
the remaining repair from completing.

GREEN command: the same focused command.

Result: 1 passed and 7 skipped.

### SQL/JavaScript canonicalization parity RED/GREEN

RED command:

```text
pnpm --filter @workspace/api-server exec vitest run src/db/act-review-migrations.test.ts -t "registers additive canonical-phone repair"
```

Expected failure evidence: the SQL extension boundary used locale-sensitive
`[:alnum:]` rather than JavaScript's ASCII word domain.

GREEN command: the same focused command after changing the SQL boundary to
`[^A-Za-z0-9_]`.

Result: 1 passed and 7 skipped.

### Review-found legacy-state repair RED/GREEN

The first read-only completion review found that migration 023 corrected future
clear/rewrite behavior but did not apply that behavior to pre-existing
migration-022 drift. The behavior test was made unconditional with embedded
PGlite PostgreSQL before changing the migration.

RED command:

```text
pnpm --filter @workspace/api-server exec vitest run src/db/act-review-migrations.test.ts -t "collapses duplicates"
```

Expected failure evidence: the cleared legacy contact still had
`primary = true`; expected `false`.

GREEN command: the same focused command after adding explicit pre-trigger
reconciliation.

Result: 1 passed and 7 skipped. The test now executes migration 023 and verifies:

- deterministic duplicate collapse;
- DNC timestamp/reason retention;
- `call_sessions.phone_id` remapping;
- stale cleared-contact primary demotion;
- canonical-before-raw formatting reconciliation without DNC loss;
- unique-index rejection with PostgreSQL code `23505`;
- future trigger rewrite and clear behavior; and
- migration rerun idempotency.

### Database-bound ACT repository behavior

An unconditional PGlite test executes the real `DrizzleApplyRepository` against
migration 023. It verifies ACT create, normalized primary `contact_phones`, the
real `DrizzleContactRepository.findCallerExactMetadata` exact lookup, database
unique-index rejection, ACT phone update, and ACT phone clear. This closed the
review finding that rendered-SQL assertions alone did not prove the resulting
rows or caller lookup.

Focused command:

```text
pnpm --filter @workspace/api-server exec vitest run src/features/act-replacement/drizzle-apply-repository.test.ts -t "persists ACT phone create"
```

Result: 1 passed and 35 skipped.

## Final GREEN verification

Required amended-file command:

```text
pnpm --filter @workspace/api-server exec vitest run src/features/contact-phones/contact-phone-repository.test.ts src/features/act-replacement/drizzle-apply-repository.test.ts src/db/act-review-migrations.test.ts src/routes/contacts.test.ts
```

Fresh final result: 4 files passed; 63 tests passed; 0 skipped.

Expanded affected-area command:

```text
pnpm --filter @workspace/api-server exec vitest run src/features/contact-phones/contact-phone-repository.test.ts src/features/act-replacement/drizzle-apply-repository.test.ts src/features/act-replacement/apply-service.test.ts src/db/act-review-migrations.test.ts src/routes/contacts.test.ts src/features/contacts/contact-repository.test.ts src/features/caller-finder/caller-finder-service.test.ts src/features/calls/assisted-calling.integration.test.ts
```

Result: 8 files passed; 105 tests passed; 0 skipped.

Required typechecks:

```text
pnpm run typecheck:libs
pnpm --filter @workspace/api-server typecheck
```

Fresh final result: both exited 0. A forced project-reference rebuild was run
immediately beforehand after adding the optional Drizzle PGlite peer so stale
`.tsbuildinfo` could not retain the prior peer graph.

`git diff --check` also exited 0 before commit.

## Implementation details

- ACT contact create and all phone-changing update paths co-write canonical
  `normalized_phone`, including null on clear.
- Ordinary replacement canonicalizes all requested values before mutation and
  rejects any non-null destination collision with an actionable HTTP-400 message.
- Migration 023 implements the writer-supported North American canonicalization
  domain, replaces legacy compatibility triggers, repairs stored normalization,
  reconciles existing primary/display drift, merges duplicate DNC metadata,
  remaps call-session references, deletes only merged losers, and installs a
  partial unique index on `(contact_id, normalized_number)`.
- Keeper selection is deterministic: exact legacy display match, then primary,
  suppressed, legacy source, creation time, and UUID. The earliest DNC timestamp
  and all distinct nonblank reasons are retained.
- The compatibility trigger matches canonical destination before raw display
  text, updates/reuses the row without touching DNC fields, and demotes primary
  rows when the legacy phone clears.
- The runbook derives canonical normalization from raw phone and fails on null,
  mismatch, wrong/missing primary, display mismatch, and blank contacts retaining
  normalized/primary state.
- `@electric-sql/pglite` is a test-only API-server dependency used to make the
  PostgreSQL migration/repository behavior mandatory in normal focused tests.

## Files changed

- `artifacts/api-server/package.json`
- `artifacts/api-server/src/db/act-review-migrations.test.ts`
- `artifacts/api-server/src/features/act-replacement/drizzle-apply-repository.test.ts`
- `artifacts/api-server/src/features/act-replacement/drizzle-apply-repository.ts`
- `artifacts/api-server/src/features/contact-phones/contact-phone-repository.test.ts`
- `artifacts/api-server/src/features/contact-phones/contact-phone-repository.ts`
- `artifacts/api-server/src/routes/contacts.test.ts`
- `artifacts/api-server/src/routes/contacts.ts`
- `docs/assisted-calling-runbook.md`
- `lib/db/migrations/023_contact_phone_canonical_dnc.sql`
- `lib/db/src/migrations.ts`
- `lib/db/src/schema/index.ts`
- `pnpm-lock.yaml`

## Self-review

- Confirmed migrations 020-022 were not modified.
- Confirmed DNC columns are only merged during migration and never cleared by
  the compatibility trigger or ordinary replacement.
- Confirmed primary losers are demoted before keeper promotion, satisfying the
  existing immediate one-primary index.
- Confirmed call-session foreign keys are remapped before duplicate deletion.
- Confirmed the unique index is per contact and permits null normalized values.
- Confirmed clear behavior preserves historical suppressed rows while removing
  primary status and legacy normalization.
- Confirmed both contact phone routes classify the new error as HTTP 400.
- Confirmed `ASSISTED_CALLING_ENABLED=false` remains unchanged.
- Confirmed `.pnpm-home`, build output, and unrelated files were not staged.
- Independent read-only review initially found two Important issues (existing
  drift repair and optional database coverage); both were fixed. Follow-up review
  reported no remaining Critical or Important findings.

## Concerns

- No external `TEST_DATABASE_URL` was available. The database-bound tests run
  unconditionally on PGlite's embedded PostgreSQL/WASM engine and execute the
  complete migration and Drizzle repositories; the controller may additionally
  exercise migration 023 on its disposable PostgreSQL environment.
- Migration 023 is intentionally additive and has not been applied to any
  production database.

## Final fix wave — atomic distinct primary edit

### Status and scope

Completed from the reviewed combined head `af3c393` in the remediation checkout.
No remote write, deployment, feature enablement, or production database change
was performed. The local implementation commit is `1f6e422` (`fix: coordinate
atomic primary phone edits`).

The fix is intentionally confined to atomic contact-edit coordination and its
database-bound regression coverage. Migration 023, canonical uniqueness, DNC
storage, and assisted-calling feature configuration were not changed.

### Root cause

The atomic `PUT /contacts/:id` transaction updated `contacts.phone` before
replacing `contact_phones`. Migration 023's legacy compatibility trigger
immediately created and promoted destination B. `replaceForContact` then received
the UI's original destination-A row ID, saw the trigger-created B row as a
different canonical duplicate, and returned HTTP 400. The same premature B row
also caused a suppressed A→B attempt to report the duplicate error before the
suppressed-row immutability error.

### Strict TDD evidence

The new regression mounts the actual contacts router on Express, injects a real
Drizzle PGlite database, executes migration 023 and its triggers, and leaves the
actual `DrizzleContactRepository` and contact-phone repository unmocked.
`ASSISTED_CALLING_ENABLED` is explicitly `false` for the suite.

Product RED was run against `af3c393` before any production edit:

```text
env CI=true XDG_DATA_HOME=/tmp/remediation-xdg PNPM_HOME=/tmp/remediation-pnpm pnpm --filter @workspace/api-server exec vitest run src/routes/contacts.atomic-pglite.test.ts
```

Expected product failure: 1 test file failed; 2 tests failed and 1 passed.

- The legitimate A→distinct-B request expected HTTP 200 and received HTTP 400.
- The suppressed A→B request received the canonical-duplicate message instead
  of the suppressed-number immutability message.
- The database rollback fixture already passed.

After the coordination fix, the same command was run with the completed four-test
suite. GREEN result: 1 test file passed; 4 tests passed; 0 skipped. It verifies:

- real HTTP A→B success with exactly one primary B row;
- canonical B and legacy `phone`/`normalized_phone` mirroring;
- saved-primary authority when the redundant legacy payload disagrees;
- operation while assisted calling is disabled;
- suppressed destination immutability and contact-field rollback; and
- rollback of an already-completed phone replacement when the subsequent
  contact-field update fails.

The ACT-created-phone database test now calls the real quick-caller exact gate
with the reformatted equivalent `701.555.0199`:

```text
env CI=true XDG_DATA_HOME=/tmp/remediation-xdg PNPM_HOME=/tmp/remediation-pnpm pnpm --filter @workspace/api-server exec vitest run src/features/act-replacement/drizzle-apply-repository.test.ts -t "persists ACT phone create"
```

Result: 1 test passed and 35 tests skipped. The gate resolved `true`, proving the
reformatted ACT-created destination blocks quick-caller creation.

### Final GREEN verification

Focused amended suite:

```text
env CI=true XDG_DATA_HOME=/tmp/remediation-xdg PNPM_HOME=/tmp/remediation-pnpm pnpm --filter @workspace/api-server exec vitest run src/features/contact-phones/contact-phone-repository.test.ts src/features/act-replacement/drizzle-apply-repository.test.ts src/db/act-review-migrations.test.ts src/routes/contacts.test.ts src/routes/contacts.atomic-pglite.test.ts
```

Fresh result immediately before the fix commit: 5 test files passed; 67 tests
passed; 0 skipped.

Expanded affected-area suite:

```text
env CI=true XDG_DATA_HOME=/tmp/remediation-xdg PNPM_HOME=/tmp/remediation-pnpm pnpm --filter @workspace/api-server exec vitest run src/features/contact-phones/contact-phone-repository.test.ts src/features/act-replacement/drizzle-apply-repository.test.ts src/features/act-replacement/apply-service.test.ts src/db/act-review-migrations.test.ts src/routes/contacts.test.ts src/routes/contacts.atomic-pglite.test.ts src/features/contacts/contact-repository.test.ts src/features/contacts/quick-caller-service.test.ts src/routes/calls-quick-caller.test.ts src/features/caller-finder/caller-finder-service.test.ts src/features/calls/assisted-calling.integration.test.ts
```

Result: 11 test files passed; 118 tests passed; 0 skipped.

Required API typecheck:

```text
env CI=true XDG_DATA_HOME=/tmp/remediation-xdg PNPM_HOME=/tmp/remediation-pnpm pnpm --filter @workspace/api-server typecheck
```

Fresh result immediately before the fix commit: `tsc -p tsconfig.json --noEmit`
exited 0. `git diff --cached --check` also exited 0.

### Implementation

- The atomic route replaces and validates phone rows first inside the existing
  outer database transaction.
- It derives the legacy contact phone from the primary row actually returned by
  `replaceForContact`, making the saved phone collection the sole authority even
  if a client sends inconsistent redundant legacy data.
- It then updates the remaining contact fields using that derived primary. A
  missing contact or any later failure aborts the outer transaction and rolls
  back the phone replacement.
- Suppression checks and canonical duplicate checks remain unchanged and execute
  before the contact-field repository call.
- The existing mocked route test now asserts replacement-before-contact ordering
  and that a rejected suppression operation never reaches the contact update.

### Files changed in `1f6e422`

- `artifacts/api-server/src/features/act-replacement/drizzle-apply-repository.test.ts`
- `artifacts/api-server/src/routes/contacts.atomic-pglite.test.ts`
- `artifacts/api-server/src/routes/contacts.test.ts`
- `artifacts/api-server/src/routes/contacts.ts`

### Self-review

- Confirmed migration 023 and schema/index definitions are unchanged.
- Confirmed the route does not write, clear, or merge DNC fields.
- Confirmed the per-contact canonical unique index remains the database safety
  boundary and no duplicate validation was relaxed.
- Confirmed suppressed mutation rejection retains the original phone, DNC reason,
  legacy fields, and unrelated contact fields.
- Confirmed a forced failure after replacement restores both legacy and phone-row
  state through the outer transaction.
- Confirmed the saved primary, not redundant `contact.phone` input, determines
  the legacy mirror and empty phone collections mirror null.
- Confirmed the route remains available with assisted calling disabled.
- Confirmed `.pnpm-home` and unrelated/generated files were not staged.
- An independent read-only review reported no Critical or Important findings and
  assessed the fix ready to commit.

### Final-wave concerns

- The route module statically imports activity code used only by contact-detail
  GET. Vitest does not apply the API build's `zod` → `zod/v4` alias, so the new
  PUT-focused integration test stubs only the unused activity service and
  repository imports. The atomic route plus both persistence repositories are
  real; this does not weaken the database behavior under test.
- PGlite supplies the mandatory embedded PostgreSQL behavior test. No external
  PostgreSQL instance or production database was accessed.
- No functional concern remains from the scoped review.
