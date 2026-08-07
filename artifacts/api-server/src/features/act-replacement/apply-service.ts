import { randomUUID } from "node:crypto";
import { fingerprintSourceContent } from "./source-fingerprint";
import { verifyOverwrite } from "./local-edit-policy";
import type { ActApplyAction } from "./import-types";
import type { ApplyRepository, ApplyAttempt, ApplyBatchRecord, StoredOperation } from "./apply-repository";

export type ApplyBatchStatus = { batchId: string; runId: string; manifestDigest: string; state: ApplyBatchRecord["state"]; operationCount: number; completedCount: number; alreadyPresentCount: number; blockedCount: number; failedCount: number };
const status = (batch: ApplyBatchRecord): ApplyBatchStatus => ({ batchId: batch.batchId, runId: batch.runId, manifestDigest: batch.manifestDigest, state: batch.state, operationCount: batch.operationIds.length, completedCount: batch.completed, alreadyPresentCount: batch.alreadyPresent, blockedCount: batch.blocked, failedCount: batch.failed });
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };

export class ActApplyService {
  constructor(private readonly repository: ApplyRepository, private readonly enabled = false) {}
  async apply(input: { runId: string; approvedOperationIds: string[]; expectedManifestDigest: string; requestKey: string; approvalRequestKey?: string; startCursor?: number; requestedBy?: string; retryFailed?: boolean }): Promise<ApplyBatchStatus> {
    if (!this.enabled) fail("act_apply_disabled");
    if (this.repository.durableApply !== true) fail("durable_apply_unavailable");
    const replayFingerprint = fingerprintSourceContent({ digest: input.expectedManifestDigest, operationIds: [...input.approvedOperationIds].sort(), requestedBy: input.requestedBy ?? "" });
    const existing = await this.repository.getBatch(input.runId, input.requestKey); if (existing) {
      if (existing.fingerprint && existing.fingerprint !== replayFingerprint) fail("request_replay_mismatch");
      const expiredApplying = existing.state === "applying" && existing.leaseExpiresAt !== undefined && existing.leaseExpiresAt <= Date.now();
      if (existing.state !== "queued" && !expiredApplying) return status(existing);
      if (existing.manifestDigest !== input.expectedManifestDigest || JSON.stringify([...existing.operationIds].sort()) !== JSON.stringify([...input.approvedOperationIds].sort())) fail("request_replay_mismatch");
    }
    const currentDigest = await this.repository.getManifestDigest(input.runId); if (!currentDigest || currentDigest !== input.expectedManifestDigest) fail("manifest_digest_mismatch");
    const operations = await this.repository.getOperations(input.runId, input.approvedOperationIds); if (operations.length !== new Set(input.approvedOperationIds).size) fail("operation_not_found");
    if (operations.some((operation) => operation.sourceVersionId.trim() === "")) fail("source_version_missing");
    if (operations.some((operation) => !operation.safeByDefault || operation.action === "overwrite_reviewed")) fail("operation_not_safe");
    if (operations.some((operation) => operation.status !== "applied" && operation.status !== "already_present" && operation.outcomeState !== "ready" && !(input.retryFailed && operation.outcomeState === "failed"))) fail("outcome_not_ready");
    if (operations.some((operation) => operation.latestSourceVersionId !== operation.sourceVersionId)) fail("source_version_changed");
    const keys = new Set(operations.map((operation) => operation.operationKey));
    const priorDependencyIds = [...new Set(operations.flatMap((operation) => operation.dependencyOperationKeys ?? []).filter((dependency) => !keys.has(dependency)))];
    if (priorDependencyIds.length) {
      const priorDependencies = await this.repository.getOperations(input.runId, priorDependencyIds);
      if (priorDependencies.length !== priorDependencyIds.length || priorDependencies.some((dependency) => dependency.status !== "applied" && dependency.status !== "already_present")) fail("dependency_not_approved");
    }
    const attemptToken = randomUUID();
    const claim = await this.repository.createBatch({ batchId: `${input.runId}:${input.requestKey}`, runId: input.runId, requestKey: input.requestKey, approvalRequestKey: input.approvalRequestKey, startCursor: input.startCursor, manifestDigest: input.expectedManifestDigest, operationIds: [...input.approvedOperationIds], state: "applying", leaseOwner: input.requestedBy, leaseExpiresAt: Date.now() + 120_000, attemptToken, fingerprint: replayFingerprint });
    if (!claim.claimed) return status(claim.batch);
    if (claim.batch.attemptToken !== attemptToken) fail("apply_attempt_lost");
    const batch = claim.batch;
    const attempt = { batchId: batch.batchId, attemptToken };
    const ordered = this.order(operations); for (const operation of ordered) await this.execute(operation, batch, ordered, attempt);
    batch.state = batch.failed || batch.blocked ? "complete_with_issues" : "complete"; await this.repository.finishBatch(batch, attempt); return status(batch);
  }
  private order(operations: StoredOperation[]) { const pending = new Map(operations.map((operation) => [operation.operationKey, operation])); const ordered: StoredOperation[] = []; while (pending.size) { const ready = [...pending.values()].filter((operation) => (operation.dependencyOperationKeys ?? []).every((dependency) => ordered.some((item) => item.operationKey === dependency) || !pending.has(dependency))).sort((a, b) => a.operationKey.localeCompare(b.operationKey)); if (!ready.length) fail("dependency_cycle"); for (const operation of ready) { pending.delete(operation.operationKey); ordered.push(operation); } } return ordered; }
  private async execute(operation: StoredOperation, batch: ApplyBatchRecord, all: StoredOperation[], attempt: ApplyAttempt) {
    if (operation.status === "applied" || operation.status === "already_present") { batch.alreadyPresent += 1; return; }
    operation.attemptCount += 1; operation.status = "leased"; await this.repository.saveOperation(operation, attempt);
    try {
      const blockedDependency = (operation.dependencyOperationKeys ?? []).some((key) => { const dependency = all.find((item) => item.operationKey === key); return dependency && dependency.status !== "applied" && dependency.status !== "already_present"; });
      if (blockedDependency) { operation.status = "blocked"; operation.lastErrorCode = "dependency_not_applied"; batch.blocked += 1; await this.repository.saveOperation(operation, attempt); return; }
      const payload = operation.payload; const action = operation.action as ActApplyAction;
      if (action === "create") { const result = await this.repository.createTarget(operation.targetType, (payload.normalized as Record<string, unknown>) ?? payload, operation.sourceRecordId, operation.sourceVersionId, attempt); operation.status = result.alreadyPresent ? "already_present" : "applied"; if (result.alreadyPresent) batch.alreadyPresent += 1; else batch.completed += 1; }
      else if (action === "link_existing") {
        const target = await this.repository.getTarget(operation.targetType, String(payload.localId ?? ""));
        if (!target) throw Object.assign(new Error("target_not_found"), { code: "target_not_found" });
        await this.repository.recordProvenance(operation, attempt);
        operation.status = "already_present";
        batch.alreadyPresent += 1;
      }
      else if (action === "fill_missing" || action === "overwrite_reviewed") {
        const maybeTarget = await this.repository.getTarget(operation.targetType, String(payload.entityId ?? payload.localId ?? "")) ?? await this.repository.findTargetBySource?.(operation.targetType, operation.sourceRecordId);
        if (!maybeTarget) throw Object.assign(new Error("target_not_found"), { code: "target_not_found" });
        const target = maybeTarget;
        const field = String(payload.fieldName ?? "");
        const current = target.values[field];
        if (action === "fill_missing") {
          const fillResult = await this.repository.fillMissingTarget(target, field, payload.value, attempt);
          if (fillResult === "local_value_nonempty") {
            operation.status = "blocked";
            operation.lastErrorCode = "local_value_nonempty";
            batch.blocked += 1;
          } else {
            await this.repository.recordOrigin({ entityType: operation.targetType, entityId: target.id, fieldName: field, sourceRecordId: operation.sourceRecordId, sourceVersionId: operation.sourceVersionId, operationId: operation.id, sourceValueFingerprint: fingerprintSourceContent({ value: payload.value }) }, attempt);
            operation.status = fillResult;
            operation.lastErrorCode = undefined;
            if (fillResult === "already_present") batch.alreadyPresent += 1;
            else batch.completed += 1;
          }
        }
        else if (action === "overwrite_reviewed") { const proof = payload.proof as Parameters<typeof verifyOverwrite>[0]["proof"]; const decision = payload.decision as Parameters<typeof verifyOverwrite>[0]["decision"]; if (!proof || fingerprintSourceContent({ value: proof.sourceValue }) !== fingerprintSourceContent({ value: payload.value })) fail("source_value_changed"); const checked = verifyOverwrite({ local: { entityType: operation.targetType, entityId: target.id, fieldName: field, value: current }, proof, expectedSourceVersionId: operation.sourceVersionId, decision }); if (!checked.ok) fail(checked.code); await this.repository.writeTarget(target, field, payload.value, attempt); await this.repository.recordOrigin({ entityType: operation.targetType, entityId: target.id, fieldName: field, sourceRecordId: operation.sourceRecordId, sourceVersionId: operation.sourceVersionId, operationId: operation.id, sourceValueFingerprint: fingerprintSourceContent({ value: payload.value }) }, attempt); operation.status = "applied"; batch.completed += 1; }
      } else if (action === "create_relationship") { const result = await this.repository.createRelationship(operation, attempt); operation.status = result; if (result === "already_present") batch.alreadyPresent += 1; else batch.completed += 1; }
      else if (action === "record_provenance") { await this.repository.recordProvenance(operation, attempt); operation.status = "applied"; batch.completed += 1; }
      else { operation.status = "applied"; batch.completed += 1; }
      await this.repository.saveOperation(operation, attempt);
    } catch (error) { if (error instanceof Error && "code" in error && (error as Error & { code: unknown }).code === "apply_attempt_lost") throw error; operation.status = "failed"; operation.lastErrorCode = error instanceof Error && "code" in error ? String((error as Error & { code: unknown }).code) : "apply_failed"; batch.failed += 1; await this.repository.saveOperation(operation, attempt); }
  }
}
