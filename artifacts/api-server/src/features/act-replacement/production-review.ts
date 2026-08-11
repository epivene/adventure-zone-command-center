import type { ActApplyService } from "./apply-service";
import { ActApplyCoordinator } from "./apply-coordinator";
import {
  DrizzleActReviewCommandStore,
  DrizzleActReviewReader,
} from "./review-sql-adapter";
import { ReviewCommandService } from "./review-command-service";
import type { ReviewCommandStore } from "./review-command-service";
import type { ReviewReader } from "./review-reader";
import { createDrizzleApplyRepository } from "./drizzle-apply-repository";
import { ActApplyService as ApplyService } from "./apply-service";
import {
  isAutomaticallyApprovedOperation,
  readAutomaticReviewProofForOperation,
} from "./automatic-review-policy";
import type { ImportWorkflow } from "./import-types";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  actReplacementApplyBatches,
  actReplacementApplyOperations,
  actReplacementCheckpoints,
  actReplacementOutcomes,
  actReplacementRuns,
} from "@workspace/db/schema";
import type { db as database } from "@/db/client";

type Scope = { sourceDatabaseKey: string; requestedBy: string };
type ScopeProvider = Scope | (() => Scope);
type DrizzleDatabase = typeof database;

type WorkflowReader = {
  summarize(runId: string): Promise<ImportWorkflow>;
};

export const workflowOutcomeSelection = {
  sourceRecordId: actReplacementOutcomes.sourceRecordId,
  state: actReplacementOutcomes.state,
  leaseExpiresAt: actReplacementOutcomes.leaseExpiresAt,
};

export type ImportWorkflowProjectionInput = {
  phase: string;
  organizerLeaseExpiresAt?: Date | null;
  summary: Record<string, unknown> | null | undefined;
  outcomes: readonly {
    sourceRecordId: string;
    state: string;
    match?: unknown;
  }[];
  operations: readonly {
    operationKey: string;
    sourceRecordId: string;
    action: string;
    dependencyOperationKeys: readonly string[];
    safeByDefault: boolean;
    status: string;
    sourceVersionId?: string | null;
    targetType: string;
    requiredForSourceOutcome?: boolean;
    leaseExpiresAt?: Date | null;
    automaticReview?: unknown;
    payload?: unknown;
  }[];
  batches: readonly {
    id?: string;
    requestKey: string;
    approvalRequestKey?: string | null;
    startCursor?: number | null;
    manifestDigest: string;
    operationIds: unknown;
    state: string;
    leaseExpiresAt?: Date | null;
    createdAt?: Date;
  }[];
  requiredStreams?: readonly string[];
  leases?: readonly { state: string; leaseExpiresAt?: Date | null }[];
  now?: Date;
  actionableDiagnosticCount?: number;
};

export function projectImportWorkflow(
  input: ImportWorkflowProjectionInput,
): ImportWorkflow {
  type ProjectionOperation = ImportWorkflowProjectionInput["operations"][number];
  const operationsBySourceId = new Map<string, ProjectionOperation[]>();
  for (const operation of input.operations) {
    const sourceOperations = operationsBySourceId.get(operation.sourceRecordId);
    if (sourceOperations) sourceOperations.push(operation);
    else operationsBySourceId.set(operation.sourceRecordId, [operation]);
  }
  const operationByKey = new Map(
    input.operations.map((operation) => [operation.operationKey, operation]),
  );
  const safeOperationKeys = new Set<string>();
  const collectSafeClosure = (
    operationKey: string,
    trail: ReadonlySet<string>,
    closure: Set<string>,
  ): boolean => {
    const operation = operationByKey.get(operationKey);
    if (
      !operation ||
      trail.has(operationKey)
    ) {
      return false;
    }
    if (
      operation.status === "applied" ||
      operation.status === "already_present"
    ) {
      return true;
    }
    if (!isAutomaticallyApprovedOperation(operation)) return false;
    if (closure.has(operationKey)) return true;
    const nextTrail = new Set(trail).add(operationKey);
    for (const dependency of operation.dependencyOperationKeys) {
      if (!collectSafeClosure(dependency, nextTrail, closure)) return false;
    }
    closure.add(operationKey);
    return true;
  };
  for (const operation of input.operations.filter(
    (candidate) =>
      candidate.status === "pending" || candidate.status === "failed",
  )) {
    const closure = new Set<string>();
    if (collectSafeClosure(operation.operationKey, new Set(), closure)) {
      for (const operationKey of closure) safeOperationKeys.add(operationKey);
    }
  }

  const dispositions = input.outcomes.map((outcome) => {
    if (outcome.state === "failed") {
      return { sourceRecordId: outcome.sourceRecordId, disposition: "failed" as const };
    }
    const sourceOperations = operationsBySourceId.get(outcome.sourceRecordId) ?? [];
    const proofs = sourceOperations.map((operation) =>
      readAutomaticReviewProofForOperation(operation),
    );
    const sourceDispositions = new Set(
      proofs.flatMap((proof) => proof ? [proof.disposition] : []),
    );
    let disposition =
      sourceOperations.length > 0 &&
      proofs.every(Boolean) &&
      sourceDispositions.size === 1
        ? [...sourceDispositions][0]!
        : "archived_only";
    const hasTerminalOperation = sourceOperations.some(
      (operation) =>
        operation.status === "applied" || operation.status === "already_present",
    );
    if (hasTerminalOperation && disposition === "archived_only") {
      disposition = "safe_ready";
    }
    const hasNonterminalOperation = sourceOperations.some(
      (operation) =>
        operation.status !== "applied" &&
        operation.status !== "already_present",
    );
    const hasSafeClosure = sourceOperations.some((operation) =>
      safeOperationKeys.has(operation.operationKey),
    );
    if (
      !hasTerminalOperation &&
      hasNonterminalOperation &&
      !hasSafeClosure &&
      (disposition === "safe_ready" || disposition === "auto_resolved")
    ) disposition = "archived_only";
    return { sourceRecordId: outcome.sourceRecordId, disposition };
  });
  const safeOperationCount = safeOperationKeys.size;
  const autoResolvedCount = dispositions.filter(
    ({ disposition }) => disposition === "auto_resolved",
  ).length;
  const archivedOnlyCount = dispositions.filter(
    ({ disposition }) => disposition === "archived_only",
  ).length;
  const reviewRequiredCount = 0;
  const summaryDigest = input.summary?.manifestDigest;
  const manifestDigest =
    typeof summaryDigest === "string" &&
    /^[a-f0-9]{64}$/.test(summaryDigest) &&
    input.batches.every(
      (batch) =>
        batch.manifestDigest === summaryDigest ||
        batch.state === "complete" ||
        batch.state === "complete_with_issues",
    )
      ? summaryDigest
      : null;
  const terminalOperationKeys = new Set<string>(
    input.batches
      .filter(
        (batch) =>
          batch.state === "complete" || batch.state === "complete_with_issues",
      )
      .flatMap((batch) =>
        Array.isArray(batch.operationIds)
          ? batch.operationIds.filter(
              (operationKey): operationKey is string =>
                typeof operationKey === "string",
            )
          : [],
      ),
  );
  let nextApplyCursor = 0;
  if (manifestDigest) {
    const cursorFor = (
      batch: ImportWorkflowProjectionInput["batches"][number],
    ) =>
      batch.startCursor ??
      Number(/:(\d+)$/.exec(batch.requestKey)?.[1] ?? Number.NaN);
    const successful = [...input.batches]
      .filter(
        (batch) =>
          batch.manifestDigest === manifestDigest &&
          batch.state === "complete" &&
          Number.isInteger(cursorFor(batch)) &&
          Array.isArray(batch.operationIds),
      )
      .sort(
        (a, b) =>
          cursorFor(a) - cursorFor(b) ||
          a.requestKey.localeCompare(b.requestKey),
      );
    for (;;) {
      const batch = successful.find(
        (candidate) => cursorFor(candidate) === nextApplyCursor,
      );
      if (
        !batch ||
        !Array.isArray(batch.operationIds) ||
        batch.operationIds.length === 0
      )
        break;
      for (const operationKey of batch.operationIds)
        if (typeof operationKey === "string")
          terminalOperationKeys.add(operationKey);
      nextApplyCursor += batch.operationIds.length;
    }
  }

  const now = input.now ?? new Date();
  const organizerLeaseExpired =
    input.phase === "organizing" &&
    (!input.organizerLeaseExpiresAt ||
      input.organizerLeaseExpiresAt.getTime() <= now.getTime());
  const leases = [
    ...(input.leases ?? []),
    ...(input.phase === "organizing" && input.organizerLeaseExpiresAt
      ? [{ state: "organizing", leaseExpiresAt: input.organizerLeaseExpiresAt }]
      : []),
    ...input.operations
      .filter((operation) => operation.status === "leased")
      .map((operation) => ({
        state: operation.status,
        leaseExpiresAt: operation.leaseExpiresAt,
      })),
    ...input.batches
      .filter((batch) => batch.state === "applying")
      .map((batch) => ({
        state: batch.state,
        leaseExpiresAt: batch.leaseExpiresAt,
      })),
  ];
  const leaseSummary = leases.reduce(
    (counts, lease) => {
      if (
        lease.leaseExpiresAt &&
        lease.leaseExpiresAt.getTime() <= now.getTime()
      )
        counts.expired += 1;
      else counts.active += 1;
      return counts;
    },
    { active: 0, expired: 0 },
  );
  const archivedOnlySourceIds = new Set(
    dispositions
      .filter(({ disposition }) => disposition === "archived_only")
      .map(({ sourceRecordId }) => sourceRecordId),
  );
  const canRebuildUnapplied =
    input.phase === "ready_to_apply" &&
    input.batches.length === 0 &&
    input.operations.every((operation) => operation.status === "pending");

  return {
    safeOperationCount,
    autoResolvedCount,
    archivedOnlyCount,
    reviewRequiredCount,
    appliedOperationCount: input.operations.filter(
      (operation) => operation.status === "applied",
    ).length,
    alreadyPresentOperationCount: input.operations.filter(
      (operation) =>
        operation.status === "already_present" &&
        terminalOperationKeys.has(operation.operationKey),
    ).length,
    blockedOperationCount: input.operations.filter(
      (operation) => operation.status === "blocked",
    ).length,
    failedOperationCount: input.operations.filter(
      (operation) => operation.status === "failed",
    ).length,
    manifestDigest,
    nextApplyCursor,
    canOrganize:
      input.phase === "extract_complete" ||
      organizerLeaseExpired ||
      canRebuildUnapplied,
    canReview:
      (archivedOnlyCount > 0 || (input.actionableDiagnosticCount ?? 0) > 0) &&
      (canRebuildUnapplied ||
        input.phase === "ready_to_apply" ||
        input.phase === "applying" ||
        input.phase === "complete" ||
        input.phase === "complete_with_issues"),
    canApplySafe:
      manifestDigest !== null &&
      safeOperationCount > 0 &&
      (input.phase === "ready_to_apply" ||
        input.phase === "applying" ||
        input.phase === "complete_with_issues"),
    requiredStreams: input.requiredStreams?.length
      ? [...new Set(input.requiredStreams)].sort()
      : [
          "company",
          "contact",
          "opportunity",
          "group",
          "activity",
          "note",
          "history",
        ],
    leaseSummary,
    operations: input.operations.map((operation) => ({
      operationKey: operation.operationKey,
      sourceVersionId: operation.sourceVersionId ?? null,
      targetType: operation.targetType ?? "",
      status:
        operation.status as ImportWorkflow["operations"][number]["status"],
      requiredForSourceOutcome: operation.requiredForSourceOutcome === true,
      heldForReview: archivedOnlySourceIds.has(operation.sourceRecordId),
      dependencyOperationKeys: [...operation.dependencyOperationKeys],
      safeByDefault: operation.safeByDefault,
    })),
    applyBatches: [...input.batches]
      .sort(
        (a, b) =>
          (a.startCursor ?? Number.MAX_SAFE_INTEGER) -
            (b.startCursor ?? Number.MAX_SAFE_INTEGER) ||
          (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
          (a.id ?? a.requestKey).localeCompare(b.id ?? b.requestKey),
      )
      .map((batch) => ({ state: batch.state })),
    durableAdapters: {
      reviewReader: true,
      commandService: true,
      applyRepository: true,
    },
  };
}

class DrizzleWorkflowReader implements WorkflowReader {
  constructor(
    private readonly database: DrizzleDatabase,
    private readonly scope: Scope,
  ) {}

  async summarize(runId: string): Promise<ImportWorkflow> {
    const [run] = await this.database
      .select({
        phase: actReplacementRuns.phase,
        summary: actReplacementRuns.summary,
        organizerLeaseExpiresAt: actReplacementRuns.organizerLeaseExpiresAt,
      })
      .from(actReplacementRuns)
      .where(
        and(
          eq(actReplacementRuns.id, runId),
          eq(
            actReplacementRuns.sourceDatabaseKey,
            this.scope.sourceDatabaseKey,
          ),
          eq(actReplacementRuns.requestedBy, this.scope.requestedBy),
        ),
      )
      .limit(1);
    if (!run) {
      throw Object.assign(new Error("run_not_found"), {
        code: "run_not_found",
        status: 404,
      });
    }

    const [outcomes, operations, batches, checkpoints, diagnosticRows] = await Promise.all([
      this.database
        .select(workflowOutcomeSelection)
        .from(actReplacementOutcomes)
        .where(eq(actReplacementOutcomes.runId, runId)),
      this.database
        .select({
          operationKey: actReplacementApplyOperations.operationKey,
          sourceRecordId: actReplacementApplyOperations.sourceRecordId,
          action: actReplacementApplyOperations.action,
          dependencyOperationKeys:
            actReplacementApplyOperations.dependencyOperationKeys,
          safeByDefault: actReplacementApplyOperations.safeByDefault,
          status: actReplacementApplyOperations.status,
          sourceVersionId: actReplacementApplyOperations.sourceVersionId,
          targetType: actReplacementApplyOperations.targetType,
          requiredForSourceOutcome:
            actReplacementApplyOperations.requiredForSourceOutcome,
          leaseExpiresAt: actReplacementApplyOperations.leaseExpiresAt,
          automaticReview: sql<unknown>`jsonb_build_object(
            'version', case when ${actReplacementApplyOperations.payload} #>> '{automaticReview,version}' = '1' then 1 else null end,
            'eligible', case
              when ${actReplacementApplyOperations.payload} #>> '{automaticReview,eligible}' = 'true' then true
              when ${actReplacementApplyOperations.payload} #>> '{automaticReview,eligible}' = 'false' then false
              else null
            end,
            'disposition', case
              when ${actReplacementApplyOperations.payload} #>> '{automaticReview,disposition}' in ('auto_resolved','safe_ready','archived_only','failed')
                then ${actReplacementApplyOperations.payload} #>> '{automaticReview,disposition}'
              else null
            end,
            'basis', case
              when ${actReplacementApplyOperations.payload} #>> '{automaticReview,basis}' in ('safe_create','trusted_exact_match','proven_context_match','dependency_closed_relationship','dependency_closed_provenance','not_automatically_safe')
                then ${actReplacementApplyOperations.payload} #>> '{automaticReview,basis}'
              else null
            end
          )`,
        })
        .from(actReplacementApplyOperations)
        .where(eq(actReplacementApplyOperations.runId, runId)),
      this.database
        .select({
          id: actReplacementApplyBatches.id,
          requestKey: actReplacementApplyBatches.requestKey,
          approvalRequestKey: actReplacementApplyBatches.approvalRequestKey,
          startCursor: actReplacementApplyBatches.startCursor,
          manifestDigest: actReplacementApplyBatches.manifestDigest,
          operationIds: actReplacementApplyBatches.dependencyClosedOperationIds,
          state: actReplacementApplyBatches.state,
          leaseExpiresAt: actReplacementApplyBatches.leaseExpiresAt,
          createdAt: actReplacementApplyBatches.createdAt,
        })
        .from(actReplacementApplyBatches)
        .where(eq(actReplacementApplyBatches.runId, runId))
        .orderBy(
          asc(actReplacementApplyBatches.startCursor),
          asc(actReplacementApplyBatches.createdAt),
          asc(actReplacementApplyBatches.id),
        ),
      this.database
        .select({
          streamType: actReplacementCheckpoints.streamType,
          requiredness: actReplacementCheckpoints.requiredness,
          state: actReplacementCheckpoints.state,
          leaseExpiresAt: actReplacementCheckpoints.leaseExpiresAt,
        })
        .from(actReplacementCheckpoints)
        .where(eq(actReplacementCheckpoints.runId, runId)),
      this.database
        .select({
          count: sql<number>`count(*) filter (where exists (
            select 1
            from jsonb_array_elements(coalesce(${actReplacementOutcomes.issues}, '[]'::jsonb)) issue(value)
            where issue.value->>'code' in ('field_conflict', 'relationship_unresolved', 'unassigned', 'ambiguous_match')
          ))::int`,
        })
        .from(actReplacementOutcomes)
        .where(eq(actReplacementOutcomes.runId, runId)),
    ]);

    return projectImportWorkflow({
      phase: run.phase,
      summary: run.summary,
      organizerLeaseExpiresAt: run.organizerLeaseExpiresAt,
      outcomes,
      operations,
      batches,
      requiredStreams: checkpoints
        .filter((checkpoint) => checkpoint.requiredness === "required")
        .map((checkpoint) => checkpoint.streamType),
      leases: [
        ...outcomes.filter((outcome) => outcome.state === "leased"),
        ...checkpoints.filter((checkpoint) => checkpoint.state === "leased"),
      ],
      actionableDiagnosticCount: Number(diagnosticRows[0]?.count ?? 0),
      now: new Date(),
    });
  }
}

/**
 * Production review wiring is lazy so importing the Express router does not
 * require DATABASE_URL (important for route tests and preview-only builds).
 * The apply service is constructed for approval/replay support, but the route
 * still enforces ACT_MIGRATION_APPLY_ENABLED before any write operation.
 */
class LazyReviewRuntime {
  private readonly runtimes = new Map<
    string,
    Promise<{
      reader: ReviewReader;
      commands: ReviewCommandService;
      applyCoordinator: ActApplyCoordinator;
      workflow: WorkflowReader;
    }>
  >();

  private runtime(scope: Scope) {
    const key = `${scope.sourceDatabaseKey}\u0000${scope.requestedBy}`;
    let current = this.runtimes.get(key);
    if (!current) {
      current = import("@/db/client").then(({ db }) => {
        const reader = new DrizzleActReviewReader(db, scope);
        const applyRepository = createDrizzleApplyRepository(db, {
          manifestDigest: async (runId) =>
            (await reader.getManifest(runId))?.digest ?? null,
        });
        const applyService: ActApplyService = new ApplyService(
          applyRepository,
          process.env.ACT_MIGRATION_APPLY_ENABLED === "true",
        );
        const store: ReviewCommandStore = new DrizzleActReviewCommandStore(
          db,
          scope,
          applyService,
        );
        return {
          reader,
          commands: new ReviewCommandService(store),
          applyCoordinator: new ActApplyCoordinator(
            applyService,
            applyRepository,
          ),
          workflow: new DrizzleWorkflowReader(db, scope),
        };
      });
      this.runtimes.set(key, current);
    }
    return current;
  }

  reader(scopeProvider: ScopeProvider): ReviewReader {
    const scope = () =>
      typeof scopeProvider === "function" ? scopeProvider() : scopeProvider;
    return {
      getManifest: (runId) =>
        this.runtime(scope()).then((runtime) =>
          runtime.reader.getManifest(runId),
        ),
      listSources: (runId) =>
        this.runtime(scope()).then((runtime) =>
          runtime.reader.listSources(runId),
        ),
      getSource: (sourceRecordId) =>
        this.runtime(scope()).then(
          (runtime) => runtime.reader.getSource?.(sourceRecordId) ?? null,
        ),
      readReviewPage: (input) =>
        this.runtime(scope()).then((runtime) => {
          if (!runtime.reader.readReviewPage)
            throw new Error("bounded_review_reader_unavailable");
          return runtime.reader.readReviewPage(input);
        }),
      listAssignmentTargets: (query) =>
        this.runtime(scope()).then(
          (runtime) => runtime.reader.listAssignmentTargets?.(query) ?? [],
        ),
    };
  }

  assignmentTargets(scopeProvider: ScopeProvider) {
    const scope = () =>
      typeof scopeProvider === "function" ? scopeProvider() : scopeProvider;
    return (query: { search?: string; entityType?: string; entityTypes?: string[] }) =>
      this.runtime(scope()).then(
        (runtime) => runtime.reader.listAssignmentTargets?.(query) ?? [],
      );
  }

  commands(scopeProvider: ScopeProvider): ReviewCommandService {
    const scope = () =>
      typeof scopeProvider === "function" ? scopeProvider() : scopeProvider;
    // The route only calls methods after a configured database is available.
    // A proxy preserves the existing service type while keeping DB creation lazy.
    return new Proxy(
      Object.create(ReviewCommandService.prototype) as ReviewCommandService,
      {
        get: (_target, property) => {
          if (typeof property !== "string") return undefined;
          return (...args: unknown[]) =>
            this.runtime(scope()).then((runtime) => {
              const method = (
                runtime.commands as unknown as Record<string, unknown>
              )[property];
              if (typeof method !== "function") return method;
              return (method as (...values: unknown[]) => unknown).apply(
                runtime.commands,
                args,
              );
            });
        },
      },
    );
  }

  applyCoordinator(
    scopeProvider: ScopeProvider,
  ): Pick<ActApplyCoordinator, "applyNext"> {
    const scope = () =>
      typeof scopeProvider === "function" ? scopeProvider() : scopeProvider;
    return {
      applyNext: (input) =>
        this.runtime(scope()).then((runtime) =>
          runtime.applyCoordinator.applyNext(input),
        ),
    };
  }

  workflow(scopeProvider: ScopeProvider): WorkflowReader {
    const scope = () =>
      typeof scopeProvider === "function" ? scopeProvider() : scopeProvider;
    return {
      summarize: (runId) =>
        this.runtime(scope()).then((runtime) =>
          runtime.workflow.summarize(runId),
        ),
    };
  }
}

const lazy = new LazyReviewRuntime();

export function createProductionReview(scope: ScopeProvider) {
  return {
    reader: lazy.reader(scope),
    assignmentTargets: lazy.assignmentTargets(scope),
    commands: lazy.commands(scope),
    applyCoordinator: lazy.applyCoordinator(scope),
    workflow: lazy.workflow(scope),
  };
}
