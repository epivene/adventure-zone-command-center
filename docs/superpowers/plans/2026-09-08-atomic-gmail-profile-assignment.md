# Atomic Gmail Profile Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Email Review profile assignments, Gmail mutation creation, and retries atomic and idempotent while preserving automatic duplicate-safe label creation and whole-thread Inbox removal.

**Architecture:** Add a transaction-focused persistence repository that commits the CRM decision, mapping, audit, stable Gmail mutation, and review projection on one checked-out PostgreSQL client before any Gmail call. Treat the mutation table as the source of truth, make completed mutations terminal, and have the service execute only the committed mutation after the transaction.

**Tech Stack:** TypeScript, Node.js, PostgreSQL 16, PGlite, Vitest, Express, Gmail API

**Spec:** `docs/superpowers/specs/2026-09-08-atomic-gmail-profile-assignment-design.md`

## Global Constraints

- Profile labels use exactly `Z - AdventureZone/Profiles/<Profile Name>`.
- Reuse normalized existing labels; never create a duplicate when one normalized match exists.
- Multiple normalized matches produce a conflict and create no label.
- Assignment applies to the entire thread and removes `INBOX`, but never removes `UNREAD`.
- Later inbound replies receive the profile label without removing `INBOX` or `UNREAD`.
- Ignore never changes Gmail.
- Stable assignment idempotency is `assign-thread:<connectionId>:<threadId>:<organizationId>`.
- Gmail runs only after the database transaction commits.
- A completed mutation is terminal and cannot be downgraded.
- `GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED` remains `true`.
- Logs must not include OAuth tokens, message bodies, or raw Gmail provider responses.

---

## File Structure

- Create `artifacts/api-server/src/features/google-workspace/google-profile-assignment-transaction.ts`: owns the atomic assignment-and-enqueue transaction.
- Create `artifacts/api-server/src/features/google-workspace/google-profile-assignment-transaction.pglite.test.ts`: proves commit, rollback, stable idempotency, and reassignment behavior against a real SQL engine.
- Modify `artifacts/api-server/src/features/google-workspace/google-gmail-mutation-repository.ts`: makes failure transitions conditional and returns the winning mutation state.
- Modify `artifacts/api-server/src/features/google-workspace/google-gmail-mutation-repository.test.ts`: tests terminal completion and conditional failure SQL.
- Modify `artifacts/api-server/src/features/google-workspace/google-profile-label-sync-service.ts`: respects a concurrently completed mutation when recording an error.
- Modify `artifacts/api-server/src/features/google-workspace/google-profile-label-sync-service.test.ts`: tests concurrent completion.
- Modify `artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.ts`: consumes committed mutations and separates Gmail failures from projection failures.
- Modify `artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.test.ts`: tests bootstrap failure, repeated assignment, and post-Gmail projection failure.
- Modify `artifacts/api-server/src/features/google-workspace/google-validation-repository.ts`: reads mutation state as the authoritative Gmail status.
- Modify `artifacts/api-server/src/features/google-workspace/google-validation-repository.test.ts`: verifies the authoritative-state join.
- Modify `artifacts/api-server/src/routes/google-workspace-validation.test.ts`: verifies a Gmail bootstrap failure returns HTTP 200 with a retryable mutation instead of HTTP 500.
- Keep `render.yaml` enabled and update the design status after verification.

### Task 1: Make completed Gmail mutations terminal

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-gmail-mutation-repository.ts`
- Test: `artifacts/api-server/src/features/google-workspace/google-gmail-mutation-repository.test.ts`
- Test: `artifacts/api-server/src/features/google-workspace/google-profile-label-sync-service.test.ts`

**Interfaces:**
- Consumes: existing `GoogleGmailMutationRecord`.
- Produces: `fail(input): Promise<GoogleGmailMutationRecord | null>`, where the returned record is the post-transition state and `completed` is never updated.

- [ ] **Step 1: Write the failing terminal-state repository test**

Add a test that requires the failure update to exclude completed rows and return the winner:

```ts
it("never downgrades a completed mutation", async () => {
  const queries: string[] = [];
  const repository = new PostgresGoogleGmailMutationRepository({
    async query(text: string) {
      queries.push(text);
      return { rows: [{ ...row, state: "completed", target_label_id: "Label_10" }] };
    },
  });

  await expect(repository.fail({
    id: "mutation-1",
    state: "retryable_error",
    errorCode: "GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED",
    nextAttemptAt: null,
    now: new Date("2026-09-08T12:00:00Z"),
  })).resolves.toMatchObject({ state: "completed", targetLabelId: "Label_10" });

  expect(queries[0]).toContain("state <> 'completed'");
  expect(queries[0]).toContain("RETURNING");
});
```

- [ ] **Step 2: Run the repository test and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-gmail-mutation-repository.test.ts
```

Expected: FAIL because `fail` returns `void` and its SQL updates completed rows.

- [ ] **Step 3: Implement the conditional transition**

Change `fail` to perform a guarded update followed by a read of the winning row:

```ts
async fail(input: {
  id: string;
  state: "retryable_error" | "permanent_error" | "conflict";
  errorCode: string;
  nextAttemptAt: Date | null;
  now: Date;
}): Promise<GoogleGmailMutationRecord | null> {
  const result = await this.pool.query(
    `WITH changed AS (
       UPDATE google_workspace_gmail_mutations
          SET state = $2,
              last_error_code = $3,
              next_attempt_at = $4,
              processing_lease_expires_at = NULL,
              updated_at = $5
        WHERE id = $1
          AND state <> 'completed'
        RETURNING id
     )
     SELECT id::text, connection_id::text, message_id, thread_id,
            organization_id::text, operation, target_label_id,
            remove_label_ids, idempotency_key, state, attempt_count,
            last_error_code
       FROM google_workspace_gmail_mutations
      WHERE id = $1
      LIMIT 1`,
    [input.id, input.state, input.errorCode, input.nextAttemptAt, input.now],
  );
  return result.rows[0] ? record(result.rows[0]) : null;
}
```

- [ ] **Step 4: Add the failing concurrent-completion sync test**

Configure `resolver.resolve` to throw while `mutations.fail` returns a completed record. Assert the service returns `state: "completed"`, the completed label ID, and no retry error.

- [ ] **Step 5: Run the sync test and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-profile-label-sync-service.test.ts
```

Expected: FAIL because the catch block currently returns the attempted failure state without honoring the returned completed record.

- [ ] **Step 6: Make the sync catch honor the winning state**

Use the result from `mutations.fail`:

```ts
const winner = await this.dependencies.mutations.fail({ /* existing values */ });
if (winner?.state === "completed") return this.view(winner);
```

Keep the existing retryable/permanent/conflict result when no completed winner exists.

- [ ] **Step 7: Run both focused tests and verify GREEN**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run   src/features/google-workspace/google-gmail-mutation-repository.test.ts   src/features/google-workspace/google-profile-label-sync-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/features/google-workspace/google-gmail-mutation-repository.ts   artifacts/api-server/src/features/google-workspace/google-gmail-mutation-repository.test.ts   artifacts/api-server/src/features/google-workspace/google-profile-label-sync-service.ts   artifacts/api-server/src/features/google-workspace/google-profile-label-sync-service.test.ts
git commit -m "fix: keep completed Gmail mutations terminal"
```

### Task 2: Commit assignments and Gmail jobs atomically

**Files:**
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-assignment-transaction.ts`
- Create: `artifacts/api-server/src/features/google-workspace/google-profile-assignment-transaction.pglite.test.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.ts`

**Interfaces:**
- Consumes: `BaseInput` and `MatchedInput` assignment fields.
- Produces:

```ts
export type CommittedProfileAssignment = {
  connectionId: string;
  messageId: string;
  threadId: string;
  organizationId: string;
  mutation: GoogleGmailMutationRecord;
};

export interface GoogleProfileAssignmentTransactionPort {
  resolveReview(input: BaseAssignmentInput): Promise<CommittedProfileAssignment>;
  assignMatched(input: MatchedAssignmentInput): Promise<CommittedProfileAssignment>;
}
```

- [ ] **Step 1: Write the PGlite test fixture**

Create organizations, contacts, and the Google Workspace schema with `ensureGoogleWorkspaceSchema`. Insert one workspace connection, one organization, and one pending review item. Wrap PGlite with a transaction client adapter whose `connect()` returns the same database and a no-op `release()`.

- [ ] **Step 2: Write the failing identical-retry test**

Call `resolveReview` twice with different `now` values but the same message, thread, and organization. Assert:

```ts
const mutations = await db.query<{ count: string }>(
  "SELECT count(*)::text AS count FROM google_workspace_gmail_mutations",
);
expect(mutations.rows[0]?.count).toBe("1");

const mutation = await db.query<{ idempotency_key: string }>(
  "SELECT idempotency_key FROM google_workspace_gmail_mutations",
);
expect(mutation.rows[0]?.idempotency_key).toBe(
  "assign-thread:20000000-0000-4000-8000-000000000001:thread-1:10000000-0000-4000-8000-000000000001",
);
```

- [ ] **Step 3: Run the new transaction test and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-profile-assignment-transaction.pglite.test.ts
```

Expected: FAIL because the transaction repository does not exist.

- [ ] **Step 4: Implement the transaction shell and validation**

Use one checked-out client:

```ts
const client = await this.pool.connect();
try {
  await client.query("BEGIN");
  const committed = await operation(client);
  await client.query("COMMIT");
  return committed;
} catch (cause) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw new GoogleProfileAssignmentTransactionError({
    stage: currentStage,
    cause,
  });
} finally {
  client.release();
}
```

Use safe stages `connection`, `target`, `review`, `mapping`, `audit`, `supersede`, and `mutation`. Preserve Google-prefixed validation codes; otherwise expose `GOOGLE_WORKSPACE_PROFILE_ASSIGNMENT_TRANSACTION_FAILED` plus a PostgreSQL code field.

- [ ] **Step 5: Implement stable mutation insertion**

Within the transaction, construct:

```ts
const idempotencyKey =
  `assign-thread:${connectionId}:${threadId}:${organizationId}`;
```

Insert with `ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key RETURNING ...`. Do not include timestamps or actors in the key.

- [ ] **Step 6: Implement review, mapping, audit, and projection writes**

For review resolution:

- lock the pending/resolved review row with `FOR UPDATE`;
- update it to `resolved`;
- merge `manual_profile_assignment` into evidence;
- upsert the validation mapping;
- insert the audit only when the prior organization differs or the prior state was not resolved;
- set `gmail_sync_state`, `gmail_sync_error_code`, and `gmail_sync_mutation_id` from the returned mutation.

For matched correction, perform the existing review-item upsert and mapping update inside the same transaction, then use the same stable mutation insert and projection update.

- [ ] **Step 7: Supersede older unfinished assignments**

Before inserting the current intent, run:

```sql
UPDATE google_workspace_gmail_mutations
   SET state = 'permanent_error',
       last_error_code = 'GOOGLE_WORKSPACE_ASSIGNMENT_SUPERSEDED',
       next_attempt_at = NULL,
       processing_lease_expires_at = NULL,
       updated_at = $4
 WHERE connection_id = $1
   AND thread_id = $2
   AND organization_id <> $3
   AND operation = 'assign_thread'
   AND state IN ('pending', 'retryable_error');
```

Do not modify processing or completed mutations. A later successful assignment removes other managed profile labels, so completed prior assignments converge safely.

- [ ] **Step 8: Add rollback and reassignment tests**

Add real-database tests that:

- inject a failure at the mutation stage and assert the review remains pending with no mapping or audit;
- assign to organization A then B and assert A’s pending mutation is superseded and B has one pending mutation;
- launch two identical `resolveReview` calls and assert one mutation row.

- [ ] **Step 9: Run the transaction tests and verify GREEN**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-profile-assignment-transaction.pglite.test.ts
```

Expected: PASS.

- [ ] **Step 10: Wire the transaction repository into the service**

Replace separate `reviewPersistence` / `matchedPersistence` / `queueSavedDecision` production flow with `GoogleProfileAssignmentTransactionPort`. Keep dependency injection for unit tests.

- [ ] **Step 11: Run assignment service and transaction tests**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run   src/features/google-workspace/google-profile-assignment-transaction.pglite.test.ts   src/features/google-workspace/google-review-profile-assignment-service.test.ts
```

Expected: PASS after the service tests use committed-assignment fixtures.

- [ ] **Step 12: Commit**

```bash
git add artifacts/api-server/src/features/google-workspace/google-profile-assignment-transaction.ts   artifacts/api-server/src/features/google-workspace/google-profile-assignment-transaction.pglite.test.ts   artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.ts   artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.test.ts
git commit -m "feat: atomically assign profiles and queue Gmail"
```

### Task 3: Separate Gmail execution from projection state

**Files:**
- Modify: `artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.ts`
- Modify: `artifacts/api-server/src/features/google-workspace/google-validation-repository.ts`
- Test: `artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.test.ts`
- Test: `artifacts/api-server/src/features/google-workspace/google-validation-repository.test.ts`

**Interfaces:**
- Consumes: `CommittedProfileAssignment` and terminal-safe `mutations.fail`.
- Produces: a 200-compatible `GoogleReviewAssignmentView` for completed or retryable Gmail outcomes.

- [ ] **Step 1: Write the failing post-Gmail projection test**

Return `gmailSync.state = "completed"` from the real service port, make the review projection update throw, and assert `resolveReview` still returns completed. Assert `mutations.fail` is not called.

- [ ] **Step 2: Run the service test and verify RED**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/google-workspace/google-review-profile-assignment-service.test.ts
```

Expected: FAIL because the broad catch currently routes projection errors through `markQueuedFailure`.

- [ ] **Step 3: Separate catch boundaries**

Structure the service as:

```ts
const committed = await this.assignmentPersistence.resolveReview(input);

let production;
try {
  production = await this.syncFactory();
} catch (error) {
  return this.markQueuedFailure(input, committed, error);
}

let gmailSync;
try {
  gmailSync = await production.service.assignThread({
    connectionId: committed.connectionId,
    messageId: committed.messageId,
    threadId: committed.threadId,
    organizationId: committed.organizationId,
    actorId: input.actorId,
    decisionRevision: committed.mutation.id,
  });
} catch (error) {
  return this.markQueuedFailure(input, committed, error);
}

await this.writeSyncStateBestEffort(committed, gmailSync, input.now);
return {
  organizationId: committed.organizationId,
  threadId: committed.threadId,
  gmailSync,
};
```

`writeSyncStateBestEffort` may retry the projection once, but it must never call `mutations.fail` and must never turn a completed result into retryable.

- [ ] **Step 4: Make bootstrap failure reload the winner**

After guarded `fail`, return completed if another worker already completed:

```ts
const winner = await this.mutations.fail({ /* retryable transition */ });
if (winner?.state === "completed") {
  return {
    organizationId: committed.organizationId,
    threadId: committed.threadId,
    gmailSync: mutationView(winner),
  };
}
```

- [ ] **Step 5: Make review reads use mutation state as source of truth**

Update `listReviewItems` to left join `google_workspace_gmail_mutations` on `gmail_sync_mutation_id` and select:

```sql
COALESCE(mutation.state, item.gmail_sync_state) AS gmail_sync_state,
COALESCE(mutation.last_error_code, item.gmail_sync_error_code) AS gmail_sync_error_code,
COALESCE(mutation.id, item.gmail_sync_mutation_id)::text AS gmail_sync_mutation_id
```

Normalize mutation `processing` to UI state `pending`. This makes a completed mutation visible even if the denormalized item update failed.

- [ ] **Step 6: Add the authoritative-read test**

Assert the repository maps an item row whose stored item state is retryable but joined mutation state is completed to `gmailSyncState: "completed"` with no retry error.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run   src/features/google-workspace/google-review-profile-assignment-service.test.ts   src/features/google-workspace/google-validation-repository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.ts   artifacts/api-server/src/features/google-workspace/google-review-profile-assignment-service.test.ts   artifacts/api-server/src/features/google-workspace/google-validation-repository.ts   artifacts/api-server/src/features/google-workspace/google-validation-repository.test.ts
git commit -m "fix: separate Gmail completion from review projection"
```

### Task 4: Verify the HTTP contract and production behavior

**Files:**
- Modify: `artifacts/api-server/src/routes/google-workspace-validation.test.ts`
- Modify: `docs/superpowers/specs/2026-09-08-atomic-gmail-profile-assignment-design.md`
- Verify: `render.yaml`

**Interfaces:**
- Consumes: `GoogleReviewAssignmentView`.
- Produces: HTTP 200 with `gmailSync.state` of `completed` or `retryable_error`; staged transaction failures remain non-200.

- [ ] **Step 1: Write the failing route contract test**

Configure the assignment service to return:

```ts
{
  organizationId: "10000000-0000-4000-8000-000000000001",
  threadId: "thread-1",
  gmailSync: {
    mutationId: "30000000-0000-4000-8000-000000000001",
    state: "retryable_error",
    gmailLabelId: null,
    gmailLabelName: null,
    errorCode: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
  },
}
```

Assert PUT returns 200, `ok: true`, and the retryable mutation ID.

- [ ] **Step 2: Run the route test and verify its contract**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/google-workspace-validation.test.ts
```

Expected: PASS if the route contract is already correct. If it passes immediately, retain it as an explicit regression contract and do not change route production code.

- [ ] **Step 3: Run the complete Google Workspace backend suite**

Run:

```bash
pnpm --filter @workspace/api-server exec vitest run   src/features/google-workspace   src/routes/google-workspace-oauth-callback.test.ts   src/routes/google-workspace-settings.test.ts
```

Expected: all included tests pass.

- [ ] **Step 4: Run builds**

Run:

```bash
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
```

Expected: both builds pass.

- [ ] **Step 5: Run typecheck and classify only pre-existing failures**

Run:

```bash
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
```

Expected: no new errors in files changed by this plan. Record existing repository-wide errors separately.

- [ ] **Step 6: Verify rollout configuration**

Run:

```bash
rg -n -A1 "GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED" render.yaml
```

Expected: `value: "true"`.

- [ ] **Step 7: Update design status and commit**

Change the design status from `Proposed` to `Implemented`, record the focused test/build results, then commit:

```bash
git add artifacts/api-server/src/routes/google-workspace-validation.test.ts   docs/superpowers/specs/2026-09-08-atomic-gmail-profile-assignment-design.md
git commit -m "test: verify atomic Gmail assignment contract"
```

- [ ] **Step 8: Request independent code review**

Review the complete range from `c4ab5bcb77a8588896e37864f0e457a3c84a5b1c` to the branch head. Fix all Critical and Important findings, rerun the affected focused tests, and repeat review until none remain.

- [ ] **Step 9: Open a new pull request**

Use title:

```text
Make Gmail profile assignments atomic
```

Include test counts, build results, known unrelated CI failures, rollout behavior, and the post-deploy manual verification steps in the PR description.
