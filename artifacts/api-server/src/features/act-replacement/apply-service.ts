import { fingerprintSourceContent } from "./source-fingerprint";
import { canFillMissing, verifyOverwrite } from "./local-edit-policy";
import type { ActApplyAction } from "./import-types";
import type { ApplyRepository, ApplyBatchRecord, StoredOperation } from "./apply-repository";

export type ApplyBatchStatus = { batchId: string; runId: string; manifestDigest: string; state: ApplyBatchRecord["state"]; operationCount: number; completedCount: number; alreadyPresentCount: number; blockedCount: number; failedCount: number };
const status = (batch: ApplyBatchRecord): ApplyBatchStatus => ({ batchId: batch.batchId, runId: batch.runId, manifestDigest: batch.manifestDigest, state: batch.state, operationCount: batch.operationIds.length, completedCount: batch.completed, alreadyPresentCount: batch.alreadyPresent, blockedCount: batch.blocked, failedCount: batch.failed });
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };

export class ActApplyService {
  constructor(private readonly repository: ApplyRepository, private readonly enabled = false) {}
  async apply(input: { runId: string; approvedOperationIds: string[]; expectedManifestDigest: string; requestKey: string; requestedBy?: string }): Promise<ApplyBatchStatus> {
    if (!this.enabled) fail("act_apply_disabled");
    if (this.repository.durableApply !== true) fail("durable_apply_unavailable");
    const replayFingerprint = fingerprintSourceContent({ digest: input.expectedManifestDigest, operationIds: [...input.approvedOperationIds].sort(), requestedBy: input.requestedBy ?? "" });
    const existing = await this.repository.getBatch(input.runId, input.requestKey); if (existing) { if (existing.fingerprint && existing.fingerprint !== replayFingerprint) fail("request_replay_mismatch"); return status(existing); }
    const currentDigest = await this.repository.getManifestDigest(input.runId); if (!currentDigest || currentDigest !== input.expectedManifestDigest) fail("manifest_digest_mismatch");
    const operations = await this.repository.getOperations(input.runId, input.approvedOperationIds); if (operations.length !== new Set(input.approvedOperationIds).size) fail("operation_not_found");
    if (operations.some((operation) => operation.sourceVersionId.trim() === "")) fail("source_version_missing");
    const keys = new Set(operations.map((operation) => operation.operationKey));
    for (const operation of operations) for (const dependency of operation.dependencyOperationKeys ?? []) if (!keys.has(dependency)) fail("dependency_not_approved");
    const batch = await this.repository.createBatch({ batchId: `${input.runId}:${input.requestKey}`, runId: input.runId, requestKey: input.requestKey, manifestDigest: input.expectedManifestDigest, operationIds: [...input.approvedOperationIds].sort(), state: "applying", leaseOwner: input.requestedBy, leaseExpiresAt: Date.now() + 120_000, fingerprint: replayFingerprint });
    const ordered = this.order(operations); for (const operation of ordered) await this.execute(operation, batch, ordered);
    batch.state = batch.failed || batch.blocked ? "complete_with_issues" : "complete"; await this.repository.finishBatch(batch); return status(batch);
  }
  private order(operations: StoredOperation[]) { const pending = new Map(operations.map((operation) => [operation.operationKey, operation])); const ordered: StoredOperation[] = []; while (pending.size) { const ready = [...pending.values()].filter((operation) => (operation.dependencyOperationKeys ?? []).every((dependency) => ordered.some((item) => item.operationKey === dependency) || !pending.has(dependency))).sort((a, b) => a.operationKey.localeCompare(b.operationKey)); if (!ready.length) fail("dependency_cycle"); for (const operation of ready) { pending.delete(operation.operationKey); ordered.push(operation); } } return ordered; }
  private async execute(operation: StoredOperation, batch: ApplyBatchRecord, all: StoredOperation[]) {
    if (operation.status === "applied" || operation.status === "already_present") { batch.alreadyPresent += 1; return; }
    operation.attemptCount += 1; operation.status = "leased"; await this.repository.saveOperation(operation);
    try {
      const blockedDependency = (operation.dependencyOperationKeys ?? []).some((key) => { const dependency = all.find((item) => item.operationKey === key); return dependency && dependency.status !== "applied" && dependency.status !== "already_present"; });
      if (blockedDependency) { operation.status = "blocked"; operation.lastErrorCode = "dependency_not_applied"; batch.blocked += 1; await this.repository.saveOperation(operation); return; }
      const payload = operation.payload; const action = operation.action as ActApplyAction;
      if (action === "create") { const result = await this.repository.createTarget(operation.targetType, (payload.normalized as Record<string, unknown>) ?? payload, operation.sourceRecordId); operation.status = result.alreadyPresent ? "already_present" : "applied"; if (result.alreadyPresent) batch.alreadyPresent += 1; else batch.completed += 1; }
      else if (action === "link_existing") { const target = await this.repository.getTarget(operation.targetType, String(payload.localId ?? "")); if (!target) fail("target_not_found"); operation.status = "already_present"; batch.alreadyPresent += 1; }
      else if (action === "fill_missing" || action === "overwrite_reviewed") {
        const maybeTarget = await this.repository.getTarget(operation.targetType, String(payload.entityId ?? payload.localId ?? "")) ?? await this.repository.findTargetBySource?.(operation.targetType, operation.sourceRecordId); if (!maybeTarget) fail("target_not_found"); const target = maybeTarget; const field = String(payload.fieldName ?? ""); const current = target.values[field];
        if (action === "fill_missing" && !canFillMissing(current)) { operation.status = "blocked"; operation.lastErrorCode = "local_value_nonempty"; batch.blocked += 1; }
        else if (action === "overwrite_reviewed") { const proof = payload.proof as Parameters<typeof verifyOverwrite>[0]["proof"]; const decision = payload.decision as Parameters<typeof verifyOverwrite>[0]["decision"]; if (!proof || fingerprintSourceContent({ value: proof.sourceValue }) !== fingerprintSourceContent({ value: payload.value })) fail("source_value_changed"); const checked = verifyOverwrite({ local: { entityType: operation.targetType, entityId: target.id, fieldName: field, value: current }, proof, expectedSourceVersionId: operation.sourceVersionId, decision }); if (!checked.ok) fail(checked.code); await this.repository.writeTarget(target, field, payload.value); await this.repository.recordOrigin({ entityType: operation.targetType, entityId: target.id, fieldName: field, sourceRecordId: operation.sourceRecordId, sourceVersionId: operation.sourceVersionId, operationId: operation.id, sourceValueFingerprint: fingerprintSourceContent({ value: payload.value }) }); operation.status = "applied"; batch.completed += 1; }
        else { await this.repository.writeTarget(target, field, payload.value); await this.repository.recordOrigin({ entityType: operation.targetType, entityId: target.id, fieldName: field, sourceRecordId: operation.sourceRecordId, sourceVersionId: operation.sourceVersionId, operationId: operation.id, sourceValueFingerprint: fingerprintSourceContent({ value: payload.value }) }); operation.status = "applied"; batch.completed += 1; }
      } else if (action === "create_relationship") { const result = await this.repository.createRelationship(operation); operation.status = result; if (result === "already_present") batch.alreadyPresent += 1; else batch.completed += 1; }
      else if (action === "record_provenance") { await this.repository.recordProvenance(operation); operation.status = "applied"; batch.completed += 1; }
      else { operation.status = "applied"; batch.completed += 1; }
      await this.repository.saveOperation(operation);
    } catch (error) { operation.status = "failed"; operation.lastErrorCode = error instanceof Error && "code" in error ? String((error as Error & { code: unknown }).code) : "apply_failed"; batch.failed += 1; await this.repository.saveOperation(operation); }
  }
}
