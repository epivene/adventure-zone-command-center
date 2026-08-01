import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actExternalLinks,
  actMigrationApplyBatches,
  actMigrationApplyOperations,
  actMigrationProposals,
  actMigrationRecords,
  actMigrationRuns,
} from "@/db/schema";
import {
  buildMigrationApplyManifest,
  migrationApplyManifestDigest,
} from "@/features/act-migration/apply-manifest";
import type {
  MigrationApplyManifest,
  MigrationApplyProposal,
  MigrationResolvedDependency,
  MigrationStableLink,
} from "@/features/act-migration/apply-types";
import {
  type ActMigrationProposal,
  type MigrationApplyBatchStatus,
  type MigrationApplyOperationStatus,
  type MigrationDecision,
  type MigrationTargetEntityType,
} from "@/features/act-migration/migration-types";
import { proposalSnapshotDigest } from "@/features/act-migration/reconciliation";
import { ActMigrationRunNotFoundError } from "@/features/act-migration/snapshot-repository";

type DrizzleDatabase = typeof database;
type DrizzleTransaction = Parameters<
  Parameters<DrizzleDatabase["transaction"]>[0]
>[0];
type StoredOperation = typeof actMigrationApplyOperations.$inferSelect;
type StoredProposal = typeof actMigrationProposals.$inferSelect;

export const ACT_MIGRATION_OPERATION_LEASE_MS = 2 * 60 * 1_000;

export type MigrationApplyOperation = {
  id: string;
  batchId: string;
  runId: string;
  proposalKey: string;
  targetEntityType: MigrationTargetEntityType;
  dependencyProposalKeys: readonly string[];
  resolvedDependencies: readonly MigrationResolvedDependency[];
  status: MigrationApplyOperationStatus;
  attemptCount: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  appliedEntityId: string | null;
  errorCode: string | null;
  retryable: boolean;
  proposal: MigrationApplyProposal;
};

export type MigrationApplyCounts = Record<MigrationApplyOperationStatus, number> & {
  total: number;
  created: number;
  updated: number;
};

export type MigrationApplyBatch = {
  id: string;
  requestKey: string;
  runId: string;
  requestedBy: string;
  status: MigrationApplyBatchStatus;
  manifestDigest: string;
  summary: MigrationApplyCounts;
  lastErrorCode: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
};

export type MigrationApplyWorkspace = {
  runId: string;
  runStatus: string;
  counts: MigrationApplyCounts;
  batches: readonly MigrationApplyBatch[];
};

export interface ActMigrationApplyRepository {
  createBatchIfAbsent(input: {
    requestKey: string;
    runId: string;
    requestedBy: string;
    manifest?: MigrationApplyManifest;
    now: Date;
  }): Promise<MigrationApplyBatch & { created: boolean }>;
  claimNextOperation(
    batchId: string,
    leaseOwner: string,
    now: Date,
  ): Promise<MigrationApplyOperation | null>;
  completeOperation(input: {
    operationId: string;
    leaseOwner: string;
    entityId: string;
    wasCreated: boolean;
    now: Date;
  }): Promise<void>;
  failOperation(input: {
    operationId: string;
    leaseOwner: string;
    errorCode: string;
    retryable: boolean;
    now: Date;
  }): Promise<void>;
  releaseExpiredLeases(batchId: string, now: Date): Promise<number>;
  getApplyWorkspace(runId: string): Promise<MigrationApplyWorkspace>;
}

function targetOrder(column: typeof actMigrationApplyOperations.targetEntityType) {
  return sql<number>`case ${column}
    when 'organization' then 0
    when 'contact' then 1
    when 'organization_contact' then 2
    when 'booking' then 3
    when 'booking_contact' then 4
    when 'calling_list' then 5
    when 'calling_list_member' then 6
    else 7 end`;
}

function proposalValue(row: StoredProposal): MigrationApplyProposal {
  return {
    proposalKey: row.proposalKey,
    state: row.state as ActMigrationProposal["state"],
    reviewState: row.reviewState as ActMigrationProposal["reviewState"],
    targetEntityType: row.targetEntityType as MigrationTargetEntityType,
    sourceRecordKeys: row.sourceRecordKeys,
    candidateLocalIds: row.candidateLocalIds,
    proposedLocalId: row.proposedLocalId,
    proposedPrimarySourceId: row.proposedPrimarySourceId,
    duplicateGroupKey: row.duplicateGroupKey,
    duplicateSourceIds: row.duplicateSourceIds,
    issueCode: row.issueCode as ActMigrationProposal["issueCode"],
    dependencyProposalKeys: row.dependencyProposalKeys,
    matchReason: row.matchReason ?? "",
    displaySnapshot: row.displaySnapshot as ActMigrationProposal["displaySnapshot"],
    decision: row.decision as MigrationDecision | null,
    chosenLocalEntityId: row.chosenLocalEntityId,
    primarySourceId: row.primarySourceId,
  };
}

function emptyCounts(): MigrationApplyCounts {
  return {
    pending: 0,
    leased: 0,
    blocked: 0,
    applied: 0,
    ignored: 0,
    failed: 0,
    total: 0,
    created: 0,
    updated: 0,
  };
}

function countOperations(operations: readonly StoredOperation[]): MigrationApplyCounts {
  const counts = emptyCounts();
  for (const operation of operations) {
    counts[operation.status as MigrationApplyOperationStatus] += 1;
    counts.total += 1;
    if (operation.status === "applied") {
      if (operation.wasCreated === true) counts.created += 1;
      else if (operation.wasCreated === false) counts.updated += 1;
    }
  }
  return counts;
}

function batchStatus(counts: MigrationApplyCounts): MigrationApplyBatchStatus {
  if (counts.failed > 0) return counts.applied > 0 ? "partially_applied" : "failed";
  if (counts.pending > 0 || counts.leased > 0 || counts.blocked > 0) {
    return counts.applied > 0 ? "partially_applied" : "applying";
  }
  return "applied";
}

function batchValue(
  row: typeof actMigrationApplyBatches.$inferSelect,
  summary: MigrationApplyCounts,
): MigrationApplyBatch {
  return {
    id: row.id,
    requestKey: row.requestKey,
    runId: row.runId,
    requestedBy: row.requestedBy,
    status: row.status as MigrationApplyBatchStatus,
    manifestDigest: row.manifestDigest,
    summary,
    lastErrorCode: row.lastErrorCode,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

function safeErrorCode(value: string) {
  const code = value.trim().toLowerCase();
  return /^[a-z0-9_:-]{1,120}$/.test(code) ? code : "unknown";
}

function operationValue(
  row: StoredOperation,
  proposal: StoredProposal,
): MigrationApplyOperation {
  return {
    id: row.id,
    batchId: row.batchId,
    runId: row.runId,
    proposalKey: row.proposalKey,
    targetEntityType: row.targetEntityType as MigrationTargetEntityType,
    dependencyProposalKeys: row.dependencyProposalKeys,
    resolvedDependencies: row.resolvedDependencies as MigrationResolvedDependency[],
    status: row.status as MigrationApplyOperationStatus,
    attemptCount: row.attemptCount,
    leaseOwner: row.leaseOwner,
    leaseExpiresAt: row.leaseExpiresAt,
    appliedEntityId: row.appliedEntityId,
    errorCode: row.errorCode,
    retryable: row.retryable,
    proposal: proposalValue(proposal),
  };
}

async function operationsForBatch(
  transaction: DrizzleTransaction,
  batchId: string,
) {
  return transaction
    .select()
    .from(actMigrationApplyOperations)
    .where(eq(actMigrationApplyOperations.batchId, batchId))
    .orderBy(
      targetOrder(actMigrationApplyOperations.targetEntityType),
      asc(actMigrationApplyOperations.proposalKey),
    )
    .for("update");
}

async function refreshBatchState(
  transaction: DrizzleTransaction,
  batchId: string,
  now: Date,
) {
  const operations = await operationsForBatch(transaction, batchId);
  const counts = countOperations(operations);
  const status = batchStatus(counts);
  const [batch] = await transaction
    .select()
    .from(actMigrationApplyBatches)
    .where(eq(actMigrationApplyBatches.id, batchId))
    .limit(1)
    .for("update");
  if (!batch) throw new Error("Act migration apply batch is missing.");
  const completed = status === "applied" || status === "failed";
  const [updated] = await transaction
    .update(actMigrationApplyBatches)
    .set({
      status,
      summary: counts,
      completedAt: completed ? now : null,
      updatedAt: now,
    })
    .where(eq(actMigrationApplyBatches.id, batchId))
    .returning();
  const [run] = await transaction
    .select({ id: actMigrationRuns.id })
    .from(actMigrationRuns)
    .where(eq(actMigrationRuns.id, batch.runId))
    .limit(1)
    .for("update");
  if (!run) throw new ActMigrationRunNotFoundError();
  await transaction
    .update(actMigrationRuns)
    .set({ status, updatedAt: now })
    .where(eq(actMigrationRuns.id, run.id));
  return { batch: updated!, counts };
}

async function updateDependencyBlocks(
  transaction: DrizzleTransaction,
  batchId: string,
  now: Date,
) {
  const operations = await operationsForBatch(transaction, batchId);
  const byProposalKey = new Map(operations.map((operation) => [
    operation.proposalKey,
    operation,
  ]));
  for (const operation of operations) {
    if (operation.status !== "pending" && operation.status !== "blocked") continue;
    const resolvedKeys = new Set(operation.resolvedDependencies.map(({ proposalKey }) => proposalKey));
    const ready = operation.dependencyProposalKeys.every((key) =>
      resolvedKeys.has(key) || byProposalKey.get(key)?.status === "applied",
    );
    const nextStatus = ready ? "pending" : "blocked";
    if (operation.status === nextStatus) continue;
    await transaction.update(actMigrationApplyOperations).set({
      status: nextStatus,
      updatedAt: now,
    }).where(eq(actMigrationApplyOperations.id, operation.id));
  }
}

async function releaseExpiredLeasesInTransaction(
  transaction: DrizzleTransaction,
  batchId: string,
  now: Date,
) {
  const released = await transaction
    .update(actMigrationApplyOperations)
    .set({
      status: "pending",
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(and(
      eq(actMigrationApplyOperations.batchId, batchId),
      eq(actMigrationApplyOperations.status, "leased"),
      lte(actMigrationApplyOperations.leaseExpiresAt, now),
    ))
    .returning({ id: actMigrationApplyOperations.id });
  return released.length;
}

export class DrizzleActMigrationApplyRepository
  implements ActMigrationApplyRepository
{
  constructor(private readonly database: DrizzleDatabase) {}

  createBatchIfAbsent(input: {
    requestKey: string;
    runId: string;
    requestedBy: string;
    manifest?: MigrationApplyManifest;
    now: Date;
  }): Promise<MigrationApplyBatch & { created: boolean }> {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(actMigrationApplyBatches)
        .where(eq(actMigrationApplyBatches.requestKey, input.requestKey))
        .limit(1).for("update");
      if (existing) {
        if (
          existing.runId !== input.runId ||
          (input.manifest && existing.manifestDigest !== input.manifest.digest)
        ) {
          throw new Error("Act migration apply request key conflicts with an existing batch.");
        }
        const operations = await operationsForBatch(transaction, existing.id);
        return { ...batchValue(existing, countOperations(operations)), created: false };
      }
      const requestedBy = input.requestedBy.trim();
      if (!requestedBy) throw new Error("Act migration apply requester is required.");
      const [run] = await transaction.select().from(actMigrationRuns)
        .where(eq(actMigrationRuns.id, input.runId)).limit(1).for("update");
      if (!run) throw new ActMigrationRunNotFoundError();
      const complete = typeof run.summary === "object" &&
        run.summary !== null &&
        (run.summary as { complete?: unknown }).complete === true;
      if (run.status !== "previewed" || !run.sourceDigest || !run.proposalDigest || !complete) {
        throw new Error("Act migration preview must be complete before apply can start.");
      }
      const proposals = await transaction.select().from(actMigrationProposals)
        .where(eq(actMigrationProposals.runId, input.runId))
        .orderBy(asc(actMigrationProposals.proposalKey)).for("update");
      const structural = proposals.map(proposalValue);
      if (proposalSnapshotDigest(structural) !== run.proposalDigest) {
        throw new Error("Act migration stored preview digest does not match the reviewed preview.");
      }
      const sourceKeys = [...new Set(proposals.flatMap((proposal) => proposal.sourceRecordKeys))];
      const records = sourceKeys.length === 0 ? [] : await transaction.select({
        sourceKey: actMigrationRecords.sourceKey,
        sourceId: actMigrationRecords.sourceId,
        streamType: actMigrationRecords.streamType,
      }).from(actMigrationRecords).where(and(
        eq(actMigrationRecords.runId, input.runId),
        inArray(actMigrationRecords.sourceKey, sourceKeys),
      )).for("update");
      const stableSourceIdentities = records.flatMap((record) =>
        record.sourceId === null ? [] : [{
          sourceEntityType: record.streamType,
          actRecordId: record.sourceId,
        }],
      );
      const links = stableSourceIdentities.length === 0 ? [] : await transaction.select({
        entityType: actExternalLinks.entityType,
        localEntityId: actExternalLinks.entityId,
        sourceEntityType: actExternalLinks.sourceEntityType,
        actRecordId: actExternalLinks.actRecordId,
      }).from(actExternalLinks).where(or(...stableSourceIdentities.map((identity) => and(
        eq(actExternalLinks.sourceEntityType, identity.sourceEntityType),
        eq(actExternalLinks.actRecordId, identity.actRecordId),
      )))).for("update");
      const recordByKey = new Map(records.map((record) => [record.sourceKey, record]));
      const stableLinks: MigrationStableLink[] = proposals.flatMap((proposal) => {
        if (proposal.state !== "matched_unchanged" || !proposal.proposedLocalId) return [];
        return proposal.sourceRecordKeys.flatMap((sourceRecordKey) => {
          const record = recordByKey.get(sourceRecordKey);
          return record && record.sourceId !== null
            ? links.filter((candidate) =>
                candidate.sourceEntityType === record.streamType &&
                candidate.actRecordId === record.sourceId,
              ).map((link) => ({
                targetEntityType: link.entityType as MigrationTargetEntityType,
                localEntityId: link.localEntityId,
                sourceRecordKey,
              }))
            : [];
        });
      });
      const manifest = buildMigrationApplyManifest({
        sourceDigest: run.sourceDigest,
        previewSourceDigest: run.sourceDigest,
        previewProposalDigest: run.proposalDigest,
        proposals: structural,
        stableLinks,
      });
      if (
        input.manifest &&
        (migrationApplyManifestDigest(input.manifest) !== input.manifest.digest ||
          manifest.digest !== input.manifest.digest)
      ) {
        throw new Error("Act migration apply manifest does not match the reviewed preview.");
      }
      const [batch] = await transaction.insert(actMigrationApplyBatches).values({
        requestKey: input.requestKey,
        runId: input.runId,
        requestedBy,
        status: manifest.entries.length === 0 ? "applied" : "applying",
        manifestDigest: manifest.digest,
        summary: emptyCounts(),
        startedAt: input.now,
        completedAt: manifest.entries.length === 0 ? input.now : null,
        updatedAt: input.now,
      }).returning();
      if (!batch) throw new Error("Act migration apply batch could not be created.");
      if (manifest.entries.length > 0) {
        await transaction.insert(actMigrationApplyOperations).values(manifest.entries.map((entry) => ({
          batchId: batch.id,
          runId: input.runId,
          proposalKey: entry.proposalKey,
          targetEntityType: entry.targetEntityType,
          dependencyProposalKeys: [...entry.dependencyProposalKeys],
          resolvedDependencies: [...entry.resolvedDependencies],
          status: "pending",
          retryable: true,
          createdAt: input.now,
          updatedAt: input.now,
        })));
      }
      const { batch: refreshed, counts } = await refreshBatchState(transaction, batch.id, input.now);
      return { ...batchValue(refreshed, counts), created: true };
    });
  }

  claimNextOperation(batchId: string, leaseOwner: string, now: Date): Promise<MigrationApplyOperation | null> {
    return this.database.transaction(async (transaction) => {
      const [batch] = await transaction.select().from(actMigrationApplyBatches)
        .where(eq(actMigrationApplyBatches.id, batchId)).limit(1).for("update");
      if (!batch || (batch.status !== "pending" && batch.status !== "applying" && batch.status !== "partially_applied")) return null;
      await releaseExpiredLeasesInTransaction(transaction, batchId, now);
      await updateDependencyBlocks(transaction, batchId, now);
      const [candidate] = await transaction.select().from(actMigrationApplyOperations)
        .where(and(
          eq(actMigrationApplyOperations.batchId, batchId),
          eq(actMigrationApplyOperations.status, "pending"),
          eq(actMigrationApplyOperations.retryable, true),
        ))
        .orderBy(targetOrder(actMigrationApplyOperations.targetEntityType), asc(actMigrationApplyOperations.proposalKey))
        .limit(1).for("update", { skipLocked: true });
      if (!candidate) {
        await refreshBatchState(transaction, batchId, now);
        return null;
      }
      const leaseExpiresAt = new Date(now.getTime() + ACT_MIGRATION_OPERATION_LEASE_MS);
      const [claimed] = await transaction.update(actMigrationApplyOperations).set({
        status: "leased", leaseOwner, leaseExpiresAt, attemptCount: sql`${actMigrationApplyOperations.attemptCount} + 1`,
        errorCode: null, updatedAt: now,
      }).where(eq(actMigrationApplyOperations.id, candidate.id)).returning();
      const [proposal] = await transaction.select().from(actMigrationProposals).where(and(
        eq(actMigrationProposals.runId, candidate.runId),
        eq(actMigrationProposals.proposalKey, candidate.proposalKey),
      )).limit(1).for("key share");
      if (!claimed || !proposal) throw new Error("Act migration apply operation proposal is missing.");
      await refreshBatchState(transaction, batchId, now);
      return operationValue(claimed, proposal);
    });
  }

  async completeOperation(input: { operationId: string; leaseOwner: string; entityId: string; wasCreated: boolean; now: Date }) {
    await this.database.transaction(async (transaction) => {
      const [operation] = await transaction.update(actMigrationApplyOperations).set({
        status: "applied", leaseOwner: null, leaseExpiresAt: null, appliedEntityId: input.entityId,
        wasCreated: input.wasCreated, errorCode: null, retryable: false, completedAt: input.now, updatedAt: input.now,
      }).where(and(
        eq(actMigrationApplyOperations.id, input.operationId),
        eq(actMigrationApplyOperations.status, "leased"),
        eq(actMigrationApplyOperations.leaseOwner, input.leaseOwner),
      )).returning();
      if (!operation) throw new Error("Act migration apply operation lease no longer matches.");
      await updateDependencyBlocks(transaction, operation.batchId, input.now);
      await refreshBatchState(transaction, operation.batchId, input.now);
    });
  }

  async failOperation(input: { operationId: string; leaseOwner: string; errorCode: string; retryable: boolean; now: Date }) {
    await this.database.transaction(async (transaction) => {
      const errorCode = safeErrorCode(input.errorCode);
      const [operation] = await transaction.update(actMigrationApplyOperations).set({
        status: input.retryable ? "pending" : "failed", leaseOwner: null, leaseExpiresAt: null,
        errorCode, retryable: input.retryable, completedAt: input.retryable ? null : input.now,
        updatedAt: input.now,
      }).where(and(
        eq(actMigrationApplyOperations.id, input.operationId),
        eq(actMigrationApplyOperations.status, "leased"),
        eq(actMigrationApplyOperations.leaseOwner, input.leaseOwner),
      )).returning();
      if (!operation) throw new Error("Act migration apply operation lease no longer matches.");
      await transaction.update(actMigrationApplyBatches).set({ lastErrorCode: errorCode, updatedAt: input.now })
        .where(eq(actMigrationApplyBatches.id, operation.batchId));
      await updateDependencyBlocks(transaction, operation.batchId, input.now);
      await refreshBatchState(transaction, operation.batchId, input.now);
    });
  }

  async releaseExpiredLeases(batchId: string, now: Date) {
    return this.database.transaction(async (transaction) => {
      const released = await releaseExpiredLeasesInTransaction(transaction, batchId, now);
      await updateDependencyBlocks(transaction, batchId, now);
      await refreshBatchState(transaction, batchId, now);
      return released;
    });
  }

  async getApplyWorkspace(runId: string): Promise<MigrationApplyWorkspace> {
    const [run] = await this.database.select({ id: actMigrationRuns.id, status: actMigrationRuns.status })
      .from(actMigrationRuns).where(eq(actMigrationRuns.id, runId)).limit(1);
    if (!run) throw new ActMigrationRunNotFoundError();
    const batches = await this.database.select().from(actMigrationApplyBatches)
      .where(eq(actMigrationApplyBatches.runId, runId)).orderBy(asc(actMigrationApplyBatches.createdAt));
    const operations = batches.length === 0 ? [] : await this.database.select().from(actMigrationApplyOperations)
      .where(inArray(actMigrationApplyOperations.batchId, batches.map(({ id }) => id)));
    const operationsByBatch = new Map<string, StoredOperation[]>();
    for (const operation of operations) {
      const values = operationsByBatch.get(operation.batchId) ?? [];
      values.push(operation);
      operationsByBatch.set(operation.batchId, values);
    }
    return {
      runId,
      runStatus: run.status,
      counts: countOperations(operations),
      batches: batches.map((batch) => batchValue(batch, countOperations(operationsByBatch.get(batch.id) ?? []))),
    };
  }
}
