import { fingerprintSourceContent } from "./source-fingerprint";
import { isAutomaticallyApprovedOperation } from "./automatic-review-policy";
import type { ManifestOperation, ManifestOutcome } from "./manifest-builder";

export type ApprovalClosure = { selectedOperationIds: string[]; approvedOperationIds: string[]; dependencyOperationIds: string[]; rejectedOperationIds: string[]; selectedCount: number; dependencyCount: number; rejectedCount: number; manifestDigest: string };
export type ApprovalOperation = ManifestOperation & { status?: string };
export type ApprovalManifest = { digest: string; operations: ApprovalOperation[]; outcomes: ManifestOutcome[] };
export type ApprovalRepository = { getManifest(runId: string): Promise<ApprovalManifest | null>; getRequest(runId: string, requestKey: string): Promise<ApprovalClosure | null>; saveRequest(runId: string, requestKey: string, closure: ApprovalClosure): Promise<ApprovalClosure> };

function fail(code: string, status = 400): never { throw Object.assign(new Error(code), { code, status }); }
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
function hasReviewedOverwriteProof(operation: ManifestOperation): boolean {
  const proof = operation.payload.proof;
  const decision = operation.payload.decision;
  const targetEntityId = operation.payload.entityId;
  return operation.action === "overwrite_reviewed"
    && isRecord(proof)
    && "localValue" in proof
    && "sourceValue" in proof
    && fingerprintSourceContent({ value: proof.sourceValue }) === fingerprintSourceContent({ value: operation.payload.value })
    && isRecord(decision)
    && typeof decision.id === "string"
    && decision.id.trim() !== ""
    && decision.scope === "field_conflict"
    && decision.decision === "use_source"
    && decision.sourceVersionId === operation.sourceVersionId
    && decision.fieldName === operation.payload.fieldName
    && decision.targetEntityType === operation.targetType
    && typeof targetEntityId === "string"
    && targetEntityId.trim() !== ""
    && decision.targetEntityId === targetEntityId;
}
function automaticCandidate(operation: ApprovalOperation): boolean {
  return isAutomaticallyApprovedOperation({
    ...operation,
    status: operation.status ?? "pending",
  });
}
function terminal(operation: ApprovalOperation): boolean {
  return operation.status === "applied" || operation.status === "already_present";
}
function closure(operations: ApprovalOperation[], selected: string[], safeOnly: boolean, eligibleSourceIds?: ReadonlySet<string>, operationIndex?: ReadonlyMap<string, ApprovalOperation>): ApprovalClosure {
  const byKey = operationIndex ?? new Map(operations.map((operation) => [operation.operationKey, operation]));
  const selectedIds = [...new Set(selected)].sort();
  const all = new Set<string>(); const deps = new Set<string>();
  const visit = (key: string, trail: Set<string>, isDependency: boolean) => {
    const operation = byKey.get(key); if (!operation) fail("operation_not_found");
    if (trail.has(key)) fail("dependency_cycle");
    if (all.has(key)) return;
    if (terminal(operation)) return;
    if (eligibleSourceIds && !eligibleSourceIds.has(operation.sourceRecordId)) fail("ineligible_source_dependency");
    if (safeOnly && !automaticCandidate(operation)) fail(isDependency ? "unsafe_dependency" : "unsafe_operation");
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

function validRoots(input: {
  roots: readonly string[];
  operationIndex: ReadonlyMap<string, ApprovalOperation>;
  safeOnly: boolean;
  eligibleSourceIds?: ReadonlySet<string>;
}): string[] {
  const dependencyValidity = new Map<string, boolean>();
  const dependencyIsValid = (key: string, visiting: Set<string>): boolean => {
    const prior = dependencyValidity.get(key);
    if (prior !== undefined) return prior;
    if (visiting.has(key)) return false;
    const operation = input.operationIndex.get(key);
    if (operation && terminal(operation)) {
      dependencyValidity.set(key, true);
      return true;
    }
    if (
      !operation ||
      (input.eligibleSourceIds && !input.eligibleSourceIds.has(operation.sourceRecordId)) ||
      (input.safeOnly && !automaticCandidate(operation)) ||
      operation.action === "overwrite_reviewed" ||
      operation.safeByDefault === false
    ) {
      dependencyValidity.set(key, false);
      return false;
    }
    const next = new Set(visiting).add(key);
    const valid = (operation.dependencyOperationKeys ?? []).every((dependency) =>
      dependencyIsValid(dependency, next)
    );
    dependencyValidity.set(key, valid);
    return valid;
  };

  return input.roots.filter((key) => {
    const operation = input.operationIndex.get(key);
    if (!operation || terminal(operation)) return false;
    if (input.eligibleSourceIds && !input.eligibleSourceIds.has(operation.sourceRecordId)) return false;
    if (input.safeOnly && (!automaticCandidate(operation) || operation.action === "overwrite_reviewed")) return false;
    return (operation.dependencyOperationKeys ?? []).every((dependency) =>
      dependencyIsValid(dependency, new Set([key]))
    );
  });
}

export class InMemoryApprovalRepository implements ApprovalRepository {
  private readonly manifests = new Map<string, ApprovalManifest>(); private readonly requests = new Map<string, ApprovalClosure>();
  seed(runId: string, manifest: Omit<ApprovalManifest, "outcomes"> & { outcomes?: ManifestOutcome[] }) { this.manifests.set(runId, { ...manifest, outcomes: manifest.outcomes ?? [] }); }
  async getManifest(runId: string) { return this.manifests.get(runId) ?? null; }
  async getRequest(runId: string, requestKey: string) { return this.requests.get(`${runId}:${requestKey}`) ?? null; }
  async saveRequest(runId: string, requestKey: string, value: ApprovalClosure) { this.requests.set(`${runId}:${requestKey}`, value); return value; }
}

export class ActApprovalService {
  constructor(private readonly repository: ApprovalRepository) {}
  async approve(input: { runId: string; operationIds: string[]; includeDependencies: true; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> {
    const prior = await this.repository.getRequest(input.runId, input.requestKey); if (prior) { if (prior.manifestDigest !== input.expectedManifestDigest) fail("request_replay_mismatch", 409); return prior; }
    const manifest = await this.repository.getManifest(input.runId); if (!manifest) fail("manifest_not_found");
    if (manifest.digest !== input.expectedManifestDigest) fail("manifest_digest_mismatch");
    for (const operationId of input.operationIds) {
      const operation = manifest.operations.find((candidate) => candidate.operationKey === operationId);
      if (operation?.action === "overwrite_reviewed" && !hasReviewedOverwriteProof(operation)) fail("review_proof_required");
    }
    const result = closure(manifest.operations, input.operationIds, false); result.manifestDigest = manifest.digest;
    return this.repository.saveRequest(input.runId, input.requestKey, result);
  }
  async approveSafeDefaults(input: { runId: string; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> {
    const prior = await this.repository.getRequest(input.runId, input.requestKey); if (prior) { if (prior.manifestDigest !== input.expectedManifestDigest) fail("request_replay_mismatch", 409); return prior; }
    const manifest = await this.repository.getManifest(input.runId); if (!manifest) fail("manifest_not_found");
    if (manifest.digest !== input.expectedManifestDigest) fail("manifest_digest_mismatch");
    const operationIndex = new Map(manifest.operations.map((operation) => [operation.operationKey, operation]));
    const safeRoots = manifest.operations.filter(automaticCandidate).map((operation) => operation.operationKey).sort();
    const accepted = validRoots({ roots: safeRoots, operationIndex, safeOnly: true });
    const result = closure(manifest.operations, accepted, true, undefined, operationIndex); result.manifestDigest = manifest.digest;
    const approved = new Set(result.approvedOperationIds);
    result.rejectedOperationIds = manifest.operations.map((operation) => operation.operationKey).filter((key) => !approved.has(key)).sort();
    result.rejectedCount = result.rejectedOperationIds.length;
    return this.repository.saveRequest(input.runId, input.requestKey, result);
  }
  async approveReady(input: { runId: string; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> {
    const prior = await this.repository.getRequest(input.runId, input.requestKey); if (prior) { if (prior.manifestDigest !== input.expectedManifestDigest) fail("request_replay_mismatch", 409); return prior; }
    const manifest = await this.repository.getManifest(input.runId); if (!manifest) fail("manifest_not_found");
    if (manifest.digest !== input.expectedManifestDigest) fail("manifest_digest_mismatch");
    const operationIndex = new Map(manifest.operations.map((operation) => [operation.operationKey, operation]));
    const eligibleSourceIds = new Set(manifest.outcomes.filter((outcome) => outcome.state === "ready").map((outcome) => outcome.sourceRecordId));
    const eligibleRoots = manifest.operations.filter((operation) => eligibleSourceIds.has(operation.sourceRecordId) && (operation.action === "overwrite_reviewed" ? hasReviewedOverwriteProof(operation) : operation.safeByDefault)).map((operation) => operation.operationKey).sort();
    const accepted = validRoots({ roots: eligibleRoots, operationIndex, safeOnly: false, eligibleSourceIds });
    const result = closure(manifest.operations, accepted, false, eligibleSourceIds, operationIndex); result.manifestDigest = manifest.digest;
    const approved = new Set(result.approvedOperationIds);
    result.rejectedOperationIds = manifest.operations.map((operation) => operation.operationKey).filter((key) => !approved.has(key)).sort();
    result.rejectedCount = result.rejectedOperationIds.length;
    return this.repository.saveRequest(input.runId, input.requestKey, result);
  }
}
