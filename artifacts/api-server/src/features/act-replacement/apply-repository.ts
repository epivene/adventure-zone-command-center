import type { ManifestOperation } from "./manifest-builder";

export type StoredOperation = ManifestOperation & { id: string; status: "pending" | "leased" | "applied" | "already_present" | "blocked" | "failed"; attemptCount: number; lastErrorCode?: string };
export type ApplyTarget = { id: string; entityType: string; values: Record<string, unknown>; sourceIds?: Set<string>; importedFingerprints?: Map<string, string> };
export type ApplyBatchRecord = { batchId: string; runId: string; requestKey: string; manifestDigest: string; operationIds: string[]; state: "queued" | "applying" | "complete" | "complete_with_issues"; completed: number; alreadyPresent: number; blocked: number; failed: number; leaseOwner?: string; leaseExpiresAt?: number; fingerprint?: string };

export interface ApplyRepository {
  readonly durableApply: true;
  getOperations(runId: string, ids: string[]): Promise<StoredOperation[]>;
  getManifestDigest(runId: string): Promise<string | null>;
  createBatch(input: Omit<ApplyBatchRecord, "completed" | "alreadyPresent" | "blocked" | "failed">): Promise<ApplyBatchRecord>;
  getBatch(runId: string, requestKey: string): Promise<ApplyBatchRecord | null>;
  saveOperation(operation: StoredOperation): Promise<void>;
  getTarget(entityType: string, id: string): Promise<ApplyTarget | null>;
  findTargetBySource?(entityType: string, sourceRecordId: string): Promise<ApplyTarget | null>;
  createTarget(entityType: string, values: Record<string, unknown>, sourceRecordId: string): Promise<{ target: ApplyTarget; alreadyPresent: boolean }>;
  writeTarget(target: ApplyTarget, field: string, value: unknown): Promise<void>;
  recordOrigin(input: { entityType: string; entityId: string; fieldName: string; sourceRecordId: string; sourceVersionId: string; operationId: string; sourceValueFingerprint: string }): Promise<void>;
  createRelationship(operation: StoredOperation): Promise<"applied" | "already_present">;
  recordProvenance(operation: StoredOperation): Promise<void>;
  finishBatch(batch: ApplyBatchRecord): Promise<void>;
}

export class InMemoryApplyRepository implements ApplyRepository {
  readonly durableApply = true as const;
  constructor(options: { unsafeForTests: true }) { this.durableApply = options.unsafeForTests; }
  readonly operations = new Map<string, StoredOperation>(); readonly targets = new Map<string, ApplyTarget>(); readonly batches = new Map<string, ApplyBatchRecord>(); readonly origins: Array<Record<string, unknown>> = [];
  seedOperations(operations: readonly ManifestOperation[]) { for (const operation of operations) this.operations.set(operation.operationKey, { ...operation, id: operation.operationKey, status: "pending", attemptCount: 0 }); }
  async getOperations(_runId: string, ids: string[]) { return ids.map((id) => this.operations.get(id)).filter((item): item is StoredOperation => Boolean(item)); }
  private digests = new Map<string, string>();
  seedManifest(runId: string, digest: string) { this.digests.set(runId, digest); }
  async getManifestDigest(runId: string) { return this.digests.get(runId) ?? null; }
  async createBatch(input: Omit<ApplyBatchRecord, "completed" | "alreadyPresent" | "blocked" | "failed">) { const prior = this.batches.get(`${input.runId}:${input.requestKey}`); if (prior) return prior; const row = { ...input, completed: 0, alreadyPresent: 0, blocked: 0, failed: 0 }; this.batches.set(`${input.runId}:${input.requestKey}`, row); return row; }
  async getBatch(runId: string, requestKey: string) { return this.batches.get(`${runId}:${requestKey}`) ?? null; }
  async saveOperation(operation: StoredOperation) { this.operations.set(operation.operationKey, operation); }
  async getTarget(entityType: string, id: string) { return this.targets.get(`${entityType}:${id}`) ?? null; }
  async findTargetBySource(entityType: string, sourceRecordId: string) { return [...this.targets.values()].find((target) => target.entityType === entityType && target.sourceIds?.has(sourceRecordId)) ?? null; }
  async createTarget(entityType: string, values: Record<string, unknown>, sourceRecordId: string) { const existing = [...this.targets.values()].find((target) => target.entityType === entityType && target.sourceIds?.has(sourceRecordId)); if (existing) return { target: existing, alreadyPresent: true }; const target = { id: `${entityType}-${this.targets.size + 1}`, entityType, values: { ...values }, sourceIds: new Set([sourceRecordId]) }; this.targets.set(`${entityType}:${target.id}`, target); return { target, alreadyPresent: false }; }
  async writeTarget(target: ApplyTarget, field: string, value: unknown) { target.values[field] = value; }
  async recordOrigin(input: Record<string, unknown>) { this.origins.push(input); }
  async createRelationship(_operation: StoredOperation) { return "applied" as const; }
  async recordProvenance(_operation: StoredOperation) { return; }
  async finishBatch(batch: ApplyBatchRecord) { this.batches.set(`${batch.runId}:${batch.requestKey}`, batch); }
}
