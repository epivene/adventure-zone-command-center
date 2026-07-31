# Act! Reviewed Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply approved Act! preview proposals through a resumable, idempotent importer that adds first-class calling lists and preserves unresolved work for review.

**Architecture:** Extend the existing immutable preview with narrowly scoped bulk decisions, freeze approved decisions into digest-checked apply operations, and execute dependency-ordered targets through durable leased queues. Entity-specific repositories own CRM mutations and canonical Act! links; the orchestration service owns batching, retries, reconciliation, and count-only status.

**Tech Stack:** TypeScript 6, Next.js 16 App Router/server actions, React 19, Drizzle ORM, PostgreSQL, Zod 4, Vitest, Testing Library, Playwright.

## Global Constraints

- Apply reads only the selected immutable snapshot and never rereads Act!.
- `ACT_MIGRATION_APPLY_ENABLED` defaults to disabled unless its exact value is `true`.
- Only the configured owner may review, schedule, continue, or retry apply work.
- Bulk approval is limited to collision-free `new` and dependency-ready `new_relationship` proposals.
- Every Act! Group requires an individual `confirm_static_group` decision before static import; Group decisions are never bulk-approved.
- A decision freezes when its apply operation is scheduled.
- Apply requests claim at most 25 operations; bulk decision requests affect at most 100 proposals.
- Contact consolidation retains exactly one primary two-way link; every other Contact link is pull-only.
- Source absence never deletes or deactivates local CRM data.
- Logs and public errors contain no source snapshots, credentials, names, contact values, addresses, or free-text decision reasons.
- Every behavior change follows RED → GREEN → REFACTOR, with the named failing test run before implementation.

---

### Task 1: Domain contracts, apply feature flag, and dynamic-list validation

**Files:**
- Create: `features/calling-lists/calling-list-filter.ts`
- Modify: `features/act-migration/migration-types.ts`
- Modify: `features/act-migration/action-limits.ts`
- Modify: `lib/env.ts`
- Modify: `.env.example`
- Modify: `render.yaml`
- Test: `tests/unit/calling-list-filter.test.ts`
- Test: `tests/unit/act-migration-types.test.ts`
- Test: `tests/unit/act-env.test.ts`

**Interfaces:**
- Produces: `CallingListFilterV1`, `callingListFilterV1Schema`, `parseCallingListFilterV1(value)`.
- Produces: `migrationApplyBatchStatusValues`, `migrationApplyOperationStatusValues`, and the extended run/decision values.
- Produces: `parseActMigrationApplyEnabled(source): boolean` and `isActMigrationApplyEnabled()`.
- Produces: `ACT_MIGRATION_APPLY_BATCH_SIZE = 25` and `ACT_MIGRATION_BULK_DECISION_SIZE = 100`.

- [ ] **Step 1: Write failing contract and filter tests**

```ts
expect(migrationDecisionValues).toContain("confirm_static_group");
expect(actMigrationRunStatusValues).toEqual(expect.arrayContaining([
  "applying", "partially_applied", "applied",
]));
expect(parseActMigrationApplyEnabled({ ACT_MIGRATION_APPLY_ENABLED: "true" }))
  .toBe(true);
expect(parseActMigrationApplyEnabled({ ACT_MIGRATION_APPLY_ENABLED: "TRUE" }))
  .toBe(false);
expect(parseCallingListFilterV1({
  version: 1,
  entity: "person",
  where: {
    op: "predicate",
    field: "place.region",
    operator: "eq",
    value: "MT",
  },
})).toMatchObject({ version: 1, entity: "person" });
expect(() => parseCallingListFilterV1({
  version: 1,
  entity: "person",
  where: { op: "predicate", field: "person.email", operator: "eq", value: "x" },
})).toThrow();
```

- [ ] **Step 2: Run the focused tests and verify the expected missing-export failures**

Run: `npx vitest run tests/unit/calling-list-filter.test.ts tests/unit/act-migration-types.test.ts tests/unit/act-env.test.ts`

Expected: FAIL because the filter module, apply statuses, decision, constants, and feature-flag parser do not exist.

- [ ] **Step 3: Add the minimal recursive Zod schema and domain constants**

```ts
export const callingListPredicateFields = [
  "person.city", "person.region", "person.job_title",
  "place.id", "place.place_type", "place.city", "place.region",
] as const;

export const migrationApplyOperationStatusValues = [
  "pending", "leased", "blocked", "applied", "ignored", "failed",
] as const;

export function parseActMigrationApplyEnabled(source: EnvironmentSource) {
  return source.ACT_MIGRATION_APPLY_ENABLED === "true";
}
```

Build `callingListFilterV1Schema` with `z.lazy`, maximum depth 8, maximum 50 clauses, strict objects, exact predicate value shapes, and no empty `and`/`or` clause arrays. Add `ACT_MIGRATION_APPLY_ENABLED` to `render.yaml` with `value: "false"` and to `.env.example` as `false`.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run tests/unit/calling-list-filter.test.ts tests/unit/act-migration-types.test.ts tests/unit/act-env.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/calling-lists/calling-list-filter.ts features/act-migration/migration-types.ts features/act-migration/action-limits.ts lib/env.ts .env.example render.yaml tests/unit/calling-list-filter.test.ts tests/unit/act-migration-types.test.ts tests/unit/act-env.test.ts
git commit -m "feat: define reviewed migration apply contracts"
```

---

### Task 2: Calling-list and apply-queue database foundation

**Files:**
- Modify: `db/schema.ts`
- Create: `db/migrations/0010_act_reviewed_import.sql`
- Create: `db/migrations/meta/0010_snapshot.json`
- Modify: `db/migrations/meta/_journal.json`
- Create: `tests/integration/act-reviewed-import-migration.test.ts`
- Modify: `tests/unit/schema-contract.test.ts`

**Interfaces:**
- Produces schema exports: `callingLists`, `callingListMemberships`, `actMigrationApplyBatches`, `actMigrationApplyOperations`.
- Extends `act_migration_runs.status` and `act_migration_proposals.decision` checks with Task 1 values.
- Apply-operation uniqueness: `(run_id, proposal_key)`.
- Membership uniqueness: `(calling_list_id, contact_id)`.

- [ ] **Step 1: Write the failing migration test**

The test applies migrations through `0009`, inserts representative CRM and preview history, applies `0010`, and asserts:

```ts
expect(await tx`select status from act_migration_runs where id = ${runId}`)
  .toEqual([{ status: "previewed" }]);
await expect(tx`insert into calling_lists (name, kind) values ('Bad', 'dynamic')`)
  .rejects.toMatchObject({ code: "23514" });
await tx`insert into calling_lists (id, name, kind) values (${listId}, 'Fair leads', 'static')`;
await tx`insert into calling_list_memberships (calling_list_id, contact_id) values (${listId}, ${contactId})`;
await expect(tx`insert into calling_list_memberships (calling_list_id, contact_id) values (${listId}, ${contactId})`)
  .rejects.toMatchObject({ code: "23505" });
```

Also assert all legacy Organizations, Contacts, Bookings, relationships, activities, calls, packages, preview records, and external links are byte-for-byte unchanged.

- [ ] **Step 2: Run the PostgreSQL migration test and verify it fails**

Run: `npx vitest run tests/integration/act-reviewed-import-migration.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: FAIL because migration `0010` and schema exports are missing. If `CRM_TEST_DATABASE_URL` is unset, run the established secure disposable-database gate wrapper rather than treating a skip as success.

- [ ] **Step 3: Add Drizzle tables and generate migration metadata**

Implement the four tables exactly as specified, including these checks:

```sql
CHECK ((kind = 'static' AND filter_version IS NULL AND filter_definition IS NULL)
    OR (kind = 'dynamic' AND filter_version = 1 AND jsonb_typeof(filter_definition) = 'object'));
CHECK (attempt_count >= 0);
CHECK ((status = 'leased') = (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL));
```

Use `npx drizzle-kit generate --name act_reviewed_import`, rename only if the generated numeric tag differs, and review the generated SQL before tests. Add indexes for runnable operation claims, run/batch lookup, active memberships, and dynamic-list kind.

- [ ] **Step 4: Add schema-contract assertions and rerun the migration test**

Run: `npx vitest run tests/integration/act-reviewed-import-migration.test.ts tests/unit/schema-contract.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: PASS with no skipped database assertion in the disposable-database gate.

- [ ] **Step 5: Commit**

```bash
git add db/schema.ts db/migrations/0010_act_reviewed_import.sql db/migrations/meta/0010_snapshot.json db/migrations/meta/_journal.json tests/integration/act-reviewed-import-migration.test.ts tests/unit/schema-contract.test.ts
git commit -m "feat: add calling list and migration apply tables"
```

---

### Task 3: Group confirmation and calling-list preview proposals

**Files:**
- Modify: `features/act-migration/migration-types.ts`
- Modify: `features/act-migration/matcher.ts`
- Modify: `features/act-migration/preview-repository.ts`
- Test: `tests/unit/act-migration-types.test.ts`
- Test: `tests/unit/act-migration-matcher.test.ts`
- Test: `tests/integration/act-migration-preview-repository.test.ts`

**Interfaces:**
- `allowedDecisionsForProposal()` returns `confirm_static_group` only for a `calling_list` with `group_membership_semantics_unknown`.
- A Group proposal becomes `needs_review`, not `ignored`.
- Group membership proposals become `new_relationship` with the Group and Person dependency keys, but remain apply-blocked until the Group is confirmed static.
- `saveDecision()` validates `confirm_static_group` target, issue, candidates, and source ownership.

- [ ] **Step 1: Write failing decision and matcher tests**

```ts
expect(allowedDecisionsForProposal({
  state: "needs_review",
  targetEntityType: "calling_list",
  issueCode: "group_membership_semantics_unknown",
  candidateLocalIds: [],
})).toEqual(["confirm_static_group", "ignore"]);

expect(groupProposal).toMatchObject({
  state: "needs_review",
  targetEntityType: "calling_list",
  issueCode: "group_membership_semantics_unknown",
});
expect(memberProposal).toMatchObject({
  state: "new_relationship",
  targetEntityType: "calling_list_member",
  dependencyProposalKeys: expect.arrayContaining([
    groupProposal.proposalKey,
    contactProposal.proposalKey,
  ]),
});
```

- [ ] **Step 2: Run focused tests and verify current `ignored` behavior fails them**

Run: `npx vitest run tests/unit/act-migration-types.test.ts tests/unit/act-migration-matcher.test.ts tests/integration/act-migration-preview-repository.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: FAIL because Groups are currently stored as `ignored` and the new decision is rejected.

- [ ] **Step 3: Implement the narrow Group decision path**

Do not add an undocumented static/dynamic heuristic. Keep normalized Group semantics `unknown`; use the owner decision as the only static authority. Save `confirm_static_group` with `review_state = 'decided'`, no free-text reason, and an audit snapshot containing decision, actor, timestamp, and source ID only.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/unit/act-migration-types.test.ts tests/unit/act-migration-matcher.test.ts tests/integration/act-migration-preview-repository.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/act-migration/migration-types.ts features/act-migration/matcher.ts features/act-migration/preview-repository.ts tests/unit/act-migration-types.test.ts tests/unit/act-migration-matcher.test.ts tests/integration/act-migration-preview-repository.test.ts
git commit -m "feat: require static Act group confirmation"
```

---

### Task 4: Server-authorized bulk review

**Files:**
- Create: `features/act-migration/bulk-review.ts`
- Modify: `features/act-migration/preview-repository.ts`
- Modify: `features/act-migration/preview-service.ts`
- Test: `tests/unit/act-migration-bulk-review.test.ts`
- Test: `tests/integration/act-migration-preview-repository.test.ts`

**Interfaces:**
- Produces `BulkReviewScope` with `runId`, target, state, optional issue, decision, reason, and actor.
- Produces `bulkReviewEligibility(proposal, dependencyStates): boolean`, where
  dependency state includes applied entity IDs and frozen parent decisions.
- Adds `ActMigrationPreviewRepository.saveBulkDecision(input): Promise<{ changed: number; remaining: number }>`.
- Scheduled proposals are rejected by both individual and bulk decision updates.

- [ ] **Step 1: Write failing eligibility and repository tests**

```ts
expect(bulkReviewEligibility(newPlace, new Set())).toBe(true);
expect(bulkReviewEligibility(changePlace, new Set())).toBe(false);
expect(bulkReviewEligibility(groupAwaitingConfirmation, new Set())).toBe(false);
expect(bulkReviewEligibility(newRelationship, resolved(parentKeys))).toBe(true);
expect(bulkReviewEligibility(newRelationship, unresolved())).toBe(false);
expect(bulkReviewEligibility(groupMembership, confirmedStaticGroupParent())).toBe(true);
expect(bulkReviewEligibility(groupMembership, unconfirmedGroupParent())).toBe(false);
```

The PostgreSQL test races two bulk approvals and asserts at most 100 unique rows change, audit count equals changed count, no ineligible row changes, and a second semantic retry reports zero changes.

- [ ] **Step 2: Run focused tests and verify missing bulk APIs fail**

Run: `npx vitest run tests/unit/act-migration-bulk-review.test.ts tests/integration/act-migration-preview-repository.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: FAIL because eligibility and `saveBulkDecision` do not exist.

- [ ] **Step 3: Implement bounded locked selection**

Use one transaction, filter by the server-owned scope, order by target rank and proposal key, `FOR UPDATE SKIP LOCKED`, limit 100, recalculate eligibility from locked rows, update only eligible rows, mirror review state to staged records, and insert one audit row per changed proposal. A `calling_list_member` carrying `group_membership_semantics_unknown` becomes eligible only when its locked Group parent has the frozen `confirm_static_group` decision. Bulk ignore requires a trimmed reason; bulk approve never accepts browser-supplied proposal IDs.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/unit/act-migration-bulk-review.test.ts tests/integration/act-migration-preview-repository.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/act-migration/bulk-review.ts features/act-migration/preview-repository.ts features/act-migration/preview-service.ts tests/unit/act-migration-bulk-review.test.ts tests/integration/act-migration-preview-repository.test.ts
git commit -m "feat: add bounded migration bulk review"
```

---

### Task 5: Immutable apply manifests and reconciliation states

**Files:**
- Create: `features/act-migration/apply-types.ts`
- Create: `features/act-migration/apply-manifest.ts`
- Test: `tests/unit/act-migration-apply-manifest.test.ts`

**Interfaces:**
- Produces `MigrationApplyManifest`, `MigrationApplyManifestEntry`, `MigrationApplyCounts`.
- Produces `buildMigrationApplyManifest(input)` and `migrationApplyManifestDigest(manifest)`.
- Entries snapshot proposal key, decision, chosen local ID, primary source ID, target, source keys, dependencies, and operation rank.
- Automatically reconciled `matched_unchanged` proposals must already own valid stable links and produce no mutation operation.

- [ ] **Step 1: Write failing manifest tests**

```ts
const first = buildMigrationApplyManifest(input);
const replay = buildMigrationApplyManifest({ ...input, proposals: [...input.proposals].reverse() });
expect(replay.digest).toBe(first.digest);
expect(first.entries.map((entry) => entry.targetEntityType)).toEqual([
  "organization", "contact", "organization_contact", "booking",
  "booking_contact", "calling_list", "calling_list_member",
]);
expect(() => buildMigrationApplyManifest(withChangedProposalDigest(input)))
  .toThrow("preview digest");
expect(() => buildMigrationApplyManifest(withUnconfirmedGroup(input)))
  .toThrow("static Group confirmation");
```

- [ ] **Step 2: Run the test and verify missing-module failure**

Run: `npx vitest run tests/unit/act-migration-apply-manifest.test.ts`

Expected: FAIL because the manifest module does not exist.

- [ ] **Step 3: Implement canonical manifests**

Canonicalize object keys, sort entries by target rank and proposal key, validate dependencies are present or already resolved, exclude ignored/pending/failed-preview proposals from runnable entries while retaining them in counts, and SHA-256 hash the canonical JSON. Refuse source/proposal digest mismatches and matched-unchanged rows without canonical links.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/unit/act-migration-apply-manifest.test.ts tests/unit/act-migration-reconciliation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/act-migration/apply-types.ts features/act-migration/apply-manifest.ts tests/unit/act-migration-apply-manifest.test.ts tests/unit/act-migration-reconciliation.test.ts
git commit -m "feat: build immutable migration apply manifests"
```

---

### Task 6: Durable apply queue, leases, and batch lifecycle

**Files:**
- Create: `features/act-migration/apply-repository.ts`
- Create: `tests/integration/act-migration-apply-repository.test.ts`

**Interfaces:**
- Produces `ActMigrationApplyRepository` with `createBatchIfAbsent`, `claimNextOperation`, `completeOperation`, `failOperation`, `releaseExpiredLeases`, and `getApplyWorkspace`.
- Produces `DrizzleActMigrationApplyRepository`.
- `createBatchIfAbsent` freezes decisions by inserting unique operations in the same transaction as the batch manifest.
- Claims use `FOR UPDATE SKIP LOCKED`, target rank, proposal key, and a two-minute lease.

- [ ] **Step 1: Write the failing PostgreSQL lifecycle tests**

Cover request-key replay, conflicting request-key/run reuse, decision freeze, two concurrent claimers, lease expiry, dependency blocking, retryable failure, deterministic failure, batch count summaries, and run status transitions.

```ts
expect(await Promise.all([
  repository.claimNextOperation(batchId, "worker-a", now),
  repository.claimNextOperation(batchId, "worker-b", now),
])).toSatisfyDistinctClaims();
await expect(previews.saveDecision(changingScheduledDecision))
  .rejects.toThrow("scheduled");
```

- [ ] **Step 2: Run and verify missing repository failure**

Run: `npx vitest run tests/integration/act-migration-apply-repository.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: FAIL because the apply repository does not exist.

- [ ] **Step 3: Implement transactional queue operations**

Lock the run before batch creation; require a complete preview and matching digest; insert batch and operations with conflict checks; update run status atomically. Claim only dependency-ready operations, mark unresolved children `blocked`, and recompute batch/run counts after every terminal transition. Store only sanitized error codes.

- [ ] **Step 4: Run concurrency tests**

Run: `npx vitest run tests/integration/act-migration-apply-repository.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: PASS with no deadlock or duplicate claim.

- [ ] **Step 5: Commit**

```bash
git add features/act-migration/apply-repository.ts tests/integration/act-migration-apply-repository.test.ts
git commit -m "feat: add resumable migration apply queue"
```

---

### Task 7: Place and Person apply handlers with canonical external links

**Files:**
- Create: `features/act-migration/entity-apply-repository.ts`
- Create: `tests/integration/act-migration-entity-apply.test.ts`

**Interfaces:**
- Produces `MigrationEntityApplyRepository.applyOrganization(operation)`.
- Produces `MigrationEntityApplyRepository.applyContact(operation)`.
- Returns `{ entityId: string; changed: boolean }` and suppresses duplicate audits on semantic retry.
- Loads normalized staged records by operation source keys; never uses display snapshots as write input.

- [ ] **Step 1: Write failing Organization and Contact tests**

Cover new, approved change, link-existing preservation, keep-separate, folded company-only Contact data, source-owner conflicts, repeated apply, concurrent apply, primary Contact selection, pull-only aliases, direct compatibility Act ID mirrors, and no operational-field overwrite.

```ts
expect(await repository.applyContact(consolidatedOperation)).toEqual({
  entityId: personId,
  changed: true,
});
expect(await linksFor(personId)).toEqual([
  expect.objectContaining({ actRecordId: primaryId, isPrimary: true, syncMode: "two_way" }),
  expect.objectContaining({ actRecordId: aliasId, isPrimary: false, syncMode: "pull_only" }),
]);
```

- [ ] **Step 2: Run and verify missing handler failure**

Run: `npx vitest run tests/integration/act-migration-entity-apply.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: FAIL because the entity apply repository does not exist.

- [ ] **Step 3: Implement locked idempotent entity writes**

For each operation, lock the proposal, staged records, candidate entity when present, and relevant external-link identities in deterministic order. Apply only normalized mapped fields. Use existing phone normalization. Create/verify canonical links and compatibility mirrors in the same transaction. Audit run ID, proposal key, actor, changed mapped fields, and source IDs without contact values.

- [ ] **Step 4: Run entity apply tests**

Run: `npx vitest run tests/integration/act-migration-entity-apply.test.ts tests/integration/act-import-drizzle.test.ts tests/integration/act-sync-apply.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: PASS, proving legacy import and Contact sync authority remain intact.

- [ ] **Step 5: Commit**

```bash
git add features/act-migration/entity-apply-repository.ts tests/integration/act-migration-entity-apply.test.ts
git commit -m "feat: apply reviewed Act places and people"
```

---

### Task 8: Booking and CRM relationship apply handlers

**Files:**
- Create: `features/act-migration/relationship-apply-repository.ts`
- Create: `tests/integration/act-migration-relationship-apply.test.ts`

**Interfaces:**
- Produces handlers for `organization_contact`, `booking`, and `booking_contact` operations.
- Resolves dependency entity IDs from applied operations, not preview display IDs.
- Booking mapping preserves local operational values and uses defaults `status = 'new_lead'`, `probability = 'possible'` for new Opportunities.

- [ ] **Step 1: Write failing dependency and idempotency tests**

Cover create/reactivate Place-Person, primary pointer synchronization, Booking with Place, Booking without Person, blocked Booking without Place, Booking-Person primary pointer synchronization, repeated/concurrent apply, and preservation of notes, travel leg, totals, calls, activities, and follow-ups.

```ts
expect(await repository.applyBooking(bookingWithoutPerson)).toMatchObject({ changed: true });
expect(await loadBooking()).toMatchObject({
  organizationId: placeId,
  primaryContactId: null,
  status: "new_lead",
  probability: "possible",
});
await expect(repository.applyBooking(bookingWithoutPlace))
  .rejects.toThrow("dependency");
```

- [ ] **Step 2: Run and verify missing handler failure**

Run: `npx vitest run tests/integration/act-migration-relationship-apply.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: FAIL because the relationship apply repository does not exist.

- [ ] **Step 3: Implement dependency-resolved transactional writes**

Reuse established relationship locking order: lock parent entity, child entity, relationship row, then compatibility pointer owner. Use `source = 'act_migration'`. A semantic retry verifies the intended row and pointer instead of reinserting or reaudit­ing it.

- [ ] **Step 4: Run relationship regressions**

Run: `npx vitest run tests/integration/act-migration-relationship-apply.test.ts tests/integration/place-person-relationship-migration.test.ts tests/integration/booking-relationship-repository.test.ts tests/integration/relationship-reconciliation.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/act-migration/relationship-apply-repository.ts tests/integration/act-migration-relationship-apply.test.ts
git commit -m "feat: apply reviewed Act bookings and relationships"
```

---

### Task 9: Calling-list and membership apply handlers

**Files:**
- Create: `features/calling-lists/calling-list-repository.ts`
- Create: `features/act-migration/calling-list-apply-repository.ts`
- Create: `tests/integration/act-migration-calling-list-apply.test.ts`

**Interfaces:**
- Produces idempotent `createOrVerifyStaticList`, `createOrVerifyDynamicList`, and `createOrReactivateMembership` operations.
- Produces handlers for `calling_list` and `calling_list_member` apply targets.
- Requires `confirm_static_group` for current unknown-semantics Groups.

- [ ] **Step 1: Write failing static-confirmation and membership tests**

Cover unconfirmed rejection, confirmed static creation, pull-only Group link, membership dependency resolution, manual membership preservation, duplicate/concurrent apply, dynamic filter validation, and rejection of materialized memberships on dynamic lists.

```ts
await expect(repository.applyCallingList(unconfirmed)).rejects.toThrow("confirm");
expect(await repository.applyCallingList(confirmed)).toMatchObject({ changed: true });
expect(await repository.applyMembership(memberOperation)).toMatchObject({ changed: true });
expect(await countMemberships(listId, personId)).toBe(1);
```

- [ ] **Step 2: Run and verify missing repositories fail**

Run: `npx vitest run tests/integration/act-migration-calling-list-apply.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: FAIL because calling-list repositories do not exist.

- [ ] **Step 3: Implement list and membership transactions**

Lock source identity before list creation. Verify kind/filter on semantic retry. Never overwrite a manual list through a conflicting Group link. Membership apply requires an applied confirmed-static list operation and resolved Person operation or stable link. Audit source IDs and state only.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/integration/act-migration-calling-list-apply.test.ts tests/unit/calling-list-filter.test.ts --maxWorkers=1 --testTimeout=120000 --hookTimeout=120000`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/calling-lists/calling-list-repository.ts features/act-migration/calling-list-apply-repository.ts tests/integration/act-migration-calling-list-apply.test.ts
git commit -m "feat: apply confirmed Act groups as calling lists"
```

---

### Task 10: Apply orchestration, runtime, and owner actions

**Files:**
- Create: `features/act-migration/apply-service.ts`
- Modify: `features/act-migration/runtime.ts`
- Modify: `app/(private)/settings/act-migration/actions.ts`
- Modify: `features/act-migration/action-limits.ts`
- Test: `tests/integration/act-migration-apply-service.test.ts`
- Test: `tests/unit/act-migration-runtime.test.ts`
- Test: `tests/unit/act-migration-actions.test.ts`

**Interfaces:**
- Produces `ActMigrationApplyService.start`, `continue`, and `retry`.
- Runtime factory has no Act! source-client dependency.
- Adds strict owner actions: `bulkReviewActMigrationAction`, `startActMigrationApplyAction`, `continueActMigrationApplyAction`, `retryActMigrationApplyAction`.
- Apply actions fail closed when the feature flag is false.

- [ ] **Step 1: Write failing orchestration and action tests**

Assert owner authorization precedes parsing/factory construction, malformed IDs never reach repositories, disabled flag prevents factory construction, start reuses request keys, continue handles at most 25 operations serially, retry only requeues retryable failures, errors are sanitized, and no apply factory imports/constructs `ActClient`.

- [ ] **Step 2: Run and verify missing service/action failures**

Run: `npx vitest run tests/integration/act-migration-apply-service.test.ts tests/unit/act-migration-runtime.test.ts tests/unit/act-migration-actions.test.ts`

Expected: FAIL because apply orchestration and actions do not exist.

- [ ] **Step 3: Implement orchestration and dispatch**

Dispatch claimed targets to Tasks 7–9 repositories, mark queue completion only after target commit, and rely on target idempotency if a crash occurs between those commits. Return only run ID, batch ID, changed flag, count summaries, retryability, retry-after, and sanitized code.

- [ ] **Step 4: Run service/action tests and source mutation boundary**

Run: `npx vitest run tests/integration/act-migration-apply-service.test.ts tests/unit/act-migration-runtime.test.ts tests/unit/act-migration-actions.test.ts tests/integration/act-migration-client.test.ts`

Expected: PASS and no Act! write request in any apply test.

- [ ] **Step 5: Commit**

```bash
git add features/act-migration/apply-service.ts features/act-migration/runtime.ts app/'(private)'/settings/act-migration/actions.ts features/act-migration/action-limits.ts tests/integration/act-migration-apply-service.test.ts tests/unit/act-migration-runtime.test.ts tests/unit/act-migration-actions.test.ts
git commit -m "feat: orchestrate reviewed Act migration apply"
```

---

### Task 11: Review workspace bulk controls and single-button apply UI

**Files:**
- Modify: `features/act-migration/preview-repository.ts`
- Modify: `features/act-migration/runtime.ts`
- Modify: `app/(private)/settings/act-migration/page.tsx`
- Modify: `components/act-migration/act-migration-review.tsx`
- Test: `tests/unit/act-migration-page.test.tsx`
- Test: `tests/unit/act-migration-review.test.tsx`

**Interfaces:**
- Workspace adds count-only apply state by target and operation status.
- UI adds bounded bulk approve/ignore, individual static-Group confirmation, exact pre-apply summary, one `Import approved records` button, progress, blocked/failed explanations, and retry controls.
- Existing preview warning remains until apply is enabled; apply section separately explains local writes.

- [ ] **Step 1: Write failing UI tests**

```tsx
expect(screen.getByRole("button", { name: "Confirm static Group" })).toBeVisible();
expect(screen.queryByRole("button", { name: /bulk approve/i })).not.toBeInTheDocument(); // Group scope
expect(screen.getByText("Approved 25 · Pending 7 · Blocked 2 · Ignored 3")).toBeVisible();
await user.click(screen.getByRole("button", { name: "Import approved records" }));
expect(startApply).toHaveBeenCalledTimes(1);
await user.dblClick(screen.getByRole("button", { name: "Import approved records" }));
expect(startApply).toHaveBeenCalledTimes(1);
```

Also assert the button is absent for incomplete/digest-invalid previews and disabled when the environment flag is false.

- [ ] **Step 2: Run and verify missing controls fail**

Run: `npx vitest run tests/unit/act-migration-page.test.tsx tests/unit/act-migration-review.test.tsx`

Expected: FAIL because the workspace has no apply state or controls.

- [ ] **Step 3: Implement accessible controls and request-key reuse**

Reuse the current filter chips and pagination. Render bulk controls only when the server count reports an eligible scope. Require an ignore reason. Keep one request key in component state through retry. Disable decisions once scheduled. Use live-region status text and preserve focus after refresh.

- [ ] **Step 4: Run UI tests**

Run: `npx vitest run tests/unit/act-migration-page.test.tsx tests/unit/act-migration-review.test.tsx tests/e2e/accessibility.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add features/act-migration/preview-repository.ts features/act-migration/runtime.ts app/'(private)'/settings/act-migration/page.tsx components/act-migration/act-migration-review.tsx tests/unit/act-migration-page.test.tsx tests/unit/act-migration-review.test.tsx
git commit -m "feat: add reviewed migration import workspace"
```

---

### Task 12: Reconciliation, operations runbook, and release gates

**Files:**
- Modify: `features/act-migration/reconciliation.ts`
- Modify: `docs/operations/act-migration.md`
- Modify: `docs/operations/deployment.md`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `scripts/run-release-tests.ts`
- Modify: `tests/integration/act-migration-docs.test.ts`
- Modify: `tests/unit/release-test-runner.test.ts`
- Create: `tests/integration/act-migration-apply-reconciliation.test.ts`

**Interfaces:**
- Reconciliation reports automatically reconciled, approved, scheduled, applied, ignored, pending, blocked, and failed counts plus manifest/applied-result digests.
- Release runner includes every new real-PostgreSQL integration suite.
- Runbook supplies parameterized PII-free before/after queries for CRM, calling-list, membership, apply-batch, operation, external-link, and audit counts.

- [ ] **Step 1: Write failing reconciliation and documentation contract tests**

```ts
expect(report.proposalTotal).toBe(
  report.reconciled + report.applied + report.ignored +
  report.pending + report.blocked + report.failed,
);
expect(runbook).toContain("ACT_MIGRATION_APPLY_ENABLED=false");
expect(runbook).toContain("confirm_static_group");
expect(releaseFiles).toContain("tests/integration/act-migration-apply-repository.test.ts");
```

- [ ] **Step 2: Run and verify missing reconciliation/release coverage fails**

Run: `npx vitest run tests/integration/act-migration-apply-reconciliation.test.ts tests/integration/act-migration-docs.test.ts tests/unit/release-test-runner.test.ts`

Expected: FAIL because apply reconciliation, runbook sections, and release-suite entries are absent.

- [ ] **Step 3: Implement count-only reconciliation and operational documentation**

Document deploy-disabled behavior, backup/restore requirement, fresh preview requirement for new Group proposals, individual Act! static verification, small pilot batch, exact stop conditions, flag disable procedure, retry procedure, and evidence retention. Parameterized queries may select IDs, timestamps, states, counts, and digests only—never snapshots or decision reasons.

- [ ] **Step 4: Run the complete local release gate**

Run in order:

```bash
npm run lint
npm run typecheck
npm run test:release
npm run build
```

Then run `npm run test:crm-db` through the established secure disposable-PostgreSQL wrapper with `--maxWorkers=1`, `--testTimeout=120000`, and `--hookTimeout=120000`. Expected: every configured suite passes, stderr is empty, and no database suite is skipped or merely gated.

- [ ] **Step 5: Verify diff, migration scope, and source mutation boundary**

Run:

```bash
git diff --check origin/main...HEAD
git status --short
rg -n "requestJson|POST|PUT|PATCH|DELETE" features/act-migration/apply-*.ts features/act-migration/*-apply-repository.ts
```

Expected: clean diff check; only intended files changed; apply modules contain no Act! transport call; working tree clean after the final commit.

- [ ] **Step 6: Commit**

```bash
git add features/act-migration/reconciliation.ts docs/operations/act-migration.md docs/operations/deployment.md README.md package.json scripts/run-release-tests.ts tests/integration/act-migration-docs.test.ts tests/unit/release-test-runner.test.ts tests/integration/act-migration-apply-reconciliation.test.ts
git commit -m "docs: add reviewed migration import release gate"
```
