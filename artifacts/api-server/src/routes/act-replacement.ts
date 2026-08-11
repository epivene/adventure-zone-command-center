import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  ActCheckpointConflictError,
  ActReplacementRunNotFoundError,
  DrizzleActReplacementCheckpointRepository,
  type ActResumeDiagnostics,
} from "@/features/act-replacement/checkpoint-repository";
import type {
  ActReplacementStatus,
  ActReplacementStreamType,
  ActRequestAuditState,
  ActSafeErrorCode,
  ImportWorkflow,
  StartActReplacementRun,
} from "@/features/act-replacement/import-types";
import { getActEnvironment } from "@/lib/env";
import {
  actReplacementRequestAudits,
  actReplacementRuns,
} from "@workspace/db/schema";
import {
  readReview,
  safeSource,
  type ReviewReader,
} from "@/features/act-replacement/review-reader";
import { projectActReviewDisplay } from "@/features/act-replacement/review-display";
import { ReviewCommandService } from "@/features/act-replacement/review-command-service";
import { createProductionReview } from "@/features/act-replacement/production-review";
import type { ActApplyCoordinator } from "@/features/act-replacement/apply-coordinator";

const ownerIdentity = "owner";
const pageSizeSchema = z.union([
  z.literal(25),
  z.literal(50),
  z.literal(100),
  z.literal(200),
]);
const reviewIssueCodeSchema = z.enum([
  "ambiguous_match",
  "field_conflict",
  "relationship_unresolved",
  "unassigned",
  "unsupported_record",
  "unsupported_field",
]);
const reviewStateSchema = z.enum([
  "ready",
  "already_present",
  "awaiting_review",
  "unassigned",
  "unsupported",
  "ignored",
]);
const reviewStateFilterSchema = z.union([
  reviewStateSchema,
  z.literal("needs_review"),
]);
const reviewFiltersSchema = z.object({
  state: reviewStateFilterSchema.optional(),
  issue: reviewIssueCodeSchema.optional(),
});
const startSchema = z
  .object({
    requestKey: z.string().trim().min(1),
    pageSize: pageSizeSchema,
  })
  .strict();
const emptyBodySchema = z.object({}).strict();
const organizeSchema = z.object({}).strict();
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const uuidSchema = z.string().uuid();
const requestKeySchema = z.string().trim().min(1).max(200);
const localEntityTypeSchema = z.enum(["organization", "contact", "booking", "calling_list", "activity"]);
const conflictReviewTokenSchema = z
  .object({
    sourceRecordId: z.string().trim().min(1),
    sourceVersionId: z.string().trim().min(1),
    fieldName: z.string().trim().min(1),
    sourceValueFingerprint: digestSchema,
    targetEntityType: z.string().trim().min(1),
    targetEntityId: z.string().trim().min(1),
    localValueFingerprint: digestSchema,
  })
  .strict();
const individualConflictReviewTokenSchema = z
  .object({
    sourceRecordId: uuidSchema,
    sourceVersionId: uuidSchema,
    fieldName: z.string().trim().min(1),
    sourceValueFingerprint: digestSchema,
    targetEntityType: localEntityTypeSchema,
    targetEntityId: uuidSchema,
    localValueFingerprint: digestSchema,
  })
  .strict();
const approvalSchema = z
  .object({
    operationIds: z.array(z.string().trim().min(1)).max(100000),
    includeDependencies: z.literal(true),
    expectedManifestDigest: digestSchema,
    requestKey: z.string().trim().min(1),
  })
  .strict();
const safeApprovalSchema = z
  .object({
    expectedManifestDigest: digestSchema,
    requestKey: z.string().trim().min(1),
  })
  .strict();
const bulkSelectionSchema = z
  .object({
    sourceRecordId: z.string().trim().min(1),
    sourceVersionId: z.string().trim().min(1),
    reviewToken: conflictReviewTokenSchema.optional(),
  })
  .strict();
const bulkDecisionSchema = z.discriminatedUnion("scope", [
  z
    .object({
      expectedManifestDigest: digestSchema,
      requestKey: z.string().trim().min(1),
      selections: z.array(bulkSelectionSchema).min(1).max(200),
      scope: z.literal("duplicate_identity"),
      decision: z.enum(["link_existing", "keep_separate"]),
      fieldName: z.null(),
    })
    .strict(),
  z
    .object({
      expectedManifestDigest: digestSchema,
      requestKey: z.string().trim().min(1),
      selections: z.array(bulkSelectionSchema).min(1).max(200),
      scope: z.literal("field_conflict"),
      decision: z.enum(["keep_local", "use_source"]),
      fieldName: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      expectedManifestDigest: digestSchema,
      requestKey: z.string().trim().min(1),
      selections: z.array(bulkSelectionSchema).min(1).max(200),
      scope: z.literal("relationship"),
      decision: z.enum(["keep_unlinked", "ignore_source"]),
      fieldName: z.null(),
    })
    .strict(),
  z
    .object({
      expectedManifestDigest: digestSchema,
      requestKey: z.string().trim().min(1),
      selections: z.array(bulkSelectionSchema).min(1).max(200),
      scope: z.literal("unsupported_record"),
      decision: z.literal("ignore_source"),
      fieldName: z.null(),
    })
    .strict(),
]).superRefine((value, context) => {
  if (value.scope !== "field_conflict" || value.decision !== "use_source") return;
  value.selections.forEach((selection, index) => {
    if (!selection.reviewToken) context.addIssue({ code: "custom", path: ["selections", index, "reviewToken"], message: "review_token_required" });
  });
});
const applyNextSchema = z
  .object({
    expectedManifestDigest: digestSchema,
    approvalRequestKey: z.string().trim().min(1),
    batchSize: z.number().int().min(1).max(25),
    retryFailed: z.boolean().optional(),
  })
  .strict();
const supersedeSchema = z.object({ confirm: z.literal("START OVER") }).strict();
const runIdSchema = z.string().uuid();
const sourceRecordParamsSchema = z.object({ sourceRecordId: uuidSchema }).strict();
const assignmentParamsSchema = z.object({ sourceRecordId: uuidSchema, assignmentId: uuidSchema }).strict();
const decisionParamsSchema = z.object({ sourceRecordId: uuidSchema, decisionId: uuidSchema }).strict();
const sourceRecordQuerySchema = z.object({ runId: uuidSchema }).strict();
const assignmentBodySchema = z.object({
  runId: uuidSchema,
  targetEntityType: localEntityTypeSchema,
  targetEntityId: uuidSchema,
  sourceVersionId: uuidSchema,
  expectedSourceVersionId: uuidSchema,
  requestKey: requestKeySchema,
  role: z.string().trim().min(1).max(100).optional(),
  isPrimary: z.boolean().optional(),
}).strict();
const removeAssignmentBodySchema = z.object({
  runId: uuidSchema,
  expectedSourceVersionId: uuidSchema,
  requestKey: requestKeySchema,
}).strict();
const individualDecisionBodySchema = z.discriminatedUnion("scope", [
  z.object({
    runId: uuidSchema,
    sourceVersionId: uuidSchema,
    scope: z.literal("duplicate_identity"),
    decision: z.enum(["link_existing", "keep_separate"]),
    requestKey: requestKeySchema,
    targetEntityType: localEntityTypeSchema.nullish(),
    targetEntityId: uuidSchema.nullish(),
  }).strict(),
  z.object({
    runId: uuidSchema,
    sourceVersionId: uuidSchema,
    scope: z.literal("field_conflict"),
    decision: z.enum(["keep_local", "use_source"]),
    fieldName: z.string().trim().min(1).max(200),
    requestKey: requestKeySchema,
    reviewToken: individualConflictReviewTokenSchema.optional(),
  }).strict(),
  z.object({
    runId: uuidSchema,
    sourceVersionId: uuidSchema,
    scope: z.literal("relationship"),
    decision: z.enum(["assign_parent", "keep_unlinked", "ignore_source"]),
    relationshipSlot: z.string().trim().min(1).max(200),
    requestKey: requestKeySchema,
    targetEntityType: localEntityTypeSchema.nullish(),
    targetEntityId: uuidSchema.nullish(),
  }).strict(),
  z.object({
    runId: uuidSchema,
    sourceVersionId: uuidSchema,
    scope: z.literal("unsupported_record"),
    decision: z.literal("ignore_source"),
    requestKey: requestKeySchema,
  }).strict(),
]).superRefine((value, context) => {
  if (value.scope === "field_conflict" && value.decision === "use_source" && !value.reviewToken)
    context.addIssue({ code: "custom", path: ["reviewToken"], message: "review_token_required" });
  if (value.scope === "relationship" && value.decision === "assign_parent" && (!value.targetEntityType || !value.targetEntityId))
    context.addIssue({ code: "custom", path: ["targetEntityId"], message: "relationship_parent_required" });
});
const removeDecisionBodySchema = z.object({ runId: uuidSchema, requestKey: requestKeySchema }).strict();

export type ActReplacementAuditRecord = {
  auditId: string;
  runId: string;
  checkpointId: string;
  streamType: ActReplacementStreamType;
  method: "GET";
  pathTemplate: string;
  state: ActRequestAuditState;
  httpStatus: number | null;
  safeErrorCode: ActSafeErrorCode | null;
  durationMs: number | null;
  startedAt: string;
  completedAt: string | null;
};

type OwnedRunLookup = {
  runId: string;
  sourceDatabaseKey: string;
  requestedBy: string;
};

export interface ActReplacementControlStore {
  createRun(
    input: StartActReplacementRun,
  ): Promise<{ runId: string; created: boolean }>;
  findOwnedRun(input: OwnedRunLookup): Promise<{ runId: string } | null>;
  findLatestOwnedRun(input: {
    sourceDatabaseKey: string;
    requestedBy: string;
  }): Promise<{ runId: string } | null>;
  summarize(runId: string): Promise<ActReplacementStatus>;
  resumeRun?(input: {
    runId: string;
    now: Date;
  }): Promise<ActResumeDiagnostics>;
  supersedeRun(input: {
    runId: string;
    requestedBy: string;
    now: Date;
  }): Promise<void>;
  listRequestAudits(
    input: OwnedRunLookup,
  ): Promise<readonly ActReplacementAuditRecord[]>;
}

export type ActReplacementRouteDependencies = {
  store: ActReplacementControlStore;
  getActConfiguration():
    { configured: false } | { configured: true; databaseName: string };
  now(): Date;
  review?: {
    reader: ReviewReader;
    commands: ReviewCommandService;
    applyCoordinator: Pick<ActApplyCoordinator, "applyNext">;
    workflow: {
      summarize(runId: string): Promise<ImportWorkflow>;
    };
    assignmentTargets?: (query: {
      search?: string;
      entityType?: string;
      entityTypes?: string[];
    }) => Promise<unknown[]>;
  };
};

class DatabaseActReplacementControlStore implements ActReplacementControlStore {
  private async database() {
    return (await import("@/db/client")).db;
  }

  private async checkpoints() {
    return new DrizzleActReplacementCheckpointRepository(await this.database());
  }

  async createRun(input: StartActReplacementRun) {
    return (await this.checkpoints()).createRun(input);
  }

  async resumeRun(input: { runId: string; now: Date }) {
    return (await this.checkpoints()).resumeRun(input);
  }

  async findOwnedRun(input: OwnedRunLookup) {
    const database = await this.database();
    const [run] = await database
      .select({ runId: actReplacementRuns.id })
      .from(actReplacementRuns)
      .where(
        and(
          eq(actReplacementRuns.id, input.runId),
          eq(actReplacementRuns.sourceDatabaseKey, input.sourceDatabaseKey),
          eq(actReplacementRuns.requestedBy, input.requestedBy),
        ),
      )
      .limit(1);
    return run ?? null;
  }

  async findLatestOwnedRun(input: {
    sourceDatabaseKey: string;
    requestedBy: string;
  }) {
    const database = await this.database();
    const [run] = await database
      .select({ runId: actReplacementRuns.id })
      .from(actReplacementRuns)
      .where(
        and(
          eq(actReplacementRuns.sourceDatabaseKey, input.sourceDatabaseKey),
          eq(actReplacementRuns.requestedBy, input.requestedBy),
        ),
      )
      .orderBy(desc(actReplacementRuns.createdAt), desc(actReplacementRuns.id))
      .limit(1);
    return run ?? null;
  }

  async summarize(runId: string) {
    return (await this.checkpoints()).summarize(runId);
  }

  async supersedeRun(input: { runId: string; requestedBy: string; now: Date }) {
    await (await this.checkpoints()).supersedeRun(input);
  }

  async listRequestAudits(input: OwnedRunLookup) {
    const database = await this.database();
    const rows = await database
      .select({
        auditId: actReplacementRequestAudits.id,
        runId: actReplacementRequestAudits.runId,
        checkpointId: actReplacementRequestAudits.checkpointId,
        streamType: actReplacementRequestAudits.streamType,
        method: actReplacementRequestAudits.method,
        pathTemplate: actReplacementRequestAudits.pathTemplate,
        state: actReplacementRequestAudits.state,
        httpStatus: actReplacementRequestAudits.httpStatus,
        safeErrorCode: actReplacementRequestAudits.safeErrorCode,
        durationMs: actReplacementRequestAudits.durationMs,
        startedAt: actReplacementRequestAudits.startedAt,
        completedAt: actReplacementRequestAudits.completedAt,
      })
      .from(actReplacementRequestAudits)
      .innerJoin(
        actReplacementRuns,
        eq(actReplacementRuns.id, actReplacementRequestAudits.runId),
      )
      .where(
        and(
          eq(actReplacementRuns.id, input.runId),
          eq(actReplacementRuns.sourceDatabaseKey, input.sourceDatabaseKey),
          eq(actReplacementRuns.requestedBy, input.requestedBy),
        ),
      )
      .orderBy(
        asc(actReplacementRequestAudits.startedAt),
        asc(actReplacementRequestAudits.id),
      );
    return rows.map((row): ActReplacementAuditRecord => ({
      auditId: row.auditId,
      runId: row.runId,
      checkpointId: row.checkpointId,
      streamType: row.streamType as ActReplacementStreamType,
      method: "GET",
      pathTemplate: row.pathTemplate,
      state: row.state as ActRequestAuditState,
      httpStatus: row.httpStatus,
      safeErrorCode: row.safeErrorCode,
      durationMs: row.durationMs,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    }));
  }
}

const productionDependencies: ActReplacementRouteDependencies = {
  store: new DatabaseActReplacementControlStore(),
  getActConfiguration() {
    const environment = getActEnvironment();
    return environment.configured
      ? { configured: true, databaseName: environment.config.databaseName }
      : { configured: false };
  },
  now: () => new Date(),
  review: {
    ...createProductionReview(() => {
      const environment = getActEnvironment();
      return {
        sourceDatabaseKey: environment.configured
          ? environment.config.databaseName
          : "unconfigured",
        requestedBy: ownerIdentity,
      };
    }),
  },
};

function invalidRequest(res: Response) {
  res.status(400).json({ code: "invalid_request" });
}

function runNotFound(res: Response) {
  res.status(404).json({ code: "run_not_found" });
}

function serverContext(
  dependencies: ActReplacementRouteDependencies,
  res: Response,
): { sourceDatabaseKey: string; requestedBy: string } | null {
  try {
    const configuration = dependencies.getActConfiguration();
    if (!configuration.configured) {
      res.status(503).json({ code: "not_configured" });
      return null;
    }
    return {
      sourceDatabaseKey: configuration.databaseName,
      requestedBy: ownerIdentity,
    };
  } catch {
    res.status(503).json({ code: "not_configured" });
    return null;
  }
}

function safeAuditRecord(row: ActReplacementAuditRecord) {
  return {
    auditId: row.auditId,
    runId: row.runId,
    checkpointId: row.checkpointId,
    streamType: row.streamType,
    method: "GET" as const,
    pathTemplate: row.pathTemplate,
    state: row.state,
    httpStatus: row.httpStatus,
    safeErrorCode: row.safeErrorCode,
    durationMs: row.durationMs,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function safeManifestProjection(
  manifest: Awaited<ReturnType<ReviewReader["getManifest"]>>,
) {
  if (!manifest) return null;
  return {
    digest: manifest.digest,
    diagnostics: manifest.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      sourceRecordId: diagnostic.sourceRecordId,
      ...(diagnostic.path ? { path: diagnostic.path } : {}),
    })),
    outcomes: manifest.outcomes.map((outcome) => ({
      sourceRecordId: outcome.sourceRecordId,
      sourceVersionId: outcome.sourceVersionId,
      state: outcome.state,
      issueCodes: outcome.issues.map((issue) => issue.code),
      operationKeys: [...outcome.operationKeys],
    })),
    operations: manifest.operations.map((operation) => ({
      operationKey: operation.operationKey,
      sourceRecordId: operation.sourceRecordId,
      sourceVersionId: operation.sourceVersionId,
      targetType: operation.targetType,
      action: operation.action,
      dependencyOperationKeys: [...operation.dependencyOperationKeys],
      requiredForSourceOutcome: operation.requiredForSourceOutcome,
      safeByDefault: operation.safeByDefault,
    })),
  };
}

function safeApproval(result: {
  selectedOperationIds: string[];
  approvedOperationIds: string[];
  dependencyOperationIds: string[];
  rejectedOperationIds: string[];
  selectedCount: number;
  dependencyCount: number;
  rejectedCount: number;
  manifestDigest: string;
}) {
  return {
    selectedOperationIds: [...result.selectedOperationIds],
    approvedOperationIds: [...result.approvedOperationIds],
    dependencyOperationIds: [...result.dependencyOperationIds],
    rejectedOperationIds: [...result.rejectedOperationIds],
    selectedCount: result.selectedCount,
    dependencyCount: result.dependencyCount,
    rejectedCount: result.rejectedCount,
    manifestDigest: result.manifestDigest,
  };
}

function safeAutomaticApproval(result: {
  approvedOperationIds: string[];
  manifestDigest: string;
}) {
  return {
    approvedOperationCount: result.approvedOperationIds.length,
    manifestDigest: result.manifestDigest,
  };
}

function safeReviewPage(page: Awaited<ReturnType<typeof readReview>>) {
  return {
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    manifestDigest: page.manifestDigest,
    summary: {
      decisionRequired: page.summary.decisionRequired,
      archivedOnly: page.summary.archivedOnly,
      issueCounts: { ...page.summary.issueCounts },
      diagnosticCounts: { ...page.summary.diagnosticCounts },
    },
    rows: page.rows.map((row) => ({
      sourceRecordId: row.sourceRecordId,
      sourceVersionId: row.sourceVersionId,
      state: row.state,
      issueCodes: row.issues.map((issue) => issue.code),
      issues: row.issues.map((issue) => ({
        code: issue.code,
        ...(issue.reason ? { reason: issue.reason } : {}),
      })),
      conflicts: row.conflicts.map((conflict) => ({
        fieldName: conflict.fieldName,
        localValue: conflict.localValue,
        sourceValue: conflict.sourceValue,
        ...(conflict.target ? { target: { ...conflict.target } } : {}),
        ...(conflict.reviewToken ? { reviewToken: { ...conflict.reviewToken } } : {}),
      })),
      candidates: row.candidates.map((candidate) => ({
        id: candidate.id,
        entityType: candidate.entityType,
        label: candidate.label,
        detail: candidate.detail,
      })),
      ...(row.relationshipIssues?.length ? {
        relationshipIssues: row.relationshipIssues.map((issue) => ({
          relationshipSlot: issue.relationshipSlot,
          issueCode: issue.issueCode,
          reason: issue.reason,
          expectedParentTypes: [...issue.expectedParentTypes],
          canImportStandalone: issue.canImportStandalone,
        })),
      } : {}),
      canImportStandalone: row.canImportStandalone,
      operationKeys: [...row.operationKeys],
      ...(row.streamType ? { streamType: row.streamType } : {}),
      display: projectActReviewDisplay(row.streamType, row.display),
    })),
  };
}

function handleRouteError(error: unknown, res: Response) {
  if (error instanceof ActReplacementRunNotFoundError) {
    runNotFound(res);
    return;
  }
  if (error instanceof ActCheckpointConflictError) {
    res.status(409).json({ code: "run_conflict" });
    return;
  }
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    const typed = error as { status: number; code?: string };
    res
      .status(typed.status)
      .json({ code: typed.code ?? "act_replacement_error" });
    return;
  }
  res.status(500).json({ code: "act_replacement_unavailable" });
}

export function createActReplacementRouter(
  dependencies: ActReplacementRouteDependencies,
): IRouter {
  const router: IRouter = Router();

  const requireReview = (res: Response) => {
    if (!dependencies.review)
      res.status(503).json({ code: "review_unavailable" });
    return dependencies.review;
  };
  const summarizeRun = async (runId: string) => {
    const run = await dependencies.store.summarize(runId);
    if (!dependencies.review) return run;
    return {
      ...run,
      ...(await dependencies.review.workflow.summarize(runId)),
      applyEnabled: process.env.ACT_MIGRATION_APPLY_ENABLED === "true",
    };
  };
  const ownedSource = async (
    runId: string,
    sourceRecordId: string,
    context: { sourceDatabaseKey: string; requestedBy: string },
    review: NonNullable<ActReplacementRouteDependencies["review"]>,
  ) => {
    const owned = await dependencies.store.findOwnedRun({ runId, ...context });
    if (!owned) return false;
    const manifest = await review.reader.getManifest(runId);
    return Boolean(
      manifest?.outcomes.some(
        (outcome) => outcome.sourceRecordId === sourceRecordId,
      ),
    );
  };

  router.post("/migration/act-replacement/runs", async (req, res) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      invalidRequest(res);
      return;
    }
    const context = serverContext(dependencies, res);
    if (!context) return;
    try {
      const result = await dependencies.store.createRun({
        ...parsed.data,
        ...context,
      });
      const owned = await dependencies.store.findOwnedRun({
        runId: result.runId,
        ...context,
      });
      if (!owned) {
        res.status(409).json({ code: "run_conflict" });
        return;
      }
      const run = await summarizeRun(owned.runId);
      res.status(result.created ? 201 : 200).json({
        created: result.created,
        run,
      });
    } catch (error) {
      handleRouteError(error, res);
    }
  });

  router.get("/migration/act-replacement/runs/latest", async (req, res) => {
    const context = serverContext(dependencies, res);
    if (!context) return;
    try {
      const owned = await dependencies.store.findLatestOwnedRun(context);
      if (!owned) {
        res.json({ run: null });
        return;
      }
      res.json({ run: await summarizeRun(owned.runId) });
    } catch (error) {
      handleRouteError(error, res);
    }
  });

  router.get("/migration/act-replacement/runs/:runId", async (req, res) => {
    const runId = runIdSchema.safeParse(req.params.runId);
    if (!runId.success) {
      runNotFound(res);
      return;
    }
    const context = serverContext(dependencies, res);
    if (!context) return;
    try {
      const owned = await dependencies.store.findOwnedRun({
        runId: runId.data,
        ...context,
      });
      if (!owned) {
        runNotFound(res);
        return;
      }
      res.json({ run: await summarizeRun(owned.runId) });
    } catch (error) {
      handleRouteError(error, res);
    }
  });

  router.get(
    "/migration/act-replacement/runs/:runId/request-audit",
    async (req, res) => {
      const runId = runIdSchema.safeParse(req.params.runId);
      if (!runId.success) {
        runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) {
          runNotFound(res);
          return;
        }
        const audits = await dependencies.store.listRequestAudits({
          runId: owned.runId,
          ...context,
        });
        res.json({ audits: audits.map(safeAuditRecord) });
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );

  router.post(
    "/migration/act-replacement/runs/:runId/resume",
    async (req, res) => {
      if (!emptyBodySchema.safeParse(req.body ?? {}).success) {
        invalidRequest(res);
        return;
      }
      const runId = runIdSchema.safeParse(req.params.runId);
      if (!runId.success) {
        runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) {
          runNotFound(res);
          return;
        }
        const run = await summarizeRun(owned.runId);
        if (!run.canResume) {
          res.status(409).json({ code: "run_not_resumable" });
          return;
        }
        await dependencies.store.resumeRun?.({
          runId: owned.runId,
          now: dependencies.now(),
        });
        res.json({ run });
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );

  router.post(
    "/migration/act-replacement/runs/:runId/organize",
    async (req, res) => {
      if (!organizeSchema.safeParse(req.body ?? {}).success) {
        invalidRequest(res);
        return;
      }
      const runId = runIdSchema.safeParse(req.params.runId);
      const review = requireReview(res);
      if (!runId.success || !review) {
        if (!runId.success) runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) return runNotFound(res);
        const result = await review.commands.startOrganize(owned.runId);
        res.status(202).json(result);
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );

  router.get(
    "/migration/act-replacement/runs/:runId/manifest",
    async (req, res) => {
      const runId = runIdSchema.safeParse(req.params.runId);
      const review = requireReview(res);
      if (!runId.success || !review) {
        if (!runId.success) runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) return runNotFound(res);
        const manifest = await review.reader.getManifest(owned.runId);
        if (!manifest)
          return res.status(404).json({ code: "manifest_not_found" });
        res.json({ manifest: safeManifestProjection(manifest) });
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );

  router.get(
    "/migration/act-replacement/runs/:runId/review",
    async (req, res) => {
      const runId = runIdSchema.safeParse(req.params.runId);
      const review = requireReview(res);
      if (!runId.success || !review) {
        if (!runId.success) runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      const pageSize = Number(req.query.pageSize ?? 50);
      const page = Number(req.query.page ?? 1);
      const filters = reviewFiltersSchema.safeParse({
        state: req.query.state,
        issue: req.query.issue,
      });
      if (
        ![25, 50, 100, 200].includes(pageSize) ||
        !Number.isInteger(page) ||
        page < 1 ||
        !filters.success
      )
        return invalidRequest(res);
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) return runNotFound(res);
        const result = await readReview(review.reader, {
          runId: owned.runId,
          page,
          pageSize,
          search:
            typeof req.query.search === "string" ? req.query.search : undefined,
          state: filters.data.state,
          issue: filters.data.issue,
        });
        res.json(safeReviewPage(result));
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );

  router.post(
    "/migration/act-replacement/runs/:runId/approvals",
    async (req, res) => {
      const runId = runIdSchema.safeParse(req.params.runId);
      const review = requireReview(res);
      if (!runId.success || !review) {
        if (!runId.success) runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      const body = approvalSchema.safeParse(req.body);
      if (!body.success) return invalidRequest(res);
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) return runNotFound(res);
        res.json(
          safeApproval(
            await review.commands.approve({
              runId: owned.runId,
              operationIds: body.data.operationIds,
              expectedManifestDigest: body.data.expectedManifestDigest,
              requestKey: body.data.requestKey,
              requestedBy: context.requestedBy,
            }),
          ),
        );
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );
  router.post(
    "/migration/act-replacement/runs/:runId/approvals/safe-defaults",
    async (req, res) => {
      const runId = runIdSchema.safeParse(req.params.runId);
      const review = requireReview(res);
      if (!runId.success || !review) {
        if (!runId.success) runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      const body = safeApprovalSchema.safeParse(req.body);
      if (!body.success) return invalidRequest(res);
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) return runNotFound(res);
        res.json(
          safeAutomaticApproval(
            await review.commands.approveSafeDefaults({
              runId: owned.runId,
              expectedManifestDigest: body.data.expectedManifestDigest,
              requestKey: body.data.requestKey,
              requestedBy: context.requestedBy,
            }),
          ),
        );
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );
  router.post(
    "/migration/act-replacement/runs/:runId/approvals/ready",
    async (req, res) => {
      const runId = runIdSchema.safeParse(req.params.runId);
      const review = requireReview(res);
      if (!runId.success || !review) {
        if (!runId.success) runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      const body = safeApprovalSchema.safeParse(req.body);
      if (!body.success) return invalidRequest(res);
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) return runNotFound(res);
        res.json(
          safeApproval(
            await review.commands.approveReady({
              runId: owned.runId,
              expectedManifestDigest: body.data.expectedManifestDigest,
              requestKey: body.data.requestKey,
              requestedBy: context.requestedBy,
            }),
          ),
        );
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );
  router.post(
    "/migration/act-replacement/runs/:runId/decisions/bulk",
    async (req, res) => {
      const runId = runIdSchema.safeParse(req.params.runId);
      const review = requireReview(res);
      if (!runId.success || !review) {
        if (!runId.success) runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      const body = bulkDecisionSchema.safeParse(req.body);
      if (!body.success) return invalidRequest(res);
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) return runNotFound(res);
        res.status(201).json(
          await review.commands.bulkDecide({
            runId: owned.runId,
            ...body.data,
            requestedBy: context.requestedBy,
          }),
        );
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );
  router.post(
    "/migration/act-replacement/runs/:runId/apply-next",
    async (req, res) => {
      const parsed = applyNextSchema.safeParse(req.body);
      if (!parsed.success) {
        const oversized =
          typeof req.body?.batchSize === "number" && req.body.batchSize > 25;
        res.status(400).json({
          code: oversized ? "invalid_apply_batch_size" : "invalid_request",
        });
        return;
      }
      const runId = runIdSchema.safeParse(req.params.runId);
      const review = requireReview(res);
      if (!runId.success || !review) {
        if (!runId.success) runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) return runNotFound(res);
        if (process.env.ACT_MIGRATION_APPLY_ENABLED !== "true")
          return res
            .status(403)
            .json({ code: "act_apply_disabled", previewOnly: true });
        res.json(
          await review.applyCoordinator.applyNext({
            runId: owned.runId,
            ...parsed.data,
            requestedBy: context.requestedBy,
          }),
        );
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );
  router.post(
    "/migration/act-replacement/runs/:runId/apply",
    async (req, res) => {
      const runId = runIdSchema.safeParse(req.params.runId);
      const review = requireReview(res);
      if (!runId.success || !review) {
        if (!runId.success) runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) return runNotFound(res);
        if (process.env.ACT_MIGRATION_APPLY_ENABLED !== "true")
          return res
            .status(403)
            .json({ code: "act_apply_disabled", previewOnly: true });
        res.status(410).json({ code: "apply_next_required" });
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );
  router.get(
    "/migration/act-replacement/runs/:runId/unassigned",
    async (req, res) => {
      const runId = runIdSchema.safeParse(req.params.runId);
      const review = requireReview(res);
      if (!runId.success || !review) {
        if (!runId.success) runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) return runNotFound(res);
        res.json(
          safeReviewPage(
            await readReview(review.reader, {
              runId: owned.runId,
              state: "unassigned",
              page: 1,
              pageSize: 200,
            }),
          ),
        );
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );
  router.get(
    "/migration/act-replacement/runs/:runId/issues",
    async (req, res) => {
      const runId = runIdSchema.safeParse(req.params.runId);
      const review = requireReview(res);
      if (!runId.success || !review) {
        if (!runId.success) runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      const filters = reviewFiltersSchema.safeParse({ issue: req.query.issue });
      if (!filters.success) return invalidRequest(res);
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) return runNotFound(res);
        res.json(
          safeReviewPage(
            await readReview(review.reader, {
              runId: owned.runId,
              issue: filters.data.issue,
              page: 1,
              pageSize: 200,
            }),
          ),
        );
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );
  router.get(
    "/migration/act-replacement/source-records/:sourceRecordId",
    async (req, res) => {
      const review = requireReview(res);
      if (!review) return;
      const context = serverContext(dependencies, res);
      if (!context) return;
      const params = sourceRecordParamsSchema.safeParse(req.params);
      const query = sourceRecordQuerySchema.safeParse(req.query);
      if (!params.success || !query.success) return invalidRequest(res);
      try {
        if (
          !(await ownedSource(
            query.data.runId,
            params.data.sourceRecordId,
            context,
            review,
          ))
        )
          return runNotFound(res);
        const source = await review.reader.getSource?.(
          params.data.sourceRecordId,
        );
        if (!source) return res.status(404).json({ code: "source_not_found" });
        const safe = safeSource(source);
        res.json({
          source: {
            ...safe,
            display: projectActReviewDisplay(source.streamType, safe.display),
          },
          assignments: await review.commands.assignments(source.sourceRecordId),
          decisions: await review.commands.decisions(source.sourceRecordId),
        });
      } catch (error) {
        handleRouteError(error, res);
        return;
      }
      return;
    },
  );
  router.get(
    "/migration/act-replacement/assignment-targets",
    async (req, res) => {
      const review = requireReview(res);
      if (!review) return;
      const context = serverContext(dependencies, res);
      if (!context) return;
      try {
        const rows =
          (await review.assignmentTargets?.({
            search:
              typeof req.query.search === "string"
                ? req.query.search
                : undefined,
            entityType:
              typeof req.query.entityType === "string"
                ? req.query.entityType
                : undefined,
            entityTypes:
              typeof req.query.entityTypes === "string"
                ? req.query.entityTypes.split(",").map((value) => value.trim()).filter(Boolean).slice(0, 3)
                : undefined,
          })) ?? [];
        res.json({ targets: rows });
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );
  router.post(
    "/migration/act-replacement/source-records/:sourceRecordId/assignments",
    async (req, res) => {
      const review = requireReview(res);
      if (!review) return;
      const context = serverContext(dependencies, res);
      if (!context) return;
      const params = sourceRecordParamsSchema.safeParse(req.params);
      const body = assignmentBodySchema.safeParse(req.body);
      if (!params.success || !body.success) return invalidRequest(res);
      try {
        if (
          !(await ownedSource(
            body.data.runId,
            params.data.sourceRecordId,
            context,
            review,
          ))
        )
          return runNotFound(res);
        res.status(201).json(
          await review.commands.assign({
            ...body.data,
            sourceRecordId: params.data.sourceRecordId,
            assignedBy: context.requestedBy,
          }),
        );
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );
  router.delete(
    "/migration/act-replacement/source-records/:sourceRecordId/assignments/:assignmentId",
    async (req, res) => {
      const review = requireReview(res);
      if (!review) return;
      const context = serverContext(dependencies, res);
      if (!context) return;
      const params = assignmentParamsSchema.safeParse(req.params);
      const body = removeAssignmentBodySchema.safeParse(req.body);
      if (!params.success || !body.success) return invalidRequest(res);
      try {
        if (
          !(await ownedSource(
            body.data.runId,
            params.data.sourceRecordId,
            context,
            review,
          ))
        )
          return runNotFound(res);
        res.json(
          await review.commands.removeAssignment({
            runId: body.data.runId,
            sourceRecordId: params.data.sourceRecordId,
            assignmentId: params.data.assignmentId,
            actor: context.requestedBy,
            expectedSourceVersionId: body.data.expectedSourceVersionId,
            requestKey: body.data.requestKey,
          }),
        );
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );
  router.post(
    "/migration/act-replacement/source-records/:sourceRecordId/decisions",
    async (req, res) => {
      const review = requireReview(res);
      if (!review) return;
      const context = serverContext(dependencies, res);
      if (!context) return;
      const params = sourceRecordParamsSchema.safeParse(req.params);
      const body = individualDecisionBodySchema.safeParse(req.body);
      if (!params.success || !body.success) return invalidRequest(res);
      try {
        if (
          !(await ownedSource(
            body.data.runId,
            params.data.sourceRecordId,
            context,
            review,
          ))
        )
          return runNotFound(res);
        res.status(201).json(
          await review.commands.decide({
            ...body.data,
            sourceRecordId: params.data.sourceRecordId,
            decidedBy: context.requestedBy,
          }),
        );
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );
  router.delete(
    "/migration/act-replacement/source-records/:sourceRecordId/decisions/:decisionId",
    async (req, res) => {
      const review = requireReview(res);
      if (!review) return;
      const context = serverContext(dependencies, res);
      if (!context) return;
      const params = decisionParamsSchema.safeParse(req.params);
      const body = removeDecisionBodySchema.safeParse(req.body);
      if (!params.success || !body.success) return invalidRequest(res);
      try {
        if (
          !(await ownedSource(
            body.data.runId,
            params.data.sourceRecordId,
            context,
            review,
          ))
        )
          return runNotFound(res);
        res.json(
          await review.commands.removeDecision({
            runId: body.data.runId,
            sourceRecordId: params.data.sourceRecordId,
            decisionId: params.data.decisionId,
            actor: context.requestedBy,
            requestKey: body.data.requestKey,
          }),
        );
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );

  router.post(
    "/migration/act-replacement/runs/:runId/supersede",
    async (req, res) => {
      if (!supersedeSchema.safeParse(req.body).success) {
        invalidRequest(res);
        return;
      }
      const runId = runIdSchema.safeParse(req.params.runId);
      if (!runId.success) {
        runNotFound(res);
        return;
      }
      const context = serverContext(dependencies, res);
      if (!context) return;
      try {
        const owned = await dependencies.store.findOwnedRun({
          runId: runId.data,
          ...context,
        });
        if (!owned) {
          runNotFound(res);
          return;
        }
        await dependencies.store.supersedeRun({
          runId: owned.runId,
          requestedBy: context.requestedBy,
          now: dependencies.now(),
        });
        res.json({ run: await summarizeRun(owned.runId) });
      } catch (error) {
        handleRouteError(error, res);
      }
    },
  );

  return router;
}

export default createActReplacementRouter(productionDependencies);
