import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
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
  projectImportWorkflow,
  type ImportWorkflowProjectionInput,
  workflowOperationSelection,
  workflowOutcomeSelection,
} from "./production-review";
import { ProductionActOrganizer } from "./production-organizer";
import {
  InMemoryReviewCommandStore,
  ReviewCommandService,
} from "./review-command-service";
import {
  buildActOrganizeManifest,
  type ActOrganizeManifest,
  type ManifestOperation,
  type ManifestOutcome,
} from "./manifest-builder";
import {
  InMemoryReviewReader,
  readReview,
} from "./review-reader";
import {
  proposeAutomaticReview,
  type AutomaticReviewRecord,
  type AutomaticReviewReason,
} from "./automatic-review-resolver";
import { fingerprintSourceContent } from "./source-fingerprint";
import {
  manifestFromRows,
  manifestSourcesFromArchiveRows,
  type ArchivedOrganizerSourceRow,
} from "./review-sql-adapter";

const CURRENT_DIGEST = "a".repeat(64);
const STALE_DIGEST = "b".repeat(64);

function automaticProof(
  disposition: "safe_ready" | "auto_resolved" | "archived_only" = "safe_ready",
  basis:
    | "safe_create"
    | "trusted_exact_match"
    | "proven_context_match"
    | "not_automatically_safe" = "safe_create",
  eligible = basis !== "not_automatically_safe",
) {
  return { version: 1 as const, eligible, disposition, basis };
}

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
        automaticReview: {
          version: 1,
          eligible: true,
          disposition: "safe_ready",
          basis: "safe_create",
        },
      },
    ],
    batches: [],
  };
}

describe("durable production workflow projection", () => {
  it("fails closed when a safe-by-default operation lacks bounded automatic proof", () => {
    const state = input();
    state.operations = [{
      ...state.operations[0]!,
      automaticReview: undefined,
    }];

    expect(projectImportWorkflow(state)).toMatchObject({
      safeOperationCount: 0,
      archivedOnlyCount: 1,
      canApplySafe: false,
    });
  });

  it("keeps archived-only diagnostics available without creating review blockers", () => {
    const state = input();
    state.operations = [{
      ...state.operations[0]!,
      automaticReview: {
        version: 1,
        eligible: false,
        disposition: "archived_only",
        basis: "not_automatically_safe",
      },
    }];

    expect(projectImportWorkflow(state)).toMatchObject({
      reviewRequiredCount: 0,
      archivedOnlyCount: 1,
      canReview: true,
    });
  });

  it("preserves a completed automatic disposition when optional provenance remains pending", () => {
    const state = input();
    state.operations = [
      {
        ...state.operations[0]!,
        action: "link_existing",
        status: "applied",
        automaticReview: automaticProof(
          "auto_resolved",
          "proven_context_match",
        ),
      },
      {
        operationKey: "provenance:source-one",
        sourceRecordId: "source-one",
        action: "record_provenance",
        dependencyOperationKeys: ["organization:one"],
        safeByDefault: true,
        status: "pending",
        targetType: "provenance",
        automaticReview: automaticProof(
          "archived_only",
          "not_automatically_safe",
          false,
        ),
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      safeOperationCount: 0,
      autoResolvedCount: 1,
      archivedOnlyCount: 0,
      operations: expect.arrayContaining([
        expect.objectContaining({
          operationKey: "provenance:source-one",
          heldForReview: false,
        }),
      ]),
    });
  });

  it("uses a bounded outcome status projection that never selects match metadata", () => {
    expect(Object.keys(workflowOutcomeSelection).sort()).toEqual([
      "leaseExpiresAt",
      "sourceRecordId",
      "state",
    ]);
    expect(workflowOutcomeSelection).not.toHaveProperty("match");
  });

  it("guards object-only automatic proof operations behind a nested case", () => {
    const rendered = new PgDialect().sqlToQuery(
      sql`select ${workflowOperationSelection.automaticReview}`,
    ).sql;

    expect(rendered).toContain(
      "when jsonb_typeof(((\"act_replacement_apply_operations\".\"payload\")::jsonb -> 'automaticReview'::text)) = 'object' then case",
    );
    expect(rendered).toContain("?& array['version','eligible','disposition','basis']::text[]");
    expect(rendered).toContain("- 'version'::text - 'eligible'::text - 'disposition'::text - 'basis'::text");
    expect(rendered).toContain("jsonb_typeof");
    expect(rendered).toContain("->'version') = 'number'");
    expect(rendered).toContain("->'eligible') = 'boolean'");
    expect(rendered).toContain("->'disposition') = 'string'");
    expect(rendered).toContain("->'basis') = 'string'");
    expect(rendered).not.toContain("#>> '{automaticReview");
    expect(rendered).not.toContain("jsonb_build_object");
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

    const ready = await approvalService.approveReady({
      runId,
      expectedManifestDigest: manifest.digest,
      requestKey: "approve-ready",
      requestedBy: "owner",
    });
    expect(ready).toEqual(safe);

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
    applyRepository.seedApproval(
      runId,
      "safe-defaults",
      safe.approvedOperationIds,
      manifest.digest,
    );
    const safeApply = await applyService.apply({
      runId,
      approvedOperationIds: safe.approvedOperationIds,
      expectedManifestDigest: manifest.digest,
      requestKey: "apply-safe-defaults",
      approvalRequestKey: "safe-defaults",
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
    applyRepository.seedApproval(
      runId,
      "explicit-reviewed-overwrite",
      explicit.approvedOperationIds,
      manifest.digest,
      "explicit_manual",
    );
    const explicitApply = await applyService.apply({
      runId,
      approvedOperationIds: explicit.approvedOperationIds,
      expectedManifestDigest: manifest.digest,
      requestKey: "apply-reviewed-overwrite",
      approvalRequestKey: "explicit-reviewed-overwrite",
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

  it("projects a pending safe link from an awaiting-review source", () => {
    const state = input();
    state.outcomes = [
      { sourceRecordId: "source-one", state: "awaiting_review" },
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
        automaticReview: automaticProof(
          "safe_ready",
          "trusted_exact_match",
        ),
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
    state.operations = [
      {
        operationKey: "organization:source-one:identity:local-one",
        sourceRecordId: "source-one",
        action: "link_existing",
        dependencyOperationKeys: ["organization:source-one:create"],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        automaticReview: automaticProof(
          "safe_ready",
          "trusted_exact_match",
        ),
      },
      {
        operationKey: "organization:source-one:create",
        sourceRecordId: "source-one",
        action: "create",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        automaticReview: automaticProof(),
      },
    ];

    expect(projectImportWorkflow(state).safeOperationCount).toBe(2);

    state.operations = state.operations.map((operation, index) =>
      index === 1
        ? {
            ...operation,
            action: "create_relationship",
            targetType: "organization_contact",
            automaticReview: automaticProof(
              "safe_ready",
              "not_automatically_safe",
              false,
            ),
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
        automaticReview: automaticProof(),
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
        automaticReview: automaticProof(
          "safe_ready",
          "trusted_exact_match",
        ),
      },
      {
        operationKey: "organization_contact:source-one:relationship",
        sourceRecordId: "source-one",
        action: "create_relationship",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization_contact",
        automaticReview: automaticProof(
          "safe_ready",
          "not_automatically_safe",
          false,
        ),
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
        automaticReview: automaticProof(
          "archived_only",
          "not_automatically_safe",
          false,
        ),
      },
    ];

    expect(projectImportWorkflow(state)).toMatchObject({
      archivedOnlyCount: 1,
      reviewRequiredCount: 0,
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
        automaticReview: automaticProof(
          "auto_resolved",
          "proven_context_match",
        ),
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
        automaticReview: automaticProof(
          "auto_resolved",
          "proven_context_match",
        ),
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
        automaticReview: automaticProof(
          "auto_resolved",
          "proven_context_match",
        ),
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
        automaticReview: automaticProof(
          "auto_resolved",
          "not_automatically_safe",
          false,
        ),
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
        automaticReview: automaticProof(
          "auto_resolved",
          "proven_context_match",
        ),
      },
      {
        operationKey: "organization:two-clue-link:identity",
        sourceRecordId: "two-clue-link",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        automaticReview: automaticProof(
          "auto_resolved",
          "proven_context_match",
        ),
      },
      {
        operationKey: "organization:safe-fill-with-conflict:identity",
        sourceRecordId: "safe-fill-with-conflict",
        action: "link_existing",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        automaticReview: automaticProof(
          "safe_ready",
          "trusted_exact_match",
        ),
      },
      {
        operationKey: "organization:safe-fill-with-conflict:field:website",
        sourceRecordId: "safe-fill-with-conflict",
        action: "fill_missing",
        dependencyOperationKeys: ["organization:safe-fill-with-conflict:identity"],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        automaticReview: automaticProof(
          "safe_ready",
          "trusted_exact_match",
        ),
      },
      {
        operationKey: "organization:safe-fill-with-conflict:field:phone",
        sourceRecordId: "safe-fill-with-conflict",
        action: "overwrite_reviewed",
        dependencyOperationKeys: ["organization:safe-fill-with-conflict:identity"],
        safeByDefault: false,
        status: "pending",
        targetType: "organization",
        automaticReview: automaticProof(
          "safe_ready",
          "not_automatically_safe",
          false,
        ),
      },
      {
        operationKey: "organization:unsafe-relationship-dependency:identity",
        sourceRecordId: "unsafe-relationship-dependency",
        action: "link_existing",
        dependencyOperationKeys: ["organization_contact:unsafe-relationship-dependency:relationship"],
        safeByDefault: true,
        status: "pending",
        targetType: "organization",
        automaticReview: automaticProof(
          "auto_resolved",
          "proven_context_match",
        ),
      },
      {
        operationKey: "organization_contact:unsafe-relationship-dependency:relationship",
        sourceRecordId: "unsafe-relationship-dependency",
        action: "create_relationship",
        dependencyOperationKeys: [],
        safeByDefault: true,
        status: "pending",
        targetType: "organization_contact",
        automaticReview: automaticProof(
          "auto_resolved",
          "not_automatically_safe",
          false,
        ),
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

  it("approves and applies only the rebuilt safe closure from complete-with-issues", async () => {
    const runId = "automatic-complete-with-issues";
    const digest = "e".repeat(64);
    const safeOrganization: ManifestOperation = {
      operationKey: "organization:safe-boundary",
      sourceRecordId: "safe-boundary-organization",
      sourceVersionId: "safe-boundary-organization-version",
      targetType: "organization",
      action: "create",
      payload: {
        normalized: { kind: "organization", name: "Safe Boundary" },
        automaticReview: automaticProof(),
      },
      dependencyOperationKeys: [],
      requiredForSourceOutcome: true,
      safeByDefault: true,
    };
    const safeContact: ManifestOperation = {
      operationKey: "contact:safe-boundary",
      sourceRecordId: "safe-boundary-contact",
      sourceVersionId: "safe-boundary-contact-version",
      targetType: "contact",
      action: "create",
      payload: {
        normalized: { kind: "contact", firstName: "Safe", lastName: "Boundary" },
        automaticReview: automaticProof(),
      },
      dependencyOperationKeys: [safeOrganization.operationKey],
      requiredForSourceOutcome: true,
      safeByDefault: true,
    };
    const unsafeProof = automaticProof(
      "archived_only",
      "not_automatically_safe",
      false,
    );
    const unsafeOperations: ManifestOperation[] = [
      {
        operationKey: "contact:duplicate-exact-name",
        sourceRecordId: "duplicate-exact-name",
        sourceVersionId: "duplicate-exact-name-version",
        targetType: "contact",
        action: "create",
        payload: { automaticReview: unsafeProof },
        dependencyOperationKeys: [],
        requiredForSourceOutcome: true,
        safeByDefault: true,
      },
      {
        operationKey: "contact:conflicting-evidence",
        sourceRecordId: "conflicting-evidence",
        sourceVersionId: "conflicting-evidence-version",
        targetType: "contact",
        action: "link_existing",
        payload: { localId: "conflicting-local", automaticReview: unsafeProof },
        dependencyOperationKeys: [],
        requiredForSourceOutcome: true,
        safeByDefault: true,
      },
      {
        operationKey: "contact:stale-field-proof",
        sourceRecordId: "stale-field-proof",
        sourceVersionId: "stale-field-proof-version",
        targetType: "contact",
        action: "overwrite_reviewed",
        payload: {
          entityId: "stale-local",
          fieldName: "phone",
          value: "555-ACT",
          automaticReview: unsafeProof,
        },
        dependencyOperationKeys: [],
        requiredForSourceOutcome: true,
        safeByDefault: false,
      },
      {
        operationKey: "organization:required-unresolved",
        sourceRecordId: "required-unresolved-relationship",
        sourceVersionId: "required-unresolved-version",
        targetType: "organization",
        action: "create",
        payload: {
          automaticReview: automaticProof(),
        },
        dependencyOperationKeys: ["organization_contact:required-unresolved"],
        requiredForSourceOutcome: true,
        safeByDefault: true,
      },
      {
        operationKey: "organization_contact:required-unresolved",
        sourceRecordId: "required-unresolved-relationship",
        sourceVersionId: "required-unresolved-version",
        targetType: "organization_contact",
        action: "create_relationship",
        payload: { automaticReview: unsafeProof },
        dependencyOperationKeys: [],
        requiredForSourceOutcome: true,
        safeByDefault: true,
      },
    ];
    const outcome = (
      sourceRecordId: string,
      sourceVersionId: string,
      issues: ManifestOutcome["issues"],
      operationKeys: string[],
    ): ManifestOutcome => ({
      sourceRecordId,
      sourceVersionId,
      state: "awaiting_review",
      issues,
      candidates: [],
      match: null,
      mappingWarnings: [],
      unsupportedFieldPaths: [],
      operationKeys,
    });
    const manifest: ActOrganizeManifest = {
      digest,
      diagnostics: [],
      outcomes: [
        outcome("safe-boundary-organization", "safe-boundary-organization-version", [], [safeOrganization.operationKey]),
        outcome("safe-boundary-contact", "safe-boundary-contact-version", [], [safeContact.operationKey]),
        outcome("duplicate-exact-name", "duplicate-exact-name-version", [{ code: "ambiguous_match", reason: "multiple_candidates" }], ["contact:duplicate-exact-name"]),
        outcome("conflicting-evidence", "conflicting-evidence-version", [{ code: "ambiguous_match", reason: "conflicting_contact_fields" }], ["contact:conflicting-evidence"]),
        outcome("stale-field-proof", "stale-field-proof-version", [{ code: "field_conflict", reason: "phone" }], ["contact:stale-field-proof"]),
        outcome("required-unresolved-relationship", "required-unresolved-version", [{ code: "relationship_unresolved", reason: "source_relationship_conflict", relationshipSlot: "required", expectedParentTypes: [], canImportStandalone: false }], ["organization:required-unresolved", "organization_contact:required-unresolved"]),
      ],
      operations: [safeOrganization, safeContact, ...unsafeOperations],
    };

    const workflow = projectImportWorkflow({
      phase: "complete_with_issues",
      summary: { manifestDigest: digest },
      outcomes: manifest.outcomes,
      operations: manifest.operations.map((operation) => ({
        ...operation,
        status: "pending",
        automaticReview: operation.payload.automaticReview,
      })),
      batches: [],
    });
    expect(workflow).toMatchObject({
      safeOperationCount: 2,
      canReview: true,
      canApplySafe: true,
    });
    expect(new Set(workflow.operations.filter((operation) => operation.heldForReview)
      .map((operation) => manifest.operations.find((candidate) => candidate.operationKey === operation.operationKey)!.sourceRecordId)))
      .toEqual(new Set([
        "duplicate-exact-name",
        "conflicting-evidence",
        "stale-field-proof",
        "required-unresolved-relationship",
      ]));

    const approvals = new InMemoryApprovalRepository();
    approvals.seed(runId, manifest);
    const approval = await new ActApprovalService(approvals).approveSafeDefaults({
      runId,
      expectedManifestDigest: digest,
      requestKey: "approve-rebuilt-safe-closure",
      requestedBy: "owner",
    });
    expect(approval.approvedOperationIds).toEqual([
      safeOrganization.operationKey,
      safeContact.operationKey,
    ]);
    expect(new Set(approval.rejectedOperationIds)).toEqual(
      new Set(unsafeOperations.map((operation) => operation.operationKey)),
    );

    const applyRepository = new InMemoryApplyRepository({ unsafeForTests: true });
    applyRepository.seedManifest(runId, digest);
    applyRepository.seedOperations(manifest.operations);
    applyRepository.seedApproval(
      runId,
      "approve-rebuilt-safe-closure",
      approval.approvedOperationIds,
      digest,
    );
    expect(applyRepository.targets.size).toBe(0);
    const coordinator = new ActApplyCoordinator(
      new ActApplyService(applyRepository, true),
      applyRepository,
    );
    await coordinator.applyNext({
      runId,
      approvalRequestKey: "approve-rebuilt-safe-closure",
      expectedManifestDigest: digest,
      requestedBy: "owner",
      batchSize: 25,
    });
    expect(applyRepository.targets.size).toBe(2);
    expect([...applyRepository.targets.values()].map((target) => target.entityType).sort())
      .toEqual(["contact", "organization"]);
  });

  it("applies safe and reviewed operations through one explicit dependency-closed approval", async () => {
    const runId = "combined-explicit-approval";
    const digest = "f".repeat(64);
    const link: ManifestOperation = {
      operationKey: "organization:existing:identity:local-existing",
      sourceRecordId: "existing-source",
      sourceVersionId: "existing-version",
      targetType: "organization",
      action: "link_existing",
      payload: {
        localId: "local-existing",
        normalized: { kind: "organization", name: "Existing", phone: "555-ACT" },
        automaticReview: automaticProof("safe_ready", "trusted_exact_match"),
      },
      dependencyOperationKeys: [],
      requiredForSourceOutcome: true,
      safeByDefault: true,
    };
    const create: ManifestOperation = {
      operationKey: "organization:new-source",
      sourceRecordId: "new-source",
      sourceVersionId: "new-version",
      targetType: "organization",
      action: "create",
      payload: {
        normalized: { kind: "organization", name: "New Safe" },
        automaticReview: automaticProof(),
      },
      dependencyOperationKeys: [],
      requiredForSourceOutcome: true,
      safeByDefault: true,
    };
    const overwrite: ManifestOperation = {
      operationKey: "organization:existing:field:phone:decision:reviewed",
      sourceRecordId: "existing-source",
      sourceVersionId: "existing-version",
      targetType: "organization",
      action: "overwrite_reviewed",
      payload: {
        entityId: "local-existing",
        fieldName: "phone",
        value: "555-ACT",
        proof: {
          entityType: "organization",
          entityId: "local-existing",
          fieldName: "phone",
          sourceVersionId: "existing-version",
          expectedLocalValueFingerprint: fingerprintSourceContent({ value: "555-LOCAL" }),
          decisionId: "decision-reviewed",
          decision: "use_source",
          localValue: "555-LOCAL",
          sourceValue: "555-ACT",
        },
        decision: {
          id: "decision-reviewed",
          sourceVersionId: "existing-version",
          scope: "field_conflict",
          decision: "use_source",
          fieldName: "phone",
          targetEntityType: "organization",
          targetEntityId: "local-existing",
        },
      },
      dependencyOperationKeys: [link.operationKey],
      requiredForSourceOutcome: true,
      safeByDefault: false,
    };
    const manifest: ActOrganizeManifest = {
      digest,
      diagnostics: [],
      outcomes: [],
      operations: [link, create, overwrite],
    };
    const approvals = new InMemoryApprovalRepository();
    approvals.seed(runId, manifest);
    const approvalService = new ActApprovalService(approvals);
    const combinedApproval = await approvalService.approve({
      runId,
      operationIds: [create.operationKey, overwrite.operationKey],
      includeDependencies: true,
      expectedManifestDigest: digest,
      requestKey: "combined-explicit",
      requestedBy: "owner",
    });
    expect(new Set(combinedApproval.approvedOperationIds)).toEqual(new Set([
      link.operationKey,
      create.operationKey,
      overwrite.operationKey,
    ]));
    const repository = new InMemoryApplyRepository({ unsafeForTests: true });
    repository.seedManifest(runId, digest);
    repository.seedOperations(manifest.operations);
    repository.targets.set("organization:local-existing", {
      id: "local-existing",
      entityType: "organization",
      values: { name: "Existing", phone: "555-LOCAL" },
      sourceIds: new Set(["existing-source"]),
    });
    repository.seedApproval(runId, "combined-explicit", combinedApproval.approvedOperationIds, digest, "explicit_manual");
    const coordinator = new ActApplyCoordinator(new ActApplyService(repository, true), repository);

    const first = await coordinator.applyNext({
      runId, approvalRequestKey: "combined-explicit", expectedManifestDigest: digest,
      requestedBy: "owner", batchSize: 25,
    });
    expect(first).toMatchObject({ hasMore: false, requiresReview: false });
    const appliedOnce = [...repository.targets.values()].map((target) => ({
      id: target.id,
      entityType: target.entityType,
      values: { ...target.values },
      sourceIds: [...(target.sourceIds ?? [])].sort(),
    })).sort((left, right) => left.id.localeCompare(right.id));
    expect(repository.targets.get("organization:local-existing")?.values.phone).toBe("555-ACT");
    expect(repository.runPhases.get(runId)).toBe("complete");

    const replay = await coordinator.applyNext({
      runId, approvalRequestKey: "combined-explicit", expectedManifestDigest: digest,
      requestedBy: "owner", batchSize: 25,
    });
    expect(replay).toEqual(first);
    expect([...repository.targets.values()].map((target) => ({
      id: target.id,
      entityType: target.entityType,
      values: { ...target.values },
      sourceIds: [...(target.sourceIds ?? [])].sort(),
    })).sort((left, right) => left.id.localeCompare(right.id))).toEqual(appliedOnce);
  });

  it("rebuilds the exact real unsafe remainder after a concurrent local edit stales field proof", async () => {
    const fetchedAt = new Date("2026-08-12T12:00:00.000Z");
    const archived = (
      sourceRecordId: string,
      streamType: string,
      rawSnapshot: Record<string, unknown>,
      actRecordId: string | null = `${sourceRecordId}-act`,
      relationshipEvidence: Record<string, unknown> = {},
    ): ArchivedOrganizerSourceRow => ({
      sourceRecordId,
      sourceVersionId: `${sourceRecordId}-version`,
      latestSourceVersionId: `${sourceRecordId}-version`,
      streamType,
      actRecordId,
      archiveCompleteness: "complete",
      rawSnapshot,
      fetchedAt,
      relationshipEvidence,
    });
    const rows = [
      archived("duplicate-exact-name", "contact", { FirstName: "Dana", LastName: "Duplicate" }),
      archived("conflicting-evidence", "contact", {
        FirstName: "Casey", LastName: "Conflict",
        EmailAddress: "casey-source@example.com", BusinessPhone: "555-333-4444",
      }),
      archived("stale-field-proof", "contact", {
        FirstName: "Natalie", LastName: "Proof",
        EmailAddress: "natalie-proof@example.com", JobTitle: "ACT Director",
      }),
      archived("required-unresolved-relationship", "company", { Name: "Required Company" }),
      archived("required-relationship-evidence", "company_contact", {}, null, {
        source: "endpoint",
        parentKind: "company",
        parentActRecordId: "required-unresolved-relationship-act",
        targetKind: "contact",
        targetActRecordId: "missing-required-contact-act",
      }),
    ];
    const localContacts = [
      { id: "duplicate-a", firstName: "Dana", lastName: "Duplicate", email: null, phone: null },
      { id: "duplicate-b", firstName: "Dana", lastName: "Duplicate", email: null, phone: null },
      { id: "conflict-email", firstName: "Casey", lastName: "Conflict", email: "casey-source@example.com", phone: "555-000-0000" },
      { id: "conflict-phone", firstName: "Different", lastName: "Person", email: "different@example.com", phone: "555-333-4444" },
      { id: "stale-target", firstName: "Natalie", lastName: "Proof", email: "natalie-proof@example.com", phone: null, jobTitle: "Local Director" },
    ];
    const initialSources = manifestSourcesFromArchiveRows({
      rows,
      localCandidates: { contacts: localContacts },
    });
    const displayBySourceId: Record<string, Record<string, string>> = {
      "duplicate-exact-name": { firstName: "Dana", lastName: "Duplicate" },
      "conflicting-evidence": { firstName: "Casey", lastName: "Conflict", email: "casey-source@example.com", phone: "555-333-4444" },
      "stale-field-proof": { firstName: "Natalie", lastName: "Proof", email: "natalie-proof@example.com", jobTitle: "ACT Director" },
      "required-unresolved-relationship": { name: "Required Company" },
    };
    const initialManifest = buildActOrganizeManifest({ runId: "unsafe-remainder", sources: initialSources });
    const records: AutomaticReviewRecord[] = initialManifest.outcomes.map((outcome) => ({
      sourceRecordId: outcome.sourceRecordId,
      sourceVersionId: outcome.sourceVersionId,
      issues: outcome.issues.flatMap((issue) => [
        "ambiguous_match", "field_conflict", "relationship_unresolved", "unassigned",
        "unsupported_record", "unsupported_field",
      ].includes(issue.code) ? [{ ...issue, code: issue.code as AutomaticReviewReason }] : []),
      conflicts: outcome.issues.flatMap((issue) => issue.code === "field_conflict" && issue.reason ? [{ fieldName: issue.reason }] : []),
      match: outcome.match as AutomaticReviewRecord["match"],
      unsupportedRecord: outcome.state === "unsupported",
    }));
    const targetProjections = localContacts.map((contact) => ({
      id: contact.id,
      entityType: "contact",
      label: `${contact.firstName} ${contact.lastName}`,
      detail: null,
      fields: {
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        phone: contact.phone,
        jobTitle: contact.jobTitle ?? null,
      },
    }));
    const resolution = proposeAutomaticReview({
      records,
      context: {
        sourceRecords: initialSources.map((source) => ({
          sourceRecordId: source.sourceRecordId,
          sourceVersionId: source.sourceVersionId,
          streamType: source.streamType,
          display: displayBySourceId[source.sourceRecordId] ?? {},
        })),
        targetsByEntityType: { contact: targetProjections },
      },
    });
    expect(resolution.proposals.filter((proposal) => proposal.kind === "manual_review").map((proposal) => proposal.sourceRecordId).sort())
      .toEqual(["conflicting-evidence", "duplicate-exact-name", "required-unresolved-relationship"]);
    const decisions = resolution.proposals.flatMap((proposal, index) => {
      if (proposal.kind !== "decision") return [];
      const fieldProof = proposal.scope === "field_conflict" && proposal.decision === "use_source"
        ? {
            reviewedSourceValue: "ACT Director",
            reviewedSourceValueFingerprint: fingerprintSourceContent({ value: "ACT Director" }),
            reviewedLocalValue: "Local Director",
            reviewedLocalValueFingerprint: fingerprintSourceContent({ value: "Local Director" }),
          }
        : {};
      return [{
        id: `automatic-decision-${index}`,
        ...proposal,
        fieldName: proposal.fieldName,
        relationshipSlot: proposal.relationshipSlot,
        ...fieldProof,
        decidedBy: "owner",
        active: true,
        createdAt: fetchedAt,
      }];
    });
    expect(decisions.map(({ sourceRecordId, scope, decision }) => ({ sourceRecordId, scope, decision })))
      .toEqual([
        { sourceRecordId: "stale-field-proof", scope: "field_conflict", decision: "use_source" },
      ]);

    const rebuiltSources = manifestSourcesFromArchiveRows({
      rows,
      decisions,
      localCandidates: {
        contacts: localContacts.map((contact) => contact.id === "stale-target"
          ? { ...contact, jobTitle: "Concurrent Local Edit" }
          : contact),
      },
    });
    const rebuilt = buildActOrganizeManifest({ runId: "unsafe-remainder", sources: rebuiltSources });
    const reader = new InMemoryReviewReader();
    reader.seed("unsafe-remainder", rebuilt, rebuiltSources.map((source) => ({
      sourceRecordId: source.sourceRecordId,
      sourceVersionId: source.sourceVersionId,
      streamType: source.streamType,
      display: displayBySourceId[source.sourceRecordId] ?? {},
    })), targetProjections.map((target) => target.id === "stale-target"
      ? { ...target, fields: { ...target.fields, jobTitle: "Concurrent Local Edit" } }
      : target));
    const page = await readReview(reader, { runId: "unsafe-remainder", state: "needs_review", pageSize: 25 });

    expect(page.rows.map((row) => ({
      sourceRecordId: row.sourceRecordId,
      issues: row.issues.map((issue) => `${issue.code}:${issue.reason}`).sort(),
      relationshipRequired: row.relationshipIssues.map((issue) => !issue.canImportStandalone),
    }))).toEqual([
      { sourceRecordId: "conflicting-evidence", issues: ["ambiguous_match:conflicting_contact_identity"], relationshipRequired: [] },
      { sourceRecordId: "duplicate-exact-name", issues: ["ambiguous_match:insufficient_independent_context_clues"], relationshipRequired: [] },
      { sourceRecordId: "required-unresolved-relationship", issues: ["relationship_unresolved:unresolved_exact_relationship"], relationshipRequired: [true] },
      { sourceRecordId: "stale-field-proof", issues: ["field_conflict:jobTitle"], relationshipRequired: [] },
    ]);
    expect(rebuilt.operations).not.toContainEqual(expect.objectContaining({
      sourceRecordId: "stale-field-proof",
      action: "overwrite_reviewed",
    }));
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
      payload: {
        normalized: { kind: "organization", name: "Safe first" },
        automaticReview: automaticProof(),
      },
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
        automaticReview: automaticProof(),
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
