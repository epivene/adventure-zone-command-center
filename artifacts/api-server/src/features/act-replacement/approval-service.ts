import type { ManifestOperation } from "./manifest-builder";

export type ApprovalClosure = { selectedOperationIds: string[]; approvedOperationIds: string[]; dependencyOperationIds: string[]; rejectedOperationIds: string[]; selectedCount: number; dependencyCount: number; rejectedCount: number; manifestDigest: string };
export type ApprovalRepository = { getManifest(runId: string): Promise<{ digest: string; operations: ManifestOperation[] } | null>; getRequest(runId: string, requestKey: string): Promise<ApprovalClosure | null>; saveRequest(runId: string, requestKey: string, closure: ApprovalClosure): Promise<ApprovalClosure> };

function fail(code: string, status = 400): never { throw Object.assign(new Error(code), { code, status }); }
function closure(operations: ManifestOperation[], selected: string[], safeOnly: boolean): ApprovalClosure {
  const byKey = new Map(operations.map((operation) => [operation.operationKey, operation]));
  const selectedIds = [...new Set(selected)].sort();
  const all = new Set<string>(); const deps = new Set<string>();
  const visit = (key: string, trail: Set<string>, isDependency: boolean) => {
    const operation = byKey.get(key); if (!operation) fail("operation_not_found");
    if (trail.has(key)) fail("dependency_cycle");
    if (all.has(key)) return;
    if (operation.safeByDefault === false && (safeOnly || isDependency)) fail("unsafe_dependency");
    const next = new Set(trail); next.add(key);
    for (const dependency of operation.dependencyOperationKeys ?? []) visit(dependency, next, true);
    all.add(key); if (isDependency) deps.add(key);
  };
  for (const key of selectedIds) visit(key, new Set(), false);
  const approved = [...all].sort((a, b) => (byKey.get(a)!.operationKey.localeCompare(byKey.get(b)!.operationKey)));
  return { selectedOperationIds: selectedIds, approvedOperationIds: approved, dependencyOperationIds: [...deps].sort(), rejectedOperationIds: [], selectedCount: selectedIds.length, dependencyCount: deps.size, rejectedCount: 0, manifestDigest: "" };
}

export class InMemoryApprovalRepository implements ApprovalRepository {
  private readonly manifests = new Map<string, { digest: string; operations: ManifestOperation[] }>(); private readonly requests = new Map<string, ApprovalClosure>();
  seed(runId: string, manifest: { digest: string; operations: ManifestOperation[] }) { this.manifests.set(runId, manifest); }
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
    const result = closure(manifest.operations, input.operationIds, false); result.manifestDigest = manifest.digest;
    return this.repository.saveRequest(input.runId, input.requestKey, result);
  }
  async approveSafeDefaults(input: { runId: string; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> {
    const prior = await this.repository.getRequest(input.runId, input.requestKey); if (prior) { if (prior.manifestDigest !== input.expectedManifestDigest) fail("request_replay_mismatch", 409); return prior; }
    const manifest = await this.repository.getManifest(input.runId); if (!manifest) fail("manifest_not_found");
    if (manifest.digest !== input.expectedManifestDigest) fail("manifest_digest_mismatch");
    const safeRoots = manifest.operations.filter((operation) => operation.safeByDefault).map((operation) => operation.operationKey).sort(); const accepted: string[] = [];
    for (const root of safeRoots) { try { closure(manifest.operations, [root], true); accepted.push(root); } catch (error) { if (!(error instanceof Error) || !["unsafe_dependency", "dependency_cycle", "operation_not_found"].includes((error as Error & { code?: string }).code ?? "")) throw error; } }
    const result = closure(manifest.operations, accepted, false); result.manifestDigest = manifest.digest;
    return this.repository.saveRequest(input.runId, input.requestKey, result);
  }
}
