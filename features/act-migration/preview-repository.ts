import { and, asc, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  actMigrationProposals,
  actMigrationRecords,
  actMigrationRuns,
  actMigrationApplyOperations,
  auditEntries,
  bookings,
  contacts,
  organizations,
} from "@/db/schema";
import {
  allowedDecisionsForProposal,
  migrationPreviewStateValues,
  migrationTargetEntityTypeValues,
  migrationTargetRank,
  type ActMigrationProposal,
  type MigrationDecision,
  type MigrationPreviewState,
  type MigrationReviewState,
  type MigrationTargetEntityType,
} from "@/features/act-migration/migration-types";
import {
  bulkReviewEligibility,
  type BulkReviewDependencyStates,
  type BulkReviewScope,
} from "@/features/act-migration/bulk-review";
import {
  proposalSnapshotDigest,
  type MigrationReconciliationReport,
} from "@/features/act-migration/reconciliation";
import { ActMigrationRunNotFoundError } from "@/features/act-migration/snapshot-repository";

type DrizzleDatabase = typeof database;
type DrizzleTransaction = Parameters<
  Parameters<DrizzleDatabase["transaction"]>[0]
>[0];
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
  candidateChoices: readonly StoredMigrationChoice[];
  primarySourceChoices: readonly StoredMigrationChoice[];
};

export type StoredMigrationChoice = {
  id: string;
  label: string;
  available: boolean;
};

export type StoredMigrationPreviewPage = {
  runId: string;
  rows: readonly StoredMigrationProposal[];
  report: MigrationReconciliationReport;
  page: number;
  pageSize: number;
  total: number;
  entityCounts: Record<MigrationTargetEntityType, number>;
  stateCounts: Record<MigrationPreviewState, number>;
  reviewSummary?: {
    approved: number;
    pending: number;
    blocked: number;
    ignored: number;
    byTarget: Record<MigrationTargetEntityType, {
      approved: number;
      pending: number;
      blocked: number;
      ignored: number;
    }>;
    bulkEligible: number;
  };
};

export interface ActMigrationPreviewRepository {
  storeProposalsIfAbsent(input: {
    runId: string;
    sourceDigest: string;
    proposalDigest: string;
    proposals: readonly ActMigrationProposal[];
    report: MigrationReconciliationReport;
  }): Promise<{ changed: boolean }>;
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
  }): Promise<{ changed: boolean }>;
  saveBulkDecision(input: BulkReviewScope): Promise<{
    changed: number;
    remaining: number;
  }>;
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

function proposalValue(
  row: StoredProposalRow,
  candidateChoices: readonly StoredMigrationChoice[] = [],
  primarySourceChoices: readonly StoredMigrationChoice[] = [],
): StoredMigrationProposal {
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
    candidateChoices,
    primarySourceChoices,
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

function scopeIssue(input: BulkReviewScope) {
  return input.issue ?? null;
}

async function bulkDependencyStates(
  transaction: DrizzleTransaction,
  runId: string,
  proposals: readonly StoredProposalRow[],
): Promise<BulkReviewDependencyStates> {
  const dependencyProposalKeys = [...new Set(proposals.flatMap(
    ({ dependencyProposalKeys: keys }) => keys,
  ))];
  if (dependencyProposalKeys.length === 0) {
    return { appliedEntityIds: new Set(), frozenParentDecisions: new Map() };
  }
  const parents = await transaction
    .select({
      proposalKey: actMigrationProposals.proposalKey,
      decision: actMigrationProposals.decision,
    })
    .from(actMigrationProposals)
    .where(and(
      eq(actMigrationProposals.runId, runId),
      inArray(actMigrationProposals.proposalKey, dependencyProposalKeys),
    ))
    .for("update");
  const appliedRecords = await transaction
    .select({ proposalKey: actMigrationRecords.proposalKey })
    .from(actMigrationRecords)
    .where(and(
      eq(actMigrationRecords.runId, runId),
      inArray(actMigrationRecords.proposalKey, dependencyProposalKeys),
      isNotNull(actMigrationRecords.appliedEntityId),
    ))
    .for("update");
  return {
    appliedEntityIds: new Set(appliedRecords.flatMap(({ proposalKey }) =>
      proposalKey ? [proposalKey] : []
    )),
    frozenParentDecisions: new Map(parents.map(({ proposalKey, decision }) => [
      proposalKey,
      decision as MigrationDecision | null,
    ])),
  };
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
  }): Promise<{ changed: boolean }> {
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
        return { changed: false };
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
      return { changed: true };
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
    if (!run || !["previewed", "applying", "partially_applied", "applied", "failed"].includes(run.status)) return null;
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
    const organizationCandidateIds = [...new Set(rows.flatMap((row) =>
      row.targetEntityType === "organization" ? row.candidateLocalIds : []
    ))];
    const contactCandidateIds = [...new Set(rows.flatMap((row) =>
      row.targetEntityType === "contact" ? row.candidateLocalIds : []
    ))];
    const bookingCandidateIds = [...new Set(rows.flatMap((row) =>
      row.targetEntityType === "booking" ? row.candidateLocalIds : []
    ))];
    const entityFilters = [eq(actMigrationProposals.runId, runId)];
    if (query.state) {
      entityFilters.push(eq(actMigrationProposals.state, query.state));
    }
    const stateFilters = [eq(actMigrationProposals.runId, runId)];
    if (query.targetEntityType) {
      stateFilters.push(
        eq(actMigrationProposals.targetEntityType, query.targetEntityType),
      );
    }
    const [entityRows, stateRows, organizationRows, contactRows, bookingRows] =
      await Promise.all([
        this.database
          .select({
            value: actMigrationProposals.targetEntityType,
            total: count(),
          })
          .from(actMigrationProposals)
          .where(and(...entityFilters))
          .groupBy(actMigrationProposals.targetEntityType),
        this.database
          .select({ value: actMigrationProposals.state, total: count() })
          .from(actMigrationProposals)
          .where(and(...stateFilters))
          .groupBy(actMigrationProposals.state),
        organizationCandidateIds.length === 0
          ? Promise.resolve([])
          : this.database
          .select({ id: organizations.id, label: organizations.name })
          .from(organizations)
          .where(inArray(organizations.id, organizationCandidateIds)),
        contactCandidateIds.length === 0
          ? Promise.resolve([])
          : this.database
          .select({
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
          })
          .from(contacts)
          .where(inArray(contacts.id, contactCandidateIds)),
        bookingCandidateIds.length === 0
          ? Promise.resolve([])
          : this.database
          .select({ id: bookings.id, label: bookings.name })
          .from(bookings)
          .where(inArray(bookings.id, bookingCandidateIds)),
      ]);
    const organizationLabels = new Map(
      organizationRows.map((row) => [row.id, row.label] as const),
    );
    const contactLabels = new Map(contactRows.map((row) => [
        row.id,
        `${row.firstName} ${row.lastName}`.trim() || row.id,
      ] as const));
    const bookingLabels = new Map(
      bookingRows.map((row) => [row.id, row.label] as const),
    );
    const sourceKeys = [...new Set(rows.flatMap((row) => row.sourceRecordKeys))];
    const contactSources = sourceKeys.length === 0
      ? []
      : await this.database
        .select({
          sourceKey: actMigrationRecords.sourceKey,
          sourceId: actMigrationRecords.sourceId,
          streamType: actMigrationRecords.streamType,
        })
        .from(actMigrationRecords)
        .where(and(
          eq(actMigrationRecords.runId, runId),
          eq(actMigrationRecords.streamType, "contact"),
          isNull(actMigrationRecords.errorCode),
          inArray(actMigrationRecords.sourceKey, sourceKeys),
        ));
    const contactSourceByKey = new Map(
      contactSources.flatMap((record) =>
        record.streamType === "contact" && record.sourceId?.trim()
          ? [[record.sourceKey, record.sourceId] as const]
          : []
      ),
    );
    const storedRows = rows.map((row) => {
      const candidateLabels = row.targetEntityType === "organization"
        ? organizationLabels
        : row.targetEntityType === "contact"
          ? contactLabels
          : row.targetEntityType === "booking"
            ? bookingLabels
            : new Map<string, string>();
      const choices = row.candidateLocalIds.flatMap((id) => {
        const label = candidateLabels.get(id);
        return label ? [{ id, label, available: true }] : [];
      });
      if (
        row.chosenLocalEntityId &&
        !choices.some(({ id }) => id === row.chosenLocalEntityId)
      ) {
        choices.push({
          id: row.chosenLocalEntityId,
          label: "Unavailable local record",
          available: false,
        });
      }
      const primarySourceChoices = row.targetEntityType === "contact"
        ? [...new Set(row.sourceRecordKeys.flatMap((key) => {
            const id = contactSourceByKey.get(key);
            return id ? [id] : [];
          }))].map((id) => ({ id, label: id, available: true }))
        : [];
      return proposalValue(row, choices, primarySourceChoices);
    });
    const entityCounts = Object.fromEntries(
      migrationTargetEntityTypeValues.map((value) => [
        value,
        Number(entityRows.find((row) => row.value === value)?.total ?? 0),
      ]),
    ) as Record<MigrationTargetEntityType, number>;
    const stateCounts = Object.fromEntries(
      migrationPreviewStateValues.map((value) => [
        value,
        Number(stateRows.find((row) => row.value === value)?.total ?? 0),
      ]),
    ) as Record<MigrationPreviewState, number>;
    const reviewRows = await this.database.select({
      target: actMigrationProposals.targetEntityType,
      state: actMigrationProposals.state,
      decision: actMigrationProposals.decision,
    }).from(actMigrationProposals).where(eq(actMigrationProposals.runId, runId));
    const byTarget = Object.fromEntries(migrationTargetEntityTypeValues.map((target) => [
      target,
      { approved: 0, pending: 0, blocked: 0, ignored: 0 },
    ])) as NonNullable<StoredMigrationPreviewPage["reviewSummary"]>["byTarget"];
    const reviewSummary = { approved: 0, pending: 0, blocked: 0, ignored: 0, byTarget, bulkEligible: 0 };
    for (const value of reviewRows) {
      const target = value.target as MigrationTargetEntityType;
      const bucket = byTarget[target];
      if (value.decision === "ignore" || value.state === "ignored") {
        reviewSummary.ignored += 1;
        bucket.ignored += 1;
      } else if (value.state === "error") {
        reviewSummary.blocked += 1;
        bucket.blocked += 1;
      } else if (value.decision) {
        reviewSummary.approved += 1;
        bucket.approved += 1;
      } else if (value.state !== "matched_unchanged") {
        reviewSummary.pending += 1;
        bucket.pending += 1;
      }
      if (
        query.targetEntityType === target &&
        query.state === value.state &&
        value.decision === null &&
        value.state === "new"
      ) reviewSummary.bulkEligible += 1;
    }
    return {
      runId,
      rows: storedRows,
      report: reportValue(run.summary),
      page: query.page,
      pageSize: query.pageSize,
      total,
      entityCounts,
      stateCounts,
      reviewSummary,
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

  saveBulkDecision(input: BulkReviewScope): Promise<{
    changed: number;
    remaining: number;
  }> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({ id: actMigrationRuns.id, status: actMigrationRuns.status })
        .from(actMigrationRuns)
        .where(eq(actMigrationRuns.id, input.runId))
        .limit(1)
        .for("update");
      if (!run) throw new ActMigrationRunNotFoundError();
      if (run.status !== "previewed") {
        throw new Error("Act migration preview is not ready for review decisions.");
      }
      if (input.decision !== "approve_proposed" && input.decision !== "ignore") {
        throw new Error("Act migration bulk decision must approve or ignore proposals.");
      }
      const decisionReason = input.decision === "ignore"
        ? input.reason?.trim() || null
        : null;
      if (input.decision === "ignore" && !decisionReason) {
        throw new Error("Act migration bulk ignore decision requires a reason.");
      }
      const issue = scopeIssue(input);
      const scope = and(
        eq(actMigrationProposals.runId, input.runId),
        eq(actMigrationProposals.targetEntityType, input.target),
        eq(actMigrationProposals.state, input.state),
        eq(actMigrationProposals.reviewState, "pending"),
        issue === null
          ? isNull(actMigrationProposals.issueCode)
          : eq(actMigrationProposals.issueCode, issue),
      );
      const locked = await transaction
        .select()
        .from(actMigrationProposals)
        .where(scope)
        .orderBy(
          targetOrder(actMigrationProposals.targetEntityType),
          asc(actMigrationProposals.proposalKey),
        )
        .limit(100)
        .for("update", { skipLocked: true });
      if (locked.length > 0) {
        const scheduled = await transaction
          .select({ proposalKey: actMigrationApplyOperations.proposalKey })
          .from(actMigrationApplyOperations)
          .where(and(
            eq(actMigrationApplyOperations.runId, input.runId),
            inArray(
              actMigrationApplyOperations.proposalKey,
              locked.map(({ proposalKey }) => proposalKey),
            ),
          ))
          .limit(1)
          .for("key share");
        if (scheduled.length > 0) {
          throw new Error("Act migration proposal decision is scheduled and cannot be changed.");
        }
      }
      const dependencies = await bulkDependencyStates(transaction, input.runId, locked);
      const selected = input.decision === "approve_proposed"
        ? locked.filter((proposal) => bulkReviewEligibility(
          structuralProposal(proposal),
          dependencies,
        ))
        : locked;
      const nextReviewState = input.decision === "ignore" ? "ignored" : "decided";
      const now = new Date();
      for (const proposal of selected) {
        const previousDecision = decisionMetadata(proposal);
        const nextDecision = {
          decision: input.decision,
          decisionReason,
          chosenLocalEntityId: null,
          primarySourceId: null,
        };
        await transaction
          .update(actMigrationProposals)
          .set({ ...nextDecision, decidedBy: input.actor, decidedAt: now, updatedAt: now })
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
      }

      const pending = await transaction
        .select()
        .from(actMigrationProposals)
        .where(scope)
        .orderBy(
          targetOrder(actMigrationProposals.targetEntityType),
          asc(actMigrationProposals.proposalKey),
        );
      const pendingDependencies = await bulkDependencyStates(
        transaction,
        input.runId,
        pending,
      );
      const remaining = input.decision === "ignore"
        ? pending.length
        : pending.filter((proposal) => bulkReviewEligibility(
          structuralProposal(proposal),
          pendingDependencies,
        )).length;
      return { changed: selected.length, remaining };
    });
  }

  saveDecision(input: {
    runId: string;
    proposalKey: string;
    decision: MigrationDecision;
    chosenLocalEntityId?: string;
    primarySourceId?: string;
    ignoreReason?: string;
    decidedBy: string;
  }): Promise<{ changed: boolean }> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({ id: actMigrationRuns.id, status: actMigrationRuns.status })
        .from(actMigrationRuns)
        .where(eq(actMigrationRuns.id, input.runId))
        .limit(1)
        .for("update");
      if (!run) throw new ActMigrationRunNotFoundError();
      if (run.status !== "previewed") {
        const [scheduled] = await transaction
          .select({ id: actMigrationApplyOperations.id })
          .from(actMigrationApplyOperations)
          .where(and(
            eq(actMigrationApplyOperations.runId, input.runId),
            eq(actMigrationApplyOperations.proposalKey, input.proposalKey),
          ))
          .limit(1)
          .for("key share");
        if (scheduled) {
          throw new Error("Act migration proposal decision is scheduled and cannot be changed.");
        }
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
      const [scheduled] = await transaction
        .select({ id: actMigrationApplyOperations.id })
        .from(actMigrationApplyOperations)
        .where(and(
          eq(actMigrationApplyOperations.runId, input.runId),
          eq(actMigrationApplyOperations.proposalKey, input.proposalKey),
        ))
        .limit(1)
        .for("key share");
      if (scheduled) {
        throw new Error("Act migration proposal decision is scheduled and cannot be changed.");
      }

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
      const isStaticGroupConfirmation = input.decision === "confirm_static_group";
      const groupRecord = referencedRecords[0];
      if (
        isStaticGroupConfirmation &&
        (proposal.targetEntityType !== "calling_list" ||
          proposal.issueCode !== "group_membership_semantics_unknown" ||
          proposal.candidateLocalIds.length !== 0 ||
          proposal.sourceRecordKeys.length !== 1 ||
          referencedRecords.length !== 1 ||
          groupRecord?.streamType !== "group" ||
          !groupRecord.sourceId ||
          groupRecord.sourceKey !== `group:${groupRecord.sourceId}`)
      ) {
        throw new Error(
          "Act migration static Group confirmation requires its owner-owned unknown-semantics Group proposal.",
        );
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
      if (sameDecision(previousDecision, nextDecision)) {
        return { changed: false };
      }

      if (input.decision === "link_existing" && chosenLocalEntityId) {
        const table = proposal.targetEntityType === "organization"
          ? organizations
          : proposal.targetEntityType === "contact"
            ? contacts
            : proposal.targetEntityType === "booking"
              ? bookings
              : null;
        if (!table) {
          throw new Error(
            "Act migration target does not support linking to a local record.",
          );
        }
        const [candidate] = await transaction
          .select({ id: table.id })
          .from(table)
          .where(eq(table.id, chosenLocalEntityId))
          .limit(1)
          .for("key share");
        if (!candidate) {
          throw new Error("Act migration local candidate is unavailable.");
        }
      }

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
        after: isStaticGroupConfirmation
          ? {
            decision: input.decision,
            actor: input.decidedBy,
            timestamp: now.toISOString(),
            sourceId: groupRecord!.sourceId!,
          }
          : nextDecision,
      });
      return { changed: true };
    });
  }
}
