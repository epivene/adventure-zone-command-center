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
  automaticReviewDisposition,
  isAutomaticallyImportableForOutcome,
  isAutomaticallyImportableOperation,
} from "./automatic-review-policy";
import type { ImportWorkflow } from "./import-types";
import { validateReviewedClosure } from "./reviewed-closure";
import {
  hasReviewedOverwriteProof,
  hasReviewedRelationshipProof,
} from "./review-proof";
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

const maximumProjectedMatchItems = 20;
const maximumProjectedMatchStringLength = 200;

export const boundedOutcomeMatchProjection = sql<Record<string, unknown> | null>`
  case
    when ${actReplacementOutcomes.match} is null
      or jsonb_typeof(${actReplacementOutcomes.match}) <> 'object'
      then null
    else jsonb_strip_nulls(jsonb_build_object(
      'kind', left(${actReplacementOutcomes.match}->>'kind', ${maximumProjectedMatchStringLength}),
      'localId', left(${actReplacementOutcomes.match}->>'localId', ${maximumProjectedMatchStringLength}),
      'reason', left(${actReplacementOutcomes.match}->>'reason', ${maximumProjectedMatchStringLength}),
      'evidence', case
        when jsonb_typeof(${actReplacementOutcomes.match}->'evidence') = 'array'
          then (
            select coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'family', left(proof.value->>'family', ${maximumProjectedMatchStringLength}),
                  'label', left(btrim(proof.value->>'label'), ${maximumProjectedMatchStringLength}),
                  'targetEntityType', left(proof.value->>'targetEntityType', ${maximumProjectedMatchStringLength}),
                  'targetEntityId', left(btrim(proof.value->>'targetEntityId'), ${maximumProjectedMatchStringLength}),
                  'authority', left(proof.value->>'authority', ${maximumProjectedMatchStringLength})
                ) order by proof.ordinality
              ),
              '[]'::jsonb
            )
            from jsonb_array_elements(${actReplacementOutcomes.match}->'evidence')
              with ordinality as proof(value, ordinality)
            where proof.ordinality <= ${maximumProjectedMatchItems}
              and jsonb_typeof(proof.value) = 'object'
              and proof.value->>'family' in (
                'identity', 'direct_contact', 'web_identity', 'location',
                'archive_relationship', 'event_context', 'narrative_context'
              )
              and proof.value->>'targetEntityType' in (
                'organization', 'contact', 'booking', 'calling_list', 'activity'
              )
              and proof.value->>'authority' in ('authoritative', 'supporting')
              and nullif(btrim(proof.value->>'label'), '') is not null
              and nullif(btrim(proof.value->>'targetEntityId'), '') is not null
          )
        else null
      end,
      'evidenceTruncated', case
        when ${actReplacementOutcomes.match}->>'evidenceTruncated' = 'true' then true
        when char_length(btrim(${actReplacementOutcomes.match}->>'localId')) > ${maximumProjectedMatchStringLength}
          then true
        when jsonb_typeof(${actReplacementOutcomes.match}->'evidence') = 'array'
          then case
            when jsonb_array_length(${actReplacementOutcomes.match}->'evidence') > ${maximumProjectedMatchItems}
              or exists (
                select 1
                from jsonb_array_elements(${actReplacementOutcomes.match}->'evidence') as raw_proof(value)
                where jsonb_typeof(raw_proof.value) <> 'object'
                  or coalesce(raw_proof.value->>'family', '') not in (
                    'identity', 'direct_contact', 'web_identity', 'location',
                    'archive_relationship', 'event_context', 'narrative_context'
                  )
                  or coalesce(raw_proof.value->>'targetEntityType', '') not in (
                    'organization', 'contact', 'booking', 'calling_list', 'activity'
                  )
                  or coalesce(raw_proof.value->>'authority', '') not in ('authoritative', 'supporting')
                  or nullif(btrim(raw_proof.value->>'label'), '') is null
                  or nullif(btrim(raw_proof.value->>'targetEntityId'), '') is null
                  or char_length(btrim(raw_proof.value->>'label')) > ${maximumProjectedMatchStringLength}
                  or char_length(btrim(raw_proof.value->>'targetEntityId')) > ${maximumProjectedMatchStringLength}
              )
              then true
            else null
          end
        else null
      end
    ))
  end
`;

const maximumProjectedReviewValueBytes = 16_384;

export const boundedReviewedPayloadProjection = sql<Record<string, unknown> | null>`
  case
    when ${actReplacementApplyOperations.action} not in ('overwrite_reviewed', 'create_relationship')
      or jsonb_typeof(${actReplacementApplyOperations.payload}) <> 'object'
      then null
    when coalesce(pg_column_size(${actReplacementApplyOperations.payload}->'value'), 0) > ${maximumProjectedReviewValueBytes}
      or coalesce(pg_column_size(${actReplacementApplyOperations.payload}->'proof'->'localValue'), 0) > ${maximumProjectedReviewValueBytes}
      or coalesce(pg_column_size(${actReplacementApplyOperations.payload}->'proof'->'sourceValue'), 0) > ${maximumProjectedReviewValueBytes}
      or coalesce(pg_column_size(${actReplacementApplyOperations.payload}->'decision'->'reviewedSourceValue'), 0) > ${maximumProjectedReviewValueBytes}
      or coalesce(pg_column_size(${actReplacementApplyOperations.payload}->'decision'->'reviewedLocalValue'), 0) > ${maximumProjectedReviewValueBytes}
      then null
    else jsonb_build_object(
      'entityId', left(${actReplacementApplyOperations.payload}->>'entityId', ${maximumProjectedMatchStringLength}),
      'fieldName', left(${actReplacementApplyOperations.payload}->>'fieldName', ${maximumProjectedMatchStringLength}),
      'value', ${actReplacementApplyOperations.payload}->'value',
      'parentEntityId', left(${actReplacementApplyOperations.payload}->>'parentEntityId', ${maximumProjectedMatchStringLength}),
      'parentType', left(${actReplacementApplyOperations.payload}->>'parentType', ${maximumProjectedMatchStringLength}),
      'relationshipSlot', left(${actReplacementApplyOperations.payload}->>'relationshipSlot', ${maximumProjectedMatchStringLength}),
      'proof', case when jsonb_typeof(${actReplacementApplyOperations.payload}->'proof') = 'object' then
        jsonb_build_object(
          'entityType', left(${actReplacementApplyOperations.payload}->'proof'->>'entityType', ${maximumProjectedMatchStringLength}),
          'entityId', left(${actReplacementApplyOperations.payload}->'proof'->>'entityId', ${maximumProjectedMatchStringLength}),
          'fieldName', left(${actReplacementApplyOperations.payload}->'proof'->>'fieldName', ${maximumProjectedMatchStringLength}),
          'sourceVersionId', left(${actReplacementApplyOperations.payload}->'proof'->>'sourceVersionId', ${maximumProjectedMatchStringLength}),
          'expectedLocalValueFingerprint', left(${actReplacementApplyOperations.payload}->'proof'->>'expectedLocalValueFingerprint', ${maximumProjectedMatchStringLength}),
          'decisionId', left(${actReplacementApplyOperations.payload}->'proof'->>'decisionId', ${maximumProjectedMatchStringLength}),
          'decision', left(${actReplacementApplyOperations.payload}->'proof'->>'decision', ${maximumProjectedMatchStringLength}),
          'localValue', ${actReplacementApplyOperations.payload}->'proof'->'localValue',
          'sourceValue', ${actReplacementApplyOperations.payload}->'proof'->'sourceValue'
        )
        || case when ${actReplacementApplyOperations.payload}->'proof' ? 'sourceValueFingerprint'
          then jsonb_build_object('sourceValueFingerprint', left(${actReplacementApplyOperations.payload}->'proof'->>'sourceValueFingerprint', ${maximumProjectedMatchStringLength})) else '{}'::jsonb end
        || case when ${actReplacementApplyOperations.payload}->'proof' ? 'localValueFingerprint'
          then jsonb_build_object('localValueFingerprint', left(${actReplacementApplyOperations.payload}->'proof'->>'localValueFingerprint', ${maximumProjectedMatchStringLength})) else '{}'::jsonb end
      else null end,
      'decision', case when jsonb_typeof(${actReplacementApplyOperations.payload}->'decision') = 'object' then
        jsonb_build_object(
          'id', left(${actReplacementApplyOperations.payload}->'decision'->>'id', ${maximumProjectedMatchStringLength}),
          'sourceVersionId', left(${actReplacementApplyOperations.payload}->'decision'->>'sourceVersionId', ${maximumProjectedMatchStringLength}),
          'scope', left(${actReplacementApplyOperations.payload}->'decision'->>'scope', ${maximumProjectedMatchStringLength}),
          'decision', left(${actReplacementApplyOperations.payload}->'decision'->>'decision', ${maximumProjectedMatchStringLength}),
          'fieldName', left(${actReplacementApplyOperations.payload}->'decision'->>'fieldName', ${maximumProjectedMatchStringLength}),
          'relationshipSlot', left(${actReplacementApplyOperations.payload}->'decision'->>'relationshipSlot', ${maximumProjectedMatchStringLength}),
          'targetEntityType', left(${actReplacementApplyOperations.payload}->'decision'->>'targetEntityType', ${maximumProjectedMatchStringLength}),
          'targetEntityId', left(${actReplacementApplyOperations.payload}->'decision'->>'targetEntityId', ${maximumProjectedMatchStringLength})
        )
        || case when ${actReplacementApplyOperations.payload}->'decision' ? 'reviewedSourceValue'
          then jsonb_build_object('reviewedSourceValue', ${actReplacementApplyOperations.payload}->'decision'->'reviewedSourceValue') else '{}'::jsonb end
        || case when ${actReplacementApplyOperations.payload}->'decision' ? 'reviewedSourceValueFingerprint'
          then jsonb_build_object('reviewedSourceValueFingerprint', left(${actReplacementApplyOperations.payload}->'decision'->>'reviewedSourceValueFingerprint', ${maximumProjectedMatchStringLength})) else '{}'::jsonb end
        || case when ${actReplacementApplyOperations.payload}->'decision' ? 'reviewedLocalValue'
          then jsonb_build_object('reviewedLocalValue', ${actReplacementApplyOperations.payload}->'decision'->'reviewedLocalValue') else '{}'::jsonb end
        || case when ${actReplacementApplyOperations.payload}->'decision' ? 'reviewedLocalValueFingerprint'
          then jsonb_build_object('reviewedLocalValueFingerprint', left(${actReplacementApplyOperations.payload}->'decision'->>'reviewedLocalValueFingerprint', ${maximumProjectedMatchStringLength})) else '{}'::jsonb end
      else null end
    )
  end
`;

export type ImportWorkflowProjectionInput = {
  phase: string;
  organizerLeaseExpiresAt?: Date | null;
  summary: Record<string, unknown> | null | undefined;
  outcomes: readonly {
    sourceRecordId: string;
    state: string;
    match?: unknown;
    hasOptionalReview?: boolean;
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
    selectedTargetId?: string | null;
    reviewedPayload?: Record<string, unknown> | null;
    reviewedTargetId?: string | null;
    reviewedTargetType?: string | null;
    requiredForSourceOutcome?: boolean;
    leaseExpiresAt?: Date | null;
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
  const outcomeBySourceId = new Map(
    input.outcomes.map((outcome) => [outcome.sourceRecordId, outcome]),
  );
  const safeHistoryOperationKeys = new Set<string>();
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
    const outcome = outcomeBySourceId.get(operation.sourceRecordId);
    if (!isAutomaticallyImportableForOutcome(
      operation,
      { state: outcome?.state, match: outcome?.match ?? null },
    )) return false;
    if (
      operation.status === "applied" ||
      operation.status === "already_present"
    ) {
      closure.add(operationKey);
      return true;
    }
    if (!isAutomaticallyImportableOperation(operation)) return false;
    if (closure.has(operationKey)) return true;
    const nextTrail = new Set(trail).add(operationKey);
    for (const dependency of operation.dependencyOperationKeys) {
      if (!collectSafeClosure(dependency, nextTrail, closure)) return false;
    }
    closure.add(operationKey);
    return true;
  };
  for (const operation of input.operations) {
    const closure = new Set<string>();
    if (collectSafeClosure(operation.operationKey, new Set(), closure)) {
      for (const operationKey of closure) safeHistoryOperationKeys.add(operationKey);
    }
  }
  for (const operationKey of safeHistoryOperationKeys) {
    const operation = operationByKey.get(operationKey);
    if (operation && isAutomaticallyImportableOperation(operation)) {
      safeOperationKeys.add(operationKey);
    }
  }

  const dispositions = input.outcomes.map((outcome) => ({
    sourceRecordId: outcome.sourceRecordId,
    disposition: automaticReviewDisposition({
      outcome: {
        state: outcome.state,
        match: outcome.match,
      },
      operations: (operationsBySourceId.get(outcome.sourceRecordId) ?? [])
        .filter((operation) => safeHistoryOperationKeys.has(operation.operationKey)),
    }),
  }));
  const safeOperationCount = safeOperationKeys.size;
  const reviewedReadyOperationKeys = new Set<string>();
  const reviewedClosureOperations = input.operations.map((operation) => {
    const proofOperation = {
      action: operation.action,
      sourceVersionId: operation.sourceVersionId ?? "",
      targetType: operation.targetType,
      payload: operation.reviewedPayload ?? {},
    };
    const reviewedProofValid = operation.action === "overwrite_reviewed"
      ? hasReviewedOverwriteProof(proofOperation)
      : operation.action === "create_relationship"
        ? hasReviewedRelationshipProof(proofOperation)
        : false;
    return {
      ...operation,
      reviewedProofValid,
      reviewedTargetId: operation.action === "overwrite_reviewed"
        && typeof operation.reviewedPayload?.entityId === "string"
        ? operation.reviewedPayload.entityId
        : null,
      reviewedTargetType: operation.action === "overwrite_reviewed"
        ? operation.targetType
        : null,
    };
  });
  const reviewedClosureOperationByKey = new Map(
    reviewedClosureOperations.map((operation) => [operation.operationKey, operation]),
  );
  const reviewedClosureOutcomes = input.outcomes.map((outcome) => {
    const match = outcome.match && typeof outcome.match === "object" && !Array.isArray(outcome.match)
      ? outcome.match as Record<string, unknown>
      : {};
    return {
      sourceRecordId: outcome.sourceRecordId,
      state: outcome.state,
      matchedTargetId: match.kind === "exact" && typeof match.localId === "string"
        ? match.localId
        : null,
    };
  });
  for (const operation of input.operations) {
    if (reviewedClosureOperationByKey.get(operation.operationKey)?.reviewedProofValid !== true
      || (operation.action !== "overwrite_reviewed" && operation.action !== "create_relationship")
      || (operation.status !== "pending" && operation.status !== "failed")
      || outcomeBySourceId.get(operation.sourceRecordId)?.state !== "ready") continue;
    const closure = validateReviewedClosure({
      rootOperationKey: operation.operationKey,
      operations: reviewedClosureOperations,
      outcomes: reviewedClosureOutcomes,
      requireTerminalIdentity: true,
    });
    if (closure.ok) reviewedReadyOperationKeys.add(operation.operationKey);
  }
  const reviewedReadyOperationCount = reviewedReadyOperationKeys.size;
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
  const hasOptionalReview = archivedOnlyCount > 0 || input.outcomes.some(
    (outcome) => outcome.hasOptionalReview === true,
  );

  return {
    safeOperationCount,
    reviewedReadyOperationCount,
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
      manifestDigest !== null &&
      hasOptionalReview &&
      (input.phase === "ready_to_apply" ||
        input.phase === "complete" ||
        input.phase === "complete_with_issues"),
    canApplySafe:
      manifestDigest !== null &&
      safeOperationCount > 0 &&
      (input.phase === "ready_to_apply" ||
        input.phase === "applying" ||
        input.phase === "complete_with_issues"),
    canApplyReviewed:
      manifestDigest !== null &&
      reviewedReadyOperationCount > 0 &&
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

    const [outcomes, operations, batches, checkpoints] = await Promise.all([
      this.database
        .select({
          sourceRecordId: actReplacementOutcomes.sourceRecordId,
          state: actReplacementOutcomes.state,
          match: boundedOutcomeMatchProjection,
          hasOptionalReview: sql<boolean>`
            ${actReplacementOutcomes.state} in ('awaiting_review', 'unassigned', 'unsupported')
            or case
              when jsonb_typeof(${actReplacementOutcomes.issues}) = 'array'
                then jsonb_array_length(${actReplacementOutcomes.issues}) > 0
              else false
            end
          `,
          leaseExpiresAt: actReplacementOutcomes.leaseExpiresAt,
        })
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
          selectedTargetId: sql<string | null>`case
            when ${actReplacementApplyOperations.action} = 'link_existing'
              and jsonb_typeof(${actReplacementApplyOperations.payload}) = 'object'
              and char_length(coalesce(${actReplacementApplyOperations.payload}->>'localId', '')) between 1 and 200
            then ${actReplacementApplyOperations.payload}->>'localId'
            else null
          end`,
          reviewedPayload: boundedReviewedPayloadProjection,
          requiredForSourceOutcome:
            actReplacementApplyOperations.requiredForSourceOutcome,
          leaseExpiresAt: actReplacementApplyOperations.leaseExpiresAt,
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
