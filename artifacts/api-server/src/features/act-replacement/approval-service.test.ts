import { describe, expect, it } from "vitest";
import { ActApprovalService, InMemoryApprovalRepository } from "./approval-service";
import { buildActOrganizeManifest, type ManifestOperation, type ManifestOutcome } from "./manifest-builder";
import { fingerprintSourceContent } from "./source-fingerprint";
const op = (key: string, dependencies: string[] = [], safeByDefault = true, sourceRecordId = key): ManifestOperation => ({ operationKey: key, sourceRecordId, sourceVersionId: `v-${sourceRecordId}`, targetType: "organization", action: "create", payload: {}, dependencyOperationKeys: dependencies, requiredForSourceOutcome: true, safeByDefault });
const outcome = (sourceRecordId: string, state: ManifestOutcome["state"]): ManifestOutcome => ({ sourceRecordId, sourceVersionId: `v-${sourceRecordId}`, state, issues: [], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] });
const provenOutcome = (sourceRecordId: string, state: ManifestOutcome["state"] = "awaiting_review"): ManifestOutcome => ({
  ...outcome(sourceRecordId, state),
  match: {
    kind: "exact",
    localId: `local-${sourceRecordId}`,
    reason: "authoritative_context_clue",
    evidence: [{
      family: "identity",
      label: "exact Act link",
      targetEntityType: "organization",
      targetEntityId: `local-${sourceRecordId}`,
      authority: "authoritative",
    }],
  },
});
const reviewedOverwrite = (): ManifestOperation => ({
  ...op("organization:a:field:phone", ["organization:a"], false, "a"),
  action: "overwrite_reviewed",
  payload: {
    entityId: "organization-a",
    fieldName: "phone",
    value: "555-ACT",
    proof: {
      entityType: "organization",
      entityId: "organization-a",
      fieldName: "phone",
      sourceVersionId: "v-a",
      expectedLocalValueFingerprint: fingerprintSourceContent({ value: "555-LOCAL" }),
      decisionId: "decision-a",
      decision: "use_source",
      localValue: "555-LOCAL",
      sourceValue: "555-ACT",
    },
    decision: { id: "decision-a", sourceVersionId: "v-a", scope: "field_conflict", decision: "use_source", fieldName: "phone", targetEntityType: "organization", targetEntityId: "organization-a" },
  },
});
describe("Act approval closure", () => {
  it("rejects a stale same-key replay after persisted eligibility changes", async () => {
    const repo = new InMemoryApprovalRepository();
    const identity = {
      ...op("organization:a", [], true, "a"),
      action: "link_existing" as const,
      payload: { localId: "organization-a" },
    };
    const manifest = {
      digest: "d",
      outcomes: [{ ...outcome("a", "ready"), match: { kind: "exact", localId: "organization-a", reason: "exact_external_link" } }],
      operations: [identity, reviewedOverwrite()],
    };
    repo.seed("r", manifest);
    const service = new ActApprovalService(repo);
    await service.approveReady({ runId: "r", expectedManifestDigest: "d", requestKey: "reviewed-state", requestedBy: "owner" });
    repo.seed("r", { ...manifest, operationStatuses: { [identity.operationKey]: "already_present" } });

    await expect(service.approveReady({
      runId: "r", expectedManifestDigest: "d", requestKey: "reviewed-state", requestedBy: "owner",
    })).rejects.toMatchObject({ code: "request_replay_mismatch", status: 409 });
    await expect(service.approveReady({
      runId: "r", expectedManifestDigest: "d", requestKey: "reviewed-terminal", requestedBy: "owner",
    })).resolves.toMatchObject({
      approvedOperationIds: expect.arrayContaining([identity.operationKey, reviewedOverwrite().operationKey]),
    });
  });

  it("replays the original reviewed closure after a partial apply makes only prior operations terminal", async () => {
    const repo = new InMemoryApprovalRepository();
    const identity = {
      ...op("organization:a", [], true, "a"),
      action: "link_existing" as const,
      payload: { localId: "organization-a" },
    };
    const firstOverwrite = reviewedOverwrite();
    const secondOverwrite: ManifestOperation = {
      ...reviewedOverwrite(),
      operationKey: "organization:a:field:email",
      payload: {
        ...reviewedOverwrite().payload,
        fieldName: "email",
        value: "act@example.com",
        proof: {
          ...(reviewedOverwrite().payload.proof as Record<string, unknown>),
          fieldName: "email",
          decisionId: "decision-email",
          sourceValue: "act@example.com",
        },
        decision: {
          ...(reviewedOverwrite().payload.decision as Record<string, unknown>),
          id: "decision-email",
          fieldName: "email",
        },
      },
    };
    const manifest = {
      digest: "d",
      outcomes: [{ ...outcome("a", "ready"), match: { kind: "exact", localId: "organization-a", reason: "exact_external_link" } }],
      operations: [identity, firstOverwrite, secondOverwrite],
      operationStatuses: { [identity.operationKey]: "already_present" as const },
    };
    repo.seed("r", manifest);
    const service = new ActApprovalService(repo);
    const first = await service.approveReady({
      runId: "r", expectedManifestDigest: "d", requestKey: "reviewed-restart", requestedBy: "owner",
    });

    repo.seed("r", {
      ...manifest,
      operationStatuses: {
        [identity.operationKey]: "already_present",
        [firstOverwrite.operationKey]: "applied",
        [secondOverwrite.operationKey]: "failed",
      },
    });
    const restartedService = new ActApprovalService(repo);
    const replay = await restartedService.approveReady({
      runId: "r", expectedManifestDigest: "d", requestKey: "reviewed-restart", requestedBy: "owner",
    });

    expect(replay).toEqual(first);
    expect(replay.approvedOperationIds).toEqual(expect.arrayContaining([
      identity.operationKey,
      firstOverwrite.operationKey,
      secondOverwrite.operationKey,
    ]));
  });

  it("rejects reviewed replay when a nonterminal prior root disappears", async () => {
    const repo = new InMemoryApprovalRepository();
    const identity = {
      ...op("organization:a", [], true, "a"),
      action: "link_existing" as const,
      payload: { localId: "organization-a" },
    };
    const overwrite = reviewedOverwrite();
    const manifest = {
      digest: "d",
      outcomes: [{ ...outcome("a", "ready"), match: { kind: "exact", localId: "organization-a", reason: "exact_external_link" } }],
      operations: [identity, overwrite],
      operationStatuses: { [identity.operationKey]: "already_present" as const },
    };
    repo.seed("r", manifest);
    const service = new ActApprovalService(repo);
    await service.approveReady({ runId: "r", expectedManifestDigest: "d", requestKey: "reviewed-mismatch", requestedBy: "owner" });
    repo.seed("r", {
      ...manifest,
      operations: [identity, { ...overwrite, payload: { ...overwrite.payload, proof: undefined } }],
      operationStatuses: { [identity.operationKey]: "already_present", [overwrite.operationKey]: "failed" },
    });

    await expect(service.approveReady({
      runId: "r", expectedManifestDigest: "d", requestKey: "reviewed-mismatch", requestedBy: "owner",
    })).rejects.toMatchObject({ code: "request_replay_mismatch", status: 409 });
  });

  it("rejects reviewed recovery while its persisted identity dependency is pending", async () => {
    const repo = new InMemoryApprovalRepository();
    const identity = {
      ...op("organization:a", [], true, "a"),
      action: "link_existing" as const,
      payload: { localId: "organization-a" },
    };
    repo.seed("r", {
      digest: "d",
      outcomes: [{ ...outcome("a", "ready"), match: { kind: "exact", localId: "organization-a", reason: "exact_external_link" } }],
      operations: [identity, reviewedOverwrite()],
    });

    const result = await new ActApprovalService(repo).approveReady({
      runId: "r", expectedManifestDigest: "d", requestKey: "pending-identity", requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual([identity.operationKey]);
    expect(result.rejectedOperationIds).toContain(reviewedOverwrite().operationKey);
  });

  it("allows reviewed recovery when its persisted identity dependency is terminal", async () => {
    const repo = new InMemoryApprovalRepository();
    const identity = {
      ...op("organization:a", [], true, "a"),
      action: "link_existing" as const,
      payload: { localId: "organization-a" },
    };
    repo.seed("r", {
      digest: "d",
      outcomes: [{ ...outcome("a", "ready"), match: { kind: "exact", localId: "organization-a", reason: "exact_external_link" } }],
      operations: [identity, reviewedOverwrite()],
      operationStatuses: { [identity.operationKey]: "already_present" },
    });

    const result = await new ActApprovalService(repo).approveReady({
      runId: "r", expectedManifestDigest: "d", requestKey: "terminal-identity", requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual(expect.arrayContaining([
      identity.operationKey,
      reviewedOverwrite().operationKey,
    ]));
  });

  it("rejects a reviewed overwrite whose canonical target differs from its terminal identity", async () => {
    const repo = new InMemoryApprovalRepository();
    const identity = {
      ...op("organization:a", [], true, "a"),
      action: "link_existing" as const,
      payload: { localId: "organization-a" },
    };
    const overwrite = reviewedOverwrite();
    const crossTarget = {
      ...overwrite,
      payload: {
        ...overwrite.payload,
        entityId: "organization-b",
        proof: {
          ...(overwrite.payload.proof as Record<string, unknown>),
          entityId: "organization-b",
        },
        decision: {
          ...(overwrite.payload.decision as Record<string, unknown>),
          targetEntityId: "organization-b",
        },
      },
    };
    repo.seed("r", {
      digest: "d",
      outcomes: [{ ...outcome("a", "ready"), match: { kind: "exact", localId: "organization-a", reason: "exact_external_link" } }],
      operations: [identity, crossTarget],
      operationStatuses: { [identity.operationKey]: "already_present" },
    });

    const result = await new ActApprovalService(repo).approveReady({
      runId: "r", expectedManifestDigest: "d", requestKey: "cross-target-root", requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual([identity.operationKey]);
    expect(result.rejectedOperationIds).toContain(crossTarget.operationKey);
  });

  it("rejects a reviewed overwrite whose entity type differs from its terminal identity", async () => {
    const repo = new InMemoryApprovalRepository();
    const identity = {
      ...op("organization:a", [], true, "a"),
      action: "link_existing" as const,
      payload: { localId: "organization-a" },
    };
    const overwrite = reviewedOverwrite();
    const crossType: ManifestOperation = {
      ...overwrite,
      targetType: "contact",
      payload: {
        ...overwrite.payload,
        proof: { ...(overwrite.payload.proof as Record<string, unknown>), entityType: "contact" },
        decision: { ...(overwrite.payload.decision as Record<string, unknown>), targetEntityType: "contact" },
      },
    };
    repo.seed("r", {
      digest: "d",
      outcomes: [{ ...outcome("a", "ready"), match: { kind: "exact", localId: "organization-a", reason: "exact_external_link" } }],
      operations: [identity, crossType],
      operationStatuses: { [identity.operationKey]: "already_present" },
    });

    const result = await new ActApprovalService(repo).approveReady({
      runId: "r", expectedManifestDigest: "d", requestKey: "cross-type-root", requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual([identity.operationKey]);
    expect(result.rejectedOperationIds).toContain(crossType.operationKey);
  });
  it("includes transitive dependencies deterministically and replays request", async () => { const repo = new InMemoryApprovalRepository(); repo.seed("r", { digest: "d", operations: [op("z", ["b"]), op("b", ["a"]), op("a")] }); const service = new ActApprovalService(repo); const first = await service.approve({ runId: "r", operationIds: ["z"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "k", requestedBy: "owner" }); expect(first).toMatchObject({ selectedCount: 1, dependencyCount: 2, approvedOperationIds: ["a", "b", "z"] }); expect(await service.approve({ runId: "r", operationIds: ["a"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "k", requestedBy: "other" })).toEqual(first); });
  it("rejects unsafe and cyclic dependencies", async () => { const repo = new InMemoryApprovalRepository(); repo.seed("r", { digest: "d", operations: [op("a", ["b"]), op("b", [], false)] }); await expect(new ActApprovalService(repo).approve({ runId: "r", operationIds: ["a"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "x", requestedBy: "o" })).rejects.toMatchObject({ code: "unsafe_dependency" }); repo.seed("c", { digest: "d", operations: [op("a", ["b"]), op("b", ["a"])] }); await expect(new ActApprovalService(repo).approve({ runId: "c", operationIds: ["a"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "x", requestedBy: "o" })).rejects.toMatchObject({ code: "dependency_cycle" }); });

  it("orders dependencies before dependents even when lexical order is opposite", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", { digest: "d", operations: [op("activity:child", ["organization:parent"]), op("organization:parent")] });

    const result = await new ActApprovalService(repo).approve({ runId: "r", operationIds: ["activity:child"], includeDependencies: true, expectedManifestDigest: "d", requestKey: "ordered", requestedBy: "owner" });

    expect(result.approvedOperationIds).toEqual(["organization:parent", "activity:child"]);
  });

  it("rejects an explicitly selected link whose payload targets a different match", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [{ ...provenOutcome("linked", "ready"), match: {
        ...provenOutcome("linked", "ready").match,
        localId: "organization-a",
      } }],
      operations: [{
        ...op("organization:linked", [], true, "linked"),
        action: "link_existing",
        payload: { localId: "organization-b" },
      }],
    });

    await expect(new ActApprovalService(repo).approve({
      runId: "r",
      operationIds: ["organization:linked"],
      includeDependencies: true,
      expectedManifestDigest: "d",
      requestKey: "mismatched-link",
      requestedBy: "owner",
    })).rejects.toMatchObject({ code: "link_target_mismatch" });
  });

  it("rejects a mismatched link pulled into explicit approval through dependencies", async () => {
    const repo = new InMemoryApprovalRepository();
    const overwrite = reviewedOverwrite();
    repo.seed("r", {
      digest: "d",
      outcomes: [{
        ...outcome("a", "ready"),
        match: { kind: "exact", localId: "organization-a", reason: "exact_external_link" },
      }],
      operations: [
        {
          ...op("organization:a", [], true, "a"),
          action: "link_existing",
          payload: { localId: "organization-b" },
        },
        { ...overwrite, dependencyOperationKeys: ["organization:a"] },
      ],
    });

    await expect(new ActApprovalService(repo).approve({
      runId: "r",
      operationIds: [overwrite.operationKey],
      includeDependencies: true,
      expectedManifestDigest: "d",
      requestKey: "mismatched-dependency-link",
      requestedBy: "owner",
    })).rejects.toMatchObject({ code: "link_target_mismatch" });
  });

  it("approves a safe operation from an awaiting-review outcome", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [outcome("safe", "ready"), outcome("conflict", "awaiting_review")],
      operations: [op("safe:create", [], true, "safe"), op("conflict:create", [], true, "conflict")],
    });

    const result = await new ActApprovalService(repo).approveSafeDefaults({ runId: "r", expectedManifestDigest: "d", requestKey: "safe-defaults", requestedBy: "owner" });

    expect(result.approvedOperationIds).toEqual(["conflict:create", "safe:create"]);
    expect(result.rejectedOperationIds).toEqual([]);
  });

  it("approves an awaiting-review safe link while excluding unsafe and dependency-blocked roots", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [provenOutcome("awaiting")],
      operations: [
        { ...op("awaiting:link", [], true, "awaiting"), action: "link_existing", payload: { localId: "local-awaiting" } },
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

  it("keeps reviewed-ready imports while adding safe defaults from mixed outcomes", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [{ ...outcome("reviewed", "ready"), match: { kind: "exact", localId: "organization-reviewed", reason: "exact_external_link" } }, provenOutcome("awaiting")],
      operations: [
        { ...op("organization:reviewed", [], true, "reviewed"), action: "link_existing", payload: { localId: "organization-reviewed" } },
        { ...reviewedOverwrite(), sourceRecordId: "reviewed", sourceVersionId: "v-reviewed", dependencyOperationKeys: ["organization:reviewed"], payload: {
          ...reviewedOverwrite().payload,
          entityId: "organization-reviewed",
          proof: {
            ...(reviewedOverwrite().payload.proof as Record<string, unknown>),
            entityId: "organization-reviewed",
            sourceVersionId: "v-reviewed",
          },
          decision: {
            ...(reviewedOverwrite().payload.decision as Record<string, unknown>),
            sourceVersionId: "v-reviewed",
            targetEntityId: "organization-reviewed",
          },
        } },
        { ...op("awaiting:link", [], true, "awaiting"), action: "link_existing", payload: { localId: "local-awaiting" } },
        { ...op("awaiting:overwrite", [], false, "awaiting"), action: "overwrite_reviewed" },
      ],
      operationStatuses: { "organization:reviewed": "already_present" },
    });

    const result = await new ActApprovalService(repo).approveReady({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "page-import",
      requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual([
      "awaiting:link",
      "organization:reviewed",
      "organization:a:field:phone",
    ]);
    expect(result.rejectedOperationIds).toEqual(["awaiting:overwrite"]);
  });

  it("rejects an awaiting-review link when bounded proof contradicts its target", async () => {
    const repo = new InMemoryApprovalRepository();
    const contradictory = provenOutcome("awaiting");
    contradictory.match = {
      ...(contradictory.match ?? {}),
      evidence: [
        ...((contradictory.match?.evidence as unknown[]) ?? []),
        {
          family: "location",
          label: "another location",
          targetEntityType: "organization",
          targetEntityId: "local-other",
          authority: "supporting",
        },
      ],
    };
    repo.seed("r", {
      digest: "d",
      outcomes: [contradictory],
      operations: [{
        ...op("awaiting:link", [], true, "awaiting"),
        action: "link_existing",
        payload: { localId: "local-awaiting" },
      }],
    });

    const result = await new ActApprovalService(repo).approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "contradictory-safe-defaults",
      requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual([]);
    expect(result.rejectedOperationIds).toEqual(["awaiting:link"]);
  });

  it("keeps a contradictory ready-state link out of the legacy ready approval", async () => {
    const repo = new InMemoryApprovalRepository();
    const contradictory = provenOutcome("ready-link", "ready");
    contradictory.match = {
      ...(contradictory.match ?? {}),
      evidence: [
        ...((contradictory.match?.evidence as unknown[]) ?? []),
        {
          family: "location",
          label: "another location",
          targetEntityType: "organization",
          targetEntityId: "local-other",
          authority: "supporting",
        },
      ],
    };
    repo.seed("r", {
      digest: "d",
      outcomes: [contradictory],
      operations: [{
        ...op("ready:link", [], true, "ready-link"),
        action: "link_existing",
        payload: { localId: "local-ready-link" },
      }],
    });

    const result = await new ActApprovalService(repo).approveReady({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "contradictory-ready",
      requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual([]);
    expect(result.rejectedOperationIds).toEqual(["ready:link"]);
  });

  it("rejects a ready legacy link whose operation target is not the matched target", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [{
        ...outcome("legacy", "ready"),
        match: { kind: "exact", localId: "local-a", reason: "exact_external_link" },
      }],
      operations: [{
        ...op("legacy:link", [], true, "legacy"),
        action: "link_existing",
        payload: { localId: "local-b" },
      }],
    });

    const result = await new ActApprovalService(repo).approveReady({
      runId: "r", expectedManifestDigest: "d", requestKey: "legacy-target-binding", requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual([]);
    expect(result.rejectedOperationIds).toEqual(["legacy:link"]);
  });

  it("fails closed on safe operations retained by a stale ambiguous manifest", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [{
        ...outcome("ambiguous", "awaiting_review"),
        match: {
          kind: "ambiguous",
          candidateIds: ["local-a", "local-b"],
          reason: "conflicting_context_clues",
        },
      }],
      operations: [op("ambiguous:create", [], true, "ambiguous")],
    });

    const result = await new ActApprovalService(repo).approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "stale-ambiguous",
      requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual([]);
    expect(result.rejectedOperationIds).toEqual(["ambiguous:create"]);
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

  it("approves safe operations and proof-bearing reviewed overwrites for ready outcomes", async () => {
    const repo = new InMemoryApprovalRepository();
    repo.seed("r", {
      digest: "d",
      outcomes: [{ ...outcome("a", "ready"), match: { kind: "exact", localId: "organization-a", reason: "exact_external_link" } }],
      operations: [
        { ...op("organization:a", [], true, "a"), action: "link_existing", payload: { localId: "organization-a" } },
        reviewedOverwrite(),
        { ...op("provenance:a", ["organization:a"], true, "a"), action: "record_provenance" },
      ],
      operationStatuses: { "organization:a": "already_present" },
    });

    const result = await new ActApprovalService(repo).approveReady({ runId: "r", expectedManifestDigest: "d", requestKey: "ready", requestedBy: "owner" });

    expect(result.approvedOperationIds).toEqual(["organization:a", "organization:a:field:phone", "provenance:a"]);
  });

  it("approves only decision-bound reviewed relationships from ready outcomes", async () => {
    const repo = new InMemoryApprovalRepository();
    const reviewedRelationship: ManifestOperation = {
      ...op("organization_contact:a:reviewed-parent", ["organization:a"], true, "a"),
      action: "create_relationship",
      targetType: "organization_contact",
      payload: {
        parentEntityId: "organization-parent",
        parentType: "organization",
        relationshipSlot: "organization",
        decision: {
          id: "decision-parent",
          sourceVersionId: "v-a",
          scope: "relationship",
          decision: "assign_parent",
          relationshipSlot: "organization",
          targetEntityType: "organization",
          targetEntityId: "organization-parent",
        },
      },
    };
    repo.seed("r", {
      digest: "d",
      outcomes: [{ ...outcome("a", "ready"), match: { kind: "exact", localId: "organization-a", reason: "exact_external_link" } }],
      operations: [
        { ...op("organization:a", [], true, "a"), action: "link_existing", payload: { localId: "organization-a" } },
        reviewedRelationship,
        {
          ...reviewedRelationship,
          operationKey: "organization_contact:a:unbound-parent",
          payload: { ...reviewedRelationship.payload, decision: undefined },
        },
      ],
      operationStatuses: { "organization:a": "already_present" },
    });

    const result = await new ActApprovalService(repo).approveReady({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "reviewed-relationships",
      requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual([
      "organization:a",
      "organization_contact:a:reviewed-parent",
    ]);
    expect(result.rejectedOperationIds).toContain(
      "organization_contact:a:unbound-parent",
    );
  });

  it("excludes a reviewed root whose dependency closure contains an unproved relationship", async () => {
    const repo = new InMemoryApprovalRepository();
    const overwrite = reviewedOverwrite();
    repo.seed("r", {
      digest: "d",
      outcomes: [{
        ...outcome("a", "ready"),
        match: { kind: "exact", localId: "organization-a", reason: "exact_external_link" },
      }],
      operations: [
        {
          ...op("organization:a", [], true, "a"),
          action: "link_existing",
          payload: { localId: "organization-a" },
        },
        {
          ...op("organization-contact:a", ["organization:a"], true, "a"),
          action: "create_relationship",
          targetType: "organization_contact",
          payload: {
            parentEntityId: "organization-parent",
            parentType: "organization",
            relationshipSlot: "organization",
          },
        },
        { ...overwrite, dependencyOperationKeys: ["organization-contact:a"] },
      ],
    });

    const result = await new ActApprovalService(repo).approveReady({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "unproved-relationship-dependency",
      requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual(["organization:a"]);
    expect(result.rejectedOperationIds).toEqual(expect.arrayContaining([
      "organization-contact:a",
      overwrite.operationKey,
    ]));
  });

  it("excludes a reviewed root whose dependency closure contains a mismatched link", async () => {
    const repo = new InMemoryApprovalRepository();
    const overwrite = reviewedOverwrite();
    repo.seed("r", {
      digest: "d",
      outcomes: [{
        ...outcome("a", "ready"),
        match: { kind: "exact", localId: "organization-a", reason: "exact_external_link" },
      }],
      operations: [
        {
          ...op("organization:a", [], true, "a"),
          action: "link_existing",
          payload: { localId: "organization-b" },
        },
        { ...overwrite, dependencyOperationKeys: ["organization:a"] },
      ],
    });

    const result = await new ActApprovalService(repo).approveReady({
      runId: "r",
      expectedManifestDigest: "d",
      requestKey: "mismatched-ready-dependency-link",
      requestedBy: "owner",
    });

    expect(result.approvedOperationIds).toEqual([]);
    expect(result.rejectedOperationIds).toEqual(expect.arrayContaining([
      "organization:a",
      overwrite.operationKey,
    ]));
  });

  it("approves real exact-match fills and reviewed overwrites without admitting held or unsafe work", async () => {
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
      operationStatuses: { "organization:overwrite:identity:local-overwrite": "already_present" },
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
      "organization:overwrite:field:phone:decision:decision-use-source",
    ]));
    expect(ready.approvedOperationIds).not.toContain("organization:ambiguous");
    expect(ready.approvedOperationIds).not.toContain("contact:unresolved");
    expect(ready.approvedOperationIds).not.toContain("organization:unsafe");
    expect(ready.approvedOperationIds.filter((operationId) =>
      manifest.operations.find((operation) => operation.operationKey === operationId)?.action === "overwrite_reviewed"
    )).toEqual(["organization:overwrite:field:phone:decision:decision-use-source"]);

    const safe = await service.approveSafeDefaults({
      runId: "r",
      expectedManifestDigest: manifest.digest,
      requestKey: "real-safe-defaults",
      requestedBy: "owner",
    });
    expect(safe.approvedOperationIds).toContain(fillOperationKey);
    expect(safe.approvedOperationIds).not.toContain("organization:overwrite:field:phone:decision:decision-use-source");
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
    expect(result.rejectedOperationIds).toContain("safe:create");
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
