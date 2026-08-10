import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  ActApprovalService,
  InMemoryApprovalRepository,
} from "./approval-service";
import { ActApplyCoordinator } from "./apply-coordinator";
import { InMemoryApplyRepository } from "./apply-repository";
import { ActApplyService } from "./apply-service";
import {
  createProductionReview,
  boundedOutcomeMatchProjection,
  boundedReviewedPayloadProjection,
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
        targetType: "organization",
        selectedTargetId: "local-one",
      },
    ],
    batches: [],
  };
}

const projectedOverwritePayload = (
  entityId = "organization-a",
  overrides: Record<string, unknown> = {},
) => ({
  entityId,
  fieldName: "phone",
  value: "555-ACT",
  proof: {
    entityType: "organization",
    entityId,
    fieldName: "phone",
    sourceVersionId: "v-reviewed-source",
    expectedLocalValueFingerprint: fingerprintSourceContent({ value: "555-LOCAL" }),
    decisionId: "decision-reviewed",
    decision: "use_source",
    localValue: "555-LOCAL",
    sourceValue: "555-ACT",
  },
  decision: {
    id: "decision-reviewed",
    sourceVersionId: "v-reviewed-source",
    scope: "field_conflict",
    decision: "use_source",
    fieldName: "phone",
    targetEntityType: "organization",
    targetEntityId: entityId,
  },
  ...overrides,
});

describe("durable production workflow projection", () => {
  it("projects bounded sanitized context proof instead of materializing raw match JSON", () => {
    const rendered = new PgDialect().sqlToQuery(
      boundedOutcomeMatchProjection as never,
    );

    expect(rendered.sql).toContain("jsonb_array_elements");
    expect(rendered.sql).toContain("with ordinality");
    expect(rendered.sql).toContain("jsonb_build_object");
    expect(rendered.sql).toContain("left(");
    expect(rendered.sql).toContain("char_length");
    expect(rendered.params).toContain(20);
    expect(rendered.params).toContain(200);
    expect(rendered.sql).not.toContain("jsonb_path_query_array");
    expect(rendered.sql).not.toContain("jsonb_agg(proof.value)");
  });

  it("projects only bounded reviewed proof fields for canonical validation", () => {
    const rendered = new PgDialect().sqlToQuery(
      boundedReviewedPayloadProjection as never,
    );

    expect(rendered.sql).toContain("overwrite_reviewed");
    expect(rendered.sql).toContain("create_relationship");
    expect(rendered.sql).toContain("jsonb_build_object");
    expect(rendered.sql).toContain("pg_column_size");
    expect(rendered.sql).toContain("left(");
    expect(rendered.params).toContain(16_384);
    expect(rendered.params).toContain(200);
    expect(rendered.sql).toContain("'sourceValue'");
    expect(rendered.sql).toContain("->'value'");
    expect(rendered.sql).not.toContain("jsonb_agg");
    expect(rendered.sql).not.toContain("then \"act_replacement_apply_operations\".\"payload\"");
  });

  it("approves and applies only the dependency-closed safe subset of a mixed awaiting-review outcome", async () => {
    const runId = "mixed-awaiting-review-run";
    const manifest: ActOrganizeManifest = {
      digest: CURRENT_DIGEST,
      diagnostics: [],
      outcomes: [{
        sourceRecordId: "source-one",
        sourceVersionId: "version-one",
        state: "awaiting_review",
        issues: [{ code: "field_conflict", reason: "phone" }],
        candidates: [],
        match: {
          kind: "exact",
          localId: "local-one",
          reason: "context_clue_authoritative",
          evidence: [{
            family: "identity",
            label: "exact Act link",
            targetEntityType: "organization",
            targetEntityId: "local-one",
            authority: "authoritative",
          }],
        },
        mappingWarnings: [],
        unsupportedFieldPaths: [],
        operationKeys: ["safe-link", "unsafe-overwrite"],
      }],
      operations: [
        {
          operationKey: "safe-link",
          sourceRecordId: "source-one",
          sourceVersionId: "version-one",
          targetType: "organization",
          action: "link_existing",
          payload: { localId: "local-one" },
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
        {
          operationKey: "unsafe-overwrite",
          sourceRecordId: "source-one",
          sourceVersionId: "version-one",
          targetType: "organization",
          action: "overwrite_reviewed",
          payload: { entityId: "local-one", fieldName: "phone", value: "Act" },
          dependencyOperationKeys: ["safe-link"],
          requiredForSourceOutcome: true,
          safeByDefault: false,
        },
      ],
    };
    const projection = projectImportWorkflow({
      phase: "ready_to_apply",
      summary: { manifestDigest: manifest.digest },
      outcomes: manifest.outcomes,
      operations: manifest.operations.map((operation) => ({
        ...operation,
        status: "pending" as const,
      })),
      batches: [],
    });
    expect(projection.safeOperationCount).toBe(1);

    const approvalRepository = new InMemoryApprovalRepository();
    approvalRepository.seed(runId, manifest);
    const approval = await new ActApprovalService(
      approvalRepository,
    ).approveReady({
      runId,
      expectedManifestDigest: manifest.digest,
      requestKey: "page-ready-import",
      requestedBy: "owner",
    });
    expect(approval.approvedOperationIds).toEqual(["safe-link"]);
    expect(approval.rejectedOperationIds).toEqual(["unsafe-overwrite"]);

    const applyRepository = new InMemoryApplyRepository({ unsafeForTests: true });
    applyRepository.seedManifest(runId, manifest.digest);
    applyRepository.seedOperations(manifest.operations);
    applyRepository.seedApproval(
      runId,
      "page-ready-import",
      approval.approvedOperationIds,
      manifest.digest,
    );
    for (const operation of applyRepository.operations.values()) {
      operation.outcomeState = "awaiting_review";
    }
    applyRepository.targets.set("organization:local-one", {
      id: "local-one",
      entityType: "organization",
      values: { name: "Local record", phone: "Local" },
      sourceIds: new Set(),
    });

    const applied = await new ActApplyService(applyRepository, true).apply({
      runId,
      approvedOperationIds: approval.approvedOperationIds,
      expectedManifestDigest: manifest.digest,
      requestKey: "apply-safe-defaults",
      approvalRequestKey: "page-ready-import",
      requestedBy: "owner",
    });

    expect(applied).toMatchObject({
      state: "complete",
      operationCount: 1,
      alreadyPresentCount: 1,
    });
    expect(applyRepository.operations.get("safe-link")?.status).toBe(
      "already_present",
    );
    expect(applyRepository.operations.get("unsafe-overwrite")?.status).toBe(
      "pending",
    );
  });

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
    ];
    const expectedSafeApprovedOperationIds = [
      "organization:ambiguous-kept-separate",
      "organization:create-with-unsupported",
      "organization:exact-empty:identity:local-fill",
      fillPhoneKey,
      "organization:keep-local:identity:local-keep",
      "organization:use-act:identity:local-use",
    ];
    expect(safe).toEqual({
      selectedOperationIds: expectedSafeSelectedOperationIds,
      approvedOperationIds: expectedSafeApprovedOperationIds,
      dependencyOperationIds: ["organization:exact-empty:identity:local-fill"],
      rejectedOperationIds: [
        "organization:use-act:field:phone:decision:decision-use-act",
        provenanceAmbiguousKey,
        provenanceCreateKey,
        provenanceFillKey,
        provenanceKeepKey,
        provenanceUseKey,
      ],
      selectedCount: 6,
      dependencyCount: 1,
      rejectedCount: 6,
      manifestDigest: manifest.digest,
    });

    approvals.seed(runId, {
      ...manifest,
      operationStatuses: {
        "organization:use-act:identity:local-use": "already_present",
      },
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
      operationCount: 6,
      completedCount: 2,
      alreadyPresentCount: 3,
      blockedCount: 1,
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
    await expect(applyService.apply({
      runId,
      approvedOperationIds: explicit.approvedOperationIds,
      expectedManifestDigest: manifest.digest,
      requestKey: "apply-reviewed-overwrite",
      requestedBy: "owner",
    })).rejects.toMatchObject({ code: "local_edit_detected" });
    expect(applyRepository.batches.has(`${runId}:apply-reviewed-overwrite`)).toBe(false);
    expect(overwriteTarget.values.phone).toBe("concurrent-reviewed-edit");
    expect(
      applyRepository.operations.get("organization:use-act:field:phone:decision:decision-use-act"),
    ).toMatchObject({
      status: "pending",
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

  it("projects a pending safe link from an awaiting-review source", () => {
    const state = input();
    state.outcomes = [
      {
        sourceRecordId: "source-one",
        state: "awaiting_review",
        match: {
          kind: "exact",
          localId: "local-one",
          evidence: [{
            family: "identity",
            label: "exact Act link",
            targetEntityType: "organization",
            targetEntityId: "local-one",
            authority: "authoritative",
          }],
        },
      },
    ];
    state.operations = [
      {
        operationKey: "organization:source-one:identity:local-one",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        selectedTargetId: "local-one",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      safeOperationCount: 1,
      reviewRequiredCount: 0,
      archivedOnlyCount: 0,
    });
  });

  it("includes a safe dependency closure only when every dependency is automatically importable", () => {
    const state = input();
    state.outcomes = [{
      sourceRecordId: "source-one",
      state: "ready",
      match: { kind: "exact", localId: "local-one", reason: "exact_external_link" },
    }];
    state.operations = [
      {
        operationKey: "organization:source-one:identity:local-one",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: ["organization:source-one:create"],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        selectedTargetId: "local-one",
      },
      {
        operationKey: "organization:source-one:create",
        sourceRecordId: "source-one",
        action: "create",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
      },
    ];

    expect(projectImportWorkflow(state).safeOperationCount).toBe(2);

    state.operations = state.operations.map((operation, index) =>
      index === 1
        ? {
            ...operation,
            action: "create_relationship",
            targetType: "organization_contact",
          }
        : operation,
    );

    expect(projectImportWorkflow(state)).toMatchObject({
      safeOperationCount: 0,
      archivedOnlyCount: 1,
      operations: expect.arrayContaining([
        expect.objectContaining({
          operationKey: "organization:source-one:identity:local-one",
          heldForReview: true,
        }),
        expect.objectContaining({
          operationKey: "organization:source-one:create",
          heldForReview: true,
        }),
      ]),
    });
  });

  it("does not use a dependency-blocked link as context proof when another root is safe", () => {
    const state = input();
    state.outcomes = [
      {
        sourceRecordId: "source-one",
        state: "awaiting_review",
        match: {
          kind: "exact",
          localId: "local-one",
          evidence: [
            {
              family: "identity",
              targetEntityId: "local-one",
              targetEntityType: "organization",
              authority: "authoritative",
            },
          ],
        },
      },
    ];
    state.operations = [
      {
        operationKey: "organization:source-one:create",
        sourceRecordId: "source-one",
        action: "create",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
      },
      {
        operationKey: "organization:source-one:identity:local-one",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: [
          "organization_contact:source-one:relationship",
        ],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
      },
      {
        operationKey: "organization_contact:source-one:relationship",
        sourceRecordId: "source-one",
        action: "create_relationship",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization_contact",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      safeOperationCount: 1,
      autoResolvedCount: 0,
      archivedOnlyCount: 0,
    });
  });

  it("excludes overwrite-reviewed operations from the safe projection", () => {
    const state = input();
    state.operations = state.operations.map((operation) => ({
      ...operation,
      action: "overwrite_reviewed",
      targetType: "organization",
    }));

    expect(projectImportWorkflow(state).safeOperationCount).toBe(0);
  });

  it.each([
    { state: "awaiting_review", match: { kind: "ambiguous" } },
    { state: "unassigned", match: null },
    { state: "unsupported", match: null },
  ])("projects a $state source without a safe operation as archived-only", (outcome) => {
    const state = input();
    state.outcomes = [{ sourceRecordId: "source-one", ...outcome }];
    state.operations = [
      {
        operationKey: "organization_contact:source-one:parent",
        sourceRecordId: "source-one",
        action: "create_relationship",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization_contact",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      archivedOnlyCount: 1,
      reviewRequiredCount: 0,
      canReview: true,
    });
  });

  it("keeps optional diagnostics reachable when no decision is mandatory", () => {
    const state = input();
    state.outcomes = [{
      sourceRecordId: "source-one",
      state: "ready",
      hasOptionalReview: true,
    }];

    expect(projectImportWorkflow(state)).toMatchObject({
      reviewRequiredCount: 0,
      archivedOnlyCount: 0,
      canReview: true,
    });
  });

  it("keeps proven context counts stable after the safe operation is applied", () => {
    const state = input();
    state.phase = "complete";
    state.outcomes = [{
      sourceRecordId: "source-one",
      state: "applied",
      match: {
        kind: "exact",
        localId: "local-one",
        evidence: [{
          family: "identity",
          label: "exact Act link",
          targetEntityType: "organization",
          targetEntityId: "local-one",
          authority: "authoritative",
        }],
      },
    }];
    state.operations = [{
      operationKey: "organization:source-one:identity:local-one",
      sourceRecordId: "source-one",
      action: "link_existing",
      dependencyOperationKeys: [],
      safeByDefault: true,
      status: "already_present",
      targetType: "organization",
      selectedTargetId: "local-one",
    }];

    expect(projectImportWorkflow(state)).toMatchObject({
      safeOperationCount: 0,
      autoResolvedCount: 1,
      archivedOnlyCount: 0,
    });
  });

  it("archives a contradictory context link instead of offering it for automatic import", () => {
    const state = input();
    state.outcomes = [{
      sourceRecordId: "source-one",
      state: "awaiting_review",
      match: {
        kind: "exact",
        localId: "local-one",
        evidence: [
          {
            family: "identity",
            label: "exact Act link",
            targetEntityType: "organization",
            targetEntityId: "local-one",
            authority: "authoritative",
          },
          {
            family: "location",
            label: "different location",
            targetEntityType: "organization",
            targetEntityId: "local-two",
            authority: "supporting",
          },
        ],
      },
    }];
    state.operations = [{
      operationKey: "organization:source-one:identity:local-one",
      sourceRecordId: "source-one",
      action: "link_existing",
      dependencyOperationKeys: [],
      safeByDefault: true,
      status: "pending",
      targetType: "organization",
      selectedTargetId: "local-one",
    }];

    expect(projectImportWorkflow(state)).toMatchObject({
      safeOperationCount: 0,
      autoResolvedCount: 0,
      archivedOnlyCount: 1,
      canReview: true,
    });
  });

  it("counts a proven context match once when it emits multiple safe operations", () => {
    const state = input();
    state.outcomes = [
      {
        sourceRecordId: "source-one",
        state: "awaiting_review",
        match: {
          kind: "exact",
          localId: "local-one",
          evidence: [
            {
              family: "identity",
              targetEntityId: "local-one",
              targetEntityType: "organization",
              authority: "authoritative",
            },
          ],
        },
      },
    ];
    state.operations = [
      {
        operationKey: "organization:source-one:identity:local-one",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        selectedTargetId: "local-one",
      },
      {
        operationKey: "organization:source-one:phone",
        sourceRecordId: "source-one",
        action: "fill_missing",
        dependencyOperationKeys: [
          "organization:source-one:identity:local-one",
        ],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        selectedTargetId: "local-one",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      autoResolvedCount: 1,
      safeOperationCount: 2,
    });
  });

  it("projects a safe exact link while excluding its conflicting reviewed overwrite", () => {
    const state = input();
    state.outcomes = [
      {
        sourceRecordId: "source-one",
        state: "awaiting_review",
        match: {
          kind: "exact",
          localId: "local-one",
          evidence: [
            {
              family: "identity",
              targetEntityId: "local-one",
              targetEntityType: "organization",
              authority: "authoritative",
            },
          ],
        },
      },
    ];
    state.operations = [
      {
        operationKey: "organization:source-one:identity:local-one",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        selectedTargetId: "local-one",
      },
      {
        operationKey: "organization:source-one:field:phone",
        sourceRecordId: "source-one",
        action: "overwrite_reviewed",
        dependencyOperationKeys: [
          "organization:source-one:identity:local-one",
        ],
        safeByDefault: false,
        status: "pending",
        targetType: "organization",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      autoResolvedCount: 1,
      safeOperationCount: 1,
      archivedOnlyCount: 0,
    });
  });

  it("allows safe application when archived-only sources coexist", () => {
    const state = input();
    state.outcomes = [
      { sourceRecordId: "source-one", state: "ready", match: null },
      {
        sourceRecordId: "source-two",
        state: "awaiting_review",
        match: { kind: "ambiguous" },
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      safeOperationCount: 1,
      archivedOnlyCount: 1,
      canApplySafe: true,
    });
  });

  it("imports only dependency-closed context-safe operations while retaining mixed uncertain records in the archive", () => {
    // Protects against source-state gating, double-counting proven records,
    // or treating unsafe relationship dependencies as safe imports.
    const state = input();
    state.outcomes = [
      {
        sourceRecordId: "authoritative-link",
        state: "awaiting_review",
        match: {
          kind: "exact",
          localId: "organization-authoritative",
          evidence: [{
            family: "identity",
            targetEntityType: "organization",
            targetEntityId: "organization-authoritative",
            authority: "authoritative",
          }],
        },
      },
      {
        sourceRecordId: "two-clue-link",
        state: "awaiting_review",
        match: {
          kind: "exact",
          localId: "organization-two-clue",
          evidence: [
            {
              family: "identity",
              targetEntityType: "organization",
              targetEntityId: "organization-two-clue",
              authority: "supporting",
            },
            {
              family: "web_identity",
              targetEntityType: "organization",
              targetEntityId: "organization-two-clue",
              authority: "supporting",
            },
          ],
        },
      },
      {
        sourceRecordId: "safe-fill-with-conflict",
        state: "awaiting_review",
        match: { kind: "exact", localId: "organization-conflict", reason: "exact_external_link" },
      },
      {
        sourceRecordId: "ambiguous",
        state: "awaiting_review",
        match: { kind: "ambiguous", candidateIds: ["one", "two"] },
      },
      { sourceRecordId: "unsupported", state: "unsupported", match: null },
      {
        sourceRecordId: "unsafe-relationship-dependency",
        state: "awaiting_review",
        match: {
          kind: "exact",
          localId: "organization-blocked",
          evidence: [{
            family: "identity",
            targetEntityType: "organization",
            targetEntityId: "organization-blocked",
            authority: "authoritative",
          }],
        },
      },
    ];
    state.operations = [
      {
        operationKey: "organization:authoritative-link:identity",
        sourceRecordId: "authoritative-link",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        selectedTargetId: "organization-authoritative",
      },
      {
        operationKey: "organization:two-clue-link:identity",
        sourceRecordId: "two-clue-link",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        selectedTargetId: "organization-two-clue",
      },
      {
        operationKey: "organization:safe-fill-with-conflict:identity",
        sourceRecordId: "safe-fill-with-conflict",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        selectedTargetId: "organization-conflict",
      },
      {
        operationKey: "organization:safe-fill-with-conflict:field:website",
        sourceRecordId: "safe-fill-with-conflict",
        action: "fill_missing",
        dependencyOperationKeys: ["organization:safe-fill-with-conflict:identity"],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
      },
      {
        operationKey: "organization:safe-fill-with-conflict:field:phone",
        sourceRecordId: "safe-fill-with-conflict",
        action: "overwrite_reviewed",
        dependencyOperationKeys: ["organization:safe-fill-with-conflict:identity"],
        safeByDefault: false,
        status: "pending",
        targetType: "organization",
      },
      {
        operationKey: "organization:unsafe-relationship-dependency:identity",
        sourceRecordId: "unsafe-relationship-dependency",
        action: "link_existing",
        dependencyOperationKeys: ["organization_contact:unsafe-relationship-dependency:relationship"],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        selectedTargetId: "organization-blocked",
      },
      {
        operationKey: "organization_contact:unsafe-relationship-dependency:relationship",
        sourceRecordId: "unsafe-relationship-dependency",
        action: "create_relationship",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization_contact",
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      safeOperationCount: 4,
      autoResolvedCount: 2,
      archivedOnlyCount: 3,
      reviewRequiredCount: 0,
      canApplySafe: true,
      operations: expect.arrayContaining([
        expect.objectContaining({
          operationKey: "organization:safe-fill-with-conflict:field:phone",
          heldForReview: false,
        }),
        expect.objectContaining({
          operationKey: "organization:unsafe-relationship-dependency:identity",
          heldForReview: true,
        }),
      ]),
    });
  });

  it("keeps failed outcomes visible without labeling them archived-only", () => {
    const state = input();
    state.outcomes = [
      { sourceRecordId: "source-one", state: "failed", match: null },
    ];
    state.operations = state.operations.map((operation) => ({
      ...operation,
      status: "failed",
      targetType: "organization",
    }));

    expect(projectImportWorkflow(state)).toMatchObject({
      archivedOnlyCount: 0,
      reviewRequiredCount: 0,
      failedOperationCount: 1,
      operations: [expect.objectContaining({ heldForReview: false })],
    });
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
      reviewRequiredCount: 0,
      archivedOnlyCount: 1,
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
        targetType: "contact",
      },
      {
        operationKey: "contact:not-terminal",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
        targetType: "contact",
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
        targetType: "contact",
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

  it("enables reviewed recovery when its identity link is already terminal", () => {
    const state = input();
    state.outcomes = [{
      sourceRecordId: "reviewed-source",
      state: "ready",
      hasOptionalReview: true,
      match: { kind: "exact", localId: "organization-a" },
    }];
    state.operations = [
      {
        operationKey: "organization:reviewed-source",
        sourceRecordId: "reviewed-source",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
        targetType: "organization",
        selectedTargetId: "organization-a",
      },
      {
        operationKey: "organization:reviewed-source:field:phone",
        sourceRecordId: "reviewed-source",
        action: "overwrite_reviewed",
        dependencyOperationKeys: ["organization:reviewed-source"],
        safeByDefault: false,
        status: "pending",
        sourceVersionId: "v-reviewed-source",
        targetType: "organization",
        reviewedPayload: projectedOverwritePayload(),
      },
    ];
    state.batches = [{
      requestKey: "prior-safe:0",
      manifestDigest: CURRENT_DIGEST,
      operationIds: ["organization:reviewed-source"],
      state: "complete",
    }];

    expect(projectImportWorkflow(state)).toMatchObject({
      safeOperationCount: 0,
      reviewedReadyOperationCount: 1,
      canApplySafe: false,
      canApplyReviewed: true,
    });
  });

  it("does not project reviewed readiness when the reviewed root targets another entity", () => {
    const state = input();
    state.outcomes = [{
      sourceRecordId: "reviewed-source",
      state: "ready",
      match: { kind: "exact", localId: "organization-a" },
    }];
    state.operations = [
      {
        operationKey: "organization:reviewed-source",
        sourceRecordId: "reviewed-source",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
        targetType: "organization",
        selectedTargetId: "organization-a",
      },
      {
        operationKey: "organization:reviewed-source:field:phone",
        sourceRecordId: "reviewed-source",
        action: "overwrite_reviewed",
        dependencyOperationKeys: ["organization:reviewed-source"],
        safeByDefault: false,
        status: "pending",
        sourceVersionId: "v-reviewed-source",
        targetType: "organization",
        reviewedPayload: projectedOverwritePayload("organization-b"),
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      reviewedReadyOperationCount: 0,
      canApplyReviewed: false,
    });
  });

  it("does not project reviewed readiness when the reviewed root has another entity type", () => {
    const state = input();
    state.outcomes = [{ sourceRecordId: "reviewed-source", state: "ready", match: { kind: "exact", localId: "organization-a" } }];
    state.operations = [
      {
        operationKey: "organization:reviewed-source",
        sourceRecordId: "reviewed-source",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
        targetType: "organization",
        selectedTargetId: "organization-a",
      },
      {
        operationKey: "contact:reviewed-source:field:phone",
        sourceRecordId: "reviewed-source",
        sourceVersionId: "v-reviewed-source",
        action: "overwrite_reviewed",
        dependencyOperationKeys: ["organization:reviewed-source"],
        safeByDefault: false,
        status: "pending",
        targetType: "contact",
        reviewedPayload: {
          ...projectedOverwritePayload(),
          proof: { ...(projectedOverwritePayload().proof as Record<string, unknown>), entityType: "contact" },
          decision: { ...(projectedOverwritePayload().decision as Record<string, unknown>), targetEntityType: "contact" },
        },
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({ reviewedReadyOperationCount: 0, canApplyReviewed: false });
  });

  it("fails projection closed when a relationship decision carries a field name", () => {
    const state = input();
    state.outcomes = [{ sourceRecordId: "reviewed-source", state: "ready", match: { kind: "exact", localId: "organization-a" } }];
    state.operations = [
      { operationKey: "organization:reviewed-source", sourceRecordId: "reviewed-source", action: "link_existing", dependencyOperationKeys: [], safeByDefault: true, status: "already_present", targetType: "organization", selectedTargetId: "organization-a" },
      {
        operationKey: "organization-contact:reviewed-source",
        sourceRecordId: "reviewed-source",
        sourceVersionId: "v-reviewed-source",
        action: "create_relationship",
        dependencyOperationKeys: ["organization:reviewed-source"],
        safeByDefault: true,
        status: "pending",
        targetType: "organization_contact",
        reviewedPayload: {
          parentEntityId: "organization-parent",
          parentType: "organization",
          relationshipSlot: "organization",
          decision: { id: "decision-parent", sourceVersionId: "v-reviewed-source", scope: "relationship", decision: "assign_parent", relationshipSlot: "organization", targetEntityType: "organization", targetEntityId: "organization-parent", fieldName: "phone" },
        },
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({ reviewedReadyOperationCount: 0, canApplyReviewed: false });
  });

  it.each([
    ["proof entity metadata", (payload: Record<string, unknown>) => ({ ...payload, proof: { ...(payload.proof as Record<string, unknown>), entityId: "other" } })],
    ["proof field metadata", (payload: Record<string, unknown>) => ({ ...payload, proof: { ...(payload.proof as Record<string, unknown>), fieldName: "email" } })],
    ["proof source version", (payload: Record<string, unknown>) => ({ ...payload, proof: { ...(payload.proof as Record<string, unknown>), sourceVersionId: "stale" } })],
    ["expected local fingerprint", (payload: Record<string, unknown>) => ({ ...payload, proof: { ...(payload.proof as Record<string, unknown>), expectedLocalValueFingerprint: "bad" } })],
    ["decision id binding", (payload: Record<string, unknown>) => ({ ...payload, decision: { ...(payload.decision as Record<string, unknown>), id: "other" } })],
    ["decision type binding", (payload: Record<string, unknown>) => ({ ...payload, decision: { ...(payload.decision as Record<string, unknown>), decision: "keep_local" } })],
    ["optional reviewed source value", (payload: Record<string, unknown>) => ({ ...payload, decision: { ...(payload.decision as Record<string, unknown>), reviewedSourceValue: "other" } })],
    ["optional reviewed local value", (payload: Record<string, unknown>) => ({ ...payload, decision: { ...(payload.decision as Record<string, unknown>), reviewedLocalValue: "other" } })],
    ["optional source fingerprint", (payload: Record<string, unknown>) => ({ ...payload, proof: { ...(payload.proof as Record<string, unknown>), sourceValueFingerprint: "bad" } })],
    ["optional local fingerprint", (payload: Record<string, unknown>) => ({ ...payload, proof: { ...(payload.proof as Record<string, unknown>), localValueFingerprint: "bad" } })],
    ["optional reviewed source fingerprint", (payload: Record<string, unknown>) => ({ ...payload, decision: { ...(payload.decision as Record<string, unknown>), reviewedSourceValueFingerprint: "bad" } })],
    ["optional reviewed local fingerprint", (payload: Record<string, unknown>) => ({ ...payload, decision: { ...(payload.decision as Record<string, unknown>), reviewedLocalValueFingerprint: "bad" } })],
  ])("fails projection closed for malformed %s", (_label, mutate) => {
    const state = input();
    state.outcomes = [{ sourceRecordId: "reviewed-source", state: "ready", match: { kind: "exact", localId: "organization-a" } }];
    state.operations = [
      { operationKey: "organization:reviewed-source", sourceRecordId: "reviewed-source", action: "link_existing", dependencyOperationKeys: [], safeByDefault: true, status: "already_present", targetType: "organization", selectedTargetId: "organization-a" },
      { operationKey: "organization:reviewed-source:field:phone", sourceRecordId: "reviewed-source", sourceVersionId: "v-reviewed-source", action: "overwrite_reviewed", dependencyOperationKeys: ["organization:reviewed-source"], safeByDefault: false, status: "pending", targetType: "organization", reviewedPayload: mutate(projectedOverwritePayload()) },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({ reviewedReadyOperationCount: 0, canApplyReviewed: false });
  });

  it.each([
    ["assignment decision", { decision: "keep_local" }],
    ["assignment target", { targetEntityId: "organization-other" }],
    ["assignment type", { targetEntityType: "contact" }],
    ["assignment slot", { relationshipSlot: "contact" }],
    ["field exclusion", { fieldName: "phone" }],
  ])("fails projection closed for malformed relationship %s", (_label, decisionOverride) => {
    const state = input();
    state.outcomes = [{ sourceRecordId: "reviewed-source", state: "ready", match: { kind: "exact", localId: "organization-a" } }];
    state.operations = [
      { operationKey: "organization:reviewed-source", sourceRecordId: "reviewed-source", action: "link_existing", dependencyOperationKeys: [], safeByDefault: true, status: "already_present", targetType: "organization", selectedTargetId: "organization-a" },
      {
        operationKey: "organization-contact:reviewed-source",
        sourceRecordId: "reviewed-source",
        sourceVersionId: "v-reviewed-source",
        action: "create_relationship",
        dependencyOperationKeys: ["organization:reviewed-source"],
        safeByDefault: true,
        status: "pending",
        targetType: "organization_contact",
        reviewedPayload: {
          parentEntityId: "organization-parent",
          parentType: "organization",
          relationshipSlot: "organization",
          decision: {
            id: "decision-parent",
            sourceVersionId: "v-reviewed-source",
            scope: "relationship",
            decision: "assign_parent",
            relationshipSlot: "organization",
            targetEntityType: "organization",
            targetEntityId: "organization-parent",
            ...decisionOverride,
          },
        },
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({ reviewedReadyOperationCount: 0, canApplyReviewed: false });
  });

  it("does not enable reviewed recovery without its identity dependency", () => {
    const state = input();
    state.outcomes = [{ sourceRecordId: "reviewed-source", state: "ready" }];
    state.operations = [{
      operationKey: "organization:reviewed-source:field:phone",
      sourceRecordId: "reviewed-source",
      action: "overwrite_reviewed",
      dependencyOperationKeys: ["organization:reviewed-source"],
      safeByDefault: false,
      status: "pending",
      sourceVersionId: "v-reviewed-source",
      targetType: "organization",
      reviewedPayload: projectedOverwritePayload(),
    }];

    expect(projectImportWorkflow(state)).toMatchObject({
      reviewedReadyOperationCount: 0,
      canApplyReviewed: false,
    });
  });

  it("does not enable reviewed recovery while its identity dependency is nonterminal", () => {
    const state = input();
    state.outcomes = [{ sourceRecordId: "reviewed-source", state: "ready" }];
    state.operations = [
      {
        operationKey: "organization:reviewed-source",
        sourceRecordId: "reviewed-source",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
      },
      {
        operationKey: "organization:reviewed-source:field:phone",
        sourceRecordId: "reviewed-source",
        action: "overwrite_reviewed",
        dependencyOperationKeys: ["organization:reviewed-source"],
        safeByDefault: false,
        status: "pending",
        sourceVersionId: "v-reviewed-source",
        targetType: "organization",
        reviewedPayload: projectedOverwritePayload(),
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      reviewedReadyOperationCount: 0,
      canApplyReviewed: false,
    });
  });

  it("does not enable reviewed recovery when source-value proof fails the database projection", () => {
    const state = input();
    state.outcomes = [{ sourceRecordId: "reviewed-source", state: "ready" }];
    state.operations = [
      {
        operationKey: "organization:reviewed-source",
        sourceRecordId: "reviewed-source",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
        targetType: "organization",
      },
      {
        operationKey: "organization:reviewed-source:field:phone",
        sourceRecordId: "reviewed-source",
        action: "overwrite_reviewed",
        dependencyOperationKeys: ["organization:reviewed-source"],
        safeByDefault: false,
        status: "pending",
        sourceVersionId: "v-reviewed-source",
        targetType: "organization",
        reviewedPayload: projectedOverwritePayload("organization-a", {
          proof: {
            ...(projectedOverwritePayload().proof as Record<string, unknown>),
            sourceValue: "different-source",
          },
        }),
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      reviewedReadyOperationCount: 0,
      canApplyReviewed: false,
    });
  });

  it("does not enable reviewed recovery through a pending unsafe dependency", () => {
    const state = input();
    state.outcomes = [{ sourceRecordId: "reviewed-source", state: "ready", match: { kind: "exact", localId: "organization-a" } }];
    state.operations = [
      {
        operationKey: "organization:reviewed-source",
        sourceRecordId: "reviewed-source",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
        targetType: "organization",
        selectedTargetId: "organization-a",
      },
      {
        operationKey: "organization:reviewed-source:unsafe",
        sourceRecordId: "reviewed-source",
        action: "record_provenance",
        dependencyOperationKeys: ["organization:reviewed-source"],
        safeByDefault: false,
        status: "pending",
        targetType: "organization",
      },
      {
        operationKey: "organization:reviewed-source:field:phone",
        sourceRecordId: "reviewed-source",
        action: "overwrite_reviewed",
        dependencyOperationKeys: ["organization:reviewed-source:unsafe"],
        safeByDefault: false,
        status: "pending",
        sourceVersionId: "v-reviewed-source",
        targetType: "organization",
        reviewedPayload: projectedOverwritePayload(),
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      reviewedReadyOperationCount: 0,
      canApplyReviewed: false,
    });
  });

  it("does not enable reviewed recovery through a terminal link bound to another target", () => {
    const state = input();
    state.outcomes = [{ sourceRecordId: "reviewed-source", state: "ready", match: { kind: "exact", localId: "organization-a" } }];
    state.operations = [
      {
        operationKey: "organization:reviewed-source",
        sourceRecordId: "reviewed-source",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "already_present",
        targetType: "organization",
        selectedTargetId: "organization-b",
      },
      {
        operationKey: "organization:reviewed-source:field:phone",
        sourceRecordId: "reviewed-source",
        action: "overwrite_reviewed",
        dependencyOperationKeys: ["organization:reviewed-source"],
        safeByDefault: false,
        status: "pending",
        sourceVersionId: "v-reviewed-source",
        targetType: "organization",
        reviewedPayload: projectedOverwritePayload(),
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      reviewedReadyOperationCount: 0,
      canApplyReviewed: false,
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
