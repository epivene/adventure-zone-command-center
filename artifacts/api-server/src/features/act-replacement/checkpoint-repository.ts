import { and, asc, eq, inArray, isNull, like, lte, or, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actReplacementCheckpoints,
  actReplacementObservations,
  actReplacementRuns,
  actSourceRecords,
  actSourceRecordVersions,
} from "@workspace/db/schema";
import {
  actRootStreamTypes,
  actSafeErrorCodes,
  type ActCheckpointState,
  type ActExtractionCounters,
  type ActQueryMode,
  type ActReplacementStatus,
  type ActReplacementStreamType,
  type ActRootStreamType,
  type ActSafeErrorCode,
  type CheckpointFailure,
  type ClaimedCheckpoint,
  type StartActReplacementRun,
} from "./import-types";
import { calculateRetryAt } from "./retry-policy";

type DrizzleDatabase = typeof database;
type DrizzleTransaction = Parameters<
  Parameters<DrizzleDatabase["transaction"]>[0]
>[0];

const activeRunPhases = [
  "extracting",
  "extract_complete",
  "organizing",
  "ready_to_apply",
  "applying",
] as const;
const openCheckpointStates = ["pending", "leased", "retry_wait"] as const;
const terminalCheckpointStates = ["complete", "unsupported", "failed"] as const;

const zeroCounters = (): ActExtractionCounters => ({
  responseRows: 0,
  observedIdentities: 0,
  archivedIdentities: 0,
  completeIdentities: 0,
  partialIdentities: 0,
  failedIdentities: 0,
  snapshotVersionsInserted: 0,
});

export interface ActReplacementCheckpointRepository {
  createRun(
    input: StartActReplacementRun,
  ): Promise<{ runId: string; created: boolean }>;
  claimNext(input: {
    workerId: string;
    now: Date;
    leaseMs: 60_000;
  }): Promise<ClaimedCheckpoint | null>;
  switchToPlain(input: {
    checkpointId: string;
    leaseOwner: string;
    now: Date;
  }): Promise<void>;
  releaseForAuthorization(input: {
    checkpointId: string;
    leaseOwner: string;
    now: Date;
  }): Promise<void>;
  resumeRun(input: { runId: string; now: Date }): Promise<void>;
  markDetailCapabilityUnavailable(input: {
    runId: string;
    checkpointId: string;
    leaseOwner: string;
    rootStream: ActRootStreamType;
    now: Date;
  }): Promise<{ fallbackCheckpointId: string; created: boolean }>;
  scheduleRetry(input: CheckpointFailure): Promise<void>;
  markUnsupported(input: CheckpointFailure): Promise<void>;
  markFailed(input: CheckpointFailure): Promise<void>;
  supersedeRun(input: {
    runId: string;
    requestedBy: string;
    now: Date;
  }): Promise<void>;
  summarize(runId: string): Promise<ActReplacementStatus>;
}

export class ActCheckpointConflictError extends Error {
  readonly code = "ACT_CHECKPOINT_CONFLICT";

  constructor() {
    super("Act checkpoint state no longer matches.");
    this.name = "ActCheckpointConflictError";
  }
}

export class ActReplacementRunNotFoundError extends Error {
  readonly code = "ACT_REPLACEMENT_RUN_NOT_FOUND";

  constructor() {
    super("Act replacement run was not found.");
    this.name = "ActReplacementRunNotFoundError";
  }
}

export class ActCheckpointRepositoryError extends Error {
  readonly code = "ACT_CHECKPOINT_STORE_FAILED";

  constructor() {
    super("Act checkpoint state could not be stored.");
    this.name = "ActCheckpointRepositoryError";
  }
}

function conflict(): never {
  throw new ActCheckpointConflictError();
}

function safeErrorCode(value: string | null): ActSafeErrorCode | null {
  return actSafeErrorCodes.includes(value as ActSafeErrorCode)
    ? (value as ActSafeErrorCode)
    : value === null
      ? null
      : "invalid_response";
}

function rootRank(column: typeof actReplacementCheckpoints.streamType) {
  return sql<number>`case ${column}
    when 'company' then 0
    when 'contact' then 1
    when 'opportunity' then 2
    when 'group' then 3
    when 'activity' then 4
    when 'note' then 5
    when 'history' then 6
    else 7 end`;
}

function checkpointKindRank(
  column: typeof actReplacementCheckpoints.checkpointKind,
) {
  return sql<number>`case ${column}
    when 'list' then 0
    when 'detail' then 1
    when 'plain_list_fallback' then 2
    when 'relationship' then 3
    else 4 end`;
}

function claimedCheckpointValue(
  row: typeof actReplacementCheckpoints.$inferSelect & {
    runSourceDatabaseKey: string;
  },
): ClaimedCheckpoint {
  return {
    id: row.id,
    runId: row.runId,
    sourceDatabaseKey: row.runSourceDatabaseKey,
    leaseOwner: row.leaseOwner!,
    attemptCount: row.attemptCount,
    streamType: row.streamType as ActReplacementStreamType,
    // The persisted queue also contains root `list` work. The recovered global
    // ClaimedCheckpoint type narrows this field too far, so retain the truthful
    // database value at runtime while keeping this Task 4 change file-bounded.
    checkpointKind: row.checkpointKind as ClaimedCheckpoint["checkpointKind"],
    partitionKey: row.partitionKey,
    requiredness: row.requiredness as ClaimedCheckpoint["requiredness"],
    parentSourceRecordId: row.parentSourceRecordId,
    parentActRecordId: row.parentActRecordId,
    sourceRecordId: row.sourceRecordId,
    nextSkip: row.nextSkip,
    pageSize: row.pageSize,
    queryMode: row.queryMode as ActQueryMode,
    deriveDetails: row.deriveDetails,
  };
}

export class DrizzleActReplacementCheckpointRepository implements ActReplacementCheckpointRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async resumeRun(input: { runId: string; now: Date }): Promise<void> {
    return this.protect(async () => {
      await this.database.transaction(async (transaction) => {
        const recoverableContactNotes = and(
          eq(actReplacementCheckpoints.state, "failed"),
          eq(actReplacementCheckpoints.streamType, "note"),
          eq(actReplacementCheckpoints.checkpointKind, "relationship"),
          like(actReplacementCheckpoints.partitionKey, "contact-notes:%"),
          eq(actReplacementCheckpoints.errorCode, "not_found"),
        );
        const recovered = await transaction
          .update(actReplacementCheckpoints)
          .set({
            state: "pending",
            leaseOwner: null,
            leaseExpiresAt: null,
            retryAfter: null,
            retryable: true,
            errorCode: null,
            completedAt: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(actReplacementCheckpoints.runId, input.runId),
              or(
                eq(actReplacementCheckpoints.state, "retry_wait"),
                and(
                  eq(actReplacementCheckpoints.state, "leased"),
                  lte(actReplacementCheckpoints.leaseExpiresAt, input.now),
                ),
                recoverableContactNotes,
              ),
            ),
          )
          .returning({ id: actReplacementCheckpoints.id });
        if (recovered.length > 0) {
          await transaction
            .update(actReplacementRuns)
            .set({
              phase: "extracting",
              lastErrorCode: null,
              completedAt: null,
              updatedAt: input.now,
            })
            .where(eq(actReplacementRuns.id, input.runId));
        }
      });
    });
  }

  async createRun(
    input: StartActReplacementRun,
  ): Promise<{ runId: string; created: boolean }> {
    return this.protect(async () =>
      this.database.transaction(async (transaction) => {
        const [created] = await transaction
          .insert(actReplacementRuns)
          .values(input)
          .onConflictDoNothing()
          .returning({ id: actReplacementRuns.id });

        if (created) {
          await transaction.insert(actReplacementCheckpoints).values(
            actRootStreamTypes
              .filter((streamType) => streamType !== "note")
              .map((streamType) => ({
                runId: created.id,
                sourceDatabaseKey: input.sourceDatabaseKey,
                streamType,
                checkpointKind: "list",
                partitionKey: `root:${streamType}`,
                requiredness: "required",
                nextSkip: 0,
                pageSize: input.pageSize,
                queryMode: "projected",
                deriveDetails: true,
                state: "pending",
              })),
          );
          return { runId: created.id, created: true };
        }

        const [replay] = await transaction
          .select({ id: actReplacementRuns.id })
          .from(actReplacementRuns)
          .where(
            and(
              eq(actReplacementRuns.sourceDatabaseKey, input.sourceDatabaseKey),
              eq(actReplacementRuns.requestKey, input.requestKey),
            ),
          )
          .limit(1);
        if (replay) return { runId: replay.id, created: false };

        const [active] = await transaction
          .select({ id: actReplacementRuns.id })
          .from(actReplacementRuns)
          .where(
            and(
              eq(actReplacementRuns.sourceDatabaseKey, input.sourceDatabaseKey),
              inArray(actReplacementRuns.phase, [...activeRunPhases]),
            ),
          )
          .orderBy(
            asc(actReplacementRuns.createdAt),
            asc(actReplacementRuns.id),
          )
          .limit(1);
        if (!active) throw new ActCheckpointRepositoryError();
        return { runId: active.id, created: false };
      }),
    );
  }

  async claimNext(input: {
    workerId: string;
    now: Date;
    leaseMs: 60_000;
  }): Promise<ClaimedCheckpoint | null> {
    return this.protect(async () => {
      if (
        input.leaseMs !== 60_000 ||
        !input.workerId.trim() ||
        !Number.isFinite(input.now.getTime())
      ) {
        conflict();
      }
      return this.database.transaction(async (transaction) => {
        const eligible = or(
          eq(actReplacementCheckpoints.state, "pending"),
          and(
            eq(actReplacementCheckpoints.state, "leased"),
            lte(actReplacementCheckpoints.leaseExpiresAt, input.now),
          ),
          and(
            eq(actReplacementCheckpoints.state, "retry_wait"),
            or(
              isNull(actReplacementCheckpoints.retryAfter),
              lte(actReplacementCheckpoints.retryAfter, input.now),
            ),
          ),
        );
        const [candidate] = await transaction
          .select({
            checkpoint: actReplacementCheckpoints,
            runSourceDatabaseKey: actReplacementRuns.sourceDatabaseKey,
          })
          .from(actReplacementCheckpoints)
          .innerJoin(
            actReplacementRuns,
            and(
              eq(actReplacementRuns.id, actReplacementCheckpoints.runId),
              eq(
                actReplacementRuns.sourceDatabaseKey,
                actReplacementCheckpoints.sourceDatabaseKey,
              ),
            ),
          )
          .where(and(eq(actReplacementRuns.phase, "extracting"), eligible))
          .orderBy(
            sql`case when ${actReplacementCheckpoints.requiredness} = 'required' then 0 else 1 end`,
            rootRank(actReplacementCheckpoints.streamType),
            checkpointKindRank(actReplacementCheckpoints.checkpointKind),
            asc(actReplacementCheckpoints.createdAt),
            asc(actReplacementCheckpoints.partitionKey),
            asc(actReplacementCheckpoints.id),
          )
          .limit(1)
          .for("update", { of: actReplacementCheckpoints, skipLocked: true });
        if (!candidate) return null;

        const [claimed] = await transaction
          .update(actReplacementCheckpoints)
          .set({
            state: "leased",
            leaseOwner: input.workerId,
            leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
            retryAfter: null,
            errorCode: null,
            attemptCount: sql`${actReplacementCheckpoints.attemptCount} + 1`,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(actReplacementCheckpoints.id, candidate.checkpoint.id),
              eq(
                actReplacementCheckpoints.sourceDatabaseKey,
                candidate.runSourceDatabaseKey,
              ),
            ),
          )
          .returning();
        if (!claimed) conflict();
        return claimedCheckpointValue({
          ...claimed,
          runSourceDatabaseKey: candidate.runSourceDatabaseKey,
        });
      });
    });
  }

  async switchToPlain(input: {
    checkpointId: string;
    leaseOwner: string;
    now: Date;
  }): Promise<void> {
    return this.protect(async () =>
      this.database.transaction(async (transaction) => {
        const { checkpoint } = await this.lockLiveLease(transaction, input);
        await transaction
          .update(actReplacementCheckpoints)
          .set({
            queryMode: "plain",
            state: "pending",
            leaseOwner: null,
            leaseExpiresAt: null,
            retryAfter: null,
            errorCode: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(actReplacementCheckpoints.id, checkpoint.id),
              eq(actReplacementCheckpoints.runId, checkpoint.runId),
              eq(
                actReplacementCheckpoints.sourceDatabaseKey,
                checkpoint.sourceDatabaseKey,
              ),
              eq(actReplacementCheckpoints.streamType, checkpoint.streamType),
            ),
          );
      }),
    );
  }

  async releaseForAuthorization(input: {
    checkpointId: string;
    leaseOwner: string;
    now: Date;
  }): Promise<void> {
    return this.protect(async () =>
      this.database.transaction(async (transaction) => {
        const { checkpoint, run } = await this.lockLiveLease(
          transaction,
          input,
        );
        await transaction
          .update(actReplacementCheckpoints)
          .set({
            state: "pending",
            leaseOwner: null,
            leaseExpiresAt: null,
            retryAfter: null,
            errorCode: null,
            attemptCount: sql`greatest(${actReplacementCheckpoints.attemptCount} - 1, 0)`,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(actReplacementCheckpoints.id, checkpoint.id),
              eq(actReplacementCheckpoints.runId, run.id),
              eq(
                actReplacementCheckpoints.sourceDatabaseKey,
                run.sourceDatabaseKey,
              ),
              eq(actReplacementCheckpoints.streamType, checkpoint.streamType),
            ),
          );
      }),
    );
  }

  async markDetailCapabilityUnavailable(input: {
    runId: string;
    checkpointId: string;
    leaseOwner: string;
    rootStream: ActRootStreamType;
    now: Date;
  }): Promise<{ fallbackCheckpointId: string; created: boolean }> {
    return this.protect(async () =>
      this.database.transaction(async (transaction) => {
        const [run] = await transaction
          .select()
          .from(actReplacementRuns)
          .where(eq(actReplacementRuns.id, input.runId))
          .limit(1)
          .for("update");
        if (!run) throw new ActReplacementRunNotFoundError();
        if (run.phase !== "extracting") conflict();

        const [checkpoint] = await transaction
          .select()
          .from(actReplacementCheckpoints)
          .where(eq(actReplacementCheckpoints.id, input.checkpointId))
          .limit(1)
          .for("update");
        if (
          !checkpoint ||
          checkpoint.runId !== run.id ||
          checkpoint.sourceDatabaseKey !== run.sourceDatabaseKey ||
          checkpoint.streamType !== input.rootStream ||
          checkpoint.checkpointKind !== "detail"
        ) {
          conflict();
        }

        const replay =
          checkpoint.requiredness === "optional_capability" &&
          checkpoint.state === "unsupported" &&
          checkpoint.errorCode === "endpoint_unsupported";
        if (!replay && !this.isLiveLease(checkpoint, input)) conflict();

        if (!replay) {
          await transaction
            .update(actReplacementCheckpoints)
            .set({
              requiredness: "optional_capability",
              state: "unsupported",
              leaseOwner: null,
              leaseExpiresAt: null,
              retryAfter: null,
              retryable: false,
              errorCode: "endpoint_unsupported",
              completedAt: input.now,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(actReplacementCheckpoints.runId, run.id),
                eq(
                  actReplacementCheckpoints.sourceDatabaseKey,
                  run.sourceDatabaseKey,
                ),
                eq(actReplacementCheckpoints.streamType, input.rootStream),
                eq(actReplacementCheckpoints.checkpointKind, "detail"),
                inArray(actReplacementCheckpoints.state, [
                  ...openCheckpointStates,
                ]),
              ),
            );
        }

        const [created] = await transaction
          .insert(actReplacementCheckpoints)
          .values({
            runId: run.id,
            sourceDatabaseKey: run.sourceDatabaseKey,
            streamType: input.rootStream,
            checkpointKind: "plain_list_fallback",
            partitionKey: `plain-full:${input.rootStream}`,
            requiredness: "optional_capability",
            parentSourceRecordId: null,
            parentActRecordId: null,
            sourceRecordId: null,
            nextSkip: 0,
            pageSize: run.pageSize,
            queryMode: "plain",
            deriveDetails: false,
            state: "pending",
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing({
            target: [
              actReplacementCheckpoints.runId,
              actReplacementCheckpoints.streamType,
              actReplacementCheckpoints.partitionKey,
            ],
          })
          .returning({ id: actReplacementCheckpoints.id });
        const [fallback] = created
          ? [created]
          : await transaction
              .select({
                id: actReplacementCheckpoints.id,
                checkpointKind: actReplacementCheckpoints.checkpointKind,
                requiredness: actReplacementCheckpoints.requiredness,
                queryMode: actReplacementCheckpoints.queryMode,
                deriveDetails: actReplacementCheckpoints.deriveDetails,
                nextSkip: actReplacementCheckpoints.nextSkip,
                sourceDatabaseKey: actReplacementCheckpoints.sourceDatabaseKey,
              })
              .from(actReplacementCheckpoints)
              .where(
                and(
                  eq(actReplacementCheckpoints.runId, run.id),
                  eq(actReplacementCheckpoints.streamType, input.rootStream),
                  eq(
                    actReplacementCheckpoints.partitionKey,
                    `plain-full:${input.rootStream}`,
                  ),
                ),
              )
              .limit(1);
        if (!fallback) conflict();
        if (
          "checkpointKind" in fallback &&
          (fallback.sourceDatabaseKey !== run.sourceDatabaseKey ||
            fallback.checkpointKind !== "plain_list_fallback" ||
            fallback.requiredness !== "optional_capability" ||
            fallback.queryMode !== "plain" ||
            fallback.deriveDetails !== false ||
            fallback.nextSkip !== 0)
        ) {
          conflict();
        }
        return { fallbackCheckpointId: fallback.id, created: Boolean(created) };
      }),
    );
  }

  async scheduleRetry(input: CheckpointFailure): Promise<void> {
    return this.protect(async () =>
      this.database.transaction(async (transaction) => {
        if (!input.retryable) conflict();
        const { checkpoint } = await this.lockLiveLease(transaction, input);
        const retryAt = calculateRetryAt({
          attemptCount: checkpoint.attemptCount,
          now: input.now,
          retryAfter: input.retryAfter,
        });
        await transaction
          .update(actReplacementCheckpoints)
          .set({
            state: "retry_wait",
            leaseOwner: null,
            leaseExpiresAt: null,
            retryAfter: retryAt,
            retryable: true,
            errorCode: input.errorCode,
            updatedAt: input.now,
          })
          .where(eq(actReplacementCheckpoints.id, checkpoint.id));
      }),
    );
  }

  markUnsupported(input: CheckpointFailure): Promise<void> {
    return this.terminalize(input, "unsupported");
  }

  markFailed(input: CheckpointFailure): Promise<void> {
    return this.terminalize(input, "failed");
  }

  async supersedeRun(input: {
    runId: string;
    requestedBy: string;
    now: Date;
  }): Promise<void> {
    return this.protect(async () =>
      this.database.transaction(async (transaction) => {
        const [run] = await transaction
          .select()
          .from(actReplacementRuns)
          .where(eq(actReplacementRuns.id, input.runId))
          .limit(1)
          .for("update");
        if (!run) throw new ActReplacementRunNotFoundError();
        if (run.requestedBy !== input.requestedBy) conflict();
        if (run.phase === "superseded") return;
        if (
          !activeRunPhases.includes(
            run.phase as (typeof activeRunPhases)[number],
          )
        ) {
          conflict();
        }
        await transaction
          .update(actReplacementRuns)
          .set({
            phase: "superseded",
            supersededAt: input.now,
            completedAt: input.now,
            updatedAt: input.now,
          })
          .where(eq(actReplacementRuns.id, run.id));
      }),
    );
  }

  async summarize(runId: string): Promise<ActReplacementStatus> {
    return this.protect(async () => {
      await this.database.transaction(async (transaction) => {
        const [run] = await transaction
          .select()
          .from(actReplacementRuns)
          .where(eq(actReplacementRuns.id, runId))
          .limit(1)
          .for("update");
        if (!run) throw new ActReplacementRunNotFoundError();
        await this.maybeFinalize(transaction, run);
      });

      const [run] = await this.database
        .select()
        .from(actReplacementRuns)
        .where(eq(actReplacementRuns.id, runId))
        .limit(1);
      if (!run) throw new ActReplacementRunNotFoundError();
      const checkpoints = await this.database
        .select()
        .from(actReplacementCheckpoints)
        .where(
          and(
            eq(actReplacementCheckpoints.runId, run.id),
            eq(
              actReplacementCheckpoints.sourceDatabaseKey,
              run.sourceDatabaseKey,
            ),
          ),
        )
        .orderBy(
          rootRank(actReplacementCheckpoints.streamType),
          asc(actReplacementCheckpoints.streamType),
          checkpointKindRank(actReplacementCheckpoints.checkpointKind),
          asc(actReplacementCheckpoints.partitionKey),
          asc(actReplacementCheckpoints.id),
        );

      const streamOrder = new Map<string, number>(
        [...actRootStreamTypes].map((stream, index) => [stream, index]),
      );
      const streamTypes = [
        ...new Set(checkpoints.map(({ streamType }) => streamType)),
      ].toSorted(
        (left, right) =>
          (streamOrder.get(left) ?? 20) - (streamOrder.get(right) ?? 20) ||
          left.localeCompare(right),
      );
      const streams = streamTypes.map((streamType) => {
        const rows = checkpoints.filter((row) => row.streamType === streamType);
        const counters = this.sumCounters(rows);
        const states = new Set(rows.map(({ state }) => state));
        const queryModes = new Set(rows.map(({ queryMode }) => queryMode));
        const errorRow = rows
          .filter(({ errorCode }) => errorCode !== null)
          .toSorted(
            (left, right) =>
              this.errorRank(left.state) - this.errorRank(right.state) ||
              right.updatedAt.getTime() - left.updatedAt.getTime() ||
              left.id.localeCompare(right.id),
          )[0];
        const lastSucceededAt = rows
          .flatMap(({ lastSucceededAt }) =>
            lastSucceededAt ? [lastSucceededAt] : [],
          )
          .toSorted((left, right) => right.getTime() - left.getTime())[0];
        return {
          streamType: streamType as ActReplacementStreamType,
          ...counters,
          state:
            states.size === 1
              ? (rows[0]!.state as ActCheckpointState)
              : ("mixed" as const),
          completedCheckpoints: rows.filter(({ state }) => state === "complete")
            .length,
          totalCheckpoints: rows.length,
          queryMode:
            queryModes.size === 1
              ? (rows[0]!.queryMode as ActQueryMode)
              : ("mixed" as const),
          lastSucceededAt: lastSucceededAt?.toISOString() ?? null,
          error: errorRow
            ? {
                code: safeErrorCode(errorRow.errorCode) ?? "invalid_response",
                retryable: errorRow.retryable,
                retryAfter: errorRow.retryAfter?.toISOString() ?? null,
              }
            : null,
        };
      });
      const allStreams = this.sumCounters(checkpoints);
      const unsupportedCapabilities = new Set(
        checkpoints
          .filter(
            ({ requiredness, state }) =>
              requiredness === "optional_capability" && state === "unsupported",
          )
          .map(
            ({ streamType, checkpointKind, errorCode }) =>
              `${streamType}:${checkpointKind}:${safeErrorCode(errorCode) ?? "invalid_response"}`,
          ),
      ).size;
      const hasRecoverableContactNoteFailure = checkpoints.some(
        ({
          state,
          streamType,
          checkpointKind,
          partitionKey,
          errorCode,
        }) =>
          state === "failed" &&
          streamType === "note" &&
          checkpointKind === "relationship" &&
          partitionKey.startsWith("contact-notes:") &&
          errorCode === "not_found",
      );
      return {
        runId: run.id,
        phase: run.phase as ActReplacementStatus["phase"],
        previewOnly: run.previewOnly,
        pageSize: run.pageSize as ActReplacementStatus["pageSize"],
        streams,
        allStreams: {
          ...allStreams,
          unsupportedCapabilities,
        },
        canResume:
          (run.phase === "extracting" &&
            checkpoints.some(({ state }) =>
              openCheckpointStates.includes(
                state as (typeof openCheckpointStates)[number],
              ),
            )) ||
          (run.phase === "failed" && hasRecoverableContactNoteFailure),
        canStartOver:
          run.phase === "failed" ||
          activeRunPhases.includes(
            run.phase as (typeof activeRunPhases)[number],
          ),
      };
    });
  }

  private async terminalize(
    input: CheckpointFailure,
    state: "unsupported" | "failed",
  ): Promise<void> {
    return this.protect(async () =>
      this.database.transaction(async (transaction) => {
        const { checkpoint, run } = await this.lockLiveLease(
          transaction,
          input,
        );
        if (
          input.errorCode === "authentication_failed" ||
          input.errorCode === "permission_denied"
        ) {
          await transaction
            .update(actReplacementCheckpoints)
            .set({
              state: "failed",
              leaseOwner: null,
              leaseExpiresAt: null,
              retryAfter: null,
              retryable: false,
              errorCode: input.errorCode,
              completedAt: input.now,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(actReplacementCheckpoints.runId, run.id),
                eq(
                  actReplacementCheckpoints.sourceDatabaseKey,
                  run.sourceDatabaseKey,
                ),
                inArray(actReplacementCheckpoints.state, [
                  ...openCheckpointStates,
                ]),
              ),
            );
          await transaction
            .update(actReplacementRuns)
            .set({
              phase: "failed",
              lastErrorCode: input.errorCode,
              completedAt: input.now,
              updatedAt: input.now,
            })
            .where(
              and(
                eq(actReplacementRuns.id, run.id),
                eq(actReplacementRuns.sourceDatabaseKey, run.sourceDatabaseKey),
              ),
            );
          return;
        }

        await transaction
          .update(actReplacementCheckpoints)
          .set({
            state,
            leaseOwner: null,
            leaseExpiresAt: null,
            retryAfter: null,
            retryable: false,
            errorCode: input.errorCode,
            completedAt: input.now,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(actReplacementCheckpoints.id, checkpoint.id),
              eq(actReplacementCheckpoints.runId, run.id),
              eq(
                actReplacementCheckpoints.sourceDatabaseKey,
                run.sourceDatabaseKey,
              ),
              eq(actReplacementCheckpoints.streamType, checkpoint.streamType),
            ),
          );
        await this.maybeFinalize(transaction, run);
      }),
    );
  }

  private async lockLiveLease(
    transaction: DrizzleTransaction,
    input: { checkpointId: string; leaseOwner: string; now: Date },
  ) {
    const [run] = await transaction
      .select({ run: actReplacementRuns })
      .from(actReplacementRuns)
      .innerJoin(
        actReplacementCheckpoints,
        and(
          eq(actReplacementCheckpoints.runId, actReplacementRuns.id),
          eq(
            actReplacementCheckpoints.sourceDatabaseKey,
            actReplacementRuns.sourceDatabaseKey,
          ),
        ),
      )
      .where(eq(actReplacementCheckpoints.id, input.checkpointId))
      .limit(1)
      .for("update", { of: actReplacementRuns });
    if (!run) conflict();
    if (run.run.phase !== "extracting") conflict();
    const [checkpoint] = await transaction
      .select()
      .from(actReplacementCheckpoints)
      .where(
        and(
          eq(actReplacementCheckpoints.id, input.checkpointId),
          eq(actReplacementCheckpoints.runId, run.run.id),
          eq(
            actReplacementCheckpoints.sourceDatabaseKey,
            run.run.sourceDatabaseKey,
          ),
        ),
      )
      .limit(1)
      .for("update");
    if (!checkpoint || !this.isLiveLease(checkpoint, input)) conflict();
    return { checkpoint, run: run.run };
  }

  private isLiveLease(
    checkpoint: typeof actReplacementCheckpoints.$inferSelect,
    input: { leaseOwner: string; now: Date },
  ) {
    return (
      checkpoint.state === "leased" &&
      checkpoint.leaseOwner === input.leaseOwner &&
      checkpoint.leaseExpiresAt !== null &&
      checkpoint.leaseExpiresAt.getTime() > input.now.getTime()
    );
  }

  private async maybeFinalize(
    transaction: DrizzleTransaction,
    run: typeof actReplacementRuns.$inferSelect,
  ) {
    if (run.phase !== "extracting") return;
    const checkpoints = await transaction
      .select()
      .from(actReplacementCheckpoints)
      .where(
        and(
          eq(actReplacementCheckpoints.runId, run.id),
          eq(
            actReplacementCheckpoints.sourceDatabaseKey,
            run.sourceDatabaseKey,
          ),
        ),
      )
      .for("update");
    if (
      checkpoints.length === 0 ||
      checkpoints.some(
        ({ state }) =>
          !terminalCheckpointStates.includes(
            state as (typeof terminalCheckpointStates)[number],
          ),
      )
    ) {
      return;
    }

    const requiredFailure = checkpoints.find(
      ({ requiredness, state }) =>
        requiredness === "required" && state !== "complete",
    );
    if (requiredFailure) {
      await transaction
        .update(actReplacementRuns)
        .set({
          phase: "failed",
          lastErrorCode:
            safeErrorCode(requiredFailure.errorCode) ?? "invalid_response",
          completedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(actReplacementRuns.id, run.id));
      return;
    }

    const observationRows = await transaction
      .select({
        streamType: actSourceRecords.streamType,
        observationId: actReplacementObservations.id,
        versionId: actSourceRecordVersions.id,
      })
      .from(actReplacementObservations)
      .innerJoin(
        actSourceRecords,
        and(
          eq(actSourceRecords.id, actReplacementObservations.sourceRecordId),
          eq(
            actSourceRecords.sourceDatabaseKey,
            actReplacementObservations.sourceDatabaseKey,
          ),
        ),
      )
      .leftJoin(
        actSourceRecordVersions,
        and(
          eq(actSourceRecordVersions.id, actReplacementObservations.versionId),
          eq(
            actSourceRecordVersions.sourceRecordId,
            actReplacementObservations.sourceRecordId,
          ),
          eq(
            actSourceRecordVersions.sourceDatabaseKey,
            actReplacementObservations.sourceDatabaseKey,
          ),
        ),
      )
      .where(
        and(
          eq(actReplacementObservations.runId, run.id),
          eq(
            actReplacementObservations.sourceDatabaseKey,
            run.sourceDatabaseKey,
          ),
        ),
      );
    const streamTypes = new Set([
      ...checkpoints.map(({ streamType }) => streamType),
      ...observationRows.map(({ streamType }) => streamType),
    ]);
    const equationsHold = [...streamTypes].every((streamType) => {
      const counters = this.sumCounters(
        checkpoints.filter((row) => row.streamType === streamType),
      );
      const observations = observationRows.filter(
        (row) => row.streamType === streamType,
      );
      const versioned = observations.filter(
        ({ versionId }) => versionId !== null,
      ).length;
      return (
        observations.length === versioned &&
        counters.observedIdentities === observations.length &&
        counters.archivedIdentities === versioned &&
        counters.observedIdentities === counters.archivedIdentities &&
        counters.observedIdentities ===
          counters.completeIdentities +
            counters.partialIdentities +
            counters.failedIdentities
      );
    });
    if (!equationsHold) return;

    await transaction
      .update(actReplacementRuns)
      .set({
        phase: "extract_complete",
        extractCompletedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(actReplacementRuns.id, run.id),
          eq(actReplacementRuns.sourceDatabaseKey, run.sourceDatabaseKey),
          eq(actReplacementRuns.phase, "extracting"),
        ),
      );
  }

  private sumCounters(
    rows: readonly (typeof actReplacementCheckpoints.$inferSelect)[],
  ): ActExtractionCounters {
    return rows.reduce<ActExtractionCounters>(
      (total, row) => ({
        responseRows: total.responseRows + row.responseRows,
        observedIdentities: total.observedIdentities + row.observedIdentities,
        archivedIdentities: total.archivedIdentities + row.archivedIdentities,
        completeIdentities: total.completeIdentities + row.completeIdentities,
        partialIdentities: total.partialIdentities + row.partialIdentities,
        failedIdentities: total.failedIdentities + row.failedIdentities,
        snapshotVersionsInserted:
          total.snapshotVersionsInserted + row.snapshotVersionsInserted,
      }),
      zeroCounters(),
    );
  }

  private errorRank(state: string) {
    return state === "failed"
      ? 0
      : state === "unsupported"
        ? 1
        : state === "retry_wait"
          ? 2
          : 3;
  }

  private async protect<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof ActCheckpointConflictError ||
        error instanceof ActReplacementRunNotFoundError ||
        error instanceof ActCheckpointRepositoryError
      ) {
        throw error;
      }
      throw new ActCheckpointRepositoryError();
    }
  }
}
