import { describe, expect, it } from "vitest";
import { ActApprovalService, InMemoryApprovalRepository, type ApprovalRepository } from "./approval-service";
import { buildActOrganizeManifest, type ManifestOperation, type ManifestOutcome } from "./manifest-builder";
import { fingerprintSourceContent } from "./source-fingerprint";
const automaticReview = (
  disposition: "safe_ready" | "auto_resolved" | "archived_only" = "safe_ready",
  basis: "safe_create" | "trusted_exact_match" | "proven_context_match" | "not_automatically_safe" = "safe_create",
  eligible = basis !== "not_automatically_safe",
) => ({ version: 1 as const, eligible, disposition, basis });
const op = (key: string, dependencies: string[] = [], safeByDefault = true, sourceRecordId = key): ManifestOperation => ({ operationKey: key, sourceRecordId, sourceVersionId: `v-${sourceRecordId}`, targetType: "organization", action: "create", payload: { automaticReview: automaticReview() }, dependencyOperationKeys: dependencies, requiredForSourceOutcome: true, safeByDefault });
const outcome = (sourceRecordId: string, state: ManifestOutcome["state"]): ManifestOutcome => ({ sourceRecordId, sourceVersionId: `v-${sourceRecordId}`, state, issues: [], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] });
const reviewedOverwrite = (): ManifestOperation => ({
  ...op("organization:a:field:phone", ["organization:a"], false, "a"),
  action: "overwrite_reviewed",
  payload: {
    entityId: "organization-a",
    fieldName: "phone",
    value: "555-ACT",
    proof: { localValue: "555-LOCAL", sourceValue: "555-ACT" },
    decision: { id: "decision-a", sourceVersionId: "v-a", scope: "field_conflict", decision: "use_source", fieldName: "phone", targetEntityType: "organization", targetEntityId: "organization-a" },
  },
});
describe("Act approval closure", () => {
  it("includes transitive dependencies deterministically and replays request", async () => { const repo = new InMemoryApprovalRepository(); repo.seed("r", { digest: "d", operations: [op("z", ["b"]), op("b", ["a"]), op("a")] }); const service = new ActApprovalService(repo); const first = await service.approve({ runId: "r", operationIds: ["z"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "k", requestedBy: "owner" }); expect(first).toMatchObject({ selectedCount: 1, dependencyCount: 2, approvedOperationIds: ["a", "b", "z"] }); expect(await service.approve({ runId: "r", operationIds: ["a"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "k", requestedBy: "other" })).toEqual(first); });
  it("rejects unsafe and cyclic dependencies", async () => { const repo = new InMemoryApprovalRepository(); repo.seed("r", { digest: "d", operations: [op("a", ["b"]), op("b", [], false)] }); await expect(new ActApprovalService(repo).approve({ runId: "r", operationIds: ["a"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "x", requestedBy: "o" })).rejects.toMatchObject({ code: "unsafe_dependency" }); repo.seed("c", { digest: "d", operations: [op("a", ["b"]), op("b", ["a"])] }); await expect(new ActApprovalService(repo).approve({ runId: "c", operationIds: ["a"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "x", requestedBy: "o" })).rejects.toMatchObject({ code: "dependency_cycle" }); });

  it("orders dependencies before dependents even when lexical order is opposite", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", { digest: "d", operations: [op("activity:child", ["organization:parent"]), op("organization:parent")] });

    const result = await new ActApprovalService(repo).approve({ runId: "r", operationIds: ["activity:child"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "ordered", requestedBy: "owner" });

    expect(result.approvedOperationIds).toEqual(["organization:parent", "activity:child"]);
  });

  it("approves a safe operation from an awaiting-review outcome", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready"), outcome("conflict", "awaiting_review")],
      operations: [op("safe:create", [], true, "safe"), op("conflict:create", [], true, "conflict")],
    });
    const service = new ActApprovalService(repo);

    const result = await service.approveSafeDefaults({ runId: "r", expectedManifestDigest: "d", requestKey: "safe-defaults", requestedBy: "owner" });

    expect(result.approvedOperationIds).toEqual(["conflict:create", "safe:create"]);
    expect(result.rejectedOperationIds).toEqual([]);
    await expect(service.approveSafeDefaults({ runId: "r", expectedManifestDigest: "d", requestKey: "safe-defaults", requestedBy: "owner" })).resolves.toEqual(result);
  });

  it("replays the same automatic approval after its operations become terminal", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready")],
      operations: [op("safe:create", [], true, "safe")],
    });
    const service = new ActApprovalService(repo);
    const first = await service.approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "safe-defaults",
      requestedBy: "owner",
    });
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready")],
      operations: [{ ...op("safe:create", [], true, "safe"), status: "applied" }],
    });

    await expect(service.approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "safe-defaults",
      requestedBy: "owner",
    })).resolves.toEqual(first);
  });

  it("approves an awaiting-review safe link while excluding unsafe and dependency-blocked roots", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("awaiting", "awaiting_review")],
      operations: [
        { ...op("awaiting:link", [], true, "awaiting"), action: "link_existing", payload: { automaticReview: automaticReview("auto_resolved", "proven_context_match") } },
        { ...op("awaiting:overwrite", [], true, "awaiting"), action: "overwrite_reviewed" },
        op("awaiting:blocked", ["awaiting:relationship"], true, "awaiting"),
        {
          ...op("awaiting:relationship", [], true, "awaiting"),
          action: "create_relationship",
          targetType: "organization_contact",
        },
      ],
    });

    const result = await new ActApprovalService(repo).approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "awaiting-safe-defaults",
      requestedBy: "owner",
    });

    expect(result).toMatchObject({
      selectedOperationIds: ["awaiting:link"],
      approvedOperationIds: ["awaiting:link"],
      dependencyOperationIds: [],
      rejectedOperationIds: [
        "awaiting:blocked",
        "awaiting:overwrite",
        "awaiting:relationship",
      ],
    });
  });

  it("fails closed when bounded automatic proof is missing or malformed", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("missing", "ready"), outcome("malformed", "ready")],
      operations: [
        { ...op("missing:create", [], true, "missing"), payload: {} },
        { ...op("malformed:create", [], true, "malformed"), payload: { automaticReview: { eligible: true } } },
      ],
    });

    const result = await new ActApprovalService(repo).approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "proof-required",
      requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual([]);
    expect(result.rejectedOperationIds).toEqual(["malformed:create", "missing:create"]);

    const legacyReady = await new ActApprovalService(repo).approveReady({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "legacy-proof-required",
      requestedBy: "owner",
    });
    expect(legacyReady.approvedOperationIds).toEqual([]);
    expect(legacyReady.rejectedOperationIds).toEqual(["malformed:create", "missing:create"]);
  });

  it("approves dependency-bound relationships while rejecting provenance actions", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready")],
      operations: [
        op("safe:create", [], true, "safe"),
        { ...op("safe:relationship", ["safe:create"], true, "safe"), action: "create_relationship", targetType: "organization_contact" },
        { ...op("safe:provenance", ["safe:create"], true, "safe"), action: "record_provenance" },
      ],
    });

    const result = await new ActApprovalService(repo).approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "no-generic-actions",
      requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual(["safe:create", "safe:relationship"]);
    expect(result.rejectedOperationIds).toEqual(["safe:provenance"]);
  });

  it("approves only the remaining pending safe closure and treats terminal dependencies as satisfied", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "awaiting_review")],
      operations: [
        { ...op("safe:parent", [], true, "safe"), status: "applied" },
        {
          ...op("safe:fill", ["safe:parent"], true, "safe"),
          action: "fill_missing",
          payload: { automaticReview: automaticReview("safe_ready", "trusted_exact_match") },
          status: "pending",
        },
        { ...op("safe:done", [], true, "safe"), status: "already_present" },
      ] as Array<ManifestOperation & { status: string }>,
    });

    const result = await new ActApprovalService(repo).approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "remaining-only",
      requestedBy: "owner",
    });

    expect(result).toMatchObject({
      selectedOperationIds: ["safe:fill"],
      approvedOperationIds: ["safe:fill"],
      dependencyOperationIds: [],
      selectedCount: 1,
    });
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

  it("allows an explicitly selected reviewed overwrite", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("a", "ready")],
      operations: [op("organization:a", [], true, "a"), reviewedOverwrite()],
    });

    const result = await new ActApprovalService(repo).approve({
      runId: "r", operationIds: ["organization:a:field:phone"], includeDependencies: true,
      expectedManifestDigest: "d", requestKey: "explicit-overwrite", requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual(["organization:a", "organization:a:field:phone"]);
  });

  it("does not replay an explicit reviewed overwrite as automatic safe defaults", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("a", "ready")],
      operations: [op("organization:a", [], true, "a"), reviewedOverwrite()],
    });
    const service = new ActApprovalService(repo);

    await service.approve({
      runId: "r",
      operationIds: ["organization:a:field:phone"],
      includeDependencies: true,
      expectedManifestDigest: "d",
      requestKey: "shared-request-key",
      requestedBy: "owner",
    });

    await expect(service.approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "shared-request-key",
      requestedBy: "owner",
    })).rejects.toMatchObject({ code: "request_replay_mode_mismatch", status: 409 });
  });

  it("does not replay an identical explicit manual closure as automatic safe defaults", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready")],
      operations: [op("safe:create", [], true, "safe")],
    });
    const service = new ActApprovalService(repo);

    await service.approve({
      runId: "r",
      operationIds: ["safe:create"],
      includeDependencies: true,
      expectedManifestDigest: "d",
      requestKey: "shared-request-key",
      requestedBy: "owner",
    });

    await expect(service.approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "shared-request-key",
      requestedBy: "owner",
    })).rejects.toMatchObject({ code: "request_replay_mode_mismatch", status: 409 });
  });

  it("does not replay an identical automatic closure as an explicit manual approval", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready")],
      operations: [op("safe:create", [], true, "safe")],
    });
    const service = new ActApprovalService(repo);

    await service.approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "shared-request-key",
      requestedBy: "owner",
    });

    await expect(service.approve({
      runId: "r",
      operationIds: ["safe:create"],
      includeDependencies: true,
      expectedManifestDigest: "d",
      requestKey: "shared-request-key",
      requestedBy: "owner",
    })).rejects.toMatchObject({ code: "request_replay_mode_mismatch", status: 409 });
  });

  it("does not accept an explicit reviewed overwrite that wins a concurrent automatic save", async () => {
    const base = new InMemoryApprovalRepository();
    base.seed("r", {
      digest: "d",
      outcomes: [outcome("a", "ready")],
      operations: [op("organization:a", [], true, "a"), reviewedOverwrite()],
    });
    await new ActApprovalService(base).approve({
      runId: "r",
      operationIds: ["organization:a:field:phone"],
      includeDependencies: true,
      expectedManifestDigest: "d",
      requestKey: "explicit-request",
      requestedBy: "owner",
    });
    const explicit = await base.getRequest("r", "explicit-request");
    expect(explicit).not.toBeNull();
    const concurrentRepository: ApprovalRepository = {
      getManifest: (runId) => base.getManifest(runId),
      getRequest: async () => null,
      saveRequest: async () => explicit!,
    };

    await expect(new ActApprovalService(concurrentRepository).approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "shared-request-key",
      requestedBy: "owner",
    })).rejects.toMatchObject({ code: "request_replay_mode_mismatch", status: 409 });
  });

  it("does not accept an identical manual closure that wins a concurrent automatic save", async () => {
    const base = new InMemoryApprovalRepository();
    base.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready")],
      operations: [op("safe:create", [], true, "safe")],
    });
    await new ActApprovalService(base).approve({
      runId: "r",
      operationIds: ["safe:create"],
      includeDependencies: true,
      expectedManifestDigest: "d",
      requestKey: "manual-request",
      requestedBy: "owner",
    });
    const manual = await base.getRequest("r", "manual-request");
    expect(manual).not.toBeNull();
    const concurrentRepository: ApprovalRepository = {
      getManifest: (runId) => base.getManifest(runId),
      getRequest: async () => null,
      saveRequest: async () => manual!,
    };

    await expect(new ActApprovalService(concurrentRepository).approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "shared-request-key",
      requestedBy: "owner",
    })).rejects.toMatchObject({ code: "request_replay_mode_mismatch", status: 409 });
  });

  it("treats a legacy approval without provenance as non-automatic", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready")],
      operations: [op("safe:create", [], true, "safe")],
    });
    repo.seedRequest("r", "legacy-request", {
      selectedOperationIds: ["safe:create"],
      approvedOperationIds: ["safe:create"],
      dependencyOperationIds: [],
      rejectedOperationIds: [],
      selectedCount: 1,
      dependencyCount: 0,
      rejectedCount: 0,
      manifestDigest: "d",
      approvalMode: null,
      approvalModeVersion: null,
    });

    await expect(new ActApprovalService(repo).approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "legacy-request",
      requestedBy: "owner",
    })).rejects.toMatchObject({ code: "request_replay_mode_mismatch", status: 409 });
  });

  it("preserves a concurrent same-mode automatic save", async () => {
    const base = new InMemoryApprovalRepository();
    base.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready")],
      operations: [op("safe:create", [], true, "safe")],
    });
    const expected = await new ActApprovalService(base).approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "automatic-winner",
      requestedBy: "owner",
    });
    const winner = await base.getRequest("r", "automatic-winner");
    expect(winner).not.toBeNull();
    const concurrentRepository: ApprovalRepository = {
      getManifest: (runId) => base.getManifest(runId),
      getRequest: async () => null,
      saveRequest: async () => winner!,
    };

    await expect(new ActApprovalService(concurrentRepository).approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "automatic-request",
      requestedBy: "owner",
    })).resolves.toEqual(expected);
  });

  it("rejects an explicitly selected reviewed overwrite without matching durable proof", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("a", "ready")],
      operations: [op("organization:a", [], true, "a"), { ...reviewedOverwrite(), payload: { ...reviewedOverwrite().payload, proof: undefined } }],
    });

    await expect(new ActApprovalService(repo).approve({
      runId: "r", operationIds: ["organization:a:field:phone"], includeDependencies: true,
      expectedManifestDigest: "d", requestKey: "malformed-explicit-overwrite", requestedBy: "owner",
    })).rejects.toMatchObject({ code: "review_proof_required" });
  });

  it("rejects an explicit reviewed overwrite whose decision targets another entity", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("a", "ready")],
      operations: [op("organization:a", [], true, "a"), { ...reviewedOverwrite(), payload: { ...reviewedOverwrite().payload, decision: { ...(reviewedOverwrite().payload.decision as Record<string, unknown>), targetEntityId: "organization-b" } } }],
    });

    await expect(new ActApprovalService(repo).approve({
      runId: "r", operationIds: ["organization:a:field:phone"], includeDependencies: true,
      expectedManifestDigest: "d", requestKey: "cross-target-explicit-overwrite", requestedBy: "owner",
    })).rejects.toMatchObject({ code: "review_proof_required" });
  });

  it("enforces the central automatic predicate for legacy ready approval", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("a", "ready")],
      operations: [
        op("organization:a", [], true, "a"),
        reviewedOverwrite(),
        { ...op("provenance:a", ["organization:a"], true, "a"), action: "record_provenance" },
      ],
    });

    const result = await new ActApprovalService(repo).approveReady({ runId: "r", expectedManifestDigest: "d", requestKey: "ready", requestedBy: "owner" });

    expect(result.approvedOperationIds).toEqual(["organization:a"]);
    expect(result.rejectedOperationIds).toEqual([
      "organization:a:field:phone",
      "provenance:a",
    ]);
  });

  it("uses the same automatic closure for ready and safe-default approval", async () => {
    const decision = {
      decisionId: "decision-use-source",
      sourceVersionId: "v-overwrite",
      scope: "field_conflict" as const,
      decision: "use_source" as const,
      fieldName: "phone",
      targetEntityType: "organization",
      targetEntityId: "local-overwrite",
      reviewedSourceValue: "555-ACT",
      reviewedSourceValueFingerprint: fingerprintSourceContent({ value: "555-ACT" }),
      reviewedLocalValue: "555-LOCAL",
      reviewedLocalValueFingerprint: fingerprintSourceContent({ value: "555-LOCAL" }),
      decidedBy: "owner",
      createdAt: "2026-08-08T00:00:00.000Z",
    };
    const manifest = buildActOrganizeManifest({
      runId: "r",
      sources: [
        {
          sourceRecordId: "fill",
          sourceVersionId: "v-fill",
          streamType: "company",
          normalized: { kind: "organization", name: "Fill", phone: "555-FILL", website: null },
          match: { kind: "exact", localId: "local-fill", reason: "exact_external_link" },
          localFields: { name: "Fill", phone: null },
        },
        {
          sourceRecordId: "overwrite",
          sourceVersionId: "v-overwrite",
          streamType: "company",
          normalized: { kind: "organization", name: "Overwrite", phone: "555-ACT", website: null },
          match: { kind: "exact", localId: "local-overwrite", reason: "exact_external_link" },
          localFields: { name: "Overwrite", phone: "555-LOCAL" },
          reviewDecisions: [decision],
        },
        {
          sourceRecordId: "ambiguous",
          sourceVersionId: "v-ambiguous",
          streamType: "company",
          normalized: { kind: "organization", name: "Ambiguous", phone: null, website: null },
          match: { kind: "ambiguous", candidateIds: ["local-a", "local-b"], reason: "multiple_candidates" },
        },
        {
          sourceRecordId: "unresolved",
          sourceVersionId: "v-unresolved",
          streamType: "contact",
          normalized: { kind: "contact", firstName: "Missing", lastName: "Parent", email: null, phone: null },
          match: { kind: "none", reason: "no_candidate" },
          reviewIssues: [{ code: "relationship_unresolved", reason: "parent_missing" }],
        },
      ],
    });
    const unsafeOperation: ManifestOperation = {
      operationKey: "organization:unsafe",
      sourceRecordId: "unsafe",
      sourceVersionId: "v-unsafe",
      targetType: "organization",
      action: "create",
      payload: {},
      dependencyOperationKeys: [],
      requiredForSourceOutcome: true,
      safeByDefault: false,
    };
    const unsafeOutcome = outcome("unsafe", "ready");
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: manifest.digest,
      outcomes: [...manifest.outcomes, unsafeOutcome],
      operations: [...manifest.operations, unsafeOperation],
    });
    const service = new ActApprovalService(repo);
    const fillOperationKey = manifest.operations.find((operation) => operation.sourceRecordId === "fill" && operation.action === "fill_missing")!.operationKey;

    const ready = await service.approveReady({
      runId: "r",
      expectedManifestDigest: manifest.digest,
      requestKey: "real-ready",
      requestedBy: "owner",
    });
    expect(ready.approvedOperationIds).toEqual(expect.arrayContaining([
      "organization:fill:identity:local-fill",
      fillOperationKey,
      "organization:overwrite:identity:local-overwrite",
    ]));
    expect(ready.approvedOperationIds).not.toContain("organization:ambiguous");
    expect(ready.approvedOperationIds).not.toContain("contact:unresolved");
    expect(ready.approvedOperationIds).not.toContain("organization:unsafe");
    expect(ready.approvedOperationIds).not.toContain("organization:overwrite:field:phone:decision:decision-use-source");

    const safe = await service.approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: manifest.digest,
      requestKey: "real-safe-defaults",
      requestedBy: "owner",
    });
    expect(safe.approvedOperationIds).toEqual(ready.approvedOperationIds);
    expect(safe.rejectedOperationIds).toEqual(ready.rejectedOperationIds);
  });

  it("keeps a reviewed overwrite without matching durable proof out of ready approval", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("a", "ready")],
      operations: [op("organization:a", [], true, "a"), { ...reviewedOverwrite(), safeByDefault: true, payload: { ...reviewedOverwrite().payload, proof: undefined } }],
    });

    const result = await new ActApprovalService(repo).approveReady({ runId: "r", expectedManifestDigest: "d", requestKey: "missing-proof", requestedBy: "owner" });

    expect(result.approvedOperationIds).toEqual(["organization:a"]);
    expect(result.rejectedOperationIds).toContain("organization:a:field:phone");
  });

  it("rejects a reviewed overwrite dependency during explicit approval", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("a", "ready")],
      operations: [
        { ...op("safe:create", ["organization:a:field:phone"], true, "a") },
        { ...reviewedOverwrite(), dependencyOperationKeys: [], safeByDefault: true },
      ],
    });

    await expect(new ActApprovalService(repo).approve({
      runId: "r", operationIds: ["safe:create"], includeDependencies: true,
      expectedManifestDigest: "d", requestKey: "reviewed-dependency", requestedBy: "owner",
    })).rejects.toMatchObject({ code: "unsafe_dependency" });
  });

  it("keeps a safe ready root out when it depends on a reviewed overwrite", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("a", "ready")],
      operations: [
        { ...op("safe:create", ["organization:a:field:phone"], true, "a") },
        { ...reviewedOverwrite(), dependencyOperationKeys: [], safeByDefault: true },
      ],
    });

    const result = await new ActApprovalService(repo).approveReady({ runId: "r", expectedManifestDigest: "d", requestKey: "ready-reviewed-dependency", requestedBy: "owner" });

    expect(result.selectedOperationIds).toEqual([]);
    expect(result.approvedOperationIds).toEqual([]);
    expect(result.rejectedOperationIds).toEqual([
      "organization:a:field:phone",
      "safe:create",
    ]);
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
