import { and, asc, count, eq, inArray, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actMigrationProposals,
  actMigrationRecords,
  actMigrationRuns,
  auditEntries,
} from "@/db/schema";
import {
  allowedDecisionsForProposal,
  migrationTargetRank,
  type ActMigrationProposal,
  type MigrationDecision,
  type MigrationPreviewState,
  type MigrationReviewState,
  type MigrationTargetEntityType,
} from "@/features/act-migration/migration-types";
import {
  proposalSnapshotDigest,
  type MigrationReconciliationReport,
} from "@/features/act-migration/reconciliation";

type DrizzleDatabase = typeof database;
type StoredProposalRow = typeof actMigrationProposals.$inferSelect;

const INSERT_CHUNK_SIZE = 200;

export type MigrationPreviewQuery = {
  targetEntityType?: MigrationTargetEntityType;
  state?: MigrationPreviewState;
  page: number;
  pageSize: number;
};

export type StoredMigrationProposal = ActMigrationProposal & {
  id: string;
  decision: MigrationDecision | null;
  decisionReason: string | null;
  chosenLocalEntityId: string | null;
  primarySourceId: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
};

export type StoredMigrationPreviewPage = {
  runId: string;
  rows: readonly StoredMigrationProposal[];
  report: MigrationReconciliationReport;
  page: number;
  pageSize: number;
  total: number;
};

export interface ActMigrationPreviewRepository {
  storeProposalsIfAbsent(input: {
    runId: string;
    sourceDigest: string;
    proposalDigest: string;
    proposals: readonly ActMigrationProposal[];
    report: MigrationReconciliationReport;
  }): Promise<void>;
  getPreviewIfStored(
    runId: string,
    query: MigrationPreviewQuery,
  ): Promise<StoredMigrationPreviewPage | null>;
  getPreview(
    runId: string,
    query: MigrationPreviewQuery,
  ): Promise<StoredMigrationPreviewPage>;
  saveDecision(input: {
    runId: string;
    proposalKey: string;
    decision: MigrationDecision;
    chosenLocalEntityId?: string;
    primarySourceId?: string;
    ignoreReason?: string;
    decidedBy: string;
  }): Promise<void>;
}

function targetOrder(column: typeof actMigrationProposals.targetEntityType) {
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

function validateQuery(query: MigrationPreviewQuery) {
  if (!Number.isInteger(query.page) || query.page < 1) {
    throw new Error("Act migration preview page must be a one-based integer.");
  }
  if (!Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100) {
    throw new Error("Act migration preview page size must be between 1 and 100.");
  }
}

function proposalValue(row: StoredProposalRow): StoredMigrationProposal {
  return {
    id: row.id,
    proposalKey: row.proposalKey,
    state: row.state as MigrationPreviewState,
    reviewState: row.reviewState as MigrationReviewState,
    targetEntityType: row.targetEntityType as MigrationTargetEntityType,
    sourceRecordKeys: row.sourceRecordKeys,
    candidateLocalIds: row.candidateLocalIds,
    proposedLocalId: row.proposedLocalId,
    proposedPrimarySourceId: row.proposedPrimarySourceId,
    issueCode: row.issueCode as ActMigrationProposal["issueCode"],
    dependencyProposalKeys: row.dependencyProposalKeys,
    matchReason: row.matchReason ?? "",
    displaySnapshot: row.displaySnapshot as ActMigrationProposal["displaySnapshot"],
    decision: row.decision as MigrationDecision | null,
    decisionReason: row.decisionReason,
    chosenLocalEntityId: row.chosenLocalEntityId,
    primarySourceId: row.primarySourceId,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
  };
}

function structuralProposal(row: StoredProposalRow): ActMigrationProposal {
  const proposal = proposalValue(row);
  return {
    proposalKey: proposal.proposalKey,
    state: proposal.state,
    reviewState: proposal.reviewState,
    targetEntityType: proposal.targetEntityType,
    sourceRecordKeys: proposal.sourceRecordKeys,
    candidateLocalIds: proposal.candidateLocalIds,
    proposedLocalId: proposal.proposedLocalId,
    proposedPrimarySourceId: proposal.proposedPrimarySourceId,
    issueCode: proposal.issueCode,
    dependencyProposalKeys: proposal.dependencyProposalKeys,
    matchReason: proposal.matchReason,
    displaySnapshot: proposal.displaySnapshot,
  };
}

function proposalInsert(runId: string, proposal: ActMigrationProposal) {
  return {
    runId,
    proposalKey: proposal.proposalKey,
    state: proposal.state,
    reviewState: proposal.reviewState,
    targetEntityType: proposal.targetEntityType,
    sourceRecordKeys: [...proposal.sourceRecordKeys],
    candidateLocalIds: [...proposal.candidateLocalIds],
    proposedLocalId: proposal.proposedLocalId,
    proposedPrimarySourceId: proposal.proposedPrimarySourceId,
    issueCode: proposal.issueCode,
    dependencyProposalKeys: [...proposal.dependencyProposalKeys],
    matchReason: proposal.matchReason,
    displaySnapshot: proposal.displaySnapshot,
  };
}

function reportValue(value: unknown): MigrationReconciliationReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored Act migration reconciliation report is malformed.");
  }
  return value as MigrationReconciliationReport;
}

function decisionMetadata(row: StoredProposalRow) {
  return {
    decision: row.decision,
    decisionReason: row.decisionReason,
    chosenLocalEntityId: row.chosenLocalEntityId,
    primarySourceId: row.primarySourceId,
  };
}

function sameDecision(
  left: ReturnType<typeof decisionMetadata>,
  right: ReturnType<typeof decisionMetadata>,
) {
  return left.decision === right.decision &&
    left.decisionReason === right.decisionReason &&
    left.chosenLocalEntityId === right.chosenLocalEntityId &&
    left.primarySourceId === right.primarySourceId;
}

export class DrizzleActMigrationPreviewRepository
  implements ActMigrationPreviewRepository
{
  constructor(private readonly database: DrizzleDatabase) {}

  storeProposalsIfAbsent(input: {
    runId: string;
    sourceDigest: string;
    proposalDigest: string;
    proposals: readonly ActMigrationProposal[];
    report: MigrationReconciliationReport;
  }): Promise<void> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(actMigrationRuns)
        .where(eq(actMigrationRuns.id, input.runId))
        .limit(1)
        .for("update");
      if (!run) throw new Error("Act migration run is missing.");

      const canonicalDigest = proposalSnapshotDigest(input.proposals);
      if (
        run.sourceDigest !== input.sourceDigest ||
        input.report.sourceDigest !== input.sourceDigest ||
        canonicalDigest !== input.proposalDigest ||
        input.report.proposalDigest !== input.proposalDigest
      ) {
        throw new Error("Act migration preview digests do not match.");
      }
      if (!input.report.complete) {
        throw new Error("Act migration reconciliation report is incomplete.");
      }
      if (run.status === "previewed") {
        if (run.proposalDigest !== input.proposalDigest) {
          throw new Error("Act migration preview digest does not match the stored preview.");
        }
        return;
      }
      if (run.status !== "snapshot_complete") {
        throw new Error(`Act migration run cannot preview from status ${run.status}.`);
      }

      const proposalKeys = input.proposals.map(({ proposalKey }) => proposalKey);
      const proposalKeySet = new Set(proposalKeys);
      if (proposalKeys.length !== proposalKeySet.size) {
        throw new Error("Act migration proposal keys must be unique.");
      }
      if (input.proposals.some((proposal) => proposal.dependencyProposalKeys.some(
        (key) => !proposalKeySet.has(key),
      ))) {
        throw new Error("Act migration proposal dependency is missing from this run.");
      }

      const stagedRecords = await transaction
        .select({
          sourceKey: actMigrationRecords.sourceKey,
          sourceId: actMigrationRecords.sourceId,
          streamType: actMigrationRecords.streamType,
        })
        .from(actMigrationRecords)
        .where(eq(actMigrationRecords.runId, input.runId))
        .for("update");
      const stagedKeys = new Set(stagedRecords.map(({ sourceKey }) => sourceKey));
      const ownership = new Map<string, number>();
      for (const sourceKey of input.proposals.flatMap(
        (proposal) => proposal.sourceRecordKeys,
      )) {
        ownership.set(sourceKey, (ownership.get(sourceKey) ?? 0) + 1);
      }
      if (
        stagedKeys.size !== stagedRecords.length ||
        [...stagedKeys].some((key) => ownership.get(key) !== 1) ||
        [...ownership.keys()].some((key) => !stagedKeys.has(key))
      ) {
        throw new Error("Act migration proposals must own every staged source record exactly once.");
      }
      const stagedContactIdsByKey = new Map(
        stagedRecords.flatMap((record) =>
          record.streamType === "contact" && record.sourceId
            ? [[record.sourceKey, record.sourceId] as const]
            : []
        ),
      );
      if (input.proposals.some((proposal) =>
        proposal.proposedPrimarySourceId !== null &&
        !proposal.sourceRecordKeys.some(
          (key) => stagedContactIdsByKey.get(key) === proposal.proposedPrimarySourceId,
        )
      )) {
        throw new Error("Act migration proposed primary source is not part of its staged Contact proposal.");
      }

      const ordered = [...input.proposals].toSorted((left, right) =>
        migrationTargetRank(left.targetEntityType) - migrationTargetRank(right.targetEntityType) ||
        left.proposalKey.localeCompare(right.proposalKey),
      );
      for (let offset = 0; offset < ordered.length; offset += INSERT_CHUNK_SIZE) {
        await transaction
          .insert(actMigrationProposals)
          .values(ordered.slice(offset, offset + INSERT_CHUNK_SIZE).map((proposal) =>
            proposalInsert(input.runId, proposal)
          ))
          .onConflictDoNothing({
            target: [actMigrationProposals.runId, actMigrationProposals.proposalKey],
          });
      }
      const persisted = await transaction
        .select()
        .from(actMigrationProposals)
        .where(eq(actMigrationProposals.runId, input.runId))
        .orderBy(asc(actMigrationProposals.proposalKey))
        .for("update");
      const persistedKeys = new Set(persisted.map(({ proposalKey }) => proposalKey));
      if (
        persisted.length !== input.proposals.length ||
        persistedKeys.size !== proposalKeySet.size ||
        [...proposalKeySet].some((key) => !persistedKeys.has(key)) ||
        persisted.some((proposal) => proposal.dependencyProposalKeys.some(
          (key) => !persistedKeys.has(key),
        )) ||
        proposalSnapshotDigest(persisted.map(structuralProposal)) !== input.proposalDigest
      ) {
        throw new Error("Stored Act migration proposals do not match the immutable preview digest.");
      }

      for (const proposal of ordered) {
        if (proposal.sourceRecordKeys.length === 0) continue;
        await transaction
          .update(actMigrationRecords)
          .set({
            proposedAction: proposal.state,
            reviewState: proposal.reviewState,
            proposalKey: proposal.proposalKey,
            matchedEntityType: proposal.targetEntityType,
            matchedEntityId: proposal.proposedLocalId,
          })
          .where(and(
            eq(actMigrationRecords.runId, input.runId),
            inArray(actMigrationRecords.sourceKey, [...proposal.sourceRecordKeys]),
          ));
      }
      const completedAt = run.previewCompletedAt ?? new Date();
      await transaction
        .update(actMigrationRuns)
        .set({
          status: "previewed",
          sourceDigest: input.sourceDigest,
          proposalDigest: input.proposalDigest,
          summary: input.report,
          previewCompletedAt: completedAt,
          updatedAt: completedAt,
        })
        .where(eq(actMigrationRuns.id, input.runId));
    });
  }

  async getPreviewIfStored(
    runId: string,
    query: MigrationPreviewQuery,
  ): Promise<StoredMigrationPreviewPage | null> {
    validateQuery(query);
    const [run] = await this.database
      .select({
        status: actMigrationRuns.status,
        sourceDigest: actMigrationRuns.sourceDigest,
        proposalDigest: actMigrationRuns.proposalDigest,
        summary: actMigrationRuns.summary,
      })
      .from(actMigrationRuns)
      .where(eq(actMigrationRuns.id, runId))
      .limit(1);
    if (!run || run.status !== "previewed") return null;
    if (!run.sourceDigest || !run.proposalDigest || !run.summary) {
      throw new Error("Stored Act migration preview is incomplete.");
    }
    const filters = [eq(actMigrationProposals.runId, runId)];
    if (query.targetEntityType) {
      filters.push(eq(actMigrationProposals.targetEntityType, query.targetEntityType));
    }
    if (query.state) filters.push(eq(actMigrationProposals.state, query.state));
    const where = and(...filters);
    const [{ total = 0 } = {}] = await this.database
      .select({ total: count() })
      .from(actMigrationProposals)
      .where(where);
    const rows = await this.database
      .select()
      .from(actMigrationProposals)
      .where(where)
      .orderBy(targetOrder(actMigrationProposals.targetEntityType), asc(actMigrationProposals.proposalKey))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return {
      runId,
      rows: rows.map(proposalValue),
      report: reportValue(run.summary),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async getPreview(
    runId: string,
    query: MigrationPreviewQuery,
  ): Promise<StoredMigrationPreviewPage> {
    const preview = await this.getPreviewIfStored(runId, query);
    if (!preview) throw new Error("Act migration preview was not found.");
    return preview;
  }

  saveDecision(input: {
    runId: string;
    proposalKey: string;
    decision: MigrationDecision;
    chosenLocalEntityId?: string;
    primarySourceId?: string;
    ignoreReason?: string;
    decidedBy: string;
  }): Promise<void> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({ id: actMigrationRuns.id, status: actMigrationRuns.status })
        .from(actMigrationRuns)
        .where(eq(actMigrationRuns.id, input.runId))
        .limit(1)
        .for("update");
      if (!run || run.status !== "previewed") {
        throw new Error("Act migration preview is not ready for review decisions.");
      }
      const [proposal] = await transaction
        .select()
        .from(actMigrationProposals)
        .where(and(
          eq(actMigrationProposals.runId, input.runId),
          eq(actMigrationProposals.proposalKey, input.proposalKey),
        ))
        .limit(1)
        .for("update");
      if (!proposal) throw new Error("Act migration proposal is missing.");

      const allowed = allowedDecisionsForProposal({
        state: proposal.state as MigrationPreviewState,
        targetEntityType: proposal.targetEntityType as MigrationTargetEntityType,
        issueCode: proposal.issueCode as ActMigrationProposal["issueCode"],
        candidateLocalIds: proposal.candidateLocalIds,
      });
      if (!allowed.includes(input.decision)) {
        throw new Error("Act migration decision is not allowed for this proposal.");
      }

      const chosenLocalEntityId = input.decision === "link_existing"
        ? input.chosenLocalEntityId?.trim() || null
        : null;
      if (
        input.decision === "link_existing" &&
        (!chosenLocalEntityId || !proposal.candidateLocalIds.includes(chosenLocalEntityId))
      ) {
        throw new Error("Act migration link decision must choose a proposal candidate.");
      }
      const decisionReason = input.decision === "ignore"
        ? input.ignoreReason?.trim() || null
        : null;
      if (input.decision === "ignore" && !decisionReason) {
        throw new Error("Act migration ignore decision requires a reason.");
      }

      const isContact = proposal.targetEntityType === "contact";
      const isApprovingOrLinking = input.decision === "approve_proposed" ||
        input.decision === "link_existing";
      const suppliedPrimary = input.primarySourceId?.trim() || null;
      if (suppliedPrimary && !isContact) {
        throw new Error("Act migration primary source choices are only valid for Contact proposals.");
      }
      if (suppliedPrimary && !isApprovingOrLinking) {
        throw new Error("Act migration primary source choices require an approving or linking decision.");
      }
      const referencedRecords = proposal.sourceRecordKeys.length === 0
        ? []
        : await transaction
          .select({
            sourceKey: actMigrationRecords.sourceKey,
            sourceId: actMigrationRecords.sourceId,
            streamType: actMigrationRecords.streamType,
          })
          .from(actMigrationRecords)
          .where(and(
            eq(actMigrationRecords.runId, input.runId),
            inArray(actMigrationRecords.sourceKey, proposal.sourceRecordKeys),
          ))
          .for("update");
      const contactSourceIds = referencedRecords.flatMap((record) =>
        record.streamType === "contact" && record.sourceId
          ? [record.sourceId]
          : []
      );
      if (suppliedPrimary && !contactSourceIds.includes(suppliedPrimary)) {
        throw new Error("Act migration primary source choice is not part of this Contact proposal.");
      }
      let primarySourceId: string | null = null;
      if (isApprovingOrLinking && isContact) {
        if (proposal.proposedPrimarySourceId !== null) {
          if (suppliedPrimary && suppliedPrimary !== proposal.proposedPrimarySourceId) {
            throw new Error("Act migration proposed primary source cannot be overridden.");
          }
        } else if (contactSourceIds.length > 1) {
          if (!suppliedPrimary) {
            throw new Error("Act migration Contact consolidation requires a primary source choice.");
          }
          primarySourceId = suppliedPrimary;
        } else {
          primarySourceId = suppliedPrimary;
        }
      }
      const nextDecision = {
        decision: input.decision,
        decisionReason,
        chosenLocalEntityId,
        primarySourceId,
      };
      const previousDecision = decisionMetadata(proposal);
      if (sameDecision(previousDecision, nextDecision)) return;

      const nextReviewState = input.decision === "ignore" ? "ignored" : "decided";
      const now = new Date();
      await transaction
        .update(actMigrationProposals)
        .set({ ...nextDecision, decidedBy: input.decidedBy, decidedAt: now, updatedAt: now })
        .where(eq(actMigrationProposals.id, proposal.id));
      if (proposal.sourceRecordKeys.length > 0) {
        await transaction
          .update(actMigrationRecords)
          .set({ reviewState: nextReviewState, updatedAt: now })
          .where(and(
            eq(actMigrationRecords.runId, input.runId),
            inArray(actMigrationRecords.sourceKey, proposal.sourceRecordKeys),
            inArray(actMigrationRecords.reviewState, ["pending", "decided", "ignored"]),
          ));
      }
      await transaction.insert(auditEntries).values({
        entityType: "act_migration_proposal",
        entityId: proposal.id,
        action: "review_decision_changed",
        before: previousDecision,
        after: nextDecision,
      });
    });
  }
}
