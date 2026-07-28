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
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > ACT_SYNC_BATCH_SIZE
  ) {
    throw new RangeError(
      `Batch size must be a positive integer no greater than ${ACT_SYNC_BATCH_SIZE}.`,
    );
  }

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
