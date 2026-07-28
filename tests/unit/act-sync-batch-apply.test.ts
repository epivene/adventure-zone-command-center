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
