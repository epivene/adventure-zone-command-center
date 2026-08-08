import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actReplacementCheckpoints,
  actReplacementObservations,
  actReplacementPageReceipts,
  actReplacementRuns,
  actSourceRecords,
  actSourceRecordVersions,
} from "@workspace/db/schema";
import type {
  ActArchiveCompleteness,
  ActExtractionCounters,
  ActQueryMode,
  ActReplacementStreamType,
  ActRootStreamType,
  ActSnapshotScope,
  DerivedCheckpointSpec,
} from "./import-types";
import {
  fingerprintSourceContent,
  sanitizeSourceContent,
  SourceFingerprintError,
} from "./source-fingerprint";
import { logger } from "@/lib/logger";

type DrizzleDatabase = typeof database;

export type ArchiveSourceItem = {
  streamType: ActReplacementStreamType;
  sourceKey: string;
  actRecordId: string | null;
  snapshotScope: ActSnapshotScope;
  archiveCompleteness: ActArchiveCompleteness;
  raw: Record<string, unknown>;
  relationshipEvidence: Record<string, unknown>;
  sourceCreatedAt: Date | null;
  sourceEditedAt: Date | null;
};

export interface ActSourceArchiveRepository {
  archiveCheckpointPage(input: {
    runId: string;
    checkpointId: string;
    leaseOwner: string;
    expectedSkip: number;
    items: readonly ArchiveSourceItem[];
    derivedCheckpoints: readonly DerivedCheckpointSpec[];
    nextSkip: number | null;
    queryMode: ActQueryMode;
    pageFingerprint: string;
    now: Date;
  }): Promise<ActExtractionCounters>;
}

export class ActArchiveConflictError extends Error {
  readonly code = "ACT_ARCHIVE_CONFLICT";

  constructor() {
    super("Act archive checkpoint state no longer matches.");
    this.name = "ActArchiveConflictError";
  }
}

export class ActArchiveStoreError extends Error {
  readonly code = "ACT_ARCHIVE_STORE_FAILED";

  constructor() {
    super("Act source page could not be archived.");
    this.name = "ActArchiveStoreError";
  }
}

const zeroCounters = (): ActExtractionCounters => ({
  responseRows: 0,
  observedIdentities: 0,
  archivedIdentities: 0,
  completeIdentities: 0,
  partialIdentities: 0,
  failedIdentities: 0,
  snapshotVersionsInserted: 0,
});

function conflicts(): never {
  throw new ActArchiveConflictError();
}

export function archivePageAction(
  runPhase: string,
  hasExactReceipt: boolean,
): "replay" | "write" {
  if (hasExactReceipt) return "replay";
  if (runPhase !== "extracting") conflicts();
  return "write";
}

function sameNullableNumber(left: number | null, right: number | null) {
  return left === right;
}

function safeDatabaseErrorMetadata(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") break;
    const metadata = current as {
      name?: unknown;
      code?: unknown;
      constraint?: unknown;
      table?: unknown;
      column?: unknown;
      cause?: unknown;
    };
    if (
      typeof metadata.code === "string" ||
      typeof metadata.constraint === "string" ||
      typeof metadata.table === "string" ||
      typeof metadata.column === "string"
    ) {
      return {
        errorName:
          typeof metadata.name === "string" ? metadata.name : "unknown",
        pgCode:
          typeof metadata.code === "string" ? metadata.code : "unknown",
        constraint:
          typeof metadata.constraint === "string" ? metadata.constraint : null,
        table: typeof metadata.table === "string" ? metadata.table : null,
        column: typeof metadata.column === "string" ? metadata.column : null,
      };
    }
    current = metadata.cause;
  }
  return {
    errorName:
      error instanceof Error && error.name ? error.name : "unknown",
    pgCode: "unknown",
    constraint: null,
    table: null,
    column: null,
  };
}

type TerminalCompleteness = Exclude<ActArchiveCompleteness, "discovered">;

function terminalCompleteness(
  value: ActArchiveCompleteness,
): TerminalCompleteness | null {
  return value === "complete" || value === "partial" || value === "failed"
    ? value
    : null;
}

export function derivedCheckpointsAllowedByCapabilities(
  checkpoints: readonly DerivedCheckpointSpec[],
  unavailableDetailRoots: ReadonlySet<ActRootStreamType>,
): DerivedCheckpointSpec[] {
  return checkpoints.filter(
    (checkpoint) =>
      checkpoint.checkpointKind !== "detail" ||
      !unavailableDetailRoots.has(checkpoint.streamType as ActRootStreamType),
  );
}

export class DrizzleActSourceArchiveRepository implements ActSourceArchiveRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async archiveCheckpointPage(
    input: Parameters<ActSourceArchiveRepository["archiveCheckpointPage"]>[0],
  ): Promise<ActExtractionCounters> {
    let stage = "open_transaction";
    try {
      return await this.database.transaction(async (transaction) => {
        stage = "lock_run";
        const [run] = await transaction
          .select({
            id: actReplacementRuns.id,
            sourceDatabaseKey: actReplacementRuns.sourceDatabaseKey,
            phase: actReplacementRuns.phase,
          })
          .from(actReplacementRuns)
          .where(eq(actReplacementRuns.id, input.runId))
          .limit(1)
          .for("update");
        if (!run) conflicts();

        stage = "lock_checkpoint";
        const [checkpoint] = await transaction
          .select()
          .from(actReplacementCheckpoints)
          .where(
            and(
              eq(actReplacementCheckpoints.id, input.checkpointId),
              eq(actReplacementCheckpoints.runId, run.id),
              eq(
                actReplacementCheckpoints.sourceDatabaseKey,
                run.sourceDatabaseKey,
              ),
            ),
          )
          .limit(1)
          .for("update");
        if (!checkpoint || checkpoint.runId !== input.runId) conflicts();
        if (run.sourceDatabaseKey !== checkpoint.sourceDatabaseKey) {
          conflicts();
        }
        if (
          input.items.some((item) => item.streamType !== checkpoint.streamType)
        ) {
          conflicts();
        }

        stage = "load_receipt";
        const [receipt] = await transaction
          .select()
          .from(actReplacementPageReceipts)
          .where(
            and(
              eq(actReplacementPageReceipts.checkpointId, input.checkpointId),
              eq(actReplacementPageReceipts.pageSkip, input.expectedSkip),
            ),
          )
          .limit(1);
        if (receipt) {
          if (
            receipt.runId !== input.runId ||
            receipt.streamType !== checkpoint.streamType ||
            !sameNullableNumber(receipt.nextSkip, input.nextSkip) ||
            receipt.queryMode !== input.queryMode ||
            receipt.pageFingerprint !== input.pageFingerprint ||
            receipt.responseRows !== input.items.length
          ) {
            conflicts();
          }
          archivePageAction(run.phase, true);
          return zeroCounters();
        }

        archivePageAction(run.phase, false);

        if (
          checkpoint.state !== "leased" ||
          checkpoint.leaseOwner !== input.leaseOwner ||
          checkpoint.nextSkip !== input.expectedSkip ||
          !checkpoint.leaseExpiresAt ||
          checkpoint.leaseExpiresAt.getTime() <= input.now.getTime()
        ) {
          conflicts();
        }

        stage = "insert_receipt";
        await transaction.insert(actReplacementPageReceipts).values({
          runId: input.runId,
          checkpointId: input.checkpointId,
          streamType: checkpoint.streamType,
          pageSkip: input.expectedSkip,
          nextSkip: input.nextSkip,
          queryMode: input.queryMode,
          pageFingerprint: input.pageFingerprint,
          responseRows: input.items.length,
          createdAt: input.now,
        });

        const observedIdentityIds = new Set<string>();
        const completenessDeltas: Record<TerminalCompleteness, number> = {
          complete: 0,
          partial: 0,
          failed: 0,
        };
        let snapshotVersionsInserted = 0;

        stage = "archive_items";
        for (const item of input.items) {
          stage = "sanitize_item";
          const sanitizedRaw = sanitizeSourceContent(item.raw);
          const sanitizedEvidence = sanitizeSourceContent(
            item.relationshipEvidence,
          );
          const fingerprint = fingerprintSourceContent(item.raw);
          stage = "find_identity";
          let [identity] = await transaction
            .select({
              id: actSourceRecords.id,
              archiveCompleteness: actSourceRecords.archiveCompleteness,
            })
            .from(actSourceRecords)
            .where(
              and(
                eq(actSourceRecords.sourceDatabaseKey, run.sourceDatabaseKey),
                eq(actSourceRecords.streamType, item.streamType),
                eq(actSourceRecords.sourceKey, item.sourceKey),
              ),
            )
            .limit(1)
            .for("update");
          let previousCompleteness = identity?.archiveCompleteness as
            ActArchiveCompleteness | undefined;
          const retainedTerminal = previousCompleteness
            ? terminalCompleteness(previousCompleteness)
            : null;
          let nextCompleteness =
            item.archiveCompleteness === "discovered" && retainedTerminal
              ? retainedTerminal
              : item.archiveCompleteness;

          if (!identity) {
            stage = "insert_identity";
            const [insertedIdentity] = await transaction
              .insert(actSourceRecords)
              .values({
                sourceDatabaseKey: run.sourceDatabaseKey,
                streamType: item.streamType,
                sourceKey: item.sourceKey,
                actRecordId: item.actRecordId,
                firstSeenRunId: input.runId,
                lastSeenRunId: input.runId,
                relationshipEvidence: sanitizedEvidence,
                archiveCompleteness: nextCompleteness,
                firstSeenAt: input.now,
                lastSeenAt: input.now,
                createdAt: input.now,
                updatedAt: input.now,
              })
              .onConflictDoNothing({
                target: [
                  actSourceRecords.sourceDatabaseKey,
                  actSourceRecords.streamType,
                  actSourceRecords.sourceKey,
                ],
              })
              .returning({
                id: actSourceRecords.id,
                archiveCompleteness: actSourceRecords.archiveCompleteness,
              });
            identity = insertedIdentity;
          }

          if (!identity) {
            stage = "reload_identity";
            [identity] = await transaction
              .select({
                id: actSourceRecords.id,
                archiveCompleteness: actSourceRecords.archiveCompleteness,
              })
              .from(actSourceRecords)
              .where(
                and(
                  eq(actSourceRecords.sourceDatabaseKey, run.sourceDatabaseKey),
                  eq(actSourceRecords.streamType, item.streamType),
                  eq(actSourceRecords.sourceKey, item.sourceKey),
                ),
              )
              .limit(1)
              .for("update");
            previousCompleteness = identity?.archiveCompleteness as
              ActArchiveCompleteness | undefined;
            const concurrentTerminal = previousCompleteness
              ? terminalCompleteness(previousCompleteness)
              : null;
            nextCompleteness =
              item.archiveCompleteness === "discovered" && concurrentTerminal
                ? concurrentTerminal
                : item.archiveCompleteness;
          }
          if (!identity)
            throw new Error("Act archive identity was not stored.");

          if (previousCompleteness !== undefined) {
            stage = "update_identity";
            await transaction
              .update(actSourceRecords)
              .set({
                actRecordId: sql`coalesce(${actSourceRecords.actRecordId}, ${item.actRecordId})`,
                lastSeenRunId: input.runId,
                relationshipEvidence: sanitizedEvidence,
                archiveCompleteness: nextCompleteness,
                lastSeenAt: input.now,
                updatedAt: input.now,
              })
              .where(eq(actSourceRecords.id, identity.id));
          }

          stage = "insert_version";
          const [insertedVersion] = await transaction
            .insert(actSourceRecordVersions)
            .values({
              sourceRecordId: identity.id,
              sourceDatabaseKey: run.sourceDatabaseKey,
              fingerprint,
              rawSnapshot: sanitizedRaw,
              snapshotScope: item.snapshotScope,
              sourceCreatedAt: item.sourceCreatedAt,
              sourceEditedAt: item.sourceEditedAt,
              fetchedAt: input.now,
              observedRunId: input.runId,
              createdAt: input.now,
            })
            .onConflictDoNothing({
              target: [
                actSourceRecordVersions.sourceRecordId,
                actSourceRecordVersions.fingerprint,
              ],
            })
            .returning({ id: actSourceRecordVersions.id });
          if (insertedVersion) snapshotVersionsInserted += 1;

          stage = "load_version";
          const version =
            insertedVersion ??
            (
              await transaction
                .select({ id: actSourceRecordVersions.id })
                .from(actSourceRecordVersions)
                .where(
                  and(
                    eq(actSourceRecordVersions.sourceRecordId, identity.id),
                    eq(actSourceRecordVersions.fingerprint, fingerprint),
                  ),
                )
                .limit(1)
            )[0];
          if (!version) throw new Error("Act archive version was not stored.");

          stage = "update_latest_version";
          await transaction
            .update(actSourceRecords)
            .set({
              latestVersionId: version.id,
              latestFingerprint: fingerprint,
              updatedAt: input.now,
            })
            .where(eq(actSourceRecords.id, identity.id));

          stage = "insert_observation";
          const [insertedObservation] = await transaction
            .insert(actReplacementObservations)
            .values({
              runId: input.runId,
              sourceDatabaseKey: run.sourceDatabaseKey,
              sourceRecordId: identity.id,
              versionId: version.id,
              snapshotScope: item.snapshotScope,
              observedAt: input.now,
            })
            .onConflictDoNothing({
              target: [
                actReplacementObservations.runId,
                actReplacementObservations.sourceRecordId,
              ],
            })
            .returning({ id: actReplacementObservations.id });
          if (insertedObservation) {
            observedIdentityIds.add(identity.id);
            const nextTerminal = terminalCompleteness(nextCompleteness);
            if (nextTerminal) completenessDeltas[nextTerminal] += 1;
          } else {
            stage = "update_observation";
            await transaction
              .update(actReplacementObservations)
              .set({
                versionId: version.id,
                snapshotScope: item.snapshotScope,
                observedAt: input.now,
              })
              .where(
                and(
                  eq(actReplacementObservations.runId, input.runId),
                  eq(actReplacementObservations.sourceRecordId, identity.id),
                ),
              );
            const previousTerminal = previousCompleteness
              ? terminalCompleteness(previousCompleteness)
              : null;
            const nextTerminal = terminalCompleteness(nextCompleteness);
            if (previousTerminal !== nextTerminal) {
              if (previousTerminal) completenessDeltas[previousTerminal] -= 1;
              if (nextTerminal) completenessDeltas[nextTerminal] += 1;
            }
          }
        }

        for (const category of ["complete", "partial", "failed"] as const) {
          while (completenessDeltas[category] < 0) {
            const counterColumn =
              category === "complete"
                ? actReplacementCheckpoints.completeIdentities
                : category === "partial"
                  ? actReplacementCheckpoints.partialIdentities
                  : actReplacementCheckpoints.failedIdentities;
            const [holder] = await transaction
              .select({ id: actReplacementCheckpoints.id })
              .from(actReplacementCheckpoints)
              .where(
                and(
                  eq(actReplacementCheckpoints.runId, input.runId),
                  eq(
                    actReplacementCheckpoints.streamType,
                    checkpoint.streamType,
                  ),
                  gt(counterColumn, 0),
                ),
              )
              .orderBy(
                asc(actReplacementCheckpoints.createdAt),
                asc(actReplacementCheckpoints.id),
              )
              .limit(1)
              .for("update");
            if (!holder) {
              throw new Error("Act archive completeness counters are invalid.");
            }
            if (category === "complete") {
              await transaction
                .update(actReplacementCheckpoints)
                .set({
                  completeIdentities: sql`${actReplacementCheckpoints.completeIdentities} - 1`,
                })
                .where(eq(actReplacementCheckpoints.id, holder.id));
            } else if (category === "partial") {
              await transaction
                .update(actReplacementCheckpoints)
                .set({
                  partialIdentities: sql`${actReplacementCheckpoints.partialIdentities} - 1`,
                })
                .where(eq(actReplacementCheckpoints.id, holder.id));
            } else {
              await transaction
                .update(actReplacementCheckpoints)
                .set({
                  failedIdentities: sql`${actReplacementCheckpoints.failedIdentities} - 1`,
                })
                .where(eq(actReplacementCheckpoints.id, holder.id));
            }
            completenessDeltas[category] += 1;
          }
        }

        const detailStreams = [
          ...new Set(
            input.derivedCheckpoints
              .filter(({ checkpointKind }) => checkpointKind === "detail")
              .map(({ streamType }) => streamType),
          ),
        ];
        const capabilityMarkers =
          detailStreams.length === 0
            ? []
            : await transaction
                .select({
                  streamType: actReplacementCheckpoints.streamType,
                  partitionKey: actReplacementCheckpoints.partitionKey,
                })
                .from(actReplacementCheckpoints)
                .where(
                  and(
                    eq(actReplacementCheckpoints.runId, run.id),
                    eq(
                      actReplacementCheckpoints.sourceDatabaseKey,
                      run.sourceDatabaseKey,
                    ),
                    inArray(
                      actReplacementCheckpoints.streamType,
                      detailStreams,
                    ),
                    eq(
                      actReplacementCheckpoints.checkpointKind,
                      "plain_list_fallback",
                    ),
                  ),
                );
        const unavailableDetailRoots = new Set<ActRootStreamType>(
          capabilityMarkers
            .filter(
              ({ streamType, partitionKey }) =>
                partitionKey === `plain-full:${streamType}`,
            )
            .map(({ streamType }) => streamType as ActRootStreamType),
        );
        const derivedCheckpoints = derivedCheckpointsAllowedByCapabilities(
          input.derivedCheckpoints,
          unavailableDetailRoots,
        );

        stage = "insert_derived_checkpoints";
        if (derivedCheckpoints.length > 0) {
          await transaction
            .insert(actReplacementCheckpoints)
            .values(
              derivedCheckpoints.map((checkpointSpec) => ({
                runId: input.runId,
                sourceDatabaseKey: run.sourceDatabaseKey,
                streamType: checkpointSpec.streamType,
                checkpointKind: checkpointSpec.checkpointKind,
                partitionKey: checkpointSpec.partitionKey,
                requiredness: checkpointSpec.requiredness,
                parentSourceRecordId: checkpointSpec.parentSourceRecordId,
                parentActRecordId: checkpointSpec.parentActRecordId,
                sourceRecordId: checkpointSpec.sourceRecordId,
                nextSkip: checkpointSpec.nextSkip,
                pageSize: checkpointSpec.pageSize,
                queryMode: checkpointSpec.queryMode,
                deriveDetails: checkpointSpec.deriveDetails,
                state: "pending",
                createdAt: input.now,
                updatedAt: input.now,
              })),
            )
            .onConflictDoNothing({
              target: [
                actReplacementCheckpoints.runId,
                actReplacementCheckpoints.streamType,
                actReplacementCheckpoints.partitionKey,
              ],
            });
        }

        const counters: ActExtractionCounters = {
          responseRows: input.items.length,
          observedIdentities: observedIdentityIds.size,
          archivedIdentities: observedIdentityIds.size,
          completeIdentities: completenessDeltas.complete,
          partialIdentities: completenessDeltas.partial,
          failedIdentities: completenessDeltas.failed,
          snapshotVersionsInserted,
        };
        const terminal = input.nextSkip === null;

        stage = "complete_checkpoint";
        await transaction
          .update(actReplacementCheckpoints)
          .set({
            nextSkip: input.nextSkip ?? input.expectedSkip,
            queryMode: input.queryMode,
            state: terminal ? "complete" : "pending",
            leaseOwner: null,
            leaseExpiresAt: null,
            retryAfter: null,
            retryable: true,
            responseRows: sql`${actReplacementCheckpoints.responseRows} + ${counters.responseRows}`,
            observedIdentities: sql`${actReplacementCheckpoints.observedIdentities} + ${counters.observedIdentities}`,
            archivedIdentities: sql`${actReplacementCheckpoints.archivedIdentities} + ${counters.archivedIdentities}`,
            completeIdentities: sql`${actReplacementCheckpoints.completeIdentities} + ${counters.completeIdentities}`,
            partialIdentities: sql`${actReplacementCheckpoints.partialIdentities} + ${counters.partialIdentities}`,
            failedIdentities: sql`${actReplacementCheckpoints.failedIdentities} + ${counters.failedIdentities}`,
            snapshotVersionsInserted: sql`${actReplacementCheckpoints.snapshotVersionsInserted} + ${counters.snapshotVersionsInserted}`,
            errorCode: null,
            lastSucceededAt: input.now,
            completedAt: terminal ? input.now : null,
            updatedAt: input.now,
          })
          .where(eq(actReplacementCheckpoints.id, input.checkpointId));

        return counters;
      });
    } catch (error) {
      const metadata = safeDatabaseErrorMetadata(error);
      logger.error(
        {
          stage,
          ...metadata,
        },
        "Act archive transaction failed",
      );
      if (
        error instanceof ActArchiveConflictError ||
        error instanceof SourceFingerprintError ||
        error instanceof ActArchiveStoreError
      ) {
        throw error;
      }
      throw new ActArchiveStoreError();
    }
  }
}
