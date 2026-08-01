# Act! Category Batch Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely import a single approved Act! review category in 50-contact batches with visible progress and retryable failures.

**Architecture:** Add a small category-approval helper and a client-side batch runner so the React review screen stays focused on display and state. Optimize only `new_in_act` pulls to use the stored reviewed snapshot; every operation that could overwrite an existing record or write to Act! keeps its current remote re-fetch guard. Existing server-side operation claims remain the idempotency boundary for retries and interrupted requests.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Vitest 4, Testing Library, Drizzle ORM, PostgreSQL, Act! Web API.

## Global Constraints

- Bulk approval applies only to the category currently being viewed.
- Selecting a category clears selections from every other category.
- Only `new_in_act`, `new_in_app`, `changed_in_act`, and `changed_in_app` have safe category defaults.
- A `new_in_act` import must never write to Act!.
- Sync remains manual; do not add scheduled jobs, background workers, or dependencies.
- Process at most 50 decisions per server-action request.
- Individual row failures do not stop later batches.
- A batch-level network or server failure pauses the import and preserves that batch plus all later rows.
- Completed rows are never intentionally resubmitted.
- Progress and completion text must be in an `aria-live="polite"` region inside the sticky action bar.
- Errors remain sanitized and never expose Act! credentials or raw upstream responses.

---

## File map

- Create `features/act-sync/category-approval.ts`: owns the safe default mapping and creates decisions for one category only.
- Create `features/act-sync/apply-decisions-in-batches.ts`: owns batch size, sequential batch execution, progress reporting, failure collection, and interruption recovery.
- Modify `features/act-sync/sync-service.ts`: uses a stored preview snapshot only for a validated `new_in_act` pull.
- Modify `components/act-sync/act-sync-review.tsx`: renders category-only approval, disables controls during apply, shows progress, preserves failures, and retries only unfinished decisions.
- Create `tests/unit/act-sync-category-approval.test.ts`: verifies category isolation and unsafe-category behavior.
- Create `tests/unit/act-sync-batch-apply.test.ts`: verifies 50-row batching, progress, row failures, and interrupted batches.
- Modify `tests/integration/act-sync-apply.test.ts`: verifies snapshot-only new-contact pulls and retained concurrency checks.
- Modify `tests/unit/act-sync-review.test.tsx`: verifies the complete user flow and accessible copy.
- Modify `docs/operations/act-sync.md`: replaces the global safe-default instructions with category-only batch guidance.

---

### Task 1: Isolate safe approvals to the active category

**Files:**
- Create: `features/act-sync/category-approval.ts`
- Create: `tests/unit/act-sync-category-approval.test.ts`

**Interfaces:**
- Consumes: `SyncComparisonCategory`, `SyncComparisonRow`, and `SyncApplyDecision`.
- Produces: `safeDecisionForCategory(category)` and `decisionsForCategory(rows, category)`.

- [ ] **Step 1: Write the failing category-isolation tests**

Create `tests/unit/act-sync-category-approval.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  decisionsForCategory,
  safeDecisionForCategory,
} from "@/features/act-sync/category-approval";
import type { SyncComparisonRow } from "@/features/act-sync/sync-comparison";

function row(
  rowId: string,
  category: SyncComparisonRow["category"],
  allowedDecisions: SyncComparisonRow["allowedDecisions"],
): SyncComparisonRow {
  return {
    rowId,
    category,
    matchReason: "none",
    localContactId: null,
    actRecordId: `act-${rowId}`,
    candidateLocalContactIds: [],
    candidateActRecordIds: [`act-${rowId}`],
    baseSnapshot: null,
    localSnapshot: null,
    actSnapshot: null,
    actEditedAt: null,
    allowedDecisions,
    messages: [],
  };
}

describe("Act sync category approval", () => {
  it("returns decisions only for the selected safe category", () => {
    const rows = [
      row("act-1", "new_in_act", ["pull", "skip"]),
      row("act-2", "new_in_act", ["pull", "skip"]),
      row("app-1", "new_in_app", ["push", "skip"]),
    ];

    expect(decisionsForCategory(rows, "new_in_act")).toEqual([
      { rowId: "act-1", decision: "pull" },
      { rowId: "act-2", decision: "pull" },
    ]);
  });

  it("does not bulk-approve conflicts or possible matches", () => {
    expect(safeDecisionForCategory("changed_in_both")).toBeUndefined();
    expect(safeDecisionForCategory("possible_match")).toBeUndefined();
    expect(
      decisionsForCategory(
        [row("conflict", "changed_in_both", ["keep_act", "keep_app", "skip"])],
        "changed_in_both",
      ),
    ).toEqual([]);
  });

  it("ignores a row when its allowed decisions reject the category default", () => {
    expect(
      decisionsForCategory(
        [row("malformed", "new_in_act", ["skip"])],
        "new_in_act",
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the new test and verify the missing-module failure**

Run:

```bash
npm test -- tests/unit/act-sync-category-approval.test.ts
```

Expected: FAIL because `@/features/act-sync/category-approval` does not exist.

- [ ] **Step 3: Implement the category-only decision helper**

Create `features/act-sync/category-approval.ts`:

```ts
import type {
  SyncComparisonCategory,
  SyncComparisonRow,
  SyncDecision,
} from "@/features/act-sync/sync-comparison";
import type { SyncApplyDecision } from "@/features/act-sync/sync-service";

const safeCategoryDecisions: Partial<
  Record<SyncComparisonCategory, SyncDecision>
> = {
  new_in_act: "pull",
  new_in_app: "push",
  changed_in_act: "pull",
  changed_in_app: "push",
};

export function safeDecisionForCategory(
  category: SyncComparisonCategory,
): SyncDecision | undefined {
  return safeCategoryDecisions[category];
}

export function decisionsForCategory(
  rows: readonly SyncComparisonRow[],
  category: SyncComparisonCategory,
): SyncApplyDecision[] {
  const decision = safeDecisionForCategory(category);
  if (!decision) return [];
  return rows
    .filter(
      (row) =>
        row.category === category &&
        row.allowedDecisions.includes(decision),
    )
    .map((row) => ({ rowId: row.rowId, decision }));
}
```

- [ ] **Step 4: Run the helper tests**

Run:

```bash
npm test -- tests/unit/act-sync-category-approval.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit the category helper**

```bash
git add features/act-sync/category-approval.ts tests/unit/act-sync-category-approval.test.ts
git commit -m "feat: isolate Act approvals by category"
```

---

### Task 2: Pull new Act! contacts from the reviewed snapshot

**Files:**
- Modify: `features/act-sync/sync-service.ts:168-245`
- Modify: `tests/integration/act-sync-apply.test.ts:290-419`

**Interfaces:**
- Consumes: the stored `SyncComparisonRow.actSnapshot`, `actRecordId`, and `actEditedAt`.
- Produces: `reviewedNewActContact(row)`, returning the same success/failure union shape used by `currentRemote`.

- [ ] **Step 1: Strengthen the new-contact integration test**

In `tests/integration/act-sync-apply.test.ts`, add this assertion to
`"pulls a new Act contact into Command Center"` after the existing local
contact assertions:

```ts
expect(client.getCalls).toBe(0);
```

Then add two tests:

```ts
it("fails a malformed new Act row without requesting Act", async () => {
  const rows = compareContactSets([], [remote()]);
  rows[0] = { ...rows[0]!, actSnapshot: null };
  const repository = new InMemoryApplyRepository(rows, []);
  const client = new FakeApplyClient([remote()]);
  const service = new ActSyncService(client, repository);

  const result = await service.apply("run-1", [
    { rowId: rows[0]!.rowId, decision: "pull" },
  ]);

  expect(result.rows[0]).toMatchObject({
    status: "failed",
    error: "The reviewed Act! contact is incomplete. Create a new preview.",
  });
  expect(client.getCalls).toBe(0);
  expect(repository.appliedPulls).toEqual([]);
});

it("still rechecks Act before overwriting an existing local contact", async () => {
  const existing = local();
  const rows = compareContactSets(
    [existing],
    [remote({ phone: "406-555-0202" })],
  );
  const repository = new InMemoryApplyRepository(rows, [existing]);
  const client = new FakeApplyClient([
    remote({ phone: "406-555-0202" }),
  ]);
  const service = new ActSyncService(client, repository);

  await service.apply("run-1", [
    { rowId: rows[0]!.rowId, decision: "pull" },
  ]);

  expect(client.getCalls).toBe(1);
});
```

- [ ] **Step 2: Run the focused integration tests and verify failure**

Run:

```bash
npm test -- tests/integration/act-sync-apply.test.ts
```

Expected: the new-contact test FAILS with `getCalls` equal to 1 and the
malformed-row error does not match.

- [ ] **Step 3: Add the reviewed-snapshot validator**

In `features/act-sync/sync-service.ts`, add this private method immediately
before `currentRemote`:

```ts
private reviewedNewActContact(
  row: SyncComparisonRow,
):
  | { ok: true; contact: RemoteActContact }
  | { ok: false; result: SyncApplyRowResult } {
  if (
    row.category !== "new_in_act" ||
    row.localContactId !== null ||
    !row.actRecordId ||
    !row.actSnapshot
  ) {
    return {
      ok: false,
      result: {
        rowId: row.rowId,
        status: "failed",
        error: "The reviewed Act! contact is incomplete. Create a new preview.",
      },
    };
  }
  return {
    ok: true,
    contact: {
      id: row.actRecordId,
      editedAt: row.actEditedAt,
      ...row.actSnapshot,
    },
  };
}
```

Replace the pull branch in `applyClaimedRow` with:

```ts
if (input.decision === "pull" || input.decision === "keep_act") {
  const remote =
    input.decision === "pull" && row.category === "new_in_act"
      ? this.reviewedNewActContact(row)
      : await this.currentRemote(client, row);
  if (!remote.ok) return remote.result;
  await repository.pullContact(row, remote.contact);
  return { rowId: row.rowId, status: "completed", error: null };
}
```

- [ ] **Step 4: Run integration and regression tests**

Run:

```bash
npm test -- tests/integration/act-sync-apply.test.ts tests/unit/act-sync-actions.test.ts
```

Expected: all focused tests PASS. The existing changed-record push test still
proves that Act! is re-fetched before a write.

- [ ] **Step 5: Commit the snapshot optimization**

```bash
git add features/act-sync/sync-service.ts tests/integration/act-sync-apply.test.ts
git commit -m "feat: import reviewed Act contacts without detail requests"
```

---

### Task 3: Execute decisions in bounded, recoverable batches

**Files:**
- Create: `features/act-sync/apply-decisions-in-batches.ts`
- Create: `tests/unit/act-sync-batch-apply.test.ts`

**Interfaces:**
- Consumes: `runId`, `SyncApplyDecision[]`, and an action compatible with `applyActSyncAction`.
- Produces: `ACT_SYNC_BATCH_SIZE`, `BatchApplyProgress`, `FailedSyncDecision`, `BatchApplyOutcome`, and `applyDecisionsInBatches(options)`.

- [ ] **Step 1: Write failing batch-runner tests**

Create `tests/unit/act-sync-batch-apply.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

import {
  ACT_SYNC_BATCH_SIZE,
  applyDecisionsInBatches,
} from "@/features/act-sync/apply-decisions-in-batches";
import type { SyncApplyDecision } from "@/features/act-sync/sync-service";

function decisions(count: number): SyncApplyDecision[] {
  return Array.from({ length: count }, (_, index) => ({
    rowId: `row-${index + 1}`,
    decision: "pull" as const,
  }));
}

describe("applyDecisionsInBatches", () => {
  it("submits 1,427 rows as 29 sequential batches of at most 50", async () => {
    const applyBatch = vi.fn(async (
      runId: string,
      batch: readonly SyncApplyDecision[],
    ) => ({
      ok: true as const,
      result: {
        runId,
        rows: batch.map((decision) => ({
          rowId: decision.rowId,
          status: "completed" as const,
          error: null,
        })),
      },
    }));
    const progress = vi.fn();

    const outcome = await applyDecisionsInBatches({
      runId: "run-1",
      decisions: decisions(1427),
      applyBatch,
      onProgress: progress,
    });

    expect(ACT_SYNC_BATCH_SIZE).toBe(50);
    expect(applyBatch).toHaveBeenCalledTimes(29);
    expect(applyBatch.mock.calls.every(([, batch]) => batch.length <= 50)).toBe(true);
    expect(outcome).toMatchObject({
      completed: 1427,
      failed: [],
      pending: [],
      interruptedError: null,
    });
    expect(progress).toHaveBeenLastCalledWith({
      processed: 1427,
      total: 1427,
      completed: 1427,
      failed: 0,
      completedRowIds: decisions(1427).map((decision) => decision.rowId),
    });
  });

  it("continues after row failures and returns only those rows for retry", async () => {
    const applyBatch = vi.fn(async (
      runId: string,
      batch: readonly SyncApplyDecision[],
    ) => ({
      ok: true as const,
      result: {
        runId,
        rows: batch.map((decision) => ({
          rowId: decision.rowId,
          status: decision.rowId === "row-2" ? "failed" as const : "completed" as const,
          error: decision.rowId === "row-2" ? "Try this contact again." : null,
        })),
      },
    }));

    const outcome = await applyDecisionsInBatches({
      runId: "run-1",
      decisions: decisions(51),
      applyBatch,
    });

    expect(applyBatch).toHaveBeenCalledTimes(2);
    expect(outcome.completed).toBe(50);
    expect(outcome.failed).toEqual([
      {
        decision: { rowId: "row-2", decision: "pull" },
        error: "Try this contact again.",
      },
    ]);
    expect(outcome.pending).toEqual([]);
  });

  it("pauses after a batch-level error and preserves that batch plus later rows", async () => {
    const applyBatch = vi.fn(async () => ({
      ok: false as const,
      error: "The connection was interrupted.",
    }));

    const input = decisions(75);
    const outcome = await applyDecisionsInBatches({
      runId: "run-1",
      decisions: input,
      applyBatch,
    });

    expect(applyBatch).toHaveBeenCalledOnce();
    expect(outcome.completed).toBe(0);
    expect(outcome.pending).toEqual(input);
    expect(outcome.interruptedError).toBe("The connection was interrupted.");
  });

  it("treats a thrown request as an interruption without exposing the exception", async () => {
    const input = decisions(2);
    const outcome = await applyDecisionsInBatches({
      runId: "run-1",
      decisions: input,
      applyBatch: async () => {
        throw new Error("socket and secret details");
      },
    });

    expect(outcome.pending).toEqual(input);
    expect(outcome.interruptedError).toBe(
      "The import connection was interrupted. Retry the remaining contacts.",
    );
  });
});
```

- [ ] **Step 2: Run the batch tests and verify the missing-module failure**

Run:

```bash
npm test -- tests/unit/act-sync-batch-apply.test.ts
```

Expected: FAIL because the batch-runner module does not exist.

- [ ] **Step 3: Implement the batch runner**

Create `features/act-sync/apply-decisions-in-batches.ts`:

```ts
import type {
  SyncApplyDecision,
  SyncApplyRowResult,
} from "@/features/act-sync/sync-service";

export const ACT_SYNC_BATCH_SIZE = 50;

export type BatchApplyProgress = {
  processed: number;
  total: number;
  completed: number;
  failed: number;
  completedRowIds: string[];
};

export type FailedSyncDecision = {
  decision: SyncApplyDecision;
  error: string;
};

export type BatchApplyOutcome = {
  completed: number;
  failed: FailedSyncDecision[];
  pending: SyncApplyDecision[];
  interruptedError: string | null;
};

type ApplyBatchResult =
  | {
      ok: true;
      result: { runId: string; rows: SyncApplyRowResult[] };
    }
  | { ok: false; error: string };

type ApplyBatch = (
  runId: string,
  decisions: readonly SyncApplyDecision[],
) => Promise<ApplyBatchResult>;

export async function applyDecisionsInBatches({
  runId,
  decisions,
  applyBatch,
  onProgress,
  batchSize = ACT_SYNC_BATCH_SIZE,
}: {
  runId: string;
  decisions: readonly SyncApplyDecision[];
  applyBatch: ApplyBatch;
  onProgress?: (progress: BatchApplyProgress) => void;
  batchSize?: number;
}): Promise<BatchApplyOutcome> {
  const failed: FailedSyncDecision[] = [];
  const completedRowIds: string[] = [];
  let completed = 0;
  onProgress?.({
    processed: 0,
    total: decisions.length,
    completed,
    failed: 0,
    completedRowIds: [],
  });

  for (let offset = 0; offset < decisions.length; offset += batchSize) {
    const batch = decisions.slice(offset, offset + batchSize);
    let response: ApplyBatchResult;
    try {
      response = await applyBatch(runId, batch);
    } catch {
      return {
        completed,
        failed,
        pending: decisions.slice(offset),
        interruptedError:
          "The import connection was interrupted. Retry the remaining contacts.",
      };
    }
    if (!response.ok) {
      return {
        completed,
        failed,
        pending: decisions.slice(offset),
        interruptedError: response.error,
      };
    }

    const results = new Map(
      response.result.rows.map((row) => [row.rowId, row]),
    );
    for (const decision of batch) {
      const result = results.get(decision.rowId);
      if (result?.status === "completed" || result?.status === "skipped") {
        completed += 1;
        completedRowIds.push(decision.rowId);
      } else {
        failed.push({
          decision,
          error:
            result?.error ??
            "Act! did not return a result for this contact. Try again.",
        });
      }
    }
    onProgress?.({
      processed: Math.min(offset + batch.length, decisions.length),
      total: decisions.length,
      completed,
      failed: failed.length,
      completedRowIds: [...completedRowIds],
    });
  }

  return {
    completed,
    failed,
    pending: [],
    interruptedError: null,
  };
}
```

- [ ] **Step 4: Run the batch-runner tests**

Run:

```bash
npm test -- tests/unit/act-sync-batch-apply.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit the batch runner**

```bash
git add features/act-sync/apply-decisions-in-batches.ts tests/unit/act-sync-batch-apply.test.ts
git commit -m "feat: batch Act sync decisions"
```

---

### Task 4: Replace global defaults with category-only approval

**Files:**
- Modify: `components/act-sync/act-sync-review.tsx:14-49, 240-270, 412-439`
- Modify: `tests/unit/act-sync-review.test.tsx:171-250`

**Interfaces:**
- Consumes: `safeDecisionForCategory` and `decisionsForCategory` from Task 1.
- Produces: a category-specific button and a decision map containing only the active category.

- [ ] **Step 1: Replace the old bulk-approval UI test**

Add this type import to `tests/unit/act-sync-review.test.tsx`:

```ts
import type { SyncApplyDecision } from "@/features/act-sync/sync-service";
```

Replace `"bulk-approves only safe default decisions before apply"` in
`tests/unit/act-sync-review.test.tsx` with:

```ts
it("bulk-approves only the category being viewed and clears hidden choices", async () => {
  const user = userEvent.setup();
  const apply = vi.fn(async (
    runId: string,
    decisions: readonly SyncApplyDecision[],
  ) => ({
    ok: true as const,
    result: {
      runId,
      rows: decisions.map((decision) => ({
        rowId: decision.rowId,
        status: "completed" as const,
        error: null,
      })),
    },
  }));
  render(
    <ActSyncReview
      applyAction={apply}
      configured
      initialPreview={preview}
      maskedDatabase="••••3125"
    />,
  );

  await user.click(screen.getByRole("tab", { name: "Changed in app 1" }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Decision for changed-app" }),
    "push",
  );
  await user.click(screen.getByRole("tab", { name: "New in Act! 1" }));
  await user.click(
    screen.getByRole("button", { name: "Approve only New in Act! (1)" }),
  );

  expect(screen.getByText("1 row approved")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Apply 1 approved" }));
  expect(apply).toHaveBeenCalledWith("run-1", [
    { rowId: "new-act", decision: "pull" },
  ]);
});
```

Add this test:

```ts
it("does not offer bulk approval for a conflict category", async () => {
  const user = userEvent.setup();
  render(
    <ActSyncReview
      configured
      initialPreview={preview}
      maskedDatabase="••••3125"
    />,
  );

  await user.click(screen.getByRole("tab", { name: "Changed in both 1" }));

  expect(
    screen.queryByRole("button", { name: /Approve only/ }),
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the component tests and verify the old UI fails**

Run:

```bash
npm test -- tests/unit/act-sync-review.test.tsx
```

Expected: FAIL because the category-specific button is missing and the old
global button still exists.

- [ ] **Step 3: Implement active-category approval**

In `components/act-sync/act-sync-review.tsx`:

1. Import `decisionsForCategory` and `safeDecisionForCategory`.
2. Delete the local `safeDefaults` constant.
3. Replace `approveSafeDefaults` with:

```ts
function approveActiveCategory() {
  if (!initialPreview) return;
  const approved = decisionsForCategory(
    initialPreview.rows,
    activeCategory,
  );
  setDecisions(
    new Map(
      approved.map(({ rowId, ...decision }) => [rowId, decision]),
    ),
  );
}
```

4. Derive the active default next to `visibleRows`:

```ts
const activeSafeDecision = safeDecisionForCategory(activeCategory);
```

5. Replace the global button with:

```tsx
{activeSafeDecision && visibleRows.length > 0 ? (
  <button
    className="button-secondary"
    disabled={busy}
    onClick={approveActiveCategory}
    type="button"
  >
    Approve only {categoryLabels[activeCategory]} ({visibleRows.length})
  </button>
) : null}
```

- [ ] **Step 4: Run category and component tests**

Run:

```bash
npm test -- tests/unit/act-sync-category-approval.test.ts tests/unit/act-sync-review.test.tsx
```

Expected: all focused tests PASS, including the existing explicit conflict
choice test.

- [ ] **Step 5: Commit the category-only UI**

```bash
git add components/act-sync/act-sync-review.tsx tests/unit/act-sync-review.test.tsx
git commit -m "feat: approve only visible Act category"
```

---

### Task 5: Add progress, continued failures, and retry controls

**Files:**
- Modify: `components/act-sync/act-sync-review.tsx:122-218, 220-324, 366-450`
- Modify: `tests/unit/act-sync-review.test.tsx`

**Interfaces:**
- Consumes: `applyDecisionsInBatches`, `BatchApplyProgress`, and the existing `applyAction`.
- Produces: visible batch progress, per-row errors, `Retry failed contacts`, and `Retry remaining contacts`.

- [ ] **Step 1: Add component tests for batching and row-failure continuation**

Update the Testing Library import to:

```ts
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
```

Add this helper below the existing `preview` fixture:

```ts
function previewWithNewActRows(count: number): StoredSyncPreview {
  const newRows = Array.from({ length: count }, (_, index) =>
    row("new_in_act", `new-act-${index + 1}`),
  );
  return {
    ...preview,
    rows: newRows,
    summary: {
      new_in_act: count,
      new_in_app: 0,
      changed_in_act: 0,
      changed_in_app: 0,
      changed_in_both: 0,
      possible_match: 0,
      already_matched: 0,
      missing_from_act: 0,
      error: 0,
    },
  };
}
```

Then add:

```ts
it("applies approved contacts in 50-row batches and reports completion", async () => {
  const user = userEvent.setup();
  const largePreview = previewWithNewActRows(51);
  const apply = vi.fn(async (
    runId: string,
    decisions: readonly SyncApplyDecision[],
  ) => ({
    ok: true as const,
    result: {
      runId,
      rows: decisions.map((decision) => ({
        rowId: decision.rowId,
        status: "completed" as const,
        error: null,
      })),
    },
  }));
  render(
    <ActSyncReview
      applyAction={apply}
      configured
      initialPreview={largePreview}
      maskedDatabase="••••3125"
    />,
  );

  await user.click(
    screen.getByRole("button", { name: "Approve only New in Act! (51)" }),
  );
  await user.click(screen.getByRole("button", { name: "Apply 51 approved" }));

  expect(apply).toHaveBeenCalledTimes(2);
  expect(apply.mock.calls[0]![1]).toHaveLength(50);
  expect(apply.mock.calls[1]![1]).toHaveLength(1);
  expect(await screen.findByText("51 contacts imported.")).toBeVisible();
});

it("continues after a contact failure and retries only the failed contact", async () => {
  const user = userEvent.setup();
  const largePreview = previewWithNewActRows(51);
  let shouldFail = true;
  const apply = vi.fn(async (
    runId: string,
    decisions: readonly SyncApplyDecision[],
  ) => ({
    ok: true as const,
    result: {
      runId,
      rows: decisions.map((decision) => ({
        rowId: decision.rowId,
        status:
          shouldFail && decision.rowId === "new-act-2"
            ? "failed" as const
            : "completed" as const,
        error:
          shouldFail && decision.rowId === "new-act-2"
            ? "Try this contact again."
            : null,
      })),
    },
  }));
  render(
    <ActSyncReview
      applyAction={apply}
      configured
      initialPreview={largePreview}
      maskedDatabase="••••3125"
    />,
  );

  await user.click(
    screen.getByRole("button", { name: "Approve only New in Act! (51)" }),
  );
  await user.click(screen.getByRole("button", { name: "Apply 51 approved" }));

  expect(apply).toHaveBeenCalledTimes(2);
  expect(await screen.findByText("50 imported · 1 needs retry.")).toBeVisible();
  expect(screen.getByText("Try this contact again.")).toBeVisible();

  shouldFail = false;
  await user.click(
    screen.getByRole("button", { name: "Retry failed contacts" }),
  );

  expect(apply).toHaveBeenCalledTimes(3);
  expect(apply.mock.calls[2]![1]).toEqual([
    { rowId: "new-act-2", decision: "pull" },
  ]);
});
```

Add this deferred-promise test:

```ts
it("disables review controls and shows live progress while importing", async () => {
  const user = userEvent.setup();
  const largePreview = previewWithNewActRows(51);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const apply = vi.fn(async (
    runId: string,
    decisions: readonly SyncApplyDecision[],
  ) => {
    await gate;
    return {
      ok: true as const,
      result: {
        runId,
        rows: decisions.map((decision) => ({
          rowId: decision.rowId,
          status: "completed" as const,
          error: null,
        })),
      },
    };
  });
  render(
    <ActSyncReview
      applyAction={apply}
      configured
      initialPreview={largePreview}
      maskedDatabase="••••3125"
    />,
  );

  await user.click(
    screen.getByRole("button", { name: "Approve only New in Act! (51)" }),
  );
  await user.click(screen.getByRole("button", { name: "Apply 51 approved" }));
  await waitFor(() => expect(apply).toHaveBeenCalledOnce());

  expect(screen.getByText("Importing 0 of 51…")).toBeVisible();
  expect(screen.getByRole("tab", { name: "Changed in both 0" })).toBeDisabled();
  expect(
    screen.getByRole("combobox", { name: "Decision for new-act-1" }),
  ).toBeDisabled();

  await act(async () => {
    release();
  });
  expect(await screen.findByText("51 contacts imported.")).toBeVisible();
});
```

- [ ] **Step 2: Run the review tests and verify the single-request flow fails**

Run:

```bash
npm test -- tests/unit/act-sync-review.test.tsx
```

Expected: FAIL because 51 rows are sent in one request, progress is absent,
row controls remain enabled, and retry copy is absent.

- [ ] **Step 3: Add apply state and row-level error display**

In `ActSyncReview`, add:

```ts
const [applyProgress, setApplyProgress] =
  useState<BatchApplyProgress | null>(null);
const [applySummary, setApplySummary] = useState<string | null>(null);
const [rowErrors, setRowErrors] = useState<Map<string, string>>(
  () => new Map(),
);
const [retryMode, setRetryMode] =
  useState<"failed" | "remaining" | null>(null);
```

Extend `SyncRow` with `disabled: boolean` and `error: string | undefined`.
Set `disabled={disabled}` on both selects and render:

```tsx
{error ? (
  <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">
    {error}
  </p>
) : null}
```

Pass `busy` and `rowErrors.get(row.rowId)` from the parent. Also set
`disabled={busy}` on every category tab.

- [ ] **Step 4: Replace the single apply call with the batch runner**

Import `applyDecisionsInBatches` and `BatchApplyProgress`. Replace
`applyApproved` with:

```ts
async function applyApproved() {
  if (!initialPreview || decisions.size === 0) return;
  setBusy(true);
  setStatus(null);
  setApplySummary(null);
  setRowErrors(new Map());
  const input = [...decisions].map(([rowId, value]) => ({
    rowId,
    ...value,
  }));
  const rowsById = new Map(
    initialPreview.rows.map((row) => [row.rowId, row]),
  );
  const newActOnly = input.every(
    (decision) => rowsById.get(decision.rowId)?.category === "new_in_act",
  );

  const outcome = await applyDecisionsInBatches({
    runId: initialPreview.id,
    decisions: input,
    applyBatch: applyAction,
    onProgress: (progress) => {
      setApplyProgress(progress);
      setDecisions((current) => {
        const next = new Map(current);
        progress.completedRowIds.forEach((rowId) => next.delete(rowId));
        return next;
      });
    },
  });
  const retryDecisions = [
    ...outcome.failed.map((failure) => failure.decision),
    ...outcome.pending,
  ];
  setDecisions(
    new Map(
      retryDecisions.map(({ rowId, ...decision }) => [rowId, decision]),
    ),
  );
  setRowErrors(
    new Map(
      outcome.failed.map((failure) => [
        failure.decision.rowId,
        failure.error,
      ]),
    ),
  );

  if (outcome.interruptedError) {
    setApplySummary(outcome.interruptedError);
    setRetryMode("remaining");
  } else if (outcome.failed.length > 0) {
    setApplySummary(
      newActOnly
        ? `${outcome.completed} imported · ${outcome.failed.length} ${
            outcome.failed.length === 1 ? "needs" : "need"
          } retry.`
        : `${outcome.completed} completed · ${outcome.failed.length} ${
            outcome.failed.length === 1 ? "needs" : "need"
          } retry.`,
    );
    setRetryMode("failed");
  } else {
    setApplySummary(
      newActOnly
        ? `${outcome.completed} contacts imported.`
        : `${outcome.completed} approved changes completed.`,
    );
    setRetryMode(null);
  }
  setApplyProgress(null);
  setBusy(false);
  router.refresh();
}
```

When `setRowDecision` or `approveActiveCategory` changes decisions, clear the
affected row error, `applySummary`, and `retryMode` so old results cannot be
mistaken for the next apply.

- [ ] **Step 5: Render progress and retry copy inside the sticky bar**

Replace the sticky bar's primary status paragraph with:

```tsx
<p aria-live="polite" className="font-bold">
  {applyProgress
    ? `Importing ${applyProgress.processed} of ${applyProgress.total}…`
    : applySummary ??
      `${decisions.size} ${
        decisions.size === 1 ? "row" : "rows"
      } approved`}
</p>
```

Use this label for the primary action:

```tsx
{retryMode === "failed"
  ? "Retry failed contacts"
  : retryMode === "remaining"
    ? "Retry remaining contacts"
    : `Apply ${decisions.size} approved`}
```

Keep the button disabled when `busy` or when `decisions.size === 0`.

- [ ] **Step 6: Run UI and batch-runner tests**

Run:

```bash
npm test -- tests/unit/act-sync-review.test.tsx tests/unit/act-sync-batch-apply.test.ts
```

Expected: all focused tests PASS. The 51-contact UI test makes exactly two
action calls, and the retry test's third call contains one decision.

- [ ] **Step 7: Commit the progress and retry UI**

```bash
git add components/act-sync/act-sync-review.tsx tests/unit/act-sync-review.test.tsx
git commit -m "feat: show Act import progress and retries"
```

---

### Task 6: Update operator guidance and verify the complete feature

**Files:**
- Modify: `docs/operations/act-sync.md:22-55`

**Interfaces:**
- Consumes: the completed category-only batch workflow.
- Produces: accurate operating instructions for the shared Act! account.

- [ ] **Step 1: Replace the first-sync apply instructions**

In `docs/operations/act-sync.md`, replace steps 3-5 under
`First connection and preview` with:

```markdown
3. Open one category and press **Approve only [category] ([count])**. This
   clears hidden selections and approves only the category being viewed.
4. Press **Apply [count] approved**. The app imports in batches of 50 and shows
   progress in the sticky action bar.
5. If individual contacts fail, let the remaining batches finish, review the
   failed rows, and press **Retry failed contacts**. If the connection is
   interrupted, press **Retry remaining contacts** after connectivity returns.
6. Resolve Changed in both and Possible matches one row at a time. These
   categories never have a bulk-approval action.
7. Verify a small sample in Contacts before moving to another category.
```

Add this paragraph immediately afterward:

```markdown
Importing **New in Act!** creates Command Center contacts only and never writes
to the shared Act! account. Do not approve **New in app** unless those contacts
are intentionally meant to be created in Act!.
```

- [ ] **Step 2: Run formatting, type, lint, and full test checks**

Run:

```bash
git diff --check
npm run typecheck
npm run lint
npm test
```

Expected: every command exits 0.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: Next.js production build exits 0 and includes
`/settings/act-sync`.

- [ ] **Step 4: Inspect the final diff for safety boundaries**

Run:

```bash
git diff --stat HEAD~5
git diff HEAD~5 -- features/act-sync components/act-sync docs/operations/act-sync.md
```

Confirm from the diff that:

- no dependency or environment-variable changes were added;
- `new_in_act` + `pull` is the only snapshot shortcut;
- category bulk approval replaces rather than supplements the global action;
- batch size is exactly 50;
- conflicts and possible matches have no bulk action; and
- no automatic sync path exists.

- [ ] **Step 5: Commit the operations guide**

```bash
git add docs/operations/act-sync.md
git commit -m "docs: explain safe Act category imports"
```

- [ ] **Step 6: Record the verification evidence**

Run:

```bash
git status --short
git log -6 --oneline
```

Expected: the worktree is clean and the six feature commits appear in newest
first order.
