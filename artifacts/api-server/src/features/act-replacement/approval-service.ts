import {
  isAutomaticallyImportableAction,
  isAutomaticallyImportableForOutcome,
} from "./automatic-review-policy";
import {
  hasReviewedOverwriteProof,
  hasReviewedRelationshipProof,
} from "./review-proof";
import type { ManifestOperation, ManifestOutcome } from "./manifest-builder";
import { validateReviewedClosure } from "./reviewed-closure";
import { approvalProjectionIsIncomplete, projectBoundedApprovalPayload, type ApprovalSnapshotMode } from "./approval-projection";

export type ApprovalClosure = { selectedOperationIds: string[]; approvedOperationIds: string[]; dependencyOperationIds: string[]; rejectedOperationIds: string[]; selectedCount: number; dependencyCount: number; rejectedCount: number; manifestDigest: string };
export type ApprovalManifest = { digest: string; operations: ManifestOperation[]; outcomes: ManifestOutcome[] };
export type ApprovalOperationStatus = "pending" | "leased" | "applied" | "already_present" | "blocked" | "failed";
export type ApprovalSnapshot = ApprovalManifest & {
  operationStatuses: Record<string, ApprovalOperationStatus>;
};
export type ApprovalRepository = {
  getSnapshot(runId: string, mode: ApprovalSnapshotMode): Promise<ApprovalSnapshot | null>;
  getRequest(runId: string, requestKey: string): Promise<ApprovalClosure | null>;
  saveRequest(runId: string, requestKey: string, closure: ApprovalClosure): Promise<ApprovalClosure>;
};

function fail(code: string, status = 400): never { throw Object.assign(new Error(code), { code, status }); }
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function hasBoundLinkTarget(
  operation: ManifestOperation,
  outcome: ManifestOutcome | undefined,
): boolean {
  if (operation.action !== "link_existing") return true;
  const match = isRecord(outcome?.match) ? outcome.match : {};
  return match.kind === "exact"
    && match.evidenceTruncated !== true
    && typeof match.localId === "string"
    && match.localId !== ""
    && operation.payload.localId === match.localId;
}
function closure(operations: ManifestOperation[], selected: string[], safeOnly: boolean, eligibleSourceIds?: ReadonlySet<string>, safeEligibleOperationIds?: ReadonlySet<string>): ApprovalClosure {
  const byKey = new Map(operations.map((operation) => [operation.operationKey, operation]));
  const selectedIds = [...new Set(selected)].sort();
  const all = new Set<string>(); const deps = new Set<string>();
  const visit = (key: string, trail: Set<string>, isDependency: boolean) => {
    const operation = byKey.get(key); if (!operation) fail("operation_not_found");
    if (trail.has(key)) fail("dependency_cycle");
    if (all.has(key)) return;
    if (eligibleSourceIds && !eligibleSourceIds.has(operation.sourceRecordId)) fail("ineligible_source_dependency");
    if (safeOnly && !isAutomaticallyImportableAction(operation)) fail(isDependency ? "unsafe_dependency" : "unsafe_operation");
    if (safeOnly && safeEligibleOperationIds && !safeEligibleOperationIds.has(operation.operationKey)) fail(isDependency ? "unsafe_dependency" : "unsafe_operation");
    if (safeOnly && operation.action === "overwrite_reviewed") fail("unsafe_overwrite");
    if (isDependency && operation.action === "overwrite_reviewed") fail("unsafe_dependency");
    if (operation.safeByDefault === false && (safeOnly || isDependency)) fail("unsafe_dependency");
    const next = new Set(trail); next.add(key);
    for (const dependency of [...(operation.dependencyOperationKeys ?? [])].sort()) visit(dependency, next, true);
    all.add(key); if (isDependency) deps.add(key);
  };
  for (const key of selectedIds) visit(key, new Set(), false);
  const approved = [...all];
  return { selectedOperationIds: selectedIds, approvedOperationIds: approved, dependencyOperationIds: [...deps].sort(), rejectedOperationIds: [], selectedCount: selectedIds.length, dependencyCount: deps.size, rejectedCount: 0, manifestDigest: "" };
}

function validateClosedApproval(
  manifest: ApprovalManifest,
  result: ApprovalClosure,
  requireReviewedProof: boolean,
): ApprovalClosure {
  const operationByKey = new Map(
    manifest.operations.map((operation) => [operation.operationKey, operation]),
  );
  const outcomeBySourceId = new Map(
    manifest.outcomes.map((outcome) => [outcome.sourceRecordId, outcome]),
  );
  for (const operationId of result.approvedOperationIds) {
    const operation = operationByKey.get(operationId) ?? fail("operation_not_found");
    if (approvalProjectionIsIncomplete(operation.payload)) {
      fail("approval_projection_truncated");
    }
    if (!hasBoundLinkTarget(operation, outcomeBySourceId.get(operation.sourceRecordId))) {
      fail("link_target_mismatch");
    }
    if (operation.action === "overwrite_reviewed" && !hasReviewedOverwriteProof(operation)) {
      fail("review_proof_required");
    }
    if (requireReviewedProof
      && operation.action === "create_relationship"
      && !hasReviewedRelationshipProof(operation)) {
      fail("review_proof_required");
    }
  }
  return result;
}

function validatedClosure(
  manifest: ApprovalManifest,
  selected: string[],
  safeOnly: boolean,
  requireReviewedProof: boolean,
  eligibleSourceIds?: ReadonlySet<string>,
  safeEligibleOperationIds?: ReadonlySet<string>,
): ApprovalClosure {
  return validateClosedApproval(
    manifest,
    closure(
      manifest.operations,
      selected,
      safeOnly,
      eligibleSourceIds,
      safeEligibleOperationIds,
    ),
    requireReviewedProof,
  );
}

export class InMemoryApprovalRepository implements ApprovalRepository {
  private readonly manifests = new Map<string, ApprovalManifest>(); private readonly requests = new Map<string, ApprovalClosure>();
  private readonly operationStatuses = new Map<string, Record<string, ApprovalOperationStatus>>();
  seed(runId: string, manifest: Omit<ApprovalManifest, "outcomes"> & { outcomes?: ManifestOutcome[]; operationStatuses?: Record<string, ApprovalOperationStatus> }) {
    const { operationStatuses, ...approvalManifest } = manifest;
    this.manifests.set(runId, { ...approvalManifest, outcomes: manifest.outcomes ?? [] });
    this.operationStatuses.set(runId, Object.fromEntries(
      approvalManifest.operations.map((operation) => [
        operation.operationKey,
        operationStatuses?.[operation.operationKey] ?? "pending",
      ]),
    ));
  }
  async getSnapshot(runId: string, mode: ApprovalSnapshotMode) {
    const manifest = this.manifests.get(runId);
    return manifest ? {
      ...manifest,
      operations: manifest.operations.map((operation) => ({
        ...operation,
        payload: projectBoundedApprovalPayload(operation.action, operation.payload, mode),
      })),
      operationStatuses: { ...(this.operationStatuses.get(runId) ?? {}) },
    } : null;
  }
  async getRequest(runId: string, requestKey: string) { return this.requests.get(`${runId}:${requestKey}`) ?? null; }
  async saveRequest(runId: string, requestKey: string, value: ApprovalClosure) { this.requests.set(`${runId}:${requestKey}`, value); return value; }
}

function isSafeDefaultOperation(
  operation: ManifestOperation,
  outcome: ManifestOutcome | undefined,
): boolean {
  return isAutomaticallyImportableForOutcome(
    { ...operation, status: "pending" },
    { state: outcome?.state, match: outcome?.match ?? null },
  );
}

function safeDefaultOperationIds(manifest: ApprovalManifest): Set<string> {
  const outcomeBySourceId = new Map(
    manifest.outcomes.map((outcome) => [outcome.sourceRecordId, outcome]),
  );
  return new Set(
    manifest.operations
      .filter((operation) =>
        isSafeDefaultOperation(
          operation,
          outcomeBySourceId.get(operation.sourceRecordId),
        ))
      .map((operation) => operation.operationKey),
  );
}

function reviewedClosureEligibility(
  manifest: ApprovalManifest,
  rootOperationKey: string,
  operationStatuses: Readonly<Record<string, ApprovalOperationStatus>>,
) {
  return validateReviewedClosure({
    rootOperationKey,
    operations: manifest.operations.map((operation) => ({
      operationKey: operation.operationKey,
      sourceRecordId: operation.sourceRecordId,
      action: operation.action,
      dependencyOperationKeys: operation.dependencyOperationKeys,
      safeByDefault: operation.safeByDefault,
      status: operationStatuses[operation.operationKey] ?? "pending",
      reviewedProofValid: operation.action === "overwrite_reviewed"
        ? hasReviewedOverwriteProof(operation)
        : operation.action === "create_relationship"
          ? hasReviewedRelationshipProof(operation)
          : false,
      selectedTargetId: operation.action === "link_existing"
        && typeof operation.payload.localId === "string"
        ? operation.payload.localId
        : null,
      targetType: operation.targetType,
      reviewedTargetId: operation.action === "overwrite_reviewed"
        && typeof operation.payload.entityId === "string"
        ? operation.payload.entityId
        : null,
      reviewedTargetType: operation.action === "overwrite_reviewed"
        ? operation.targetType
        : null,
    })),
    outcomes: manifest.outcomes.map((outcome) => {
      const match = isRecord(outcome.match) ? outcome.match : {};
      return {
        sourceRecordId: outcome.sourceRecordId,
        state: outcome.state,
        matchedTargetId: match.kind === "exact" && typeof match.localId === "string"
          ? match.localId
          : null,
      };
    }),
    requireTerminalIdentity: true,
  });
}

export class ActApprovalService {
  constructor(private readonly repository: ApprovalRepository) {}
  private replayOrFail(
    prior: ApprovalClosure | null,
    current: ApprovalClosure,
    expectedManifestDigest: string,
    operationStatuses?: Readonly<Record<string, ApprovalOperationStatus>>,
  ) {
    if (!prior) return null;
    const terminal = (operationId: string) => {
      const status = operationStatuses?.[operationId];
      return status === "applied" || status === "already_present";
    };
    const terminalAwareEquivalent = (priorIds: string[], currentIds: string[]) => {
      const priorSet = new Set(priorIds);
      const currentSet = new Set(currentIds);
      return currentIds.every((operationId) => priorSet.has(operationId))
        && priorIds.every((operationId) => currentSet.has(operationId) || terminal(operationId));
    };
    if (prior.manifestDigest !== expectedManifestDigest
      || !terminalAwareEquivalent(prior.approvedOperationIds, current.approvedOperationIds)
      || !terminalAwareEquivalent(prior.selectedOperationIds, current.selectedOperationIds)) {
      fail("request_replay_mismatch", 409);
    }
    return prior;
  }
  private async persist(
    runId: string,
    requestKey: string,
    result: ApprovalClosure,
  ) {
    const saved = await this.repository.saveRequest(runId, requestKey, result);
    return this.replayOrFail(saved, result, result.manifestDigest) ?? result;
  }
  async approve(input: { runId: string; operationIds: string[]; includeDependencies: true; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> {
    const prior = await this.repository.getRequest(input.runId, input.requestKey);
    if (prior) {
      if (prior.manifestDigest !== input.expectedManifestDigest) fail("request_replay_mismatch", 409);
      return prior;
    }
    const manifest = await this.repository.getSnapshot(input.runId, "reviewed"); if (!manifest) fail("manifest_not_found");
    if (manifest.digest !== input.expectedManifestDigest) fail("manifest_digest_mismatch");
    for (const operationId of input.operationIds) {
      const operation = manifest.operations.find((candidate) => candidate.operationKey === operationId);
      if (operation?.action === "overwrite_reviewed" && !hasReviewedOverwriteProof(operation)) fail("review_proof_required");
    }
    const result = validatedClosure(manifest, input.operationIds, false, false); result.manifestDigest = manifest.digest;
    return this.persist(input.runId, input.requestKey, result);
  }
  async approveSafeDefaults(input: { runId: string; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> {
    const manifest = await this.repository.getSnapshot(input.runId, "safe"); if (!manifest) fail("manifest_not_found");
    if (manifest.digest !== input.expectedManifestDigest) fail("manifest_digest_mismatch");
    const safeEligibleOperationIds = safeDefaultOperationIds(manifest);
    const safeRoots = [...safeEligibleOperationIds].sort(); const accepted: string[] = [];
    for (const root of safeRoots) { try { validatedClosure(manifest, [root], true, false, undefined, safeEligibleOperationIds); accepted.push(root); } catch (error) { if (!(error instanceof Error) || !["unsafe_operation", "unsafe_dependency", "unsafe_overwrite", "dependency_cycle", "operation_not_found", "link_target_mismatch"].includes((error as Error & { code?: string }).code ?? "")) throw error; } }
    const result = validatedClosure(manifest, accepted, false, false); result.manifestDigest = manifest.digest;
    result.rejectedOperationIds = manifest.operations.map((operation) => operation.operationKey).filter((key) => !result.approvedOperationIds.includes(key)).sort();
    result.rejectedCount = result.rejectedOperationIds.length;
    const prior = await this.repository.getRequest(input.runId, input.requestKey);
    return this.replayOrFail(prior, result, input.expectedManifestDigest)
      ?? this.persist(input.runId, input.requestKey, result);
  }
  async approveReady(input: { runId: string; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> {
    const manifest = await this.repository.getSnapshot(input.runId, "reviewed"); if (!manifest) fail("manifest_not_found");
    if (manifest.digest !== input.expectedManifestDigest) fail("manifest_digest_mismatch");
    const operationStatuses = manifest.operationStatuses;
    const eligibleSourceIds = new Set(manifest.outcomes.filter((outcome) => outcome.state === "ready").map((outcome) => outcome.sourceRecordId));
    const safeEligibleOperationIds = safeDefaultOperationIds(manifest);
    const safeRoots = [...safeEligibleOperationIds].sort();
    const reviewedRoots = manifest.operations
      .filter((operation) =>
        eligibleSourceIds.has(operation.sourceRecordId)
        && (operation.action === "overwrite_reviewed"
          ? hasReviewedOverwriteProof(operation)
          : operation.action === "create_relationship"
            ? hasReviewedRelationshipProof(operation)
            : operation.safeByDefault
              && !isAutomaticallyImportableAction(operation)))
      .map((operation) => operation.operationKey)
      .sort();
    const accepted = new Set<string>();
    for (const root of safeRoots) {
      try {
        validatedClosure(manifest, [root], true, false, undefined, safeEligibleOperationIds);
        accepted.add(root);
      } catch (error) {
        if (!(error instanceof Error) || !["unsafe_operation", "unsafe_dependency", "unsafe_overwrite", "dependency_cycle", "operation_not_found", "link_target_mismatch"].includes((error as Error & { code?: string }).code ?? "")) throw error;
      }
    }
    for (const root of reviewedRoots) {
      try {
        const rootOperation = manifest.operations.find((operation) => operation.operationKey === root);
        if (rootOperation?.action === "overwrite_reviewed"
          || rootOperation?.action === "create_relationship") {
          const eligibility = reviewedClosureEligibility(manifest, root, operationStatuses);
          if (!eligibility.ok) fail(eligibility.code);
        }
        validatedClosure(manifest, [root], false, true, eligibleSourceIds);
        accepted.add(root);
      } catch (error) {
        if (!(error instanceof Error) || !["unsafe_dependency", "dependency_cycle", "operation_not_found", "ineligible_source_dependency", "link_target_mismatch", "review_proof_required", "dependency_not_terminal", "outcome_not_ready"].includes((error as Error & { code?: string }).code ?? "")) throw error;
      }
    }
    const result = validatedClosure(manifest, [...accepted].sort(), false, true); result.manifestDigest = manifest.digest;
    result.rejectedOperationIds = manifest.operations.map((operation) => operation.operationKey).filter((key) => !result.approvedOperationIds.includes(key)).sort();
    result.rejectedCount = result.rejectedOperationIds.length;
    const prior = await this.repository.getRequest(input.runId, input.requestKey);
    return this.replayOrFail(prior, result, input.expectedManifestDigest, operationStatuses)
      ?? this.persist(input.runId, input.requestKey, result);
  }
}
