import { describe, expect, it, vi } from "vitest";

import {
  ActMigrationApplyService,
  type ActMigrationApplyTarget,
} from "@/features/act-migration/apply-service";
import type {
  ActMigrationApplyRepository,
  MigrationApplyBatch,
  MigrationApplyCounts,
  MigrationApplyOperation,
  MigrationApplyWorkspace,
} from "@/features/act-migration/apply-repository";
import type { MigrationApplyManifest } from "@/features/act-migration/apply-types";

const runId = "11111111-1111-4111-8111-111111111111";
const batchId = "22222222-2222-4222-8222-222222222222";

const counts: MigrationApplyCounts = {
  pending: 0, leased: 0, blocked: 0, applied: 0, ignored: 0, failed: 0, total: 0,
};

const manifest = {
  sourceDigest: "source",
  previewProposalDigest: "proposal",
  entries: [],
  counts: {
    proposalTotal: 0, runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0,
    byTarget: {
      organization: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
      contact: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
      organization_contact: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
      booking: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
      booking_contact: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
      calling_list: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
      calling_list_member: { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 },
    },
  },
  digest: "manifest",
} satisfies MigrationApplyManifest;

function batch(created = true): MigrationApplyBatch & { created: boolean } {
  return {
    id: batchId, requestKey: "33333333-3333-4333-8333-333333333333", runId,
    requestedBy: "owner", status: "applying", manifestDigest: "manifest", summary: counts,
    lastErrorCode: null, startedAt: null, completedAt: null, created,
  };
}

function operation(index: number): MigrationApplyOperation {
  return {
    id: `operation-${index}`, batchId, runId, proposalKey: `organization:${index}`,
    targetEntityType: "organization", dependencyProposalKeys: [], resolvedDependencies: [], status: "leased",
    attemptCount: 1, leaseOwner: "worker", leaseExpiresAt: null, appliedEntityId: null,
    errorCode: null, retryable: true,
    proposal: {
      proposalKey: `organization:${index}`, state: "new", reviewState: "decided",
      targetEntityType: "organization", sourceRecordKeys: [], candidateLocalIds: [],
      proposedLocalId: null, proposedPrimarySourceId: null, issueCode: null,
      dependencyProposalKeys: [], matchReason: "fixture", displaySnapshot: {},
      decision: "approve_proposed", chosenLocalEntityId: null, primarySourceId: null,
    },
  };
}

function workspace(): MigrationApplyWorkspace {
  return { runId, runStatus: "applying", counts, batches: [batch()] };
}

function repository(overrides: Partial<ActMigrationApplyRepository> = {}) {
  return {
    createBatchIfAbsent: vi.fn().mockResolvedValue(batch()),
    claimNextOperation: vi.fn().mockResolvedValue(null),
    completeOperation: vi.fn().mockResolvedValue(undefined),
    failOperation: vi.fn().mockResolvedValue(undefined),
    releaseExpiredLeases: vi.fn().mockResolvedValue(0),
    getApplyWorkspace: vi.fn().mockResolvedValue(workspace()),
    ...overrides,
  } satisfies ActMigrationApplyRepository;
}

describe("ActMigrationApplyService", () => {
  it("reuses request keys and returns only the safe apply summary", async () => {
    const store = repository({ createBatchIfAbsent: vi.fn().mockResolvedValue(batch(false)) });
    const service = new ActMigrationApplyService(store, {});

    await expect(service.start({
      requestKey: "33333333-3333-4333-8333-333333333333", runId, requestedBy: "owner", manifest,
    })).resolves.toEqual({
      runId, batchId, changed: false, counts, retryable: false, retryAfter: null, errorCode: null,
    });
    expect(store.createBatchIfAbsent).toHaveBeenCalledOnce();
  });

  it("continues at most 25 operations serially and commits each target before queue completion", async () => {
    const operations = Array.from({ length: 26 }, (_, index) => operation(index));
    const store = repository({
      claimNextOperation: vi.fn().mockImplementation(async () => operations.shift() ?? null),
    });
    const applied: string[] = [];
    const target: ActMigrationApplyTarget = {
      apply: async (value) => {
        expect(store.completeOperation).not.toHaveBeenCalledWith(expect.objectContaining({ operationId: value.id }));
        applied.push(value.id);
        return { entityId: `entity-${value.id}`, changed: true };
      },
    };
    const service = new ActMigrationApplyService(store, { organization: target });

    const result = await service.continue({ runId, batchId });

    expect(result.changed).toBe(true);
    expect(applied).toHaveLength(25);
    expect(store.completeOperation).toHaveBeenCalledTimes(25);
    expect(store.claimNextOperation).toHaveBeenCalledTimes(25);
  });

  it("retry processes only operations the queue presents as retryable", async () => {
    const retryable = operation(1);
    const store = repository({
      claimNextOperation: vi.fn().mockResolvedValueOnce(retryable).mockResolvedValue(null),
    });
    const apply = vi.fn().mockResolvedValue({ entityId: "entity", changed: true });
    const service = new ActMigrationApplyService(store, { organization: { apply } });

    await service.retry({ runId, batchId });

    expect(apply).toHaveBeenCalledWith(retryable);
    expect(store.completeOperation).toHaveBeenCalledOnce();
  });

  it("sanitizes unexpected target failures before they reach the result", async () => {
    const claimed = operation(1);
    const store = repository({
      claimNextOperation: vi.fn().mockResolvedValueOnce(claimed).mockResolvedValue(null),
    });
    const service = new ActMigrationApplyService(store, {
      organization: { apply: async () => { throw new Error("secret connection string"); } },
    });

    await expect(service.continue({ runId, batchId })).resolves.toMatchObject({
      errorCode: "unknown", retryable: false, retryAfter: null,
    });
    expect(store.failOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: claimed.id, errorCode: "unknown", retryable: false,
    }));
  });
});
