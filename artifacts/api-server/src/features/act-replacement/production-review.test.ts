import { describe, expect, it } from "vitest";

import {
  ActApprovalService,
  InMemoryApprovalRepository,
} from "./approval-service";
import { ActApplyCoordinator } from "./apply-coordinator";
import { InMemoryApplyRepository } from "./apply-repository";
import { ActApplyService } from "./apply-service";
import {
  createProductionReview,
  projectImportWorkflow,
  type ImportWorkflowProjectionInput,
} from "./production-review";
import { ProductionActOrganizer } from "./production-organizer";
import {
  InMemoryReviewCommandStore,
  ReviewCommandService,
} from "./review-command-service";
import type {
  ActOrganizeManifest,
  ManifestOperation,
  ManifestOutcome,
} from "./manifest-builder";
import { fingerprintSourceContent } from "./source-fingerprint";
import {
  manifestFromRows,
  manifestSourcesFromArchiveRows,
  type ArchivedOrganizerSourceRow,
} from "./review-sql-adapter";

const CURRENT_DIGEST = "a".repeat(64);
const STALE_DIGEST = "b".repeat(64);

function input(): ImportWorkflowProjectionInput {
  return {
    phase: "ready_to_apply",
    summary: { manifestDigest: CURRENT_DIGEST },
    outcomes: [{ sourceRecordId: "source-one", state: "ready" }],
    operations: [
      {
        operationKey: "organization:one",
        sourceRecordId: "source-one",
        action: "create",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
      },
    ],
    batches: [],
  };
}

describe("durable production workflow projection", () => {
  it("approves only safe or proof-reviewed operations from a mixed archived migration", async () => {
    const runId = "mixed-safety-run";
    const fetchedAt = new Date("2026-08-08T12:00:00.000Z");
    const archived = (
      sourceRecordId: string,
      rawSnapshot: Record<string, unknown>,
      streamType = "company",
    ): ArchivedOrganizerSourceRow => ({
      sourceRecordId,
      sourceVersionId: `${sourceRecordId}-version`,
      latestSourceVersionId: `${sourceRecordId}-version`,
      streamType,
      actRecordId: `${sourceRecordId}-act`,
      archiveCompleteness: "complete",
      rawSnapshot,
      fetchedAt,
      relationshipEvidence: {},
    });
    const rows: ArchivedOrganizerSourceRow[] = [
      archived("create-with-unsupported", {
        Name: "Archive Safe",
        Phone: "555-0100",
        LegacyCode: "A-17",
      }),
      archived("exact-empty", {
        Name: "Fill Me",
        Phone: "555-0200",
        Website: "https://fill.example",
      }),
      archived("keep-local", {
        Name: "Keep Local",
        Phone: "555-ACT-KEEP",
        Website: "https://keep.example",
      }),
      archived("use-act", {
        Name: "Use Act",
        Phone: "555-ACT-USE",
        Website: "https://use.example",
      }),
      archived("ambiguous-kept-separate", { Name: "Ambiguous Company" }),
      archived(
        "unresolved-relationship",
        { FirstName: "Lost", LastName: "Relationship" },
        "contact",
      ),
      archived("ignored-unsupported", { Phone: "555-0700" }),
      {
        ...archived("missing-parent-link", {}, "company_contact"),
        actRecordId: null,
        relationshipEvidence: {
          source: "endpoint",
          parentKind: "contact",
          parentActRecordId: "unresolved-relationship-act",
          targetKind: "company",
          targetActRecordId: "missing-company-act",
        },
      },
    ];
    const decisions = [
      {
        id: "decision-keep-local",
        sourceRecordId: "keep-local",
        sourceVersionId: "keep-local-version",
        scope: "field_conflict" as const,
        decision: "keep_local" as const,
        fieldName: "phone",
        targetEntityType: "organization",
        targetEntityId: "local-keep",
        decidedBy: "owner",
        createdAt: fetchedAt,
        active: true,
      },
      {
        id: "decision-use-act",
        sourceRecordId: "use-act",
        sourceVersionId: "use-act-version",
        scope: "field_conflict" as const,
        decision: "use_source" as const,
        fieldName: "phone",
        targetEntityType: "organization",
        targetEntityId: "local-use",
        reviewedSourceValue: "555-ACT-USE",
        reviewedSourceValueFingerprint: fingerprintSourceContent({ value: "555-ACT-USE" }),
        reviewedLocalValue: "555-LOCAL-USE",
        reviewedLocalValueFingerprint: fingerprintSourceContent({ value: "555-LOCAL-USE" }),
        decidedBy: "owner",
        createdAt: fetchedAt,
        active: true,
      },
      {
        id: "decision-keep-separate",
        sourceRecordId: "ambiguous-kept-separate",
        sourceVersionId: "ambiguous-kept-separate-version",
        scope: "duplicate_identity" as const,
        decision: "keep_separate" as const,
        fieldName: null,
        targetEntityType: null,
        targetEntityId: null,
        decidedBy: "owner",
        createdAt: fetchedAt,
        active: true,
      },
      {
        id: "decision-ignore-unsupported",
        sourceRecordId: "ignored-unsupported",
        sourceVersionId: "ignored-unsupported-version",
        scope: "unsupported_record" as const,
        decision: "ignore_source" as const,
        fieldName: null,
        targetEntityType: null,
        targetEntityId: null,
        decidedBy: "owner",
        createdAt: fetchedAt,
        active: true,
      },
    ];
    const sources = manifestSourcesFromArchiveRows({
      rows,
      decisions,
      sourceDatabaseKey: "act-db",
      localCandidates: {
        organizations: [
          {
            id: "local-fill",
            name: "Fill Me",
            phone: null,
            website: "https://fill.example",
          },
          {
            id: "local-keep",
            name: "Keep Local",
            phone: "555-LOCAL-KEEP",
            website: "https://keep.example",
          },
          {
            id: "local-use",
            name: "Use Act",
            phone: "555-LOCAL-USE",
            website: "https://use.example",
          },
          { id: "ambiguous-a", name: "Ambiguous Company" },
          { id: "ambiguous-b", name: "Ambiguous Company" },
        ],
      },
    });
    let persistedRows: Parameters<typeof manifestFromRows>[0] | null = null;
    const organized = await new ProductionActOrganizer({
      async claim(claimedRunId) {
        return {
          runId: claimedRunId,
          phase: "extract_complete",
          claimToken: "mixed-safety-claim",
        };
      },
      async loadSources() {
        return sources;
      },
      async renew() {
        return true;
      },
      async persistManifest(_persistedRunId, _claimToken, manifest) {
        persistedRows = JSON.parse(
          JSON.stringify({
            operations: manifest.operations,
            outcomes: manifest.outcomes,
          }),
        ) as Parameters<typeof manifestFromRows>[0];
      },
      async complete() {},
      async release() {},
    }).organize(runId);

    expect(persistedRows).not.toBeNull();
    const manifest = manifestFromRows(persistedRows!);
    expect(manifest.digest).toBe(organized.manifest.digest);
    expect(manifest.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceRecordId: "create-with-unsupported",
          state: "ready",
          issues: expect.arrayContaining([
            expect.objectContaining({ code: "unsupported_field" }),
          ]),
        }),
        expect.objectContaining({
          sourceRecordId: "exact-empty",
          state: "ready",
        }),
        expect.objectContaining({
          sourceRecordId: "keep-local",
          state: "ready",
        }),
        expect.objectContaining({ sourceRecordId: "use-act", state: "ready" }),
        expect.objectContaining({
          sourceRecordId: "ambiguous-kept-separate",
          state: "ready",
        }),
        expect.objectContaining({
          sourceRecordId: "unresolved-relationship",
          state: "awaiting_review",
          issues: expect.arrayContaining([
            expect.objectContaining({ code: "relationship_unresolved" }),
          ]),
          operationKeys: [],
        }),
        expect.objectContaining({
          sourceRecordId: "ignored-unsupported",
          state: "ignored",
          operationKeys: [],
        }),
      ]),
    );

    const operations = manifest.operations;
    const operationKeyFor = (sourceRecordId: string, action: string) => operations.find((operation) => operation.sourceRecordId === sourceRecordId && operation.action === action)!.operationKey;
    const fillPhoneKey = operationKeyFor("exact-empty", "fill_missing");
    const provenanceAmbiguousKey = operationKeyFor("ambiguous-kept-separate", "record_provenance");
    const provenanceCreateKey = operationKeyFor("create-with-unsupported", "record_provenance");
    const provenanceFillKey = operationKeyFor("exact-empty", "record_provenance");
    const provenanceKeepKey = operationKeyFor("keep-local", "record_provenance");
    const provenanceUseKey = operationKeyFor("use-act", "record_provenance");
    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationKey: "organization:create-with-unsupported",
          action: "create",
        }),
        expect.objectContaining({
          operationKey: fillPhoneKey,
          action: "fill_missing",
        }),
        expect.objectContaining({
          operationKey: "organization:ambiguous-kept-separate",
          action: "create",
        }),
      ]),
    );
    expect(
      operations.some(
        (operation) =>
          operation.sourceRecordId === "keep-local" &&
          operation.action === "overwrite_reviewed",
      ),
    ).toBe(false);
    expect(
      operations.some((operation) =>
        ["unresolved-relationship", "ignored-unsupported"].includes(
          operation.sourceRecordId,
        ),
      ),
    ).toBe(false);

    const reviewedOverwrites = operations.filter(
      (operation) => operation.action === "overwrite_reviewed",
    );
    expect(reviewedOverwrites).toEqual([
      expect.objectContaining({
        operationKey: "organization:use-act:field:phone:decision:decision-use-act",
        safeByDefault: false,
        payload: expect.objectContaining({
          decision: expect.objectContaining({
            id: "decision-use-act",
            decision: "use_source",
            sourceVersionId: "use-act-version",
            targetEntityId: "local-use",
          }),
          proof: expect.objectContaining({
            localValue: "555-LOCAL-USE",
            sourceValue: "555-ACT-USE",
            expectedLocalValueFingerprint: fingerprintSourceContent({ value: "555-LOCAL-USE" }),
          }),
        }),
      }),
    ]);

    const approvals = new InMemoryApprovalRepository();
    approvals.seed(runId, manifest);
    const approvalService = new ActApprovalService(approvals);
    const safe = await approvalService.approveSafeDefaults({
      runId,
      expectedManifestDigest: manifest.digest,
      requestKey: "safe-defaults",
      requestedBy: "owner",
    });
    const expectedSafeSelectedOperationIds = [
      "organization:ambiguous-kept-separate",
      "organization:create-with-unsupported",
      fillPhoneKey,
      "organization:exact-empty:identity:local-fill",
      "organization:keep-local:identity:local-keep",
      "organization:use-act:identity:local-use",
      provenanceAmbiguousKey,
      provenanceCreateKey,
      provenanceFillKey,
      provenanceKeepKey,
    ];
    const expectedSafeApprovedOperationIds = [
      "organization:ambiguous-kept-separate",
      "organization:create-with-unsupported",
      "organization:exact-empty:identity:local-fill",
      fillPhoneKey,
      "organization:keep-local:identity:local-keep",
      "organization:use-act:identity:local-use",
      provenanceAmbiguousKey,
      provenanceCreateKey,
      provenanceFillKey,
      provenanceKeepKey,
    ];
    expect(safe).toEqual({
      selectedOperationIds: expectedSafeSelectedOperationIds,
      approvedOperationIds: expectedSafeApprovedOperationIds,
      dependencyOperationIds: ["organization:exact-empty:identity:local-fill"],
      rejectedOperationIds: [
        "organization:use-act:field:phone:decision:decision-use-act",
        provenanceUseKey,
      ],
      selectedCount: 10,
      dependencyCount: 1,
      rejectedCount: 2,
      manifestDigest: manifest.digest,
    });

    const ready = await approvalService.approveReady({
      runId,
      expectedManifestDigest: manifest.digest,
      requestKey: "approve-ready",
      requestedBy: "owner",
    });
    const expectedReadyOperationIds = [
      "organization:ambiguous-kept-separate",
      "organization:create-with-unsupported",
      "organization:exact-empty:identity:local-fill",
      fillPhoneKey,
      "organization:keep-local:identity:local-keep",
      "organization:use-act:identity:local-use",
      "organization:use-act:field:phone:decision:decision-use-act",
      provenanceAmbiguousKey,
      provenanceCreateKey,
      provenanceFillKey,
      provenanceKeepKey,
    ];
    const expectedReadySelectedOperationIds = [
      "organization:ambiguous-kept-separate",
      "organization:create-with-unsupported",
      fillPhoneKey,
      "organization:exact-empty:identity:local-fill",
      "organization:keep-local:identity:local-keep",
      "organization:use-act:field:phone:decision:decision-use-act",
      "organization:use-act:identity:local-use",
      provenanceAmbiguousKey,
      provenanceCreateKey,
      provenanceFillKey,
      provenanceKeepKey,
    ];
    expect(ready).toEqual({
      selectedOperationIds: expectedReadySelectedOperationIds,
      approvedOperationIds: expectedReadyOperationIds,
      dependencyOperationIds: ["organization:exact-empty:identity:local-fill", "organization:use-act:identity:local-use"],
      rejectedOperationIds: [provenanceUseKey],
      selectedCount: 11,
      dependencyCount: 2,
      rejectedCount: 1,
      manifestDigest: manifest.digest,
    });

    const explicit = await approvalService.approve({
      runId,
      operationIds: ["organization:use-act:field:phone:decision:decision-use-act"],
      includeDependencies: true,
      expectedManifestDigest: manifest.digest,
      requestKey: "explicit-reviewed-overwrite",
      requestedBy: "owner",
    });
    expect(explicit).toEqual({
      selectedOperationIds: ["organization:use-act:field:phone:decision:decision-use-act"],
      approvedOperationIds: [
        "organization:use-act:identity:local-use",
        "organization:use-act:field:phone:decision:decision-use-act",
      ],
      dependencyOperationIds: ["organization:use-act:identity:local-use"],
      rejectedOperationIds: [],
      selectedCount: 1,
      dependencyCount: 1,
      rejectedCount: 0,
      manifestDigest: manifest.digest,
    });

    class ConcurrentEditApplyRepository extends InMemoryApplyRepository {
      override async findTargetBySource(
        entityType: string,
        sourceRecordId: string,
      ) {
        const target = await super.findTargetBySource(
          entityType,
          sourceRecordId,
        );
        if (!target || sourceRecordId !== "exact-empty") return target;
        const staleSnapshot = {
          ...target,
          values: { ...target.values },
          sourceIds: target.sourceIds ? new Set(target.sourceIds) : undefined,
        };
        target.values.phone = "concurrent-local-edit";
        return staleSnapshot;
      }
    }

    const applyRepository = new ConcurrentEditApplyRepository({
      unsafeForTests: true,
    });
    applyRepository.seedManifest(runId, manifest.digest);
    applyRepository.seedOperations(manifest.operations);
    const seedOrganization = (
      id: string,
      sourceRecordId: string,
      values: Record<string, unknown>,
    ) => {
      const target = {
        id,
        entityType: "organization",
        values: { ...values },
        sourceIds: new Set([sourceRecordId]),
      };
      applyRepository.targets.set(`organization:${id}`, target);
      return target;
    };
    const fillTarget = seedOrganization("local-fill", "exact-empty", {
      name: "Fill Me",
      phone: null,
      website: "https://fill.example",
    });
    const keepTarget = seedOrganization("local-keep", "keep-local", {
      name: "Keep Local",
      phone: "555-LOCAL-KEEP",
      website: "https://keep.example",
    });
    const overwriteTarget = seedOrganization("local-use", "use-act", {
      name: "Use Act",
      phone: "555-LOCAL-USE",
      website: "https://use.example",
    });
    const applyService = new ActApplyService(applyRepository, true);
    const safeApply = await applyService.apply({
      runId,
      approvedOperationIds: safe.approvedOperationIds,
      expectedManifestDigest: manifest.digest,
      requestKey: "apply-safe-defaults",
      requestedBy: "owner",
    });
    expect(safeApply).toEqual({
      batchId: `${runId}:apply-safe-defaults`,
      runId,
      manifestDigest: manifest.digest,
      state: "complete_with_issues",
      operationCount: 10,
      completedCount: 5,
      alreadyPresentCount: 3,
      blockedCount: 2,
      failedCount: 0,
    });
    expect(fillTarget.values).toEqual({
      name: "Fill Me",
      phone: "concurrent-local-edit",
      website: "https://fill.example",
    });
    expect(keepTarget.values).toEqual({
      name: "Keep Local",
      phone: "555-LOCAL-KEEP",
      website: "https://keep.example",
    });
    expect(overwriteTarget.values).toEqual({
      name: "Use Act",
      phone: "555-LOCAL-USE",
      website: "https://use.example",
    });
    expect(applyRepository.operations.get(fillPhoneKey)).toMatchObject({
      status: "blocked",
      lastErrorCode: "local_value_nonempty",
    });

    overwriteTarget.values.phone = "concurrent-reviewed-edit";
    const explicitApply = await applyService.apply({
      runId,
      approvedOperationIds: explicit.approvedOperationIds,
      expectedManifestDigest: manifest.digest,
      requestKey: "apply-reviewed-overwrite",
      requestedBy: "owner",
    });
    expect(explicitApply).toEqual({
      batchId: `${runId}:apply-reviewed-overwrite`,
      runId,
      manifestDigest: manifest.digest,
      state: "complete_with_issues",
      operationCount: 2,
      completedCount: 0,
      alreadyPresentCount: 1,
      blockedCount: 0,
      failedCount: 1,
    });
    expect(overwriteTarget.values.phone).toBe("concurrent-reviewed-edit");
    expect(
      applyRepository.operations.get("organization:use-act:field:phone:decision:decision-use-act"),
    ).toMatchObject({
      status: "failed",
      lastErrorCode: "local_edit_detected",
    });
  });

  it("lazily exposes bounded review pages and assignment target search", () => {
    const review = createProductionReview({
      sourceDatabaseKey: "act-db",
      requestedBy: "owner",
    });

    expect(review.reader.readReviewPage).toBeTypeOf("function");
    expect(review.assignmentTargets).toBeTypeOf("function");
  });

  it("allows a crashed organizer to be retried after its durable lease expires", () => {
    const state = input();
    state.phase = "organizing";
    state.organizerLeaseExpiresAt = new Date("2026-08-08T20:00:00.000Z");
    state.now = new Date("2026-08-08T20:00:01.000Z");

    expect(projectImportWorkflow(state).canOrganize).toBe(true);

    state.organizerLeaseExpiresAt = new Date("2026-08-08T20:10:00.000Z");
    expect(projectImportWorkflow(state).canOrganize).toBe(false);
  });

  it("allows an unapplied organized archive to rebuild its review manifest", () => {
    const state = input();

    expect(projectImportWorkflow(state).canOrganize).toBe(true);

    state.operations[0]!.status = "applied";
    expect(projectImportWorkflow(state).canOrganize).toBe(false);
  });

  it("keeps remaining review work actionable after applying one safe subset and applies the rebuilt subset", async () => {
    const runId = "two-subset-run";
    const firstDigest = "c".repeat(64);
    const secondDigest = "d".repeat(64);
    const safeOperation: ManifestOperation = {
      operationKey: "organization:safe",
      sourceRecordId: "safe",
      sourceVersionId: "safe-version",
      targetType: "organization",
      action: "create",
      payload: { normalized: { kind: "organization", name: "Safe first" } },
      dependencyOperationKeys: [],
      requiredForSourceOutcome: true,
      safeByDefault: true,
    };
    const remainingOutcome: ManifestOutcome = {
      sourceRecordId: "remaining",
      sourceVersionId: "remaining-version",
      state: "awaiting_review",
      issues: [{ code: "ambiguous_match" }],
      candidates: [],
      match: null,
      mappingWarnings: [],
      unsupportedFieldPaths: [],
      operationKeys: [],
    };
    const firstManifest: ActOrganizeManifest = {
      digest: firstDigest,
      diagnostics: [],
      outcomes: [
        {
          sourceRecordId: "safe",
          sourceVersionId: "safe-version",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
          operationKeys: [safeOperation.operationKey],
        },
        remainingOutcome,
      ],
      operations: [safeOperation],
    };
    const reviewedOperation: ManifestOperation = {
      operationKey: "organization:remaining",
      sourceRecordId: "remaining",
      sourceVersionId: "remaining-version",
      targetType: "organization",
      action: "create",
      payload: {
        normalized: { kind: "organization", name: "Reviewed second" },
      },
      dependencyOperationKeys: [],
      requiredForSourceOutcome: true,
      safeByDefault: true,
    };
    const secondManifest: ActOrganizeManifest = {
      digest: secondDigest,
      diagnostics: [],
      outcomes: [
        firstManifest.outcomes[0]!,
        {
          ...remainingOutcome,
          state: "ready",
          issues: [],
          operationKeys: [reviewedOperation.operationKey],
        },
      ],
      operations: [safeOperation, reviewedOperation],
    };
    const approvals = new InMemoryApprovalRepository();
    const applyRepository = new InMemoryApplyRepository({
      unsafeForTests: true,
    });
    const applyService = new ActApplyService(applyRepository, true);
    const coordinator = new ActApplyCoordinator(applyService, applyRepository);

    approvals.seed(runId, firstManifest);
    applyRepository.seedManifest(runId, firstDigest);
    applyRepository.seedOperations(firstManifest.operations);
    const firstApproval = await new ActApprovalService(
      approvals,
    ).approveSafeDefaults({
      runId,
      expectedManifestDigest: firstDigest,
      requestKey: "approve-first",
      requestedBy: "owner",
    });
    applyRepository.seedApproval(
      runId,
      "approve-first",
      firstApproval.approvedOperationIds,
      firstDigest,
    );
    await coordinator.applyNext({
      runId,
      approvalRequestKey: "approve-first",
      expectedManifestDigest: firstDigest,
      requestedBy: "owner",
      batchSize: 25,
    });

    const completedWorkflow = projectImportWorkflow({
      phase: applyRepository.runPhases.get(runId)!,
      summary: { manifestDigest: firstDigest },
      outcomes: firstManifest.outcomes,
      operations: [...applyRepository.operations.values()],
      batches: [...applyRepository.batches.values()].map((batch) => ({
        ...batch,
        leaseExpiresAt:
          batch.leaseExpiresAt === undefined
            ? undefined
            : new Date(batch.leaseExpiresAt),
      })),
    });
    expect(completedWorkflow).toMatchObject({
      canOrganize: false,
      canReview: true,
      reviewRequiredCount: 1,
      appliedOperationCount: 1,
    });

    const commandStore = new InMemoryReviewCommandStore(
      approvals,
      applyService,
    );
    commandStore.seed(
      runId,
      firstManifest,
      {
        remaining: {
          sourceVersionId: "remaining-version",
          streamType: "company",
        },
      },
      "owner",
    );
    commandStore.rebuildAfterReviewChange = async () => {
      commandStore.manifests.set(runId, secondManifest);
      approvals.seed(runId, secondManifest);
      applyRepository.seedManifest(runId, secondDigest);
      applyRepository.seedOperations([reviewedOperation]);
      return { status: "ready_to_apply" };
    };
    await new ReviewCommandService(commandStore).decide({
      runId,
      sourceRecordId: "remaining",
      sourceVersionId: "remaining-version",
      scope: "duplicate_identity",
      decision: "keep_separate",
      requestKey: "review-remaining",
      decidedBy: "owner",
    });

    const secondApproval = await new ActApprovalService(
      approvals,
    ).approveReady({
      runId,
      expectedManifestDigest: secondDigest,
      requestKey: "approve-second",
      requestedBy: "owner",
    });
    applyRepository.seedApproval(
      runId,
      "approve-second",
      secondApproval.approvedOperationIds,
      secondDigest,
    );
    const secondApply = await coordinator.applyNext({
      runId,
      approvalRequestKey: "approve-second",
      expectedManifestDigest: secondDigest,
      requestedBy: "owner",
      batchSize: 25,
    });

    expect(secondApply).toMatchObject({
      hasMore: false,
      requiresReview: false,
      batch: { completedCount: 1, alreadyPresentCount: 1 },
    });
    expect(applyRepository.runPhases.get(runId)).toBe("complete");
    expect(applyRepository.operations.get(reviewedOperation.operationKey))
      .toMatchObject({ status: "applied" });
  });

  it("counts already-present operations only from verified terminal batches", () => {
    const state = input();
    state.operations = [
      ...state.operations,
      {
        operationKey: "contact:existing",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
      },
      {
        operationKey: "contact:not-terminal",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
      },
    ];
    state.batches = [
      {
        requestKey: "apply-safe:0",
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["contact:existing"],
        state: "complete",
      },
      {
        requestKey: "apply-safe:1",
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["contact:not-terminal"],
        state: "applying",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      alreadyPresentOperationCount: 1,
      manifestDigest: CURRENT_DIGEST,
      nextApplyCursor: 1,
    });
  });

  it("fails closed when an active durable batch digest disagrees with the run manifest", () => {
    const state = input();
    state.operations = [
      ...state.operations,
      {
        operationKey: "contact:stale",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
      },
    ];
    state.batches = [
      {
        requestKey: "apply-safe:0",
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization:one"],
        state: "complete",
      },
      {
        requestKey: "apply-safe:1",
        manifestDigest: STALE_DIGEST,
        operationIds: ["contact:stale"],
        state: "applying",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      alreadyPresentOperationCount: 0,
      manifestDigest: null,
      nextApplyCursor: 0,
      canApplySafe: false,
    });
  });

  it("keeps a rebuilt manifest usable while retaining terminal prior-digest history", () => {
    const state = input();
    state.batches = [
      {
        requestKey: "old-approval:0",
        manifestDigest: STALE_DIGEST,
        operationIds: ["organization:old"],
        state: "complete_with_issues",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      manifestDigest: CURRENT_DIGEST,
      nextApplyCursor: 0,
      canApplySafe: true,
    });
  });

  it("advances only across terminal batches for the verified current digest", () => {
    const state = input();
    state.batches = [
      {
        requestKey: "safe-approval",
        approvalRequestKey: "safe-approval",
        startCursor: 0,
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization:one", "contact:two", "booking:three"],
        state: "queued",
      },
      {
        requestKey: "apply-safe:0",
        approvalRequestKey: "safe-approval",
        startCursor: 0,
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization:one", "contact:two"],
        state: "complete",
      },
      {
        requestKey: "apply-safe:2",
        approvalRequestKey: "safe-approval",
        startCursor: 2,
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["booking:three"],
        state: "complete",
      },
      {
        requestKey: "apply-safe:3",
        approvalRequestKey: "safe-approval",
        startCursor: 3,
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["activity:in-flight"],
        state: "applying",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      manifestDigest: CURRENT_DIGEST,
      nextApplyCursor: 3,
      canApplySafe: true,
    });
  });

  it("does not advance the durable cursor for a failed, blocked, or applying batch", () => {
    const state = input();
    state.batches = [
      {
        requestKey: "approval:0",
        approvalRequestKey: "approval",
        startCursor: 0,
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization:one"],
        state: "complete_with_issues",
      },
      {
        requestKey: "approval:0:retry:1",
        approvalRequestKey: "approval",
        startCursor: 0,
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization:one"],
        state: "applying",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      nextApplyCursor: 0,
      canApplySafe: true,
    });
  });

  it("does not infer a current digest from batch history when run state has none", () => {
    const state = input();
    state.summary = {};
    state.batches = [
      {
        requestKey: "apply-safe:0",
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization:one"],
        state: "complete",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      manifestDigest: null,
      nextApplyCursor: 0,
      canApplySafe: false,
    });
  });

  it("projects only safe fail-closed gate evidence from durable rows", () => {
    const state = input();
    state.phase = "complete";
    state.now = new Date("2026-08-07T12:00:00.000Z");
    state.leases = [
      { state: "leased", leaseExpiresAt: new Date("2026-08-07T11:59:00.000Z") },
    ];
    state.outcomes = [
      { sourceRecordId: "source-one", state: "awaiting_review" },
    ];
    state.operations = [
      {
        operationKey: "organization_contact:one:parent",
        sourceRecordId: "source-one",
        sourceVersionId: "version-one",
        targetType: "organization_contact",
        action: "create_relationship",
        dependencyOperationKeys: [],
        requiredForSourceOutcome: true,
        safeByDefault: true,
        status: "pending",
      },
    ];
    state.batches = [
      {
        requestKey: "apply-safe:0",
        manifestDigest: CURRENT_DIGEST,
        operationIds: ["organization_contact:one:parent"],
        state: "complete",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      canOrganize: false,
      canReview: true,
      requiredStreams: [
        "company",
        "contact",
        "opportunity",
        "group",
        "activity",
        "note",
        "history",
      ],
      leaseSummary: { active: 0, expired: 1 },
      operations: [
        {
          operationKey: "organization_contact:one:parent",
          sourceVersionId: "version-one",
          targetType: "organization_contact",
          status: "pending",
          requiredForSourceOutcome: true,
          heldForReview: true,
        },
      ],
      applyBatches: [{ state: "complete" }],
    });
  });

  it("projects required checkpoint inventory and deterministic batch order", () => {
    const state = input();
    state.requiredStreams = [
      "contact",
      "company",
      "company_contact",
      "contact",
    ];
    state.batches = [
      {
        requestKey: "later",
        startCursor: 25,
        manifestDigest: CURRENT_DIGEST,
        operationIds: [],
        state: "complete",
        createdAt: new Date("2026-08-07T12:01:00Z"),
        id: "b",
      },
      {
        requestKey: "first",
        startCursor: 0,
        manifestDigest: CURRENT_DIGEST,
        operationIds: [],
        state: "complete_with_issues",
        createdAt: new Date("2026-08-07T12:00:00Z"),
        id: "a",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      requiredStreams: ["company", "company_contact", "contact"],
      applyBatches: [{ state: "complete_with_issues" }, { state: "complete" }],
    });
  });

  it("makes a failed safe operation durably retryable after reload", () => {
    const state = input();
    state.phase = "complete_with_issues";
    state.operations[0]!.status = "failed";

    expect(projectImportWorkflow(state)).toMatchObject({
      safeOperationCount: 1,
      failedOperationCount: 1,
      canApplySafe: true,
    });
  });
});
