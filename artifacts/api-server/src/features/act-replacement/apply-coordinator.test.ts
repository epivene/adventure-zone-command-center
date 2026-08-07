import { describe, expect, it, vi } from "vitest";

import type { ApplyBatchRecord } from "./apply-repository";
import {
  ActApplyCoordinator,
  type ApplyCoordinatorStore,
} from "./apply-coordinator";

const approvedOperationIds = Array.from(
  { length: 61 },
  (_, index) => `operation-${index}`,
);

function store(
  batches: ApplyBatchRecord[] = [],
): ApplyCoordinatorStore & { updateRunPhase: ReturnType<typeof vi.fn> } {
  return {
    getApproval: vi.fn().mockResolvedValue({
      approvedOperationIds,
      manifestDigest: "digest-1",
    }),
    listApprovalBatches: vi.fn().mockResolvedValue(batches),
    updateRunPhase: vi.fn().mockResolvedValue(undefined),
  };
}

function batch(
  startCursor: number,
  state: ApplyBatchRecord["state"],
  overrides: Partial<ApplyBatchRecord> = {},
): ApplyBatchRecord {
  const operationIds = approvedOperationIds.slice(
    startCursor,
    startCursor + 25,
  );
  return {
    batchId: `batch-${startCursor}`,
    runId: "run-1",
    requestKey: `approval:${startCursor}`,
    approvalRequestKey: "approval",
    startCursor,
    manifestDigest: "digest-1",
    operationIds,
    state,
    completed: state === "complete" ? operationIds.length : 0,
    alreadyPresent: 0,
    blocked: 0,
    failed: 0,
    ...overrides,
  };
}

describe("ActApplyCoordinator", () => {
  it("derives the first 25-operation slice from the durable approval", async () => {
    const apply = vi.fn(async (input: { approvedOperationIds: string[] }) => ({
      batchId: "batch-0",
      runId: "run-1",
      manifestDigest: "digest-1",
      state: "complete" as const,
      operationCount: input.approvedOperationIds.length,
      completedCount: input.approvedOperationIds.length,
      alreadyPresentCount: 0,
      blockedCount: 0,
      failedCount: 0,
    }));
    const coordinatorStore = store();
    const coordinator = new ActApplyCoordinator({ apply }, coordinatorStore);

    const result = await coordinator.applyNext({
      runId: "run-1",
      approvalRequestKey: "approval",
      expectedManifestDigest: "digest-1",
      requestedBy: "owner",
      batchSize: 25,
    });

    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      approvedOperationIds: approvedOperationIds.slice(0, 25),
      requestKey: "approval:0",
      approvalRequestKey: "approval",
      startCursor: 0,
    }));
    expect(result).toMatchObject({ nextCursor: 25, hasMore: true });
    expect(coordinatorStore.updateRunPhase).toHaveBeenCalledWith(
      "run-1",
      "applying",
      undefined,
    );
  });

  it("derives the next cursor only from contiguous successful durable batches", async () => {
    const apply = vi.fn(async () => ({
      batchId: "batch-50",
      runId: "run-1",
      manifestDigest: "digest-1",
      state: "complete" as const,
      operationCount: 11,
      completedCount: 11,
      alreadyPresentCount: 0,
      blockedCount: 0,
      failedCount: 0,
    }));
    const coordinator = new ActApplyCoordinator(
      { apply },
      store([batch(25, "complete"), batch(0, "complete")]),
    );

    const result = await coordinator.applyNext({
      runId: "run-1",
      approvalRequestKey: "approval",
      expectedManifestDigest: "digest-1",
      requestedBy: "owner",
      batchSize: 25,
    });

    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      approvedOperationIds: approvedOperationIds.slice(50),
      startCursor: 50,
    }));
    expect(result).toMatchObject({ nextCursor: 61, hasMore: false });
  });

  it("derives prior cursor widths from durable batches, not the next requested size", async () => {
    const apply = vi.fn(async (input: { approvedOperationIds: string[] }) => ({
      batchId: "batch-25",
      runId: "run-1",
      manifestDigest: "digest-1",
      state: "complete" as const,
      operationCount: input.approvedOperationIds.length,
      completedCount: input.approvedOperationIds.length,
      alreadyPresentCount: 0,
      blockedCount: 0,
      failedCount: 0,
    }));
    const coordinator = new ActApplyCoordinator({ apply }, store([batch(0, "complete")]));

    await coordinator.applyNext({
      runId: "run-1",
      approvalRequestKey: "approval",
      expectedManifestDigest: "digest-1",
      requestedBy: "owner",
      batchSize: 10,
    });

    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      approvedOperationIds: approvedOperationIds.slice(25, 35),
      startCursor: 25,
    }));
  });

  it("does not advance past a non-successful or nonterminal batch", async () => {
    const apply = vi.fn();
    const issue = batch(25, "complete_with_issues", {
      completed: 24,
      blocked: 1,
    });
    const coordinatorStore = store([batch(0, "complete"), issue]);
    const coordinator = new ActApplyCoordinator({ apply }, coordinatorStore);

    const result = await coordinator.applyNext({
      runId: "run-1",
      approvalRequestKey: "approval",
      expectedManifestDigest: "digest-1",
      requestedBy: "owner",
      batchSize: 25,
    });

    expect(apply).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      batch: { state: "complete_with_issues", blockedCount: 1 },
      nextCursor: 25,
      hasMore: true,
      requiresReview: true,
    });
    expect(coordinatorStore.updateRunPhase).toHaveBeenCalledWith(
      "run-1",
      "complete_with_issues",
      "apply_blocked",
    );
  });

  it("never retries a blocked batch without a rebuilt approval", async () => {
    const apply = vi.fn();
    const issue = batch(0, "complete_with_issues", { completed: 24, blocked: 1 });
    const result = await new ActApplyCoordinator({ apply }, store([issue])).applyNext({
      runId: "run-1",
      approvalRequestKey: "approval",
      expectedManifestDigest: "digest-1",
      requestedBy: "owner",
      batchSize: 25,
      retryFailed: true,
    });

    expect(apply).not.toHaveBeenCalled();
    expect(result).toMatchObject({ nextCursor: 0, requiresReview: true });
  });

  it("fails closed when the approval or manifest digest is not durable", async () => {
    const apply = vi.fn();
    const missing = store();
    vi.mocked(missing.getApproval).mockResolvedValue(null);
    await expect(
      new ActApplyCoordinator({ apply }, missing).applyNext({
        runId: "run-1",
        approvalRequestKey: "client-invented",
        expectedManifestDigest: "digest-1",
        requestedBy: "owner",
        batchSize: 25,
      }),
    ).rejects.toMatchObject({ code: "approval_not_found", status: 409 });

    await expect(
      new ActApplyCoordinator({ apply }, store()).applyNext({
        runId: "run-1",
        approvalRequestKey: "approval",
        expectedManifestDigest: "stale-digest",
        requestedBy: "owner",
        batchSize: 25,
      }),
    ).rejects.toMatchObject({ code: "manifest_digest_mismatch", status: 409 });
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects a batch larger than 25 before reading durable state", async () => {
    const apply = vi.fn();
    const coordinatorStore = store();

    await expect(
      new ActApplyCoordinator({ apply }, coordinatorStore).applyNext({
        runId: "run-1",
        approvalRequestKey: "approval",
        expectedManifestDigest: "digest-1",
        requestedBy: "owner",
        batchSize: 26,
      }),
    ).rejects.toMatchObject({ code: "invalid_apply_batch_size", status: 400 });
    expect(coordinatorStore.getApproval).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});
