import { describe, expect, it } from "vitest";
import { ActApprovalService, InMemoryApprovalRepository } from "./approval-service";
import type { ManifestOperation, ManifestOutcome } from "./manifest-builder";
const op = (key: string, dependencies: string[] = [], safeByDefault = true, sourceRecordId = key): ManifestOperation => ({ operationKey: key, sourceRecordId, sourceVersionId: `v-${sourceRecordId}`, targetType: "organization", action: "create", payload: {}, dependencyOperationKeys: dependencies, requiredForSourceOutcome: true, safeByDefault });
const outcome = (sourceRecordId: string, state: ManifestOutcome["state"]): ManifestOutcome => ({ sourceRecordId, sourceVersionId: `v-${sourceRecordId}`, state, issues: [], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] });
describe("Act approval closure", () => {
  it("includes transitive dependencies deterministically and replays request", async () => { const repo = new InMemoryApprovalRepository(); repo.seed("r", { digest: "d", operations: [op("z", ["b"]), op("b", ["a"]), op("a")] }); const service = new ActApprovalService(repo); const first = await service.approve({ runId: "r", operationIds: ["z"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "k", requestedBy: "owner" }); expect(first).toMatchObject({ selectedCount: 1, dependencyCount: 2, approvedOperationIds: ["a", "b", "z"] }); expect(await service.approve({ runId: "r", operationIds: ["a"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "k", requestedBy: "other" })).toEqual(first); });
  it("rejects unsafe and cyclic dependencies", async () => { const repo = new InMemoryApprovalRepository(); repo.seed("r", { digest: "d", operations: [op("a", ["b"]), op("b", [], false)] }); await expect(new ActApprovalService(repo).approve({ runId: "r", operationIds: ["a"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "x", requestedBy: "o" })).rejects.toMatchObject({ code: "unsafe_dependency" }); repo.seed("c", { digest: "d", operations: [op("a", ["b"]), op("b", ["a"])] }); await expect(new ActApprovalService(repo).approve({ runId: "c", operationIds: ["a"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "x", requestedBy: "o" })).rejects.toMatchObject({ code: "dependency_cycle" }); });

  it("orders dependencies before dependents even when lexical order is opposite", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", { digest: "d", operations: [op("activity:child", ["organization:parent"]), op("organization:parent")] });

    const result = await new ActApprovalService(repo).approve({ runId: "r", operationIds: ["activity:child"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "ordered", requestedBy: "owner" });

    expect(result.approvedOperationIds).toEqual(["organization:parent", "activity:child"]);
  });

  it("excludes every operation belonging to a review-required outcome", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready"), outcome("conflict", "awaiting_review")],
      operations: [op("safe:create", [], true, "safe"), op("conflict:create", [], true, "conflict")],
    });

    const result = await new ActApprovalService(repo).approveSafeDefaults({ runId: "r", expectedManifestDigest: "d", requestKey: "safe-defaults", requestedBy: "owner" });

    expect(result.approvedOperationIds).toEqual(["safe:create"]);
    expect(result.rejectedOperationIds).toContain("conflict:create");
  });

  it("never safe-approves an overwrite operation", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready")],
      operations: [{ ...op("safe:overwrite", [], true, "safe"), action: "overwrite_reviewed" }],
    });

    const result = await new ActApprovalService(repo).approveSafeDefaults({ runId: "r", expectedManifestDigest: "d", requestKey: "safe-defaults", requestedBy: "owner" });

    expect(result.approvedOperationIds).toEqual([]);
    expect(result.rejectedOperationIds).toEqual(["safe:overwrite"]);
  });

  it("rejects a safe root whose dependency is an overwrite operation", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready")],
      operations: [
        op("safe:create", ["safe:overwrite"], true, "safe"),
        { ...op("safe:overwrite", [], true, "safe"), action: "overwrite_reviewed" },
      ],
    });

    const result = await new ActApprovalService(repo).approveSafeDefaults({ runId: "r", expectedManifestDigest: "d", requestKey: "safe-defaults", requestedBy: "owner" });

    expect(result.approvedOperationIds).toEqual([]);
    expect(result.rejectedOperationIds).toEqual(["safe:create", "safe:overwrite"]);
  });
});
