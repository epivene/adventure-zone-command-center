import type { ManifestOperation } from "./manifest-builder";
import { localValueFingerprint } from "./local-edit-policy";

export type StoredOperation = ManifestOperation & { id: string; status: "pending" | "leased" | "applied" | "already_present" | "blocked" | "failed"; attemptCount: number; lastErrorCode?: string; outcomeState: string; latestSourceVersionId: string | null };
export type ApplyTarget = { id: string; entityType: string; values: Record<string, unknown>; sourceIds?: Set<string>; importedFingerprints?: Map<string, string> };
export type ApplyAttempt = { batchId: string; attemptToken: string };
export type ApplyBatchRecord = { batchId: string; runId: string; requestKey: string; approvalRequestKey?: string; startCursor?: number; manifestDigest: string; operationIds: string[]; state: "queued" | "applying" | "complete" | "complete_with_issues"; completed: number; alreadyPresent: number; blocked: number; failed: number; leaseOwner?: string; leaseExpiresAt?: number; attemptToken?: string; fingerprint?: string };
export type ApplyBatchClaim = { batch: ApplyBatchRecord; claimed: boolean };
export type FillMissingResult = "applied" | "already_present" | "local_value_nonempty";
export type ApplyOrigin = { entityType: string; entityId: string; fieldName: string; sourceRecordId: string; sourceVersionId: string; operationId: string; sourceValueFingerprint: string };
export type ReviewedOverwriteInput = { target: ApplyTarget; field: string; value: unknown; expectedLocalValue: unknown; expectedLocalValueFingerprint: string; origin: ApplyOrigin; operation: StoredOperation };

const storedValuesEquivalent = (current: unknown, proposed: unknown): boolean => {
  if (Object.is(current, proposed)) return true;
  if (current instanceof Date && typeof proposed === "string") {
    const parsed = Date.parse(proposed);
    return !Number.isNaN(parsed) && current.getTime() === parsed;
  }
  if (proposed instanceof Date && typeof current === "string") {
    const parsed = Date.parse(current);
    return !Number.isNaN(parsed) && proposed.getTime() === parsed;
  }
  return false;
};

export interface ApplyRepository {
  readonly durableApply: true;
  getOperations(runId: string, ids: string[]): Promise<StoredOperation[]>;
  getManifestDigest(runId: string): Promise<string | null>;
  getApproval(runId: string, requestKey: string): Promise<{ approvedOperationIds: string[]; manifestDigest: string } | null>;
  listApprovalBatches(runId: string, approvalRequestKey: string): Promise<ApplyBatchRecord[]>;
  updateRunPhase(runId: string, phase: "ready_to_apply" | "applying" | "complete" | "complete_with_issues", errorCode?: string): Promise<void>;
  createBatch(input: Omit<ApplyBatchRecord, "completed" | "alreadyPresent" | "blocked" | "failed">): Promise<ApplyBatchClaim>;
  getBatch(runId: string, requestKey: string): Promise<ApplyBatchRecord | null>;
  saveOperation(operation: StoredOperation, attempt: ApplyAttempt): Promise<void>;
  getTarget(entityType: string, id: string): Promise<ApplyTarget | null>;
  findTargetBySource?(entityType: string, sourceRecordId: string): Promise<ApplyTarget | null>;
  createTarget(entityType: string, values: Record<string, unknown>, sourceRecordId: string, sourceVersionId: string | undefined, attempt: ApplyAttempt): Promise<{ target: ApplyTarget; alreadyPresent: boolean }>;
  fillMissingTarget(target: ApplyTarget, field: string, value: unknown, attempt: ApplyAttempt, sourceRecordId: string): Promise<FillMissingResult>;
  writeTarget(target: ApplyTarget, field: string, value: unknown, attempt: ApplyAttempt): Promise<void>;
  applyReviewedOverwrite(input: ReviewedOverwriteInput, attempt: ApplyAttempt): Promise<void>;
  recordOrigin(input: ApplyOrigin, attempt: ApplyAttempt): Promise<void>;
  createRelationship(operation: StoredOperation, attempt: ApplyAttempt): Promise<"applied" | "already_present">;
  recordProvenance(operation: StoredOperation, attempt: ApplyAttempt): Promise<void>;
  finishBatch(batch: ApplyBatchRecord, attempt: ApplyAttempt): Promise<void>;
}

export class InMemoryApplyRepository implements ApplyRepository {
  readonly durableApply = true as const;
  constructor(options: { unsafeForTests: true }) { this.durableApply = options.unsafeForTests; }
  readonly operations = new Map<string, StoredOperation>(); readonly targets = new Map<string, ApplyTarget>(); readonly batches = new Map<string, ApplyBatchRecord>(); readonly origins: Array<Record<string, unknown>> = [];
  seedOperations(operations: readonly ManifestOperation[]) { for (const operation of operations) this.operations.set(operation.operationKey, { ...operation, id: operation.operationKey, status: "pending", attemptCount: 0, outcomeState: "ready", latestSourceVersionId: operation.sourceVersionId }); }
  async getOperations(_runId: string, ids: string[]) { return ids.map((id) => this.operations.get(id)).filter((item): item is StoredOperation => Boolean(item)).map((item) => ({ ...item, payload: { ...item.payload }, dependencyOperationKeys: [...item.dependencyOperationKeys] })); }
  private digests = new Map<string, string>();
  readonly activeOrganizerRuns = new Set<string>();
  seedManifest(runId: string, digest: string) { this.digests.set(runId, digest); this.runPhases.set(runId, "ready_to_apply"); }
  async getManifestDigest(runId: string) { return this.digests.get(runId) ?? null; }
  readonly approvals = new Map<string, { approvedOperationIds: string[]; manifestDigest: string }>(); readonly runPhases = new Map<string, string>();
  seedApproval(runId: string, requestKey: string, approvedOperationIds: string[], manifestDigest: string) { this.approvals.set(`${runId}:${requestKey}`, { approvedOperationIds: [...approvedOperationIds], manifestDigest }); }
  async getApproval(runId: string, requestKey: string) { return this.approvals.get(`${runId}:${requestKey}`) ?? null; }
  async listApprovalBatches(runId: string, approvalRequestKey: string) { return [...this.batches.values()].filter((batch) => batch.runId === runId && batch.approvalRequestKey === approvalRequestKey).sort((a, b) => (a.startCursor ?? 0) - (b.startCursor ?? 0) || a.requestKey.localeCompare(b.requestKey)).map((batch) => ({ ...batch, operationIds: [...batch.operationIds] })); }
  async updateRunPhase(runId: string, phase: "ready_to_apply" | "applying" | "complete" | "complete_with_issues") { this.runPhases.set(runId, phase); }
  async createBatch(input: Omit<ApplyBatchRecord, "completed" | "alreadyPresent" | "blocked" | "failed">): Promise<ApplyBatchClaim> { const phase = this.runPhases.get(input.runId); if (!["ready_to_apply", "applying", "complete_with_issues"].includes(phase ?? "") || this.digests.get(input.runId) !== input.manifestDigest || this.activeOrganizerRuns.has(input.runId)) throw Object.assign(new Error("apply_run_not_claimable"), { code: "apply_run_not_claimable", status: 409 }); this.runPhases.set(input.runId, "applying"); const prior = this.batches.get(`${input.runId}:${input.requestKey}`); if (prior) { if (prior.state === "queued" || (prior.state === "applying" && (prior.leaseExpiresAt ?? Number.POSITIVE_INFINITY) <= Date.now())) { prior.state = "applying"; prior.leaseOwner = input.leaseOwner; prior.leaseExpiresAt = input.leaseExpiresAt; prior.attemptToken = input.attemptToken; prior.fingerprint = input.fingerprint; return { batch: { ...prior, operationIds: [...prior.operationIds] }, claimed: true }; } return { batch: { ...prior, operationIds: [...prior.operationIds] }, claimed: false }; } const row = { ...input, completed: 0, alreadyPresent: 0, blocked: 0, failed: 0 }; this.batches.set(`${input.runId}:${input.requestKey}`, row); return { batch: { ...row, operationIds: [...row.operationIds] }, claimed: true }; }
  async getBatch(runId: string, requestKey: string) { const batch = this.batches.get(`${runId}:${requestKey}`); return batch ? { ...batch, operationIds: [...batch.operationIds] } : null; }
  private assertAttempt(attempt: ApplyAttempt) { const batch = [...this.batches.values()].find((candidate) => candidate.batchId === attempt.batchId); if (!batch || batch.state !== "applying" || batch.attemptToken !== attempt.attemptToken || (batch.leaseExpiresAt ?? 0) <= Date.now()) throw Object.assign(new Error("apply_attempt_lost"), { code: "apply_attempt_lost", status: 409 }); batch.leaseExpiresAt = Date.now() + 120_000; }
  async saveOperation(operation: StoredOperation, attempt: ApplyAttempt) { this.assertAttempt(attempt); this.operations.set(operation.operationKey, { ...operation, payload: { ...operation.payload }, dependencyOperationKeys: [...operation.dependencyOperationKeys] }); }
  async getTarget(entityType: string, id: string) { return this.targets.get(`${entityType}:${id}`) ?? null; }
  async findTargetBySource(entityType: string, sourceRecordId: string) { return [...this.targets.values()].find((target) => target.entityType === entityType && target.sourceIds?.has(sourceRecordId)) ?? null; }
  async createTarget(entityType: string, values: Record<string, unknown>, sourceRecordId: string, _sourceVersionId: string | undefined, attempt: ApplyAttempt) { this.assertAttempt(attempt); const existing = [...this.targets.values()].find((target) => target.entityType === entityType && target.sourceIds?.has(sourceRecordId)); if (existing) return { target: existing, alreadyPresent: true }; const target = { id: `${entityType}-${this.targets.size + 1}`, entityType, values: { ...values }, sourceIds: new Set([sourceRecordId]) }; this.targets.set(`${entityType}:${target.id}`, target); return { target, alreadyPresent: false }; }
  async fillMissingTarget(target: ApplyTarget, field: string, value: unknown, attempt: ApplyAttempt, sourceRecordId: string): Promise<FillMissingResult> { this.assertAttempt(attempt); const authoritative = this.targets.get(`${target.entityType}:${target.id}`); if (!authoritative) throw Object.assign(new Error("target_not_found"), { code: "target_not_found" }); if (!authoritative.sourceIds?.has(sourceRecordId)) throw Object.assign(new Error("fill_target_changed"), { code: "fill_target_changed", status: 409 }); const current = authoritative.values[field]; if (current !== null && current !== undefined && current !== "") return storedValuesEquivalent(current, value) ? "already_present" : "local_value_nonempty"; authoritative.values[field] = value; target.values[field] = value; return "applied"; }
  async writeTarget(target: ApplyTarget, field: string, value: unknown, attempt: ApplyAttempt) { this.assertAttempt(attempt); target.values[field] = value; }
  async applyReviewedOverwrite(input: ReviewedOverwriteInput, attempt: ApplyAttempt) { this.assertAttempt(attempt); const authoritative = this.targets.get(`${input.target.entityType}:${input.target.id}`); if (!authoritative) throw Object.assign(new Error("target_not_found"), { code: "target_not_found" }); if (localValueFingerprint(input.expectedLocalValue) !== input.expectedLocalValueFingerprint || localValueFingerprint(authoritative.values[input.field]) !== input.expectedLocalValueFingerprint) throw Object.assign(new Error("local_edit_detected"), { code: "local_edit_detected" }); authoritative.values[input.field] = input.value; input.target.values[input.field] = input.value; const originIndex = this.origins.findIndex((origin) => origin.entityType === input.origin.entityType && origin.entityId === input.origin.entityId && origin.fieldName === input.origin.fieldName); if (originIndex === -1) this.origins.push({ ...input.origin }); else this.origins[originIndex] = { ...input.origin }; this.operations.set(input.operation.operationKey, { ...input.operation, status: "applied", lastErrorCode: undefined, payload: { ...input.operation.payload }, dependencyOperationKeys: [...input.operation.dependencyOperationKeys] }); }
  async recordOrigin(input: Record<string, unknown>, attempt: ApplyAttempt) { this.assertAttempt(attempt); this.origins.push(input); }
  async createRelationship(_operation: StoredOperation, attempt: ApplyAttempt) { this.assertAttempt(attempt); return "applied" as const; }
  async recordProvenance(_operation: StoredOperation, attempt: ApplyAttempt) { this.assertAttempt(attempt); }
  async finishBatch(batch: ApplyBatchRecord, attempt: ApplyAttempt) { this.assertAttempt(attempt); this.batches.set(`${batch.runId}:${batch.requestKey}`, { ...batch, attemptToken: undefined, leaseOwner: undefined, leaseExpiresAt: undefined, operationIds: [...batch.operationIds] }); }
}
