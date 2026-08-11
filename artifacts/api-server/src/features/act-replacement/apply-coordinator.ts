import type { ActApplyService, ApplyBatchStatus } from "./apply-service";
import type { ApplyBatchRecord, StoredApproval } from "./apply-repository";

export const MAX_ACT_APPLY_BATCH_SIZE = 25;

export type ApplyCoordinatorInput = {
  runId: string;
  approvalRequestKey: string;
  expectedManifestDigest: string;
  requestedBy: string;
  batchSize: number;
  retryFailed?: boolean;
};

export type ApplyCoordinatorStatus = {
  batch: ApplyBatchStatus;
  nextCursor: number;
  hasMore: boolean;
  requiresReview: boolean;
};

export type ApplyCoordinatorStore = {
  getApproval(runId: string, requestKey: string): Promise<StoredApproval | null>;
  listApprovalBatches(runId: string, approvalRequestKey: string): Promise<ApplyBatchRecord[]>;
  updateRunPhase(runId: string, phase: "ready_to_apply" | "applying" | "complete" | "complete_with_issues", errorCode?: string): Promise<void>;
};

function codedError(code: string, status: number) {
  return Object.assign(new Error(code), { code, status });
}

const batchStatus = (batch: ApplyBatchRecord): ApplyBatchStatus => ({
  batchId: batch.batchId,
  runId: batch.runId,
  manifestDigest: batch.manifestDigest,
  state: batch.state,
  operationCount: batch.operationIds.length,
  completedCount: batch.completed,
  alreadyPresentCount: batch.alreadyPresent,
  blockedCount: batch.blocked,
  failedCount: batch.failed,
});

function successful(batch: ApplyBatchRecord) {
  return batch.state === "complete" && batch.blocked === 0 && batch.failed === 0;
}

export class ActApplyCoordinator {
  constructor(
    private readonly service: Pick<ActApplyService, "apply">,
    private readonly store: ApplyCoordinatorStore,
  ) {}

  async applyNext(input: ApplyCoordinatorInput): Promise<ApplyCoordinatorStatus> {
    if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > MAX_ACT_APPLY_BATCH_SIZE) {
      throw codedError("invalid_apply_batch_size", 400);
    }
    const approval = await this.store.getApproval(input.runId, input.approvalRequestKey);
    if (!approval) throw codedError("approval_not_found", 409);
    if (approval.manifestDigest !== input.expectedManifestDigest) throw codedError("manifest_digest_mismatch", 409);

    const batches = await this.store.listApprovalBatches(input.runId, input.approvalRequestKey);
    let cursor = 0;
    let lastSuccessful: ApplyBatchRecord | undefined;
    for (;;) {
      const candidates = batches.filter((batch) => batch.startCursor === cursor);
      const success = candidates.find((batch) => successful(batch));
      if (!success) break;
      if (success.operationIds.length < 1 || success.operationIds.length > MAX_ACT_APPLY_BATCH_SIZE)
        throw codedError("approval_batch_mismatch", 409);
      const expected = approval.approvedOperationIds.slice(cursor, cursor + success.operationIds.length);
      if (JSON.stringify(success.operationIds) !== JSON.stringify(expected)) throw codedError("approval_batch_mismatch", 409);
      cursor += success.operationIds.length;
      lastSuccessful = success;
    }

    if (cursor >= approval.approvedOperationIds.length) {
      if (!lastSuccessful) throw codedError("approval_empty", 409);
      await this.store.updateRunPhase(input.runId, "complete");
      return { batch: batchStatus(lastSuccessful), nextCursor: cursor, hasMore: false, requiresReview: false };
    }

    const atCursor = batches.filter((batch) => batch.startCursor === cursor);
    const issue = atCursor.find((batch) => batch.state === "complete_with_issues" && (batch.blocked > 0 || batch.failed > 0));
    if (issue && (!input.retryFailed || issue.blocked > 0)) {
      await this.store.updateRunPhase(input.runId, "complete_with_issues", issue.blocked > 0 ? "apply_blocked" : "apply_failed");
      return { batch: batchStatus(issue), nextCursor: cursor, hasMore: true, requiresReview: true };
    }

    const active = atCursor.find((batch) => batch.state === "queued" || batch.state === "applying");
    const ids = approval.approvedOperationIds.slice(cursor, cursor + input.batchSize);
    const retryNumber = atCursor.filter((batch) => batch.state === "complete_with_issues").length;
    const requestKey = active?.requestKey ?? (retryNumber ? `${input.approvalRequestKey}:${cursor}:retry:${retryNumber}` : `${input.approvalRequestKey}:${cursor}`);
    const applied = await this.service.apply({
      runId: input.runId,
      approvedOperationIds: ids,
      expectedManifestDigest: approval.manifestDigest,
      requestKey,
      approvalRequestKey: input.approvalRequestKey,
      startCursor: cursor,
      requestedBy: input.requestedBy,
      retryFailed: input.retryFailed === true,
    });
    const completed = applied.state === "complete" && applied.blockedCount === 0 && applied.failedCount === 0;
    const nextCursor = completed ? cursor + ids.length : cursor;
    const requiresReview = applied.blockedCount > 0 || applied.failedCount > 0 || applied.state === "complete_with_issues";
    const hasMore = nextCursor < approval.approvedOperationIds.length;
    await this.store.updateRunPhase(
      input.runId,
      requiresReview ? "complete_with_issues" : hasMore ? "applying" : "complete",
      requiresReview ? (applied.blockedCount > 0 ? "apply_blocked" : "apply_failed") : undefined,
    );
    return { batch: applied, nextCursor, hasMore, requiresReview };
  }
}
