# Act Safe Import Automatic Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one confirmed safe import continue through temporary mobile/network interruptions without duplicate work or repeated Resume clicks.

**Architecture:** Keep `apply-next` as the durable, idempotent server boundary. Move the client loop's transient-recovery policy into focused helper functions: use smaller requests, refresh server state after an ambiguous network failure, and retry only transport errors with a fixed limit.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, TanStack Query workspace

## Global Constraints

- Send at most 10 records per `apply-next` request.
- Retry only transient fetch/network failures, at most three consecutive times.
- Refresh durable server status before every retry so an acknowledged-on-server/lost-in-browser response cannot duplicate work.
- Reset the retry count after a successful batch.
- Never retry blocked operations, failed operations, stale-review conflicts, disabled apply locks, or stalled cursors.

---

### Task 1: Automatic transient recovery

**Files:**

- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.tsx`
- Test: `artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx`

**Interfaces:**

- Consumes: `applyNext(runId, request)` and `getRun(runId)` from `act-replacement-client.ts`.
- Produces: `isTransientApplyError(error: unknown): boolean`, 10-record apply requests, and a loop that refreshes durable state before retrying.

- [ ] **Step 1: Write the failing recovery test**

Add a component test that confirms the import, makes the first `applyNext` reject with `new TypeError("Failed to fetch")`, returns an applying run from `getRun`, then succeeds on the next `applyNext` call.

```ts
it("refreshes durable progress and continues after a transient apply failure", async () => {
  client.applyNext
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(batchResult(10, false));
  client.getRun.mockResolvedValue({
    run: readyRun({ phase: "applying", nextApplyCursor: 10 }),
  });

  client.getLatestRun.mockResolvedValue({ run: readyRun() });
  client.approveSafeDefaults.mockResolvedValue(approvalWithOperationIds(42));

  render(<ActMigrationPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Import safe records" }),
  );
  await screen.findByRole("dialog");
  fireEvent.click(
    screen.getByRole("button", { name: "Yes, import safe records" }),
  );

  await waitFor(() => expect(client.applyNext).toHaveBeenCalledTimes(2));
  expect(client.getRun).toHaveBeenCalledWith(readyRun().runId);
  expect(client.applyNext).toHaveBeenLastCalledWith(
    readyRun().runId,
    expect.objectContaining({ batchSize: 10 }),
  );
  expect(screen.queryByText("Failed to fetch")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx -t "refreshes durable progress"
```

Expected: FAIL because the current catch exits after the first network error.

- [ ] **Step 3: Implement the minimal recovery loop**

In `ActMigrationPage.tsx`, change the batch constant and add a narrow transient classifier.

```ts
const APPLY_BATCH_SIZE = 10;
const MAX_TRANSIENT_APPLY_RETRIES = 3;

function isTransientApplyError(error: unknown) {
  return error instanceof TypeError || errorCode(error) === "Failed to fetch";
}
```

Inside `importSafeRecords`, catch errors around each `applyNext` call. On a transient error below the limit, call `refreshRun(confirmation.runId)`, update the local cursor from `nextApplyCursor`, and continue. Reset the consecutive failure count after any successful `applyNext`. Re-throw all non-transient errors.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same focused Vitest command. Expected: PASS with two apply attempts, one durable refresh, and `batchSize: 10`.

- [ ] **Step 5: Commit the recovery behavior**

```bash
git add artifacts/adventure-zone/src/pages/ActMigrationPage.tsx artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx
git commit -m "Automatically recover Act safe imports"
```

---

### Task 2: Bounded retries and non-retryable safety

**Files:**

- Modify: `artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx`
- Verify: `artifacts/adventure-zone/src/pages/ActMigrationPage.tsx`

**Interfaces:**

- Consumes: `MAX_TRANSIENT_APPLY_RETRIES = 3` and `isTransientApplyError` from Task 1.
- Produces: regression coverage that proves the loop terminates and existing safety stops remain unchanged.

- [ ] **Step 1: Write the failing retry-limit test**

```ts
it("stops after three consecutive transient apply failures", async () => {
  client.applyNext.mockRejectedValue(new TypeError("Failed to fetch"));
  client.getRun.mockResolvedValue({
    run: readyRun({ phase: "applying", nextApplyCursor: 0 }),
  });

  client.getLatestRun.mockResolvedValue({ run: readyRun() });
  client.approveSafeDefaults.mockResolvedValue(approvalWithOperationIds(42));

  render(<ActMigrationPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Import safe records" }),
  );
  await screen.findByRole("dialog");
  fireEvent.click(
    screen.getByRole("button", { name: "Yes, import safe records" }),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent("Failed to fetch");
  expect(client.applyNext).toHaveBeenCalledTimes(3);
  expect(client.getRun).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the retry-limit test and verify RED**

Run:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx -t "stops after three consecutive"
```

Expected: FAIL if the loop retries forever, retries the wrong number of times, or hides the final error.

- [ ] **Step 3: Complete the fixed retry bound**

Adjust only the retry counter conditions needed to produce exactly three total transient attempts and two durable refreshes. Preserve the existing outer handling for `act_apply_disabled`, review-required results, and `apply_cursor_stalled`.

- [ ] **Step 4: Run focused and existing safety tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ActMigrationPage.test.tsx
```

Expected: all page tests pass, including existing blocked-batch and apply-lock cases.

- [ ] **Step 5: Commit bounded retry coverage**

```bash
git add artifacts/adventure-zone/src/pages/ActMigrationPage.tsx artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx
git commit -m "Bound Act safe import retries"
```

---

### Task 3: Full verification and release

**Files:**

- Verify: `artifacts/adventure-zone/src/pages/ActMigrationPage.tsx`
- Verify: `artifacts/adventure-zone/src/pages/ActMigrationPage.test.tsx`
- Verify: `docs/superpowers/specs/2026-08-12-act-safe-import-auto-retry-design.md`

**Interfaces:**

- Consumes: completed behavior from Tasks 1–2.
- Produces: a focused GitHub PR and merged production commit.

- [ ] **Step 1: Run frontend tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run
```

- [ ] **Step 2: Run frontend typecheck and production build**

```bash
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```

- [ ] **Step 3: Inspect the exact branch diff**

Confirm only the design/plan, page, and page tests changed. Confirm no credentials, generated bundles, or unrelated formatting changes are present.

- [ ] **Step 4: Open and merge the PR**

Create a focused PR describing the slow-request root cause, durable refresh recovery, bounded retry behavior, and verification evidence. Merge only the verified head SHA.
