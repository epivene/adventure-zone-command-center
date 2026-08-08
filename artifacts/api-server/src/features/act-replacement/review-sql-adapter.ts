import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { logger } from "@/lib/logger";
import { actExternalLinks, actReplacementApprovalRequests, actReplacementApplyBatches, actReplacementApplyOperations, actReplacementObservations, actReplacementOutcomes, actReplacementRuns, actReplacementReviewDecisions, actSourceAssignments, actSourceRecordVersions, actSourceRecords, bookings, contacts, organizations } from "@workspace/db/schema";
import { DrizzleActSourceAssignmentRepository } from "./assignment-repository";
import type { ActApplyService } from "./apply-service";
import type { ApprovalClosure, ApprovalRepository } from "./approval-service";
import type { ActOrganizeManifest, ManifestDiagnostic, ManifestNormalized, ManifestOperation, ManifestSourceInput } from "./manifest-builder";
import { normalizeCompany } from "./normalizers/company-normalizer";
import { normalizeContact } from "./normalizers/contact-normalizer";
import { normalizeGroup } from "./normalizers/group-normalizer";
import { normalizeOpportunity } from "./normalizers/opportunity-normalizer";
import { normalizeTimeline } from "./normalizers/timeline-normalizer";
import { resolveActSourceGraph, type ActRelationshipEvidence, type ActSourceAssignmentEvidence } from "./relationship-resolver";
import { matchOrganization, type LocalOrganizationCandidate } from "./matching/organization-matcher";
import { matchContact, type LocalContactCandidate } from "./matching/contact-matcher";
import { matchBooking, type LocalBookingCandidate } from "./matching/booking-matcher";
import type { ExternalLink } from "./matching/match-result";
import type { Assignment, Decision, ReviewCommandStore, SaveAssignmentInput, SaveDecisionInput } from "./review-command-service";
import type { ReviewReader, ReviewSourceRecord } from "./review-reader";
import { projectActReviewDisplay } from "./review-display";
import { ProductionActOrganizer, type OrganizerRun, type ProductionOrganizerStore } from "./production-organizer";

export { projectActReviewDisplay } from "./review-display";

type DrizzleDatabase = typeof database;
type SourceDatabaseScope = { sourceDatabaseKey: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const array = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const manifestWriteBatchSize = 250;
// Manifest construction is synchronous, so its timer heartbeat cannot run
// while the event loop is CPU-bound. Keep enough fenced lease headroom for a
// large archive; normal database work still renews every minute.
const organizerLeaseMs = 30 * 60_000;
export function manifestWriteBatches<T>(rows: readonly T[]): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += manifestWriteBatchSize)
    batches.push(rows.slice(index, index + manifestWriteBatchSize));
  return batches;
}
const operationRank: Record<string, number> = {
  organization: 10,
  contact: 20,
  calling_list: 30,
  booking: 40,
  activity: 50,
  organization_contact: 60,
  booking_contact: 70,
  calling_list_member: 80,
  activity_association: 90,
};

/** Rebuilds the exact deterministic manifest representation written by the organizer. */
export function manifestFromRows(input: { operations: Array<Record<string, unknown>>; outcomes: Array<Record<string, unknown>> }, durableDigest?: string): ActOrganizeManifest {
  const operations: ManifestOperation[] = input.operations
    .map((row) => ({
      operationKey: text(row.operationKey),
      sourceRecordId: text(row.sourceRecordId),
      sourceVersionId: text(row.sourceVersionId),
      targetType: row.targetType as ManifestOperation["targetType"],
      action: row.action as ManifestOperation["action"],
      payload: object(row.payload),
      dependencyOperationKeys: array<string>(row.dependencyOperationKeys),
      requiredForSourceOutcome: Boolean(row.requiredForSourceOutcome),
      safeByDefault: Boolean(row.safeByDefault),
    }))
    .sort((a, b) => {
      const rank = (operation: ManifestOperation) => (operation.operationKey.startsWith("provenance:") ? 100 : (operationRank[operation.targetType] ?? 999));
      return rank(a) - rank(b) || a.operationKey.localeCompare(b.operationKey);
    });
  const operationKeysBySource = new Map<string, string[]>();
  for (const operation of operations) {
    const keys = operationKeysBySource.get(operation.sourceRecordId) ?? [];
    keys.push(operation.operationKey);
    operationKeysBySource.set(operation.sourceRecordId, keys);
  }
  const outcomes = input.outcomes
    .map((row) => ({
      sourceRecordId: text(row.sourceRecordId),
      sourceVersionId: text(row.sourceVersionId),
      state: row.state as ActOrganizeManifest["outcomes"][number]["state"],
      issues: array<{ code: string; reason?: string }>(row.issues),
      candidates: array<Record<string, unknown>>(row.candidates),
      match: row.match ? object(row.match) : null,
      mappingWarnings: array<string>(row.mappingWarnings),
      unsupportedFieldPaths: array<string>(row.unsupportedFieldPaths),
      operationKeys: Array.isArray(row.operationKeys) ? array<string>(row.operationKeys) : (operationKeysBySource.get(text(row.sourceRecordId)) ?? []),
    }))
    .sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId));
  const diagnostics: ManifestDiagnostic[] = [];
  for (const outcome of outcomes)
    for (const issue of outcome.issues) {
      const code = issue.code as ManifestDiagnostic["code"];
      if (["unsupported_field", "ambiguous_match", "unassigned", "unsupported_record", "relationship_unresolved", "field_conflict", "archive_incomplete"].includes(code))
        diagnostics.push({
          code,
          sourceRecordId: outcome.sourceRecordId,
          ...(issue.reason && code === "field_conflict" ? { path: issue.reason } : {}),
        });
    }
  for (const outcome of outcomes)
    for (const path of outcome.unsupportedFieldPaths)
      diagnostics.push({
        code: "unsupported_field",
        sourceRecordId: outcome.sourceRecordId,
        path,
      });
  diagnostics.sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId) || (a.path ?? "").localeCompare(b.path ?? ""));
  const digest = durableDigest && /^[a-f0-9]{64}$/.test(durableDigest)
    ? durableDigest
    : createHash("sha256").update(JSON.stringify({ operations, outcomes })).digest("hex");
  return { operations, outcomes, diagnostics, digest };
}

export function approvalClosureFromDurableRow(
  manifest: Pick<ActOrganizeManifest, "digest" | "operations">,
  row: {
    selectedOperationIds: unknown;
    dependencyClosedOperationIds: unknown;
    selectedCount: number;
    dependencyCount: number;
    rejectedCount: number;
    manifestDigest: string;
  },
): ApprovalClosure {
  if (manifest.digest !== row.manifestDigest)
    throw Object.assign(new Error("approval_replay_manifest_mismatch"), {
      code: "approval_replay_manifest_mismatch",
      status: 409,
    });
  const selectedOperationIds = array<string>(row.selectedOperationIds);
  const approvedOperationIds = array<string>(row.dependencyClosedOperationIds);
  const selected = new Set(selectedOperationIds);
  const approved = new Set(approvedOperationIds);
  const rejectedCandidates = manifest.operations
    .map((operation) => operation.operationKey)
    .filter((operationKey) => !approved.has(operationKey))
    .sort();
  const rejectedOperationIds = row.rejectedCount === 0 ? [] : rejectedCandidates;
  if (rejectedOperationIds.length !== row.rejectedCount)
    throw Object.assign(new Error("approval_replay_rejected_ids_unavailable"), {
      code: "approval_replay_rejected_ids_unavailable",
      status: 409,
    });
  return {
    selectedOperationIds,
    approvedOperationIds,
    dependencyOperationIds: approvedOperationIds.filter((id) => !selected.has(id)),
    rejectedOperationIds,
    selectedCount: row.selectedCount,
    dependencyCount: row.dependencyCount,
    rejectedCount: row.rejectedCount,
    manifestDigest: row.manifestDigest,
  };
}

export type ArchivedOrganizerSourceRow = {
  sourceRecordId: string;
  sourceVersionId: string;
  latestSourceVersionId: string | null;
  streamType: string;
  actRecordId: string | null;
  archiveCompleteness?: string;
  rawSnapshot: Record<string, unknown>;
  fetchedAt: Date;
  relationshipEvidence: Record<string, unknown>;
};

type OrganizerDecisionRow = Pick<Decision, "sourceRecordId" | "sourceVersionId" | "scope" | "decision" | "targetEntityType" | "targetEntityId" | "active">;
type OrganizerLocalCandidates = {
  organizations?: readonly LocalOrganizationCandidate[];
  contacts?: readonly LocalContactCandidate[];
  bookings?: readonly LocalBookingCandidate[];
  externalLinks?: readonly (ExternalLink & { sourceRecordId?: string | null })[];
};

const rootStreams = new Set(["company", "contact", "opportunity", "group", "activity", "note", "history"]);
const targetForStream: Record<string, string> = {
  company: "organization",
  contact: "contact",
  opportunity: "booking",
  group: "calling_list",
  activity: "activity",
  note: "activity",
  history: "activity",
};

function relationshipFromArchiveRow(row: ArchivedOrganizerSourceRow): ActRelationshipEvidence | null {
  const evidence = row.relationshipEvidence;
  const parentKind = text(evidence.parentKind);
  const targetKind = text(evidence.targetKind);
  const parentActRecordId = text(evidence.parentActRecordId) || null;
  const targetActRecordId = text(evidence.targetActRecordId) || null;
  if (!parentKind || !targetKind) return null;
  const evidenceKind = evidence.source === "inline" ? "inline" : "relationship_record";
  if (parentKind === "contact" && targetKind === "company") {
    return {
      parentStream: "company",
      childStream: "contact",
      parentSourceRecordId: null,
      parentActRecordId: targetActRecordId,
      childSourceRecordId: null,
      childActRecordId: parentActRecordId,
      evidenceKind,
      sourceRecordId: row.sourceRecordId,
      sourceVersionId: row.sourceVersionId,
    };
  }
  return {
    parentStream: parentKind as ActRelationshipEvidence["parentStream"],
    childStream: targetKind as ActRelationshipEvidence["childStream"],
    parentSourceRecordId: null,
    parentActRecordId,
    childSourceRecordId: null,
    childActRecordId: targetActRecordId,
    evidenceKind,
    sourceRecordId: row.sourceRecordId,
    sourceVersionId: row.sourceVersionId,
  };
}

function normalizeArchivedSource(row: ArchivedOrganizerSourceRow, relationships: ManifestSourceInput["relationships"]) {
  if (row.streamType === "company") return normalizeCompany(row.rawSnapshot);
  if (row.streamType === "contact") return normalizeContact(row.rawSnapshot);
  if (row.streamType === "opportunity") {
    return normalizeOpportunity(row.rawSnapshot, {
      organizationSourceId: relationships?.organizationSourceIds?.[0] ?? null,
    });
  }
  if (row.streamType === "group") {
    return normalizeGroup(row.rawSnapshot, {
      staticMemberSourceIds: relationships?.contactSourceIds,
    });
  }
  return normalizeTimeline(row.rawSnapshot, row.fetchedAt.toISOString(), row.streamType as "activity" | "note" | "history");
}

/** Converts owner-scoped latest archive rows into deterministic manifest inputs. */
export function manifestSourcesFromArchiveRows(input: { rows: readonly ArchivedOrganizerSourceRow[]; assignments?: readonly ActSourceAssignmentEvidence[]; decisions?: readonly OrganizerDecisionRow[]; localCandidates?: OrganizerLocalCandidates; sourceDatabaseKey?: string }): ManifestSourceInput[] {
  const stale = input.rows.find((row) => row.sourceVersionId !== row.latestSourceVersionId);
  if (stale) {
    throw Object.assign(new Error("stale_archived_source_version"), {
      code: "stale_archived_source_version",
      status: 409,
    });
  }
  const roots = input.rows.filter((row) => rootStreams.has(row.streamType));
  const incompleteRelationshipActIds = new Set(
    input.rows
      .filter((row) => !rootStreams.has(row.streamType) && row.archiveCompleteness !== "complete")
      .flatMap((row) => [text(row.relationshipEvidence.parentActRecordId), text(row.relationshipEvidence.targetActRecordId)])
      .filter(Boolean),
  );
  const resolution = resolveActSourceGraph({
    records: roots.map((row) => ({
      sourceRecordId: row.sourceRecordId,
      streamType: row.streamType,
      actRecordId: row.actRecordId,
    })),
    relationships: input.rows.map(relationshipFromArchiveRow).filter((row): row is ActRelationshipEvidence => Boolean(row)),
    assignments: input.assignments,
  });
  const relationshipIssues = new Map<string, Array<{ code: string; reason: string }>>();
  for (const diagnostic of [...resolution.conflicts, ...resolution.unresolved]) {
    if (!roots.some((row) => row.sourceRecordId === diagnostic.sourceRecordId)) continue;
    const issues = relationshipIssues.get(diagnostic.sourceRecordId) ?? [];
    issues.push({ code: "relationship_unresolved", reason: diagnostic.code });
    relationshipIssues.set(diagnostic.sourceRecordId, issues);
  }

  return roots
    .map((row): ManifestSourceInput => {
      const relationships =
        row.streamType === "contact"
          ? {
              organizationSourceIds: [...(resolution.graph.companiesByContact.get(row.sourceRecordId) ?? [])],
            }
          : row.streamType === "opportunity"
            ? {
                organizationSourceIds: [...(resolution.graph.companiesByOpportunity.get(row.sourceRecordId) ?? [])],
                contactSourceIds: [...(resolution.graph.contactsByOpportunity.get(row.sourceRecordId) ?? [])],
              }
            : row.streamType === "group"
              ? {
                  contactSourceIds: [...(resolution.graph.contactsByGroup.get(row.sourceRecordId) ?? [])],
                }
              : ["activity", "note", "history"].includes(row.streamType)
                ? {
                    organizationSourceIds: [...(resolution.graph.timelineParents.get(row.sourceRecordId)?.companyIds ?? [])],
                    contactSourceIds: [...(resolution.graph.timelineParents.get(row.sourceRecordId)?.contactIds ?? [])],
                    bookingSourceIds: [...(resolution.graph.timelineParents.get(row.sourceRecordId)?.opportunityIds ?? [])],
                  }
                : undefined;
      const normalized = normalizeArchivedSource(row, relationships);
      const activeDecisions = (input.decisions ?? []).filter((candidate) => candidate.active && candidate.sourceRecordId === row.sourceRecordId && candidate.sourceVersionId === row.sourceVersionId);
      const decision = activeDecisions.find((candidate) => candidate.scope === "duplicate_identity");
      const activeAssignments = (input.assignments ?? []).filter((candidate) => candidate.active !== false && candidate.manualAuthority !== false && candidate.sourceRecordId === row.sourceRecordId);
      const identityAssignment = activeAssignments.find((candidate) => candidate.targetEntityType === targetForStream[row.streamType]);
      const exactTarget = decision?.decision === "link_existing" ? decision.targetEntityId : identityAssignment?.targetEntityId;
      const organizationMatchForBooking = () => {
        if (!normalized.ok || normalized.value.kind !== "booking") return { kind: "none", reason: "organization_match_not_exact" } as const;
        const organizationSourceId = normalized.value.organizationSourceId;
        const organizationRow = roots.find((candidate) => candidate.sourceRecordId === organizationSourceId && candidate.streamType === "company");
        if (!organizationRow) return { kind: "none", reason: "organization_source_not_found" } as const;
        const organizationDecision = (input.decisions ?? []).find((candidate) => candidate.active && candidate.sourceRecordId === organizationRow.sourceRecordId && candidate.sourceVersionId === organizationRow.sourceVersionId && candidate.scope === "duplicate_identity");
        const organizationAssignment = (input.assignments ?? []).find((candidate) => candidate.active !== false && candidate.manualAuthority !== false && candidate.sourceRecordId === organizationRow.sourceRecordId && candidate.targetEntityType === "organization");
        const localId = organizationDecision?.decision === "link_existing" ? organizationDecision.targetEntityId : organizationAssignment?.targetEntityId;
        if (localId) return { kind: "exact", localId, reason: "manual_review" } as const;
        const organization = normalizeCompany(organizationRow.rawSnapshot);
        return organization.ok
          ? matchOrganization({ ...organization.value, sourceRecordId: organizationRow.sourceRecordId, externalLinks: input.localCandidates?.externalLinks }, input.localCandidates?.organizations ?? [], { sourceDatabaseKey: input.sourceDatabaseKey, sourceEntityType: organizationRow.streamType, sourceActRecordId: organizationRow.actRecordId })
          : ({ kind: "none", reason: "organization_normalization_failed" } as const);
      };
      const automaticMatch = normalized.ok && normalized.value.kind === "organization"
        ? matchOrganization({ ...normalized.value, sourceRecordId: row.sourceRecordId, externalLinks: input.localCandidates?.externalLinks }, input.localCandidates?.organizations ?? [], { sourceDatabaseKey: input.sourceDatabaseKey, sourceEntityType: row.streamType, sourceActRecordId: row.actRecordId })
        : normalized.ok && normalized.value.kind === "contact"
          ? matchContact({ ...normalized.value, sourceRecordId: row.sourceRecordId, externalLinks: input.localCandidates?.externalLinks }, input.localCandidates?.contacts ?? [], { sourceDatabaseKey: input.sourceDatabaseKey, sourceEntityType: row.streamType, sourceActRecordId: row.actRecordId })
          : normalized.ok && normalized.value.kind === "booking"
            ? matchBooking({ ...normalized.value, sourceRecordId: row.sourceRecordId, externalLinks: input.localCandidates?.externalLinks }, input.localCandidates?.bookings ?? [], organizationMatchForBooking(), { sourceDatabaseKey: input.sourceDatabaseKey, sourceEntityType: row.streamType, sourceActRecordId: row.actRecordId })
          : ({ kind: "none", reason: "no_candidate" } as const);
      const match = exactTarget
        ? ({
            kind: "exact",
            localId: exactTarget,
            reason: "manual_review",
          } as const)
        : automaticMatch;
      const localCandidate = match.kind === "exact"
        ? [...(input.localCandidates?.organizations ?? []), ...(input.localCandidates?.contacts ?? []), ...(input.localCandidates?.bookings ?? [])].find((candidate) => candidate.id === match.localId)
        : undefined;
      const normalizationWarnings = normalized.ok ? normalized.warnings : [...normalized.warnings, normalized.issueCode];
      const relationshipProvenance = [...resolution.provenance.entries()].filter(([key]) => key.startsWith(`${row.sourceRecordId}:`)).flatMap(([, evidence]) => evidence);
      const archiveIssue = row.archiveCompleteness && row.archiveCompleteness !== "complete"
        ? row.archiveCompleteness
        : row.actRecordId && incompleteRelationshipActIds.has(row.actRecordId)
          ? "relationship_archive_incomplete"
          : null;
      return {
        sourceRecordId: row.sourceRecordId,
        sourceVersionId: row.sourceVersionId,
        streamType: row.streamType,
        normalized: normalized.ok ? (normalized.value as ManifestNormalized) : null,
        match: decision?.decision === "keep_separate" ? { kind: "none", reason: "manual_keep_separate" } : match,
        warnings: normalizationWarnings,
        unsupportedFieldPaths: normalized.unsupportedFieldPaths,
        relationships,
        localFields: localCandidate ? { ...localCandidate } : undefined,
        reviewIssues: [
          ...(archiveIssue ? [{ code: "archive_incomplete", reason: archiveIssue }] : []),
          ...(relationshipIssues.get(row.sourceRecordId) ?? []),
        ],
        provenance: [...new Set([...relationshipProvenance, ...activeDecisions.map((activeDecision) => `decision:${activeDecision.decision}`), ...(activeAssignments.length ? ["manual_assignment"] : [])])].sort(),
      };
    })
    .sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId));
}

/** Owner-scoped durable organizer storage backed by the archived latest versions. */
export class DrizzleProductionOrganizerStore implements ProductionOrganizerStore {
  constructor(
    private readonly database: DrizzleDatabase,
    private readonly scope: SourceDatabaseScope,
  ) {
    if (!scope.sourceDatabaseKey.trim()) {
      throw new Error("source_database_key_required");
    }
  }

  async claim(runId: string): Promise<OrganizerRun | null> {
    const now = new Date();
    const claimToken = randomUUID();
    const [run] = await this.database
      .update(actReplacementRuns)
      .set({ phase: "organizing", organizerToken: claimToken, organizerLeaseExpiresAt: new Date(now.getTime() + organizerLeaseMs), lastErrorCode: null, updatedAt: now })
      .where(and(
        eq(actReplacementRuns.id, runId),
        eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey),
        or(
          and(inArray(actReplacementRuns.phase, ["extract_complete", "complete_with_issues"]), isNull(actReplacementRuns.organizerToken)),
          and(
            eq(actReplacementRuns.phase, "ready_to_apply"),
            sql`not exists (select 1 from ${actReplacementApplyBatches} where ${actReplacementApplyBatches.runId} = ${actReplacementRuns.id})`,
            sql`not exists (select 1 from ${actReplacementApplyOperations} where ${actReplacementApplyOperations.runId} = ${actReplacementRuns.id} and ${actReplacementApplyOperations.status} <> ${"pending"})`,
          ),
          and(
            eq(actReplacementRuns.phase, "complete"),
            isNull(actReplacementRuns.organizerToken),
            sql`exists (select 1 from ${actReplacementOutcomes} review_outcomes where review_outcomes.run_id = ${actReplacementRuns.id} and review_outcomes.state in (${sql.join(["awaiting_review", "unassigned", "unsupported"].map((state) => sql`${state}`), sql`, `)}))`,
          ),
          and(
            eq(actReplacementRuns.phase, "organizing"),
            or(
              isNull(actReplacementRuns.organizerLeaseExpiresAt),
              lte(actReplacementRuns.organizerLeaseExpiresAt, now),
            ),
          ),
        ),
      ))
      .returning({ runId: actReplacementRuns.id });
    return run ? { runId: run.runId, phase: "organizing", claimToken } : null;
  }

  async findRecoverableRunId(now: Date): Promise<string | null> {
    const [run] = await this.database
      .select({ runId: actReplacementRuns.id })
      .from(actReplacementRuns)
      .where(and(
        eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey),
        eq(actReplacementRuns.phase, "organizing"),
        or(
          isNull(actReplacementRuns.organizerLeaseExpiresAt),
          lte(actReplacementRuns.organizerLeaseExpiresAt, now),
        ),
      ))
      .limit(1);
    return run?.runId ?? null;
  }

  async renew(runId: string, claimToken: string): Promise<boolean> {
    const now = new Date();
    const renewed = await this.database
      .update(actReplacementRuns)
      .set({
        organizerLeaseExpiresAt: new Date(now.getTime() + organizerLeaseMs),
        updatedAt: now,
      })
      .where(and(
        eq(actReplacementRuns.id, runId),
        eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey),
        eq(actReplacementRuns.phase, "organizing"),
        eq(actReplacementRuns.organizerToken, claimToken),
      ))
      .returning({ id: actReplacementRuns.id });
    return renewed.length > 0;
  }

  async loadSources(runId: string): Promise<readonly ManifestSourceInput[]> {
    const rows = await this.database
      .select({
        sourceRecordId: actSourceRecords.id,
        sourceVersionId: actSourceRecordVersions.id,
        latestSourceVersionId: actSourceRecords.latestVersionId,
        streamType: actSourceRecords.streamType,
        actRecordId: actSourceRecords.actRecordId,
        rawSnapshot: actSourceRecordVersions.rawSnapshot,
        fetchedAt: actSourceRecordVersions.fetchedAt,
        relationshipEvidence: actSourceRecords.relationshipEvidence,
        archiveCompleteness: actSourceRecords.archiveCompleteness,
      })
      .from(actReplacementObservations)
      .innerJoin(actSourceRecords, and(eq(actSourceRecords.id, actReplacementObservations.sourceRecordId), eq(actSourceRecords.sourceDatabaseKey, this.scope.sourceDatabaseKey)))
      .innerJoin(actSourceRecordVersions, and(eq(actSourceRecordVersions.id, actReplacementObservations.versionId), eq(actSourceRecordVersions.sourceRecordId, actSourceRecords.id)))
      .where(and(eq(actReplacementObservations.runId, runId), eq(actReplacementObservations.sourceDatabaseKey, this.scope.sourceDatabaseKey)));
    const sourceIds = rows.map((row) => row.sourceRecordId);
    const [assignments, decisions, localOrganizations, localContacts, localBookings, externalLinks] = await Promise.all([
      sourceIds.length
      ? await this.database
          .select()
          .from(actSourceAssignments)
          .where(and(inArray(actSourceAssignments.sourceRecordId, sourceIds), isNull(actSourceAssignments.supersededAt)))
      : [],
      sourceIds.length
      ? await this.database
          .select()
          .from(actReplacementReviewDecisions)
          .where(and(inArray(actReplacementReviewDecisions.sourceRecordId, sourceIds), eq(actReplacementReviewDecisions.active, true)))
      : [],
      this.database.select({ id: organizations.id, name: organizations.name, phone: organizations.phone, website: organizations.website, industry: organizations.actIndustry, address1: organizations.address1, address2: organizations.address2, city: organizations.city, region: organizations.region, postalCode: organizations.postalCode }).from(organizations),
      this.database.select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone, jobTitle: contacts.jobTitle, address1: contacts.address1, address2: contacts.address2, city: contacts.city, region: contacts.region, postalCode: contacts.postalCode }).from(contacts),
      this.database.select({ id: bookings.id, name: bookings.name, organizationId: bookings.organizationId, venueName: bookings.venueName, address1: bookings.address1, city: bookings.city, region: bookings.region, postalCode: bookings.postalCode, startsAt: bookings.startsAt, endsAt: bookings.endsAt, localStatus: bookings.status, localProbability: bookings.probability, notes: bookings.notes }).from(bookings),
      this.database.select({ localId: actExternalLinks.entityId, entityType: actExternalLinks.entityType, sourceEntityType: actExternalLinks.sourceEntityType, actRecordId: actExternalLinks.actRecordId, sourceRecordId: actExternalLinks.sourceRecordId, sourceDatabaseKey: actExternalLinks.sourceDatabaseKey }).from(actExternalLinks),
    ]);
    return manifestSourcesFromArchiveRows({
      rows,
      assignments: assignments.map((assignment) => ({
        sourceRecordId: assignment.sourceRecordId,
        targetEntityType: assignment.targetEntityType,
        targetEntityId: assignment.targetEntityId,
        manualAuthority: assignment.manualAuthority,
        active: assignment.supersededAt === null,
        role: assignment.role,
      })),
      decisions: decisions.map((decision) => ({
        sourceRecordId: decision.sourceRecordId,
        sourceVersionId: decision.sourceVersionId,
        scope: decision.scope as Decision["scope"],
        decision: decision.decision as Decision["decision"],
        targetEntityType: decision.targetEntityType,
        targetEntityId: decision.targetEntityId,
        active: decision.active,
      })),
      localCandidates: {
        organizations: localOrganizations,
        contacts: localContacts,
        bookings: localBookings.map((booking) => ({ ...booking, startsAt: booking.startsAt?.toISOString() ?? null, endsAt: booking.endsAt?.toISOString() ?? null })),
        externalLinks,
      },
      sourceDatabaseKey: this.scope.sourceDatabaseKey,
    });
  }

  async persistManifest(runId: string, claimToken: string, manifest: ActOrganizeManifest) {
    await this.database.transaction(async (transaction) => {
      const [claim] = await transaction.select({ id: actReplacementRuns.id }).from(actReplacementRuns).where(and(eq(actReplacementRuns.id, runId), eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey), eq(actReplacementRuns.phase, "organizing"), eq(actReplacementRuns.organizerToken, claimToken), gt(actReplacementRuns.organizerLeaseExpiresAt, new Date()))).limit(1).for("update");
      if (!claim) throw Object.assign(new Error("organizer_claim_lost"), { code: "organizer_claim_lost", status: 409 });
      const organizedAt = new Date();
      for (const outcomes of manifestWriteBatches(manifest.outcomes)) {
        await transaction
          .insert(actReplacementOutcomes)
          .values(outcomes.map((outcome) => ({
            runId,
            sourceRecordId: outcome.sourceRecordId,
            sourceVersionId: outcome.sourceVersionId,
            state: outcome.state,
            mappingWarnings: outcome.mappingWarnings,
            unsupportedFieldPaths: outcome.unsupportedFieldPaths,
            candidates: outcome.candidates,
            issues: outcome.issues,
            match: outcome.match,
            organizedAt,
          })))
          .onConflictDoUpdate({
            target: [actReplacementOutcomes.runId, actReplacementOutcomes.sourceRecordId],
            set: {
              sourceVersionId: sql`excluded.source_version_id`,
              state: sql`excluded.state`,
              mappingWarnings: sql`excluded.mapping_warnings`,
              unsupportedFieldPaths: sql`excluded.unsupported_field_paths`,
              candidates: sql`excluded.candidates`,
              issues: sql`excluded.issues`,
              match: sql`excluded.match`,
              leaseOwner: null,
              leaseExpiresAt: null,
              retryAfter: null,
              lastErrorCode: null,
              organizedAt,
              updatedAt: organizedAt,
            },
          });
      }
      for (const operations of manifestWriteBatches(manifest.operations)) {
        await transaction
          .insert(actReplacementApplyOperations)
          .values(operations.map((operation) => ({ runId, ...operation })))
          .onConflictDoUpdate({
            target: [actReplacementApplyOperations.runId, actReplacementApplyOperations.operationKey],
            set: {
              sourceRecordId: sql`excluded.source_record_id`,
              sourceVersionId: sql`excluded.source_version_id`,
              targetType: sql`excluded.target_type`,
              action: sql`excluded.action`,
              payload: sql`excluded.payload`,
              dependencyOperationKeys: sql`excluded.dependency_operation_keys`,
              requiredForSourceOutcome: sql`excluded.required_for_source_outcome`,
              safeByDefault: sql`excluded.safe_by_default`,
              status: sql`case when ${actReplacementApplyOperations.status} in ('applied','already_present') then ${actReplacementApplyOperations.status} else 'pending' end`,
              batchId: sql`case when ${actReplacementApplyOperations.status} in ('applied','already_present') then ${actReplacementApplyOperations.batchId} else null end`,
              leaseOwner: null,
              leaseExpiresAt: null,
              retryAfter: null,
              lastErrorCode: null,
              updatedAt: organizedAt,
            },
          });
      }
      const operationKeys = manifest.operations.map((operation) => operation.operationKey);
      await transaction.delete(actReplacementApplyOperations).where(operationKeys.length ? and(eq(actReplacementApplyOperations.runId, runId), notInArray(actReplacementApplyOperations.operationKey, operationKeys)) : eq(actReplacementApplyOperations.runId, runId));
    });
  }

  async complete(runId: string, claimToken: string, phase: "ready_to_apply", digest: string) {
    const completed = await this.database
      .update(actReplacementRuns)
      .set({
        phase,
        summary: sql`coalesce(${actReplacementRuns.summary}, '{}'::jsonb) || ${JSON.stringify({ manifestDigest: digest })}::jsonb`,
        lastErrorCode: null,
        organizerToken: null,
        organizerLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(actReplacementRuns.id, runId), eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey), eq(actReplacementRuns.phase, "organizing"), eq(actReplacementRuns.organizerToken, claimToken)))
      .returning({ id: actReplacementRuns.id });
    if (!completed.length) throw Object.assign(new Error("organizer_claim_lost"), { code: "organizer_claim_lost", status: 409 });
  }

  async release(runId: string, claimToken: string, code: string) {
    await this.database
      .update(actReplacementRuns)
      .set({
        phase: "extract_complete",
        lastErrorCode: code,
        organizerToken: null,
        organizerLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(and(eq(actReplacementRuns.id, runId), eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey), eq(actReplacementRuns.phase, "organizing"), eq(actReplacementRuns.organizerToken, claimToken)));
  }
}

export class DrizzleActReviewReader implements ReviewReader {
  constructor(
    protected readonly database: DrizzleDatabase,
    protected readonly scope: SourceDatabaseScope,
  ) {
    if (!scope.sourceDatabaseKey.trim()) throw new Error("source_database_key_required");
  }
  async ownsRun(runId: string) {
    const [run] = await this.database
      .select({ id: actReplacementRuns.id })
      .from(actReplacementRuns)
      .where(and(eq(actReplacementRuns.id, runId), eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey)))
      .limit(1);
    return Boolean(run);
  }
  async getManifest(runId: string) {
    const [run] = await this.database
      .select({ summary: actReplacementRuns.summary })
      .from(actReplacementRuns)
      .where(and(eq(actReplacementRuns.id, runId), eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey)))
      .limit(1);
    if (!run) return null;
    const [operationRows, outcomeRows] = await Promise.all([this.database.select().from(actReplacementApplyOperations).where(eq(actReplacementApplyOperations.runId, runId)), this.database.select().from(actReplacementOutcomes).where(eq(actReplacementOutcomes.runId, runId))]);
    return manifestFromRows({
      operations: operationRows as unknown as Array<Record<string, unknown>>,
      outcomes: outcomeRows as unknown as Array<Record<string, unknown>>,
    }, text(object(run.summary).manifestDigest));
  }
  async listSources(runId: string): Promise<ReviewSourceRecord[]> {
    if (!(await this.ownsRun(runId))) return [];
    const rows = await this.database
      .select({ source: actSourceRecords, version: actSourceRecordVersions })
      .from(actSourceRecords)
      .innerJoin(actReplacementOutcomes, and(eq(actReplacementOutcomes.sourceRecordId, actSourceRecords.id), eq(actReplacementOutcomes.runId, runId)))
      .leftJoin(actSourceRecordVersions, eq(actSourceRecordVersions.id, actSourceRecords.latestVersionId))
      .where(eq(actSourceRecords.sourceDatabaseKey, this.scope.sourceDatabaseKey));
    return rows.map(({ source, version }) => ({
      sourceRecordId: source.id,
      sourceVersionId: source.latestVersionId ?? version?.id ?? "",
      streamType: source.streamType,
      actRecordId: source.actRecordId,
      display: projectActReviewDisplay(source.streamType, version?.rawSnapshot),
      versions: version
        ? [
            {
              versionId: version.id,
              fetchedAt: version.fetchedAt.toISOString(),
              scope: version.snapshotScope,
              completeness: source.archiveCompleteness,
            },
          ]
        : [],
    }));
  }
  async getSource(sourceRecordId: string) {
    const [row] = await this.database
      .select({ source: actSourceRecords, version: actSourceRecordVersions })
      .from(actSourceRecords)
      .leftJoin(actSourceRecordVersions, eq(actSourceRecordVersions.id, actSourceRecords.latestVersionId))
      .where(and(eq(actSourceRecords.id, sourceRecordId), eq(actSourceRecords.sourceDatabaseKey, this.scope.sourceDatabaseKey)))
      .limit(1);
    if (!row) return null;
    return {
      sourceRecordId: row.source.id,
      sourceVersionId: row.source.latestVersionId ?? row.version?.id ?? "",
      streamType: row.source.streamType,
      actRecordId: row.source.actRecordId,
      display: projectActReviewDisplay(row.source.streamType, row.version?.rawSnapshot),
    };
  }
}

class DrizzleApprovalRepository implements ApprovalRepository {
  constructor(
    private readonly reader: DrizzleActReviewReader,
    private readonly database: DrizzleDatabase,
    private readonly scope: SourceDatabaseScope,
  ) {}
  async getManifest(runId: string) {
    const manifest = await this.reader.getManifest(runId);
    return manifest
      ? {
          digest: manifest.digest,
          operations: manifest.operations,
          outcomes: manifest.outcomes,
        }
      : null;
  }
  async getRequest(runId: string, requestKey: string) {
    if (!(await this.reader.ownsRun(runId))) return null;
    const [row] = await this.database
      .select()
      .from(actReplacementApprovalRequests)
      .where(and(eq(actReplacementApprovalRequests.runId, runId), eq(actReplacementApprovalRequests.requestKey, requestKey)))
      .limit(1);
    if (!row) return null;
    const manifest = await this.reader.getManifest(runId);
    if (!manifest)
      throw Object.assign(new Error("approval_replay_manifest_not_found"), {
        code: "approval_replay_manifest_not_found",
        status: 409,
      });
    return approvalClosureFromDurableRow(manifest, row);
  }
  async saveRequest(runId: string, requestKey: string, closure: ApprovalClosure) {
    if (!(await this.reader.ownsRun(runId))) throw new Error("run_not_found");
    const [row] = await this.database
      .insert(actReplacementApprovalRequests)
      .values({
        runId,
        requestKey,
        manifestDigest: closure.manifestDigest,
        selectedOperationIds: closure.selectedOperationIds,
        dependencyClosedOperationIds: closure.approvedOperationIds,
        selectedCount: closure.selectedCount,
        dependencyCount: closure.dependencyCount,
        rejectedCount: closure.rejectedCount,
      })
      .onConflictDoNothing({ target: [actReplacementApprovalRequests.runId, actReplacementApprovalRequests.requestKey] })
      .returning();
    if (row) return closure;
    const prior = await this.getRequest(runId, requestKey);
    if (!prior) throw new Error("approval_request_not_saved");
    return prior;
  }
}

export class DrizzleActReviewCommandStore extends DrizzleActReviewReader implements ReviewCommandStore {
  private readonly assignments: DrizzleActSourceAssignmentRepository;
  private readonly approval: ApprovalRepository;
  private readonly organizer: ProductionActOrganizer;
  constructor(
    database: DrizzleDatabase,
    scope: SourceDatabaseScope,
    protected readonly applyService: ActApplyService,
  ) {
    super(database, scope);
    this.assignments = new DrizzleActSourceAssignmentRepository(database);
    this.approval = new DrizzleApprovalRepository(this, database, scope);
    this.organizer = new ProductionActOrganizer(new DrizzleProductionOrganizerStore(database, scope));
  }
  async organize(runId: string) {
    return this.organizer.organize(runId);
  }
  async startOrganize(runId: string) {
    const started = await this.organizer.start(runId);
    void started.finished.then(
      (result) => logger.info(
        { runId, status: result.status, outcomeCount: result.manifest.outcomes.length, operationCount: result.manifest.operations.length },
        "Act organization completed",
      ),
      (error) => logger.error(
        {
          runId,
          errorCode:
            error && typeof error === "object" && "code" in error
              ? String((error as { code?: unknown }).code)
              : "organize_failed",
        },
        "Act organization failed",
      ),
    );
    return { status: started.status };
  }
  private async assertSource(sourceRecordId: string) {
    const source = await super.getSource(sourceRecordId);
    if (!source)
      throw Object.assign(new Error("source_not_found"), {
        code: "source_not_found",
        status: 404,
      });
    return source;
  }
  async listAssignments(sourceRecordId: string): Promise<Assignment[]> {
    await this.assertSource(sourceRecordId);
    const rows = await this.assignments.listActive(sourceRecordId);
    return rows.map((row) => ({
      id: row.id,
      sourceRecordId: row.sourceRecordId,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      role: row.role,
      isPrimary: row.isPrimary,
      manualAuthority: true,
      assignedBy: row.assignedBy,
      sourceVersionId: row.sourceVersionId ?? "",
      active: row.supersededAt === null,
    }));
  }
  async saveAssignment(input: Omit<Assignment, "id" | "active"> & { requestKey: string }): Promise<Assignment> {
    const source = await this.assertSource(input.sourceRecordId);
    if (source.sourceVersionId !== input.sourceVersionId)
      throw Object.assign(new Error("stale_source_version"), {
        code: "stale_source_version",
        status: 409,
      });
    const row = await this.assignments.assign({
      sourceRecordId: input.sourceRecordId,
      targetEntityType: input.targetEntityType as "organization" | "contact" | "booking" | "calling_list" | "activity",
      targetEntityId: input.targetEntityId,
      role: input.role,
      isPrimary: input.isPrimary,
      assignedBy: input.assignedBy,
      sourceVersionId: input.sourceVersionId,
      expectedSourceVersionId: input.sourceVersionId,
      requestKey: input.requestKey,
    });
    return {
      id: row.id,
      sourceRecordId: row.sourceRecordId,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      role: row.role,
      isPrimary: row.isPrimary,
      manualAuthority: true,
      assignedBy: row.assignedBy,
      sourceVersionId: row.sourceVersionId ?? "",
      active: row.supersededAt === null,
    };
  }
  async discardAssignment(assignmentId: string) {
    await this.database.delete(actSourceAssignments).where(eq(actSourceAssignments.id, assignmentId));
  }
  async supersedeAssignment(sourceRecordId: string, assignmentId: string, actor: string, expectedSourceVersionId: string, _requestKey = ""): Promise<Assignment> {
    await this.assertSource(sourceRecordId);
    const row = await this.assignments.supersede({
      assignmentId,
      supersededBy: actor,
      expectedSourceVersionId,
    });
    return {
      id: row.id,
      sourceRecordId: row.sourceRecordId,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      role: row.role,
      isPrimary: row.isPrimary,
      manualAuthority: true,
      assignedBy: row.assignedBy,
      sourceVersionId: row.sourceVersionId ?? "",
      active: row.supersededAt === null,
      supersededAt: row.supersededAt?.toISOString(),
    };
  }
  async listDecisions(sourceRecordId: string): Promise<Decision[]> {
    await this.assertSource(sourceRecordId);
    const rows = await this.database
      .select()
      .from(actReplacementReviewDecisions)
      .where(and(eq(actReplacementReviewDecisions.sourceRecordId, sourceRecordId), eq(actReplacementReviewDecisions.active, true)));
    return rows.map((row) => ({
      id: row.id,
      sourceRecordId: row.sourceRecordId,
      sourceVersionId: row.sourceVersionId,
      scope: row.scope as Decision["scope"],
      decision: row.decision as Decision["decision"],
      requestKey: row.requestKey,
      fieldName: row.fieldName,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      active: row.active,
    }));
  }
  async saveDecision(input: Omit<Decision, "id" | "active"> & { requestKey: string }): Promise<Decision> {
    const source = await this.assertSource(input.sourceRecordId);
    if (source.sourceVersionId !== input.sourceVersionId)
      throw Object.assign(new Error("stale_source_version"), {
        code: "stale_source_version",
        status: 409,
      });
    const [prior] = await this.database
      .select()
      .from(actReplacementReviewDecisions)
      .where(and(eq(actReplacementReviewDecisions.sourceRecordId, input.sourceRecordId), eq(actReplacementReviewDecisions.requestKey, input.requestKey)))
      .limit(1);
    if (prior) return { ...input, id: prior.id, active: prior.active };
    const [row] = await this.database
      .insert(actReplacementReviewDecisions)
      .values({
        sourceRecordId: input.sourceRecordId,
        sourceVersionId: input.sourceVersionId,
        scope: input.scope,
        decision: input.decision,
        requestKey: input.requestKey,
        fieldName: input.fieldName,
        targetEntityType: input.targetEntityType,
        targetEntityId: input.targetEntityId,
      })
      .returning();
    if (!row) throw new Error("decision_not_saved");
    return {
      id: row.id,
      sourceRecordId: row.sourceRecordId,
      sourceVersionId: row.sourceVersionId,
      scope: row.scope as Decision["scope"],
      decision: row.decision as Decision["decision"],
      requestKey: row.requestKey,
      fieldName: row.fieldName,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      active: row.active,
    };
  }
  async discardDecision(decisionId: string) {
    await this.database.delete(actReplacementReviewDecisions).where(eq(actReplacementReviewDecisions.id, decisionId));
  }
  async supersedeDecision(sourceRecordId: string, decisionId: string, actor: string, _requestKey = ""): Promise<Decision> {
    await this.assertSource(sourceRecordId);
    const supersededBy = actor.trim();
    if (!supersededBy)
      throw Object.assign(new Error("decision_actor_required"), {
        code: "decision_actor_required",
        status: 400,
      });
    const [row] = await this.database
      .update(actReplacementReviewDecisions)
      .set({ active: false, supersededAt: new Date(), supersededBy })
      .where(and(eq(actReplacementReviewDecisions.id, decisionId), eq(actReplacementReviewDecisions.sourceRecordId, sourceRecordId), eq(actReplacementReviewDecisions.active, true)))
      .returning();
    if (!row)
      throw Object.assign(new Error("decision_not_found"), {
        code: "decision_not_found",
        status: 404,
      });
    return {
      id: row.id,
      sourceRecordId: row.sourceRecordId,
      sourceVersionId: row.sourceVersionId,
      scope: row.scope as Decision["scope"],
      decision: row.decision as Decision["decision"],
      requestKey: row.requestKey,
      fieldName: row.fieldName,
      targetEntityType: row.targetEntityType,
      targetEntityId: row.targetEntityId,
      active: row.active,
    };
  }
  getApprovalRepository() {
    return this.approval;
  }
  getApplyService() {
    return this.applyService;
  }
  async rebuildAfterReviewChange(runId: string) {
    return this.organizer.organize(runId);
  }
  private async atomicReviewMutation<T>(runId: string, mutation: (store: DrizzleActReviewCommandStore) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const store = new DrizzleActReviewCommandStore(transaction as unknown as DrizzleDatabase, this.scope, this.applyService);
      const result = await mutation(store);
      await store.rebuildAfterReviewChange(runId);
      return result;
    });
  }
  saveAssignmentAndRebuild(runId: string, input: SaveAssignmentInput) { return this.atomicReviewMutation(runId, (store) => store.saveAssignment(input)); }
  supersedeAssignmentAndRebuild(runId: string, sourceRecordId: string, assignmentId: string, actor: string, expectedSourceVersionId: string, requestKey: string) { return this.atomicReviewMutation(runId, (store) => store.supersedeAssignment(sourceRecordId, assignmentId, actor, expectedSourceVersionId, requestKey)); }
  saveDecisionAndRebuild(runId: string, input: SaveDecisionInput) { return this.atomicReviewMutation(runId, (store) => store.saveDecision(input)); }
  supersedeDecisionAndRebuild(runId: string, sourceRecordId: string, decisionId: string, actor: string, requestKey: string) { return this.atomicReviewMutation(runId, (store) => store.supersedeDecision(sourceRecordId, decisionId, actor, requestKey)); }
}

export type ProductionReviewAdapterFactory = (database: DrizzleDatabase, scope: SourceDatabaseScope, applyService: ActApplyService) => DrizzleActReviewCommandStore;
export const createDrizzleActReviewCommandStore: ProductionReviewAdapterFactory = (database, scope, applyService) => new DrizzleActReviewCommandStore(database, scope, applyService);
