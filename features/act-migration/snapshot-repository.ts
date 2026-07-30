import { createHash } from "node:crypto";

import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actMigrationCheckpoints,
  actMigrationRecords,
  actMigrationRuns,
} from "@/db/schema";
import {
  actSourceEntityTypeValues,
  type ActMigrationCheckpointStatus,
  type ActMigrationRunStatus,
  type ActMigrationStreamType,
  type ActQueryMode,
} from "@/features/act-migration/migration-types";
import type { StagedSourceItem } from "@/features/act-migration/source-parser";

type DrizzleDatabase = typeof database;

export const ACT_MIGRATION_CHECKPOINT_LEASE_MS = 5 * 60 * 1_000;
const ROOT_PAGE_SIZE = 100;
const ROOT_PARTITION_KEY = "root";

export type ActMigrationCheckpoint = {
  id: string;
  runId: string;
  streamType: ActMigrationStreamType;
  partitionKey: string;
  parentSourceId: string | null;
  nextSkip: number;
  pageSize: number;
  queryMode: ActQueryMode;
  status: ActMigrationCheckpointStatus;
  retryAfter: Date | null;
  retryable: boolean;
};

export type SnapshotProgress = {
  runId: string;
  status: ActMigrationRunStatus;
  completedCheckpoints: number;
  totalCheckpoints: number;
  stagedRecords: number;
  failedCheckpoints: number;
  retryable: boolean;
  retryAfter: Date | null;
};

export type FinalizedSourceSnapshot = {
  runId: string;
  records: readonly StagedSourceItem[];
  checkpoints: readonly ActMigrationCheckpoint[];
  sourceDigest: string;
};

export interface ActMigrationSnapshotRepository {
  createRun(input: {
    requestKey: string;
    sourceDatabaseKey: string;
    requestedBy: string;
  }): Promise<{ id: string }>;
  claimNextCheckpoint(
    runId: string,
    leaseOwner: string,
    now: Date,
  ): Promise<ActMigrationCheckpoint | null>;
  storePage(input: {
    checkpointId: string;
    leaseOwner: string;
    expectedSkip: number;
    records: readonly StagedSourceItem[];
    nextSkip: number | null;
    queryMode: ActQueryMode;
    now: Date;
  }): Promise<void>;
  failCheckpoint(input: {
    checkpointId: string;
    leaseOwner: string;
    errorCode: string;
    retryable: boolean;
    retryAfter: Date | null;
    now: Date;
  }): Promise<void>;
  enqueueRelationshipCheckpoints(runId: string): Promise<void>;
  getProgress(runId: string): Promise<SnapshotProgress>;
  finalizeSourceSnapshot(runId: string): Promise<FinalizedSourceSnapshot>;
}

type StoredCheckpoint = typeof actMigrationCheckpoints.$inferSelect;
type StoredRecord = typeof actMigrationRecords.$inferSelect;

function checkpointValue(row: StoredCheckpoint): ActMigrationCheckpoint {
  return {
    id: row.id,
    runId: row.runId,
    streamType: row.streamType as ActMigrationStreamType,
    partitionKey: row.partitionKey,
    parentSourceId: row.parentSourceId,
    nextSkip: row.nextSkip,
    pageSize: row.pageSize,
    queryMode: row.queryMode as ActQueryMode,
    status: row.status as ActMigrationCheckpointStatus,
    retryAfter: row.retryAfter,
    retryable: row.retryable,
  };
}

function stagedRecordValue(row: StoredRecord): StagedSourceItem {
  return {
    streamType: row.streamType as ActMigrationStreamType,
    sourceKey: row.sourceKey,
    sourceId: row.sourceId,
    targetSourceId: row.targetSourceId,
    rawSnapshot: row.rawSnapshot,
    normalizedSnapshot: row.normalizedSnapshot,
    fingerprint: row.fingerprint,
    errorCode: row.errorCode,
    errorFields: row.errorFields ?? [],
  };
}

function streamOrder(column: typeof actMigrationCheckpoints.streamType) {
  return sql<number>`case ${column}
    when 'company' then 0
    when 'contact' then 1
    when 'opportunity' then 2
    when 'group' then 3
    when 'company_contact' then 4
    when 'opportunity_company' then 5
    when 'opportunity_contact' then 6
    when 'group_contact' then 7
    else 8 end`;
}

function recordStreamOrder(column: typeof actMigrationRecords.streamType) {
  return sql<number>`case ${column}
    when 'company' then 0
    when 'contact' then 1
    when 'opportunity' then 2
    when 'group' then 3
    when 'company_contact' then 4
    when 'opportunity_company' then 5
    when 'opportunity_contact' then 6
    when 'group_contact' then 7
    else 8 end`;
}

function sourceDigest(records: readonly StagedSourceItem[]) {
  return createHash("sha256")
    .update(JSON.stringify(records.map((record) => ({
      streamType: record.streamType,
      sourceKey: record.sourceKey,
      sourceId: record.sourceId,
      targetSourceId: record.targetSourceId,
      fingerprint: record.fingerprint,
      errorCode: record.errorCode,
      errorFields: record.errorFields,
    }))))
    .digest("hex");
}

export class DrizzleActMigrationSnapshotRepository
  implements ActMigrationSnapshotRepository
{
  constructor(private readonly database: DrizzleDatabase) {}

  createRun(input: {
    requestKey: string;
    sourceDatabaseKey: string;
    requestedBy: string;
  }): Promise<{ id: string }> {
    return this.database.transaction(async (transaction) => {
      const [created] = await transaction
        .insert(actMigrationRuns)
        .values(input)
        .onConflictDoNothing({ target: actMigrationRuns.requestKey })
        .returning({ id: actMigrationRuns.id });
      const [run] = created
        ? [created]
        : await transaction
          .select({ id: actMigrationRuns.id })
          .from(actMigrationRuns)
          .where(eq(actMigrationRuns.requestKey, input.requestKey))
          .limit(1);
      if (!run) throw new Error("Could not create the Act migration run.");

      await transaction
        .insert(actMigrationCheckpoints)
        .values(actSourceEntityTypeValues.map((streamType) => ({
          runId: run.id,
          streamType,
          partitionKey: ROOT_PARTITION_KEY,
          pageSize: ROOT_PAGE_SIZE,
        })))
        .onConflictDoNothing({
          target: [
            actMigrationCheckpoints.runId,
            actMigrationCheckpoints.streamType,
            actMigrationCheckpoints.partitionKey,
          ],
        });
      return run;
    });
  }

  claimNextCheckpoint(
    runId: string,
    leaseOwner: string,
    now: Date,
  ): Promise<ActMigrationCheckpoint | null> {
    return this.database.transaction(async (transaction) => {
      const eligible = or(
        eq(actMigrationCheckpoints.status, "pending"),
        and(
          eq(actMigrationCheckpoints.status, "fetching"),
          lte(actMigrationCheckpoints.leaseExpiresAt, now),
        ),
        and(
          eq(actMigrationCheckpoints.status, "failed"),
          eq(actMigrationCheckpoints.retryable, true),
          or(
            isNull(actMigrationCheckpoints.retryAfter),
            lte(actMigrationCheckpoints.retryAfter, now),
          ),
        ),
      );
      const [checkpoint] = await transaction
        .select()
        .from(actMigrationCheckpoints)
        .where(and(eq(actMigrationCheckpoints.runId, runId), eligible))
        .orderBy(
          streamOrder(actMigrationCheckpoints.streamType),
          asc(actMigrationCheckpoints.partitionKey),
          asc(actMigrationCheckpoints.id),
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (!checkpoint) return null;

      const leaseExpiresAt = new Date(
        now.getTime() + ACT_MIGRATION_CHECKPOINT_LEASE_MS,
      );
      const [claimed] = await transaction
        .update(actMigrationCheckpoints)
        .set({
          status: "fetching",
          leaseOwner,
          leaseExpiresAt,
          retryAfter: null,
          errorCode: null,
          attemptCount: sql`${actMigrationCheckpoints.attemptCount} + 1`,
          updatedAt: now,
        })
        .where(eq(actMigrationCheckpoints.id, checkpoint.id))
        .returning();
      return claimed ? checkpointValue(claimed) : null;
    });
  }

  storePage(input: {
    checkpointId: string;
    leaseOwner: string;
    expectedSkip: number;
    records: readonly StagedSourceItem[];
    nextSkip: number | null;
    queryMode: ActQueryMode;
    now: Date;
  }): Promise<void> {
    return this.database.transaction(async (transaction) => {
      const guard = and(
        eq(actMigrationCheckpoints.id, input.checkpointId),
        eq(actMigrationCheckpoints.status, "fetching"),
        eq(actMigrationCheckpoints.leaseOwner, input.leaseOwner),
        eq(actMigrationCheckpoints.nextSkip, input.expectedSkip),
      );
      const [checkpoint] = await transaction
        .select({ id: actMigrationCheckpoints.id, runId: actMigrationCheckpoints.runId })
        .from(actMigrationCheckpoints)
        .where(guard)
        .limit(1)
        .for("update");
      if (!checkpoint) {
        throw new Error("Act migration checkpoint lease or skip no longer matches.");
      }

      const inserted = input.records.length === 0
        ? []
        : await transaction
          .insert(actMigrationRecords)
          .values(input.records.map((record) => ({
            runId: checkpoint.runId,
            streamType: record.streamType,
            sourceKey: record.sourceKey,
            sourceId: record.sourceId,
            targetSourceId: record.targetSourceId,
            rawSnapshot: record.rawSnapshot,
            normalizedSnapshot: record.normalizedSnapshot,
            fingerprint: record.fingerprint,
            proposedAction: record.errorCode ? "error" : null,
            errorCode: record.errorCode,
            errorFields: record.errorFields,
            createdAt: input.now,
            updatedAt: input.now,
          })))
          .onConflictDoNothing({
            target: [
              actMigrationRecords.runId,
              actMigrationRecords.streamType,
              actMigrationRecords.sourceKey,
            ],
          })
          .returning({ id: actMigrationRecords.id });

      const complete = input.nextSkip === null;
      const [advanced] = await transaction
        .update(actMigrationCheckpoints)
        .set({
          nextSkip: input.nextSkip ?? input.expectedSkip,
          queryMode: input.queryMode,
          status: complete ? "complete" : "pending",
          leaseOwner: null,
          leaseExpiresAt: null,
          retryAfter: null,
          retryable: true,
          recordsStaged: sql`${actMigrationCheckpoints.recordsStaged} + ${inserted.length}`,
          errorCode: null,
          completedAt: complete ? input.now : null,
          updatedAt: input.now,
        })
        .where(guard)
        .returning({ id: actMigrationCheckpoints.id });
      if (!advanced) {
        throw new Error("Act migration checkpoint lease or skip no longer matches.");
      }
    });
  }

  async failCheckpoint(input: {
    checkpointId: string;
    leaseOwner: string;
    errorCode: string;
    retryable: boolean;
    retryAfter: Date | null;
    now: Date;
  }) {
    const [failed] = await this.database
      .update(actMigrationCheckpoints)
      .set({
        status: "failed",
        leaseOwner: null,
        leaseExpiresAt: null,
        retryAfter: input.retryAfter,
        retryable: input.retryable,
        errorCode: input.errorCode,
        updatedAt: input.now,
      })
      .where(and(
        eq(actMigrationCheckpoints.id, input.checkpointId),
        eq(actMigrationCheckpoints.status, "fetching"),
        eq(actMigrationCheckpoints.leaseOwner, input.leaseOwner),
      ))
      .returning({ id: actMigrationCheckpoints.id });
    if (!failed) {
      throw new Error("Act migration checkpoint lease no longer matches.");
    }
  }

  enqueueRelationshipCheckpoints(runId: string): Promise<void> {
    return this.database.transaction(async (transaction) => {
      const roots = await transaction
        .select({
          id: actMigrationCheckpoints.id,
          streamType: actMigrationCheckpoints.streamType,
          status: actMigrationCheckpoints.status,
        })
        .from(actMigrationCheckpoints)
        .where(and(
          eq(actMigrationCheckpoints.runId, runId),
          eq(actMigrationCheckpoints.partitionKey, ROOT_PARTITION_KEY),
          inArray(actMigrationCheckpoints.streamType, actSourceEntityTypeValues),
        ))
        .orderBy(streamOrder(actMigrationCheckpoints.streamType))
        .for("update");
      if (
        roots.length !== actSourceEntityTypeValues.length ||
        roots.some(({ status }) => status !== "complete")
      ) {
        return;
      }

      const parents = await transaction
        .select({
          streamType: actMigrationRecords.streamType,
          sourceId: actMigrationRecords.sourceId,
        })
        .from(actMigrationRecords)
        .where(and(
          eq(actMigrationRecords.runId, runId),
          inArray(actMigrationRecords.streamType, [
            "contact",
            "opportunity",
            "group",
          ]),
          isNull(actMigrationRecords.errorCode),
        ))
        .orderBy(
          recordStreamOrder(actMigrationRecords.streamType),
          asc(actMigrationRecords.sourceId),
        );

      const checkpoints = parents.flatMap(({ streamType, sourceId }) => {
        if (!sourceId) return [];
        if (streamType === "contact") {
          return [{
            runId,
            streamType: "company_contact",
            partitionKey: `contact:${sourceId}`,
            parentSourceId: sourceId,
            pageSize: ROOT_PAGE_SIZE,
          }];
        }
        if (streamType === "opportunity") {
          return [
            {
              runId,
              streamType: "opportunity_company",
              partitionKey: `opportunity:${sourceId}:companies`,
              parentSourceId: sourceId,
              pageSize: ROOT_PAGE_SIZE,
            },
            {
              runId,
              streamType: "opportunity_contact",
              partitionKey: `opportunity:${sourceId}:contacts`,
              parentSourceId: sourceId,
              pageSize: ROOT_PAGE_SIZE,
            },
          ];
        }
        return [{
          runId,
          streamType: "group_contact",
          partitionKey: `group:${sourceId}:contacts`,
          parentSourceId: sourceId,
          pageSize: ROOT_PAGE_SIZE,
        }];
      });
      if (checkpoints.length === 0) return;
      await transaction
        .insert(actMigrationCheckpoints)
        .values(checkpoints)
        .onConflictDoNothing({
          target: [
            actMigrationCheckpoints.runId,
            actMigrationCheckpoints.streamType,
            actMigrationCheckpoints.partitionKey,
          ],
        });
    });
  }

  async getProgress(runId: string): Promise<SnapshotProgress> {
    const [run] = await this.database
      .select({ id: actMigrationRuns.id, status: actMigrationRuns.status })
      .from(actMigrationRuns)
      .where(eq(actMigrationRuns.id, runId))
      .limit(1);
    if (!run) throw new Error("Act migration run is missing.");
    const checkpoints = await this.database
      .select({
        status: actMigrationCheckpoints.status,
        retryable: actMigrationCheckpoints.retryable,
        retryAfter: actMigrationCheckpoints.retryAfter,
      })
      .from(actMigrationCheckpoints)
      .where(eq(actMigrationCheckpoints.runId, runId));
    const [{ stagedRecords = 0 } = {}] = await this.database
      .select({ stagedRecords: count() })
      .from(actMigrationRecords)
      .where(eq(actMigrationRecords.runId, runId));
    const retryableFailures = checkpoints.filter(
      (checkpoint) =>
        checkpoint.status === "failed" && checkpoint.retryable,
    );
    const retryAfter = retryableFailures
      .map((checkpoint) => checkpoint.retryAfter)
      .filter((value): value is Date => value !== null)
      .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
    return {
      runId,
      status: run.status as ActMigrationRunStatus,
      completedCheckpoints: checkpoints.filter(
        ({ status }) => status === "complete",
      ).length,
      totalCheckpoints: checkpoints.length,
      stagedRecords,
      failedCheckpoints: checkpoints.filter(
        ({ status }) => status === "failed",
      ).length,
      retryable: retryableFailures.length > 0,
      retryAfter,
    };
  }

  finalizeSourceSnapshot(runId: string): Promise<FinalizedSourceSnapshot> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(actMigrationRuns)
        .where(eq(actMigrationRuns.id, runId))
        .limit(1)
        .for("update");
      if (!run) throw new Error("Act migration run is missing.");

      const storedCheckpoints = await transaction
        .select()
        .from(actMigrationCheckpoints)
        .where(eq(actMigrationCheckpoints.runId, runId))
        .orderBy(
          streamOrder(actMigrationCheckpoints.streamType),
          asc(actMigrationCheckpoints.partitionKey),
          asc(actMigrationCheckpoints.id),
        )
        .for("update");
      const rootCount = storedCheckpoints.filter(
        ({ partitionKey, streamType }) =>
          partitionKey === ROOT_PARTITION_KEY &&
          (actSourceEntityTypeValues as readonly string[]).includes(streamType),
      ).length;
      const storedRecords = await transaction
        .select()
        .from(actMigrationRecords)
        .where(eq(actMigrationRecords.runId, runId))
        .orderBy(
          recordStreamOrder(actMigrationRecords.streamType),
          asc(actMigrationRecords.sourceKey),
          asc(actMigrationRecords.id),
        );
      const expectedRelationships = storedRecords.reduce((total, record) => {
        if (record.errorCode || !record.sourceId) return total;
        if (record.streamType === "contact" || record.streamType === "group") {
          return total + 1;
        }
        if (record.streamType === "opportunity") return total + 2;
        return total;
      }, 0);
      const relationshipCount = storedCheckpoints.length - rootCount;
      if (
        rootCount !== actSourceEntityTypeValues.length ||
        relationshipCount !== expectedRelationships ||
        storedCheckpoints.some(({ status }) => status !== "complete")
      ) {
        throw new Error("Act migration checkpoint set is incomplete.");
      }

      const records = storedRecords.map(stagedRecordValue);
      const checkpoints = storedCheckpoints.map(checkpointValue);
      const digest = sourceDigest(records);
      const completedAt = run.snapshotCompletedAt ?? new Date();
      await transaction
        .update(actMigrationRuns)
        .set({
          status: "snapshot_complete",
          sourceDigest: digest,
          snapshotCompletedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(eq(actMigrationRuns.id, runId));
      return {
        runId,
        records,
        checkpoints,
        sourceDigest: digest,
      };
    });
  }
}
