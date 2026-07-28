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

function completedBatch(
  runId: string,
  batch: readonly SyncApplyDecision[],
) {
  return {
    ok: true as const,
    result: {
      runId,
      rows: batch.map((decision) => ({
        rowId: decision.rowId,
        status: "completed" as const,
        error: null,
      })),
    },
  };
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

  it("rejects a batch size outside the adjustable 1 through 50 integer range", async () => {
    const applyBatch = vi.fn(async (
      runId: string,
      batch: readonly SyncApplyDecision[],
    ) => completedBatch(runId, batch));

    for (const batchSize of [0, -1, 1.5, Number.NaN, 51]) {
      await expect(
        applyDecisionsInBatches({
          runId: "run-1",
          decisions: decisions(1),
          applyBatch,
          batchSize,
        }),
      ).rejects.toThrow("Batch size must be a positive integer no greater than 50.");
    }

    expect(applyBatch).not.toHaveBeenCalled();
  });

  it("runs no more than one batch at a time", async () => {
    const resolvers: Array<() => void> = [];
    let inFlight = 0;
    let maximumInFlight = 0;
    const applyBatch = vi.fn((
      runId: string,
      batch: readonly SyncApplyDecision[],
    ) => new Promise<ReturnType<typeof completedBatch>>((resolve) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      resolvers.push(() => {
        inFlight -= 1;
        resolve(completedBatch(runId, batch));
      });
    }));

    const applying = applyDecisionsInBatches({
      runId: "run-1",
      decisions: decisions(2),
      applyBatch,
      batchSize: 1,
    });

    await vi.waitFor(() => expect(applyBatch).toHaveBeenCalledTimes(1));
    expect(maximumInFlight).toBe(1);
    resolvers.shift()?.();
    await vi.waitFor(() => expect(applyBatch).toHaveBeenCalledTimes(2));
    expect(maximumInFlight).toBe(1);
    resolvers.shift()?.();
    await applying;
  });

  it("marks a decision failed when its batch omits a row result", async () => {
    const input = decisions(2);
    const outcome = await applyDecisionsInBatches({
      runId: "run-1",
      decisions: input,
      applyBatch: async (runId, batch) => ({
        ok: true as const,
        result: {
          runId,
          rows: [
            {
              rowId: batch[0]!.rowId,
              status: "completed" as const,
              error: null,
            },
          ],
        },
      }),
    });

    expect(outcome).toEqual({
      completed: 1,
      failed: [
        {
          decision: input[1],
          error: "Act! did not return a result for this contact. Try again.",
        },
      ],
      pending: [],
      interruptedError: null,
    });
  });

  it("collects row failures across successful batches", async () => {
    const input = decisions(4);
    const outcome = await applyDecisionsInBatches({
      runId: "run-1",
      decisions: input,
      batchSize: 2,
      applyBatch: async (runId, batch) => ({
        ok: true as const,
        result: {
          runId,
          rows: batch.map((decision) => ({
            rowId: decision.rowId,
            status: decision.rowId === "row-2" || decision.rowId === "row-4"
              ? "failed" as const
              : "completed" as const,
            error: decision.rowId === "row-2" || decision.rowId === "row-4"
              ? `Retry ${decision.rowId}.`
              : null,
          })),
        },
      }),
    });

    expect(outcome).toMatchObject({
      completed: 2,
      failed: [
        { decision: input[1], error: "Retry row-2." },
        { decision: input[3], error: "Retry row-4." },
      ],
      pending: [],
      interruptedError: null,
    });
  });

  it("preserves remaining rows after an interruption following a completed batch", async () => {
    const input = decisions(3);
    const applyBatch = vi.fn(async (
      runId: string,
      batch: readonly SyncApplyDecision[],
    ) => {
      if (batch[0]?.rowId === "row-3") {
        return { ok: false as const, error: "The connection was interrupted." };
      }
      return completedBatch(runId, batch);
    });

    const outcome = await applyDecisionsInBatches({
      runId: "run-1",
      decisions: input,
      applyBatch,
      batchSize: 2,
    });

    expect(outcome).toMatchObject({
      completed: 2,
      failed: [],
      pending: [input[2]],
      interruptedError: "The connection was interrupted.",
    });
  });
});
