# Remaining Act Review Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix whole-review Important findings #3–#5 and Minor #1 without weakening overwrite proof, atomic rebuilds, relationship decisions, or owner isolation.

**Architecture:** Keep ownership at the HTTP boundary, but move selected source/version validation to the existing locked bulk transaction and remove manifest/source N+1 reads. Build deterministic lookup indexes before durable replay loops, remediate legacy invalid decision pairs in a new migration, and bind individual decision request keys to canonical fingerprints stored with each durable decision.

**Tech Stack:** TypeScript 5.9, Express 5, Zod, Drizzle ORM, PostgreSQL, Vitest, pnpm.

## Global Constraints

- Work at current HEAD in `/workspace/scratch/a6a7e2ba3bf7/act-safe-review-impl`.
- Preserve overwrite tokens, atomic apply/rebuild behavior, relationship decisions, and owner isolation.
- Do not modify applied migration `014_act_review_bulk_decisions.sql`.
- Every production change follows a witnessed RED then minimal GREEN cycle.
- Database-only tests may skip only when `TEST_DATABASE_URL` is unavailable.

---

### Task 1: Bounded bulk ownership and source validation

**Files:**
- Modify: `artifacts/api-server/src/routes/act-replacement.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-command-service.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.ts`
- Test: `artifacts/api-server/src/routes/act-replacement.test.ts`
- Test: `artifacts/api-server/src/features/act-replacement/review-command-service.test.ts`
- Test: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.test.ts`

**Interfaces:**
- Consumes: authenticated `runId`, owner scope, at most 200 `{ sourceRecordId, sourceVersionId }` selections.
- Produces: one owner lookup at the route and one ordered `FOR UPDATE` selected-source query in the atomic command transaction.

- [ ] **Step 1: Write failing query-count and behavior tests**

Add a route test with 200 selections that expects `findOwnedRun` once, `reader.getManifest` zero times, and `bulkDecide` once. Add a command/store test proving no per-selection `getSource` calls occur before `saveDecisionsAndRebuild`, while the SQL adapter still rejects one stale version before any decision insert.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @workspace/api-server test -- src/routes/act-replacement.test.ts src/features/act-replacement/review-command-service.test.ts src/features/act-replacement/review-sql-adapter.test.ts`

Expected: route manifest count and command source lookup assertions fail against the N+1 implementation.

- [ ] **Step 3: Implement the minimal bounded path**

Remove the route’s `ownedSource` loop for bulk requests. Pass bulk selections into the atomic store operation, build the decision inputs from one manifest plus the locked selected-source rows, and retain the existing digest, owner, version, applicability, homogeneity, token, rollback, and single-rebuild checks.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command and require zero failures.

### Task 2: Near-linear durable replay and manifest construction

**Files:**
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/manifest-builder.ts`
- Test: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.test.ts`
- Test: `artifacts/api-server/src/features/act-replacement/manifest-builder.test.ts`

**Interfaces:**
- Consumes: archive rows, assignments, decisions, roots, local candidates, and manifest sources.
- Produces: the same sorted manifest inputs and digest using maps keyed by source ID/version, target type/ID, and local candidate ID.

- [ ] **Step 1: Write deterministic complexity regressions**

Create instrumented production-sized fixtures at `N` and `2N` whose `sourceRecordId` getters count lookups. Assert doubling input remains below a 3x lookup ratio for replay projection and parent manifest construction.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @workspace/api-server test -- src/features/act-replacement/review-sql-adapter.test.ts src/features/act-replacement/manifest-builder.test.ts`

Expected: current repeated `filter`/`find` scans produce an approximately quadratic ratio above the bound.

- [ ] **Step 3: Pre-index before loops**

Build source, root, decision, assignment, and candidate maps once in `manifestSourcesFromArchiveRows`, and build a source map once in `buildActOrganizeManifest`. Replace repeated full-array scans with keyed lookups while preserving sorting and exact matching semantics.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command and require zero failures.

### Task 3: Legacy invalid decision-pair remediation

**Files:**
- Create: `lib/db/migrations/018_act_review_decision_integrity.sql`
- Test: `artifacts/api-server/src/features/act-replacement/organize-schema-contract.test.ts`

**Interfaces:**
- Consumes: legacy rows admitted before validation of `act_replacement_review_decisions_scope_decision_valid`.
- Produces: inactive superseded rows with `superseded_at` and `superseded_by = 'migration:018_invalid_scope_decision'`, a released active unique key, and a validated pair constraint.

- [ ] **Step 1: Write failing static and PostgreSQL upgrade tests**

Read migration 018 and require explicit quarantine provenance plus `VALIDATE CONSTRAINT`. In the PostgreSQL-gated suite, seed every invalid scope/decision pair as active, apply the migration, verify all are inactive/superseded, verify the constraint is validated, and verify future invalid inserts fail.

- [ ] **Step 2: Run the contract test and verify RED**

Run: `pnpm --filter @workspace/api-server test -- src/features/act-replacement/organize-schema-contract.test.ts`

Expected: migration 018 is missing.

- [ ] **Step 3: Add the forward-only migration**

Within one transaction, update invalid rows before constraint validation, drop/re-add the pair check as `NOT VALID` using the latest valid relationship set including `assign_parent`, and issue `ALTER TABLE ... VALIDATE CONSTRAINT`.

- [ ] **Step 4: Run the contract test and verify GREEN**

Run the Step 2 command; report PostgreSQL skips if `TEST_DATABASE_URL` is absent.

### Task 4: Strict individual request contracts and replay fingerprints

**Files:**
- Modify: `artifacts/api-server/src/routes/act-replacement.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-command-service.ts`
- Modify: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/db/migrations/018_act_review_decision_integrity.sql`
- Test: `artifacts/api-server/src/routes/act-replacement.test.ts`
- Test: `artifacts/api-server/src/features/act-replacement/review-command-service.test.ts`
- Test: `artifacts/api-server/src/features/act-replacement/review-sql-adapter.test.ts`
- Test: `artifacts/api-server/src/features/act-replacement/organize-schema-contract.test.ts`

**Interfaces:**
- Consumes: strict UUID path/body identifiers and discriminated decision bodies.
- Produces: `individualDecisionRequestFingerprint(...)` and durable `request_fingerprint`; exact replay returns the original row, changed payload with the same key returns `request_replay_mismatch` (409).

- [ ] **Step 1: Write failing route and replay-collision tests**

Exercise unknown keys, malformed UUIDs, invalid scope/decision field shapes, exact replay, and same-key changed decision/version/target payload. Assert invalid routes never invoke commands and mismatched replay returns 409 without rebuilding.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @workspace/api-server test -- src/routes/act-replacement.test.ts src/features/act-replacement/review-command-service.test.ts src/features/act-replacement/review-sql-adapter.test.ts src/features/act-replacement/organize-schema-contract.test.ts`

Expected: loose route bodies accept extra/malformed values and durable decision lookup returns the prior row without comparing payload.

- [ ] **Step 3: Implement strict schemas and fingerprint binding**

Replace ad-hoc individual route checks with strict Zod schemas and UUID path/body parsing. Canonically hash semantic decision fields, persist the hash, compare it before idempotent replay, and fail closed for unverifiable legacy rows.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Step 2 command and require zero failures.

### Task 5: Full verification and focused commit

**Files:**
- Verify all modified files only; preserve unrelated changes.

- [ ] **Step 1: Run API tests**

Run: `pnpm --filter @workspace/api-server test`

- [ ] **Step 2: Run workspace typecheck**

Run: `pnpm typecheck`

- [ ] **Step 3: Run frontend tests if the API contract affects generated/client code**

Run when affected: `pnpm --filter @workspace/adventure-zone test`

- [ ] **Step 4: Inspect the final diff and migration invariants**

Run: `git diff --check && git status --short && git diff --stat && git diff -- lib/db/migrations/014_act_review_bulk_decisions.sql`

Expected: no whitespace errors, only scoped files changed, and migration 014 has no diff.

- [ ] **Step 5: Commit focused changes**

Run: `git add <scoped files> && git commit -m "fix(act-review): close remaining safety findings"`
