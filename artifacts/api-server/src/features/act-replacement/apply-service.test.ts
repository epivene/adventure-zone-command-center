import { describe, expect, it, vi } from "vitest";
import { InMemoryApplyRepository } from "./apply-repository";
import { ActApplyService } from "./apply-service";
import type { ManifestOperation } from "./manifest-builder";
const op = (key: string, action: ManifestOperation["action"], payload: Record<string, unknown> = {}, dependencies: string[] = []): ManifestOperation => ({ operationKey: key, sourceRecordId: key, sourceVersionId: `v-${key}`, targetType: "organization", action, payload, dependencyOperationKeys: dependencies, requiredForSourceOutcome: true, safeByDefault: true });
const seedTarget = (repo: InMemoryApplyRepository, entityType: string, values: Record<string, unknown>, sourceRecordId = "seed") => {
  const target = { id: `${entityType}-${repo.targets.size + 1}`, entityType, values: { ...values }, sourceIds: new Set([sourceRecordId]) };
  repo.targets.set(`${entityType}:${target.id}`, target);
  return target;
};
describe("Act apply", () => { it("creates idempotently and records a durable batch replay", async () => { const repo = new InMemoryApplyRepository({ unsafeForTests: true }); repo.seedManifest("r", "d"); repo.seedOperations([op("a", "create", { normalized: { name: "A" } })]); const service = new ActApplyService(repo, true); const first = await service.apply({ runId: "r", approvedOperationIds: ["a"], expectedManifestDigest: "d", requestKey: "k" }); expect(first).toMatchObject({ state: "complete", completedCount: 1 }); expect(await service.apply({ runId: "r", approvedOperationIds: ["a"], expectedManifestDigest: "d", requestKey: "k" })).toEqual(first); }); it("blocks a fill over a local nonblank value", async () => { const repo = new InMemoryApplyRepository({ unsafeForTests: true }); repo.seedManifest("r", "d"); const created = seedTarget(repo, "organization", { name: "A", phone: "local" }); const operation = op("f", "fill_missing", { entityId: created.id, fieldName: "phone", value: "source" }); repo.seedOperations([operation]); const result = await new ActApplyService(repo, true).apply({ runId: "r", approvedOperationIds: ["f"], expectedManifestDigest: "d", requestKey: "k" }); expect(result.blockedCount).toBe(1); }); });

it("claims a queued approval row and replays the terminal batch without executing twice", async () => {
  const repo = new InMemoryApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  repo.seedOperations([op("a", "create", { normalized: { name: "A" } })]);
  repo.batches.set("r:k", {
    batchId: "approval-batch",
    runId: "r",
    requestKey: "k",
    manifestDigest: "d",
    operationIds: ["a"],
    state: "queued",
    completed: 0,
    alreadyPresent: 0,
    blocked: 0,
    failed: 0,
  });
  const createTarget = vi.spyOn(repo, "createTarget");
  const service = new ActApplyService(repo, true);

  const first = await service.apply({ runId: "r", approvedOperationIds: ["a"], expectedManifestDigest: "d", requestKey: "k", requestedBy: "owner" });
  const replay = await service.apply({ runId: "r", approvedOperationIds: ["a"], expectedManifestDigest: "d", requestKey: "k", requestedBy: "owner" });

  expect(first).toMatchObject({ batchId: "approval-batch", state: "complete", completedCount: 1 });
  expect(replay).toEqual(first);
  expect(createTarget).toHaveBeenCalledTimes(1);
  expect(repo.operations.get("a")?.attemptCount).toBe(1);
});

it("allows a later batch to depend on an operation durably applied by an earlier batch", async () => {
  const repo = new InMemoryApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  repo.seedOperations([
    op("parent", "create", { normalized: { name: "Parent" } }),
    op("child", "create", { normalized: { name: "Child" } }, ["parent"]),
  ]);
  const service = new ActApplyService(repo, true);

  await service.apply({ runId: "r", approvedOperationIds: ["parent"], expectedManifestDigest: "d", requestKey: "apply:0", requestedBy: "owner" });
  const second = await service.apply({ runId: "r", approvedOperationIds: ["child"], expectedManifestDigest: "d", requestKey: "apply:1", requestedBy: "owner" });

  expect(second).toMatchObject({ state: "complete", completedCount: 1, blockedCount: 0, failedCount: 0 });
  expect(repo.operations.get("child")?.status).toBe("applied");
});

it("preserves dependency-first approval order when creating a batch", async () => {
  const repo = new InMemoryApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  repo.seedOperations([
    op("organization:parent", "create", { normalized: { name: "Parent" } }),
    op("activity:child", "create", { normalized: { name: "Child" } }, ["organization:parent"]),
  ]);
  const createBatch = vi.spyOn(repo, "createBatch");

  await new ActApplyService(repo, true).apply({ runId: "r", approvedOperationIds: ["organization:parent", "activity:child"], expectedManifestDigest: "d", requestKey: "apply:0", requestedBy: "owner" });

  expect(createBatch).toHaveBeenCalledWith(expect.objectContaining({ operationIds: ["organization:parent", "activity:child"] }));
});

it("executes only once when two callers race to claim the same queued approval", async () => {
  class RacingApplyRepository extends InMemoryApplyRepository {
    private queuedReaders = 0;
    private releaseQueuedReaders: (() => void) | undefined;
    private readonly queuedReadersReady = new Promise<void>((resolve) => { this.releaseQueuedReaders = resolve; });

    override async getBatch(runId: string, requestKey: string) {
      const batch = await super.getBatch(runId, requestKey);
      if (batch?.state !== "queued") return batch;
      this.queuedReaders += 1;
      if (this.queuedReaders === 2) this.releaseQueuedReaders?.();
      await this.queuedReadersReady;
      return { ...batch };
    }
  }
  const repo = new RacingApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  repo.seedOperations([op("a", "create", { normalized: { name: "A" } })]);
  repo.batches.set("r:k", {
    batchId: "approval-batch",
    runId: "r",
    requestKey: "k",
    manifestDigest: "d",
    operationIds: ["a"],
    state: "queued",
    completed: 0,
    alreadyPresent: 0,
    blocked: 0,
    failed: 0,
  });
  const createTarget = vi.spyOn(repo, "createTarget");
  const service = new ActApplyService(repo, true);

  await Promise.all([
    service.apply({ runId: "r", approvedOperationIds: ["a"], expectedManifestDigest: "d", requestKey: "k", requestedBy: "owner" }),
    service.apply({ runId: "r", approvedOperationIds: ["a"], expectedManifestDigest: "d", requestKey: "k", requestedBy: "owner" }),
  ]);

  expect(createTarget).toHaveBeenCalledTimes(1);
  expect(repo.operations.get("a")?.attemptCount).toBe(1);
});

it("rejects operations that are not currently safe, ready, and on the latest source version", async () => {
  const repo = new InMemoryApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  repo.seedOperations([op("unsafe", "create"), op("stale", "create"), op("held", "create")]);
  repo.operations.get("unsafe")!.safeByDefault = false;
  repo.operations.get("stale")!.latestSourceVersionId = "new-version";
  repo.operations.get("held")!.outcomeState = "awaiting_review";
  const service = new ActApplyService(repo, true);

  await expect(service.apply({ runId: "r", approvedOperationIds: ["unsafe"], expectedManifestDigest: "d", requestKey: "unsafe" })).rejects.toMatchObject({ code: "operation_not_safe" });
  await expect(service.apply({ runId: "r", approvedOperationIds: ["stale"], expectedManifestDigest: "d", requestKey: "stale" })).rejects.toMatchObject({ code: "source_version_changed" });
  await expect(service.apply({ runId: "r", approvedOperationIds: ["held"], expectedManifestDigest: "d", requestKey: "held" })).rejects.toMatchObject({ code: "outcome_not_ready" });
  expect(repo.operations.get("unsafe")?.attemptCount).toBe(0);
  expect(repo.operations.get("stale")?.attemptCount).toBe(0);
  expect(repo.operations.get("held")?.attemptCount).toBe(0);
});

it("reclaims an expired applying batch and resumes idempotently", async () => {
  const repo = new InMemoryApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  repo.seedOperations([op("a", "create", { normalized: { name: "A" } })]);
  repo.batches.set("r:approval:0", {
    batchId: "expired-batch",
    runId: "r",
    requestKey: "approval:0",
    approvalRequestKey: "approval",
    startCursor: 0,
    manifestDigest: "d",
    operationIds: ["a"],
    state: "applying",
    completed: 0,
    alreadyPresent: 0,
    blocked: 0,
    failed: 0,
    leaseOwner: "dead-worker",
    leaseExpiresAt: Date.now() - 1,
  });

  const result = await new ActApplyService(repo, true).apply({
    runId: "r",
    approvedOperationIds: ["a"],
    expectedManifestDigest: "d",
    requestKey: "approval:0",
    approvalRequestKey: "approval",
    startCursor: 0,
    requestedBy: "replacement-worker",
  });

  expect(result).toMatchObject({
    batchId: "expired-batch",
    state: "complete",
    completedCount: 1,
  });
  expect(repo.operations.get("a")?.status).toBe("applied");
  expect(repo.operations.get("a")?.attemptCount).toBe(1);
});

it("retries only failed durable outcomes when the coordinator authorizes a retry", async () => {
  const repo = new InMemoryApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  repo.seedOperations([op("a", "create", { normalized: { name: "A" } })]);
  repo.operations.get("a")!.status = "failed";
  repo.operations.get("a")!.outcomeState = "failed";

  const result = await new ActApplyService(repo, true).apply({
    runId: "r",
    approvedOperationIds: ["a"],
    expectedManifestDigest: "d",
    requestKey: "approval:0:retry:1",
    approvalRequestKey: "approval",
    startCursor: 0,
    requestedBy: "owner",
    retryFailed: true,
  });

  expect(result).toMatchObject({ state: "complete", failedCount: 0 });
  expect(repo.operations.get("a")?.status).toBe("applied");
});

it("retries a failed server-derived slice that also contains terminal operations", async () => {
  const repo = new InMemoryApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  repo.seedOperations([
    op("already-applied", "create", { normalized: { name: "Already applied" } }),
    op("failed", "create", { normalized: { name: "Retry me" } }),
  ]);
  repo.operations.get("already-applied")!.status = "applied";
  repo.operations.get("already-applied")!.outcomeState = "applied";
  repo.operations.get("failed")!.status = "failed";
  repo.operations.get("failed")!.outcomeState = "failed";

  const result = await new ActApplyService(repo, true).apply({
    runId: "r",
    approvedOperationIds: ["already-applied", "failed"],
    expectedManifestDigest: "d",
    requestKey: "approval:0:retry:1",
    approvalRequestKey: "approval",
    startCursor: 0,
    requestedBy: "owner",
    retryFailed: true,
  });

  expect(result).toMatchObject({ state: "complete", completedCount: 1, alreadyPresentCount: 1, failedCount: 0 });
  expect(repo.operations.get("already-applied")?.attemptCount).toBe(0);
  expect(repo.operations.get("failed")?.status).toBe("applied");
});

it("records source provenance before completing a link-existing root", async () => {
  const repo = new InMemoryApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  const operation = op("a", "link_existing", { localId: "local-org" });
  repo.seedOperations([operation]);
  repo.targets.set("organization:local-org", {
    id: "local-org",
    entityType: "organization",
    values: { name: "Existing" },
  });
  const provenance = vi.spyOn(repo, "recordProvenance");

  const result = await new ActApplyService(repo, true).apply({
    runId: "r",
    approvedOperationIds: ["a"],
    expectedManifestDigest: "d",
    requestKey: "approval:0",
  });

  expect(result).toMatchObject({ state: "complete", alreadyPresentCount: 1 });
  expect(provenance).toHaveBeenCalledWith(expect.objectContaining({
    action: "link_existing",
    payload: { localId: "local-org" },
  }), expect.objectContaining({ batchId: "r:approval:0" }));
});

it("repairs provenance when a fill committed before a crashed operation retry", async () => {
  const repo = new InMemoryApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  const target = seedTarget(
    repo,
    "organization",
    { name: "A", phone: "source-value" },
    "seed",
  );
  const operation = op("fill", "fill_missing", {
    entityId: target.id,
    fieldName: "phone",
    value: "source-value",
  });
  repo.seedOperations([operation]);
  repo.operations.get("fill")!.status = "failed";
  repo.operations.get("fill")!.outcomeState = "failed";

  const result = await new ActApplyService(repo, true).apply({
    runId: "r",
    approvedOperationIds: ["fill"],
    expectedManifestDigest: "d",
    requestKey: "approval:0:retry:1",
    retryFailed: true,
  });

  expect(result).toMatchObject({
    state: "complete",
    alreadyPresentCount: 1,
    blockedCount: 0,
    failedCount: 0,
  });
  expect(repo.origins).toHaveLength(1);
  expect(repo.operations.get("fill")?.status).toBe("already_present");
});

it("repairs provenance when a committed timestamp is a Date equivalent to the ISO payload", async () => {
  const repo = new InMemoryApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  const startsAt = new Date("2026-08-07T12:00:00.000Z");
  const target = seedTarget(repo, "booking", { name: "A", startsAt });
  const operation = {
    ...op("fill-timestamp", "fill_missing", {
      entityId: target.id,
      fieldName: "startsAt",
      value: "2026-08-07T12:00:00.000Z",
    }),
    targetType: "booking" as const,
  };
  repo.seedOperations([operation]);
  repo.operations.get("fill-timestamp")!.status = "failed";
  repo.operations.get("fill-timestamp")!.outcomeState = "failed";

  const result = await new ActApplyService(repo, true).apply({
    runId: "r",
    approvedOperationIds: ["fill-timestamp"],
    expectedManifestDigest: "d",
    requestKey: "approval:0:retry:1",
    retryFailed: true,
  });

  expect(result).toMatchObject({ alreadyPresentCount: 1, blockedCount: 0, failedCount: 0 });
  expect(target.values.startsAt).toBe(startsAt);
  expect(repo.origins).toHaveLength(1);
  expect(repo.operations.get("fill-timestamp")?.status).toBe("already_present");
});

it("never overwrites a local value written after the fill target was read", async () => {
  class ConcurrentLocalEditRepository extends InMemoryApplyRepository {
    override async getTarget(entityType: string, id: string) {
      const target = await super.getTarget(entityType, id);
      if (!target) return null;
      const staleSnapshot = {
        ...target,
        values: { ...target.values },
        sourceIds: target.sourceIds ? new Set(target.sourceIds) : undefined,
      };
      target.values.phone = "concurrent-local-edit";
      return staleSnapshot;
    }
  }

  const repo = new ConcurrentLocalEditRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  const target = seedTarget(repo, "organization", { name: "A", phone: null });
  repo.seedOperations([op("fill-race", "fill_missing", {
    entityId: target.id,
    fieldName: "phone",
    value: "source-value",
  })]);

  const result = await new ActApplyService(repo, true).apply({
    runId: "r",
    approvedOperationIds: ["fill-race"],
    expectedManifestDigest: "d",
    requestKey: "approval:0",
  });

  expect(result).toMatchObject({ completedCount: 0, blockedCount: 1 });
  expect(target.values.phone).toBe("concurrent-local-edit");
  expect(repo.operations.get("fill-race")).toMatchObject({
    status: "blocked",
    lastErrorCode: "local_value_nonempty",
  });
  expect(repo.origins).toHaveLength(0);
});

it("refuses to claim operations while the durable run is being reorganized", async () => {
  const repo = new InMemoryApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  repo.runPhases.set("r", "organizing");
  repo.seedOperations([op("a", "create", { normalized: { name: "A" } })]);

  await expect(
    new ActApplyService(repo, true).apply({
      runId: "r",
      approvedOperationIds: ["a"],
      expectedManifestDigest: "d",
      requestKey: "approval:0",
      approvalRequestKey: "approval",
      startCursor: 0,
      requestedBy: "owner",
    }),
  ).rejects.toMatchObject({ code: "apply_run_not_claimable" });
  expect(repo.operations.get("a")?.attemptCount).toBe(0);
});

it("fences every stale worker operation and target mutation after lease reclamation", async () => {
  const repo = new InMemoryApplyRepository({ unsafeForTests: true });
  repo.seedManifest("r", "d");
  repo.seedOperations([op("a", "create", { normalized: { name: "A" } })]);
  const target = seedTarget(repo, "organization", { name: "Original" }, "source-a");
  repo.batches.set("r:approval:0", {
    batchId: "batch-1",
    runId: "r",
    requestKey: "approval:0",
    approvalRequestKey: "approval",
    startCursor: 0,
    manifestDigest: "d",
    operationIds: ["a"],
    state: "applying",
    completed: 0,
    alreadyPresent: 0,
    blocked: 0,
    failed: 0,
    leaseExpiresAt: Date.now() + 120_000,
    attemptToken: "new-worker-token",
  } as never);
  const staleOperation = {
    ...repo.operations.get("a")!,
    status: "applied" as const,
  };
  const staleAttempt = {
    batchId: "batch-1",
    attemptToken: "expired-worker-token",
  };

  await expect(repo.saveOperation(staleOperation, staleAttempt)).rejects.toMatchObject({
    code: "apply_attempt_lost",
  });
  await expect(
    repo.writeTarget(target, "name", "Stale overwrite", staleAttempt),
  ).rejects.toMatchObject({ code: "apply_attempt_lost" });
  await expect(repo.createTarget("organization", { name: "Stale create" }, "source-b", "version-b", staleAttempt)).rejects.toMatchObject({ code: "apply_attempt_lost" });
  await expect(repo.recordOrigin({ entityType: "organization" }, staleAttempt)).rejects.toMatchObject({ code: "apply_attempt_lost" });
  await expect(repo.createRelationship(staleOperation, staleAttempt)).rejects.toMatchObject({ code: "apply_attempt_lost" });
  await expect(repo.recordProvenance(staleOperation, staleAttempt)).rejects.toMatchObject({ code: "apply_attempt_lost" });
  await expect(repo.finishBatch({ ...repo.batches.get("r:approval:0")!, state: "complete" }, staleAttempt)).rejects.toMatchObject({ code: "apply_attempt_lost" });
  expect(repo.operations.get("a")?.status).toBe("pending");
  expect(target.values.name).toBe("Original");
  expect(repo.targets.size).toBe(1);
  expect(repo.origins).toHaveLength(0);
  expect(repo.batches.get("r:approval:0")?.state).toBe("applying");
});
