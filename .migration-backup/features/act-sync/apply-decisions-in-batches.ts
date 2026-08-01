import type {
  SyncApplyDecision,
  SyncApplyRowResult,
} from "@/features/act-sync/sync-service";

export const ACT_SYNC_BATCH_SIZE = 50;

export type BatchApplyProgress = {
  processed: number;
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  settledRowIds: string[];
};

export type FailedSyncDecision = {
  decision: SyncApplyDecision;
  error: string;
  retryable: boolean;
};

export type BatchApplyOutcome = {
  completed: number;
  skipped: number;
  failed: FailedSyncDecision[];
  pending: SyncApplyDecision[];
  interruptedError: string | null;
};

type ApplyBatchResult =
  | {
      ok: true;
      result: { runId: string; rows: SyncApplyRowResult[] };
    }
  | {
      ok: false;
      error: string;
      interruptedRow?: SyncApplyRowResult;
      processedRows?: SyncApplyRowResult[];
    };

type ApplyBatch = (
  runId: string,
  decisions: readonly SyncApplyDecision[],
  context: { queueToken: string | null },
) => Promise<ApplyBatchResult>;

type PrepareBatch = (
  runId: string,
  decisions: readonly SyncApplyDecision[],
  context: {
    replaceExisting: boolean;
    queueToken: string | null;
  },
) => Promise<
  | { ok: true; runId?: string; queueToken?: string }
  | { ok: false; error: string }
>;

export async function applyDecisionsInBatches({
  runId,
  decisions,
  prepareBatch,
  applyBatch,
  onProgress,
  batchSize = ACT_SYNC_BATCH_SIZE,
}: {
  runId: string;
  decisions: readonly SyncApplyDecision[];
  prepareBatch?: PrepareBatch;
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

  const queuedDecisions = decisions.map((decision) => ({ ...decision }));
  const failed: FailedSyncDecision[] = [];
  const settledRowIds: string[] = [];
  let completed = 0;
  let skipped = 0;
  let queueToken: string | null = null;
  if (prepareBatch) {
    for (
      let offset = 0;
      offset < queuedDecisions.length;
      offset += batchSize
    ) {
      const batch = queuedDecisions
        .slice(offset, offset + batchSize)
        .map((decision) => ({ ...decision }));
      try {
        const prepared = await prepareBatch(runId, batch, {
          replaceExisting: offset === 0,
          queueToken,
        });
        if (!prepared.ok) {
          return {
            completed,
            skipped,
            failed,
            pending: queuedDecisions.map((decision) => ({ ...decision })),
            interruptedError: prepared.error,
          };
        }
        if (prepared.queueToken) queueToken = prepared.queueToken;
      } catch {
        return {
          completed,
          skipped,
          failed,
          pending: queuedDecisions.map((decision) => ({ ...decision })),
          interruptedError:
            "The approved decisions could not be saved. Try again.",
        };
      }
    }
  }
  onProgress?.({
    processed: 0,
    total: queuedDecisions.length,
    completed,
    skipped,
    failed: 0,
    settledRowIds: [],
  });

  for (
    let offset = 0;
    offset < queuedDecisions.length;
    offset += batchSize
  ) {
    const batch = queuedDecisions
      .slice(offset, offset + batchSize)
      .map((decision) => ({ ...decision }));
    let response: ApplyBatchResult;
    try {
      response = await applyBatch(runId, batch, { queueToken });
    } catch {
      return {
        completed,
        skipped,
        failed,
        pending: queuedDecisions
          .slice(offset)
          .map((decision) => ({ ...decision })),
        interruptedError:
          "The import connection was interrupted. Retry the remaining contacts.",
      };
    }
    if (!response.ok) {
      const reportedRows = [...(response.processedRows ?? [])];
      if (
        response.interruptedRow &&
        !reportedRows.some(
          ({ rowId }) => rowId === response.interruptedRow?.rowId,
        )
      ) {
        reportedRows.push(response.interruptedRow);
      }
      const results = new Map(
        reportedRows.map((row) => [row.rowId, row]),
      );
      const processedRowIds = new Set<string>();
      let processedInBatch = 0;
      for (const [index, decision] of batch.entries()) {
        const result = results.get(decision.rowId);
        if (!result) continue;
        processedRowIds.add(decision.rowId);
        processedInBatch = index + 1;
        if (result.status === "completed") {
          completed += 1;
          settledRowIds.push(decision.rowId);
        } else if (result.status === "skipped") {
          skipped += 1;
          settledRowIds.push(decision.rowId);
        } else {
          failed.push({
            decision: { ...decision },
            error: result.error ?? response.error,
            retryable: result.retryable !== false,
          });
        }
      }
      if (processedRowIds.size > 0) {
        onProgress?.({
          processed: Math.min(
            offset + processedInBatch,
            queuedDecisions.length,
          ),
          total: queuedDecisions.length,
          completed,
          skipped,
          failed: failed.length,
          settledRowIds: [...settledRowIds],
        });
      }
      return {
        completed,
        skipped,
        failed,
        pending: queuedDecisions
          .slice(offset)
          .filter(({ rowId }) => !processedRowIds.has(rowId))
          .map((decision) => ({ ...decision })),
        interruptedError: response.error,
      };
    }

    const results = new Map(
      response.result.rows.map((row) => [row.rowId, row]),
    );
    for (const decision of batch) {
      const result = results.get(decision.rowId);
      if (result?.status === "completed") {
        completed += 1;
        settledRowIds.push(decision.rowId);
      } else if (result?.status === "skipped") {
        skipped += 1;
        settledRowIds.push(decision.rowId);
      } else {
        failed.push({
          decision: { ...decision },
          error:
            result?.error ??
            "Act! did not return a result for this contact. Try again.",
          retryable: result?.retryable !== false,
        });
      }
    }
    onProgress?.({
      processed: Math.min(offset + batch.length, queuedDecisions.length),
      total: queuedDecisions.length,
      completed,
      skipped,
      failed: failed.length,
      settledRowIds: [...settledRowIds],
    });
  }

  return {
    completed,
    skipped,
    failed,
    pending: [],
    interruptedError: null,
  };
}
