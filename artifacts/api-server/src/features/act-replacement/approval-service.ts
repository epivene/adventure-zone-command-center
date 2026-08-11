import { fingerprintSourceContent } from "./source-fingerprint";
import { isAutomaticallyApprovedOperation } from "./automatic-review-policy";
import type { ManifestOperation, ManifestOutcome } from "./manifest-builder";

export type ApprovalClosure = { selectedOperationIds: string[]; approvedOperationIds: string[]; dependencyOperationIds: string[]; rejectedOperationIds: string[]; selectedCount: number; dependencyCount: number; rejectedCount: number; manifestDigest: string };
export const actApprovalModes = ["automatic_safe", "explicit_manual"] as const;
export type ActApprovalMode = typeof actApprovalModes[number];
export const ACT_APPROVAL_MODE_VERSION = 1;
export type ApprovalRequest = ApprovalClosure & {
  approvalMode: ActApprovalMode | null;
  approvalModeVersion: number | null;
};
export type ApprovalOperation = ManifestOperation & { status?: string };
export type ApprovalManifest = { digest: string; operations: ApprovalOperation[]; outcomes: ManifestOutcome[] };
export type ApprovalRepository = { getManifest(runId: string): Promise<ApprovalManifest | null>; getRequest(runId: string, requestKey: string): Promise<ApprovalRequest | null>; saveRequest(runId: string, requestKey: string, request: ApprovalRequest): Promise<ApprovalRequest> };

function fail(code: string, status = 400): never { throw Object.assign(new Error(code), { code, status }); }
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function hasReviewedOverwriteProof(operation: ManifestOperation): boolean {
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
function closure(operations: ApprovalOperation[], selected: string[], safeOnly: boolean, eligibleSourceIds?: ReadonlySet<string>): ApprovalClosure {
  const byKey = new Map(operations.map((operation) => [operation.operationKey, operation]));
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

function automaticSafeClosure(manifest: ApprovalManifest): ApprovalClosure {
  const safeRoots = manifest.operations.filter(automaticCandidate).map((operation) => operation.operationKey).sort();
  const accepted: string[] = [];
  for (const root of safeRoots) {
    try {
      closure(manifest.operations, [root], true);
      accepted.push(root);
    } catch (error) {
      if (!(error instanceof Error) || !["unsafe_operation", "unsafe_dependency", "unsafe_overwrite", "dependency_cycle", "operation_not_found"].includes((error as Error & { code?: string }).code ?? "")) throw error;
    }
  }
  const result = closure(manifest.operations, accepted, true);
  result.manifestDigest = manifest.digest;
  result.rejectedOperationIds = manifest.operations.map((operation) => operation.operationKey).filter((key) => !result.approvedOperationIds.includes(key)).sort();
  result.rejectedCount = result.rejectedOperationIds.length;
  return result;
}

function automaticReplayClosure(manifest: ApprovalManifest, value: ApprovalClosure): ApprovalClosure {
  const approved = new Set(value.approvedOperationIds);
  const operations = manifest.operations.map((operation) => approved.has(operation.operationKey) ? { ...operation, status: "pending" } : operation);
  const result = closure(operations, value.selectedOperationIds, true);
  result.manifestDigest = manifest.digest;
  result.rejectedOperationIds = operations.map((operation) => operation.operationKey).filter((key) => !result.approvedOperationIds.includes(key)).sort();
  result.rejectedCount = result.rejectedOperationIds.length;
  return result;
}

function sameClosure(left: ApprovalClosure, right: ApprovalClosure): boolean {
  const sameIds = (leftIds: string[], rightIds: string[]) => leftIds.length === rightIds.length && leftIds.every((id, index) => id === rightIds[index]);
  return left.manifestDigest === right.manifestDigest
    && left.selectedCount === right.selectedCount
    && left.dependencyCount === right.dependencyCount
    && left.rejectedCount === right.rejectedCount
    && sameIds(left.selectedOperationIds, right.selectedOperationIds)
    && sameIds(left.approvedOperationIds, right.approvedOperationIds)
    && sameIds(left.dependencyOperationIds, right.dependencyOperationIds)
    && sameIds(left.rejectedOperationIds, right.rejectedOperationIds);
}

function automaticReplay(value: ApprovalClosure, manifest: ApprovalManifest): ApprovalClosure {
  let expected: ApprovalClosure;
  try {
    expected = automaticReplayClosure(manifest, value);
  } catch (error) {
    if (error instanceof Error && ["unsafe_operation", "unsafe_dependency", "unsafe_overwrite", "dependency_cycle", "operation_not_found"].includes((error as Error & { code?: string }).code ?? "")) fail("request_replay_mode_mismatch", 409);
    throw error;
  }
  if (!sameClosure(value, expected)) fail("request_replay_mode_mismatch", 409);
  return value;
}

function request(mode: ActApprovalMode, value: ApprovalClosure): ApprovalRequest {
  return { ...value, approvalMode: mode, approvalModeVersion: ACT_APPROVAL_MODE_VERSION };
}

function closureFromRequest(value: ApprovalRequest): ApprovalClosure {
  const { approvalMode: _approvalMode, approvalModeVersion: _approvalModeVersion, ...closure } = value;
  return closure;
}

function assertApprovalMode(value: ApprovalRequest, expectedMode: ActApprovalMode): void {
  if (value.approvalMode !== expectedMode || value.approvalModeVersion !== ACT_APPROVAL_MODE_VERSION)
    fail("request_replay_mode_mismatch", 409);
}

function replayRequest(value: ApprovalRequest, expectedMode: ActApprovalMode, expectedManifestDigest: string): ApprovalClosure {
  assertApprovalMode(value, expectedMode);
  if (value.manifestDigest !== expectedManifestDigest) fail("request_replay_mismatch", 409);
  return closureFromRequest(value);
}

export class InMemoryApprovalRepository implements ApprovalRepository {
  private readonly manifests = new Map<string, ApprovalManifest>(); private readonly requests = new Map<string, ApprovalRequest>();
  seed(runId: string, manifest: Omit<ApprovalManifest, "outcomes"> & { outcomes?: ManifestOutcome[] }) { this.manifests.set(runId, { ...manifest, outcomes: manifest.outcomes ?? [] }); }
  seedRequest(runId: string, requestKey: string, value: ApprovalRequest) { this.requests.set(`${runId}:${requestKey}`, value); }
  async getManifest(runId: string) { return this.manifests.get(runId) ?? null; }
  async getRequest(runId: string, requestKey: string) { return this.requests.get(`${runId}:${requestKey}`) ?? null; }
  async saveRequest(runId: string, requestKey: string, value: ApprovalRequest) {
    const key = `${runId}:${requestKey}`;
    const prior = this.requests.get(key);
    if (prior) return prior;
    this.requests.set(key, value);
    return value;
  }
}

export class ActApprovalService {
  constructor(private readonly repository: ApprovalRepository) {}
  async approve(input: { runId: string; operationIds: string[]; includeDependencies: true; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> {
    const prior = await this.repository.getRequest(input.runId, input.requestKey); if (prior) return replayRequest(prior, "explicit_manual", input.expectedManifestDigest);
    const manifest = await this.repository.getManifest(input.runId); if (!manifest) fail("manifest_not_found");
    if (manifest.digest !== input.expectedManifestDigest) fail("manifest_digest_mismatch");
    for (const operationId of input.operationIds) {
      const operation = manifest.operations.find((candidate) => candidate.operationKey === operationId);
      if (operation?.action === "overwrite_reviewed" && !hasReviewedOverwriteProof(operation)) fail("review_proof_required");
    }
    const result = closure(manifest.operations, input.operationIds, false); result.manifestDigest = manifest.digest;
    const saved = await this.repository.saveRequest(input.runId, input.requestKey, request("explicit_manual", result));
    return replayRequest(saved, "explicit_manual", input.expectedManifestDigest);
  }
  async approveSafeDefaults(input: { runId: string; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> {
    const prior = await this.repository.getRequest(input.runId, input.requestKey);
    if (prior) {
      assertApprovalMode(prior, "automatic_safe");
      if (prior.manifestDigest !== input.expectedManifestDigest) fail("request_replay_mismatch", 409);
    }
    const manifest = await this.repository.getManifest(input.runId); if (!manifest) fail("manifest_not_found");
    if (manifest.digest !== input.expectedManifestDigest) fail("manifest_digest_mismatch");
    const result = automaticSafeClosure(manifest);
    if (prior) return automaticReplay(closureFromRequest(prior), manifest);
    const saved = await this.repository.saveRequest(input.runId, input.requestKey, request("automatic_safe", result));
    assertApprovalMode(saved, "automatic_safe");
    if (saved.manifestDigest !== input.expectedManifestDigest) fail("request_replay_mismatch", 409);
    return automaticReplay(closureFromRequest(saved), manifest);
  }
  async approveReady(input: { runId: string; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> {
    return this.approveSafeDefaults(input);
  }
}
