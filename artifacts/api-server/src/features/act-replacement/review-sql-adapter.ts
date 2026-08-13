import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lte, notInArray, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { logger } from "@/lib/logger";
import { actExternalLinks, actReplacementApprovalRequests, actReplacementApplyBatches, actReplacementApplyOperations, actReplacementBulkReviewRequests, actReplacementObservations, actReplacementOutcomes, actReplacementRuns, actReplacementReviewDecisions, actSourceAssignments, actSourceRecordVersions, actSourceRecords, activities, bookingContacts, bookings, callingLists, contacts, organizationContacts, organizations } from "@workspace/db/schema";
import { DrizzleActSourceAssignmentRepository } from "./assignment-repository";
import type { ActApplyService } from "./apply-service";
import { actApprovalModes, type ActApprovalMode, type ApprovalManifest, type ApprovalOperation, type ApprovalRepository, type ApprovalRequest } from "./approval-service";
import { buildActOrganizeManifest, buildLegacyActOrganizeManifest, compareManifestOperations, stableRelationshipIssues, type ActOrganizeManifest, type ManifestDiagnostic, type ManifestNormalized, type ManifestOperation, type ManifestOutcome, type ManifestReviewIssue, type ManifestSourceInput } from "./manifest-builder";
import { canonicalManifestDigestVersion, digestLegacyManifestRows, digestManifestRows } from "./manifest-digest";
import { normalizeCompany } from "./normalizers/company-normalizer";
import { normalizeContact } from "./normalizers/contact-normalizer";
import { normalizeGroup } from "./normalizers/group-normalizer";
import { normalizeOpportunity } from "./normalizers/opportunity-normalizer";
import { normalizeTimeline } from "./normalizers/timeline-normalizer";
import { resolveActSourceGraph, type ActRelationshipEvidence, type ActSourceAssignmentEvidence } from "./relationship-resolver";
import { matchOrganization, type LocalOrganizationCandidate } from "./matching/organization-matcher";
import { matchContact, type LocalContactCandidate } from "./matching/contact-matcher";
import { matchBooking, type LocalBookingCandidate } from "./matching/booking-matcher";
import { uniqueSorted, type ExternalLink, type MatchResult } from "./matching/match-result";
import { buildActContextIndex } from "./context-index";
import { automaticReviewRequestFingerprint, decisionSupersessionRequestFingerprint, decisionWithReviewedProof, hasCurrentReviewedFieldProof, individualDecisionRequestFingerprint, prepareBulkReviewDecisions, reviewedOperationIds, validateIndividualDecisionAgainstCurrentState, type Assignment, type AutomaticReviewDecisionInput, type AutomaticReviewDecisionResult, type BulkReviewDecisionResult, type BulkReviewRequestLookup, type ConflictReviewState, type Decision, type ResolveAutomaticReviewCommandInput, type ReviewCommandStore, type SaveAssignmentInput, type SaveDecisionInput, type SaveDecisionsAndRebuildInput, type SaveDecisionsAndRebuildResult } from "./review-command-service";
import { assignmentTargetEntityTypes, assignmentTargetLikePattern, isAssignmentTargetEntityType, projectReviewRow, type AssignmentTargetEntityType, type ReviewCandidate, type ReviewIssueCode, type ReviewPage, type ReviewReadInput, type ReviewReader, type ReviewSourceRecord, type ReviewTargetProjection } from "./review-reader";
import { projectActReviewDisplay } from "./review-display";
import { organizerErrorCode, ProductionActOrganizer, type OrganizerRun, type ProductionOrganizerStore } from "./production-organizer";
import { fingerprintSourceContent } from "./source-fingerprint";
import { proposeAutomaticReview, type AutomaticReviewContext, type AutomaticReviewInput, type AutomaticReviewIssue, type AutomaticReviewRecord, type AutomaticReviewResolutionSummary, type AutomaticReviewSourceProjection } from "./automatic-review-resolver";

export { projectActReviewDisplay } from "./review-display";

type DrizzleDatabase = typeof database;
type SourceDatabaseScope = { sourceDatabaseKey: string };
type OwnedSourceDatabaseScope = SourceDatabaseScope & { requestedBy: string };
type ReviewReaderScope = SourceDatabaseScope & { requestedBy?: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const array = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const object = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const manifestRowInvalid = (): never => {
  throw Object.assign(new Error("manifest_row_invalid"), { code: "manifest_row_invalid", status: 409 });
};
const strictJsonObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return manifestRowInvalid();
  return value as Record<string, unknown>;
};
const strictJsonArray = <T>(value: unknown): T[] => {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return manifestRowInvalid();
  return value as T[];
};
const strictStringArray = (value: unknown): string[] => {
  const values = strictJsonArray<unknown>(value);
  if (values.some((item) => typeof item !== "string")) return manifestRowInvalid();
  return values as string[];
};
const strictObjectArray = (value: unknown): Record<string, unknown>[] =>
  strictJsonArray<unknown>(value).map(strictJsonObject);
const strictManifestIssues = (value: unknown): ManifestReviewIssue[] =>
  strictObjectArray(value).map((issue) => {
    if (typeof issue.code !== "string") return manifestRowInvalid();
    if (issue.reason !== undefined && typeof issue.reason !== "string") return manifestRowInvalid();
    if (issue.relationshipSlot !== undefined && typeof issue.relationshipSlot !== "string") return manifestRowInvalid();
    if (issue.expectedParentTypes !== undefined) strictStringArray(issue.expectedParentTypes);
    if (issue.canImportStandalone !== undefined && typeof issue.canImportStandalone !== "boolean") return manifestRowInvalid();
    return issue as ManifestReviewIssue;
  });
const manifestWriteBatchSize = 250;
// Manifest construction is synchronous, so its timer heartbeat cannot run
// while the event loop is CPU-bound. Keep enough fenced lease headroom for a
// large archive; normal database work still renews every minute.
const organizerLeaseMs = 30 * 60_000;
const pendingReviewManifestDigest = "__pending_review_rebuild__";
const automaticReviewRebuildLeaseMs = 30 * 60_000;
const automaticReviewRebuildRenewMs = 60_000;
const boundedAutomaticReviewErrorCode = /^[a-z][a-z0-9_]{0,63}$/;
function automaticReviewErrorCode(error: unknown): string {
  const visited = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    if (
      "code" in current &&
      typeof current.code === "string" &&
      boundedAutomaticReviewErrorCode.test(current.code)
    )
      return current.code;
    current = "cause" in current ? current.cause : undefined;
  }
  return "automatic_review_failed";
}
export function manifestWriteBatches<T>(rows: readonly T[]): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < rows.length; index += manifestWriteBatchSize)
    batches.push(rows.slice(index, index + manifestWriteBatchSize));
  return batches;
}

export function staleNonterminalOperationPredicate(runId: string, operationKeys: string[]) {
  const staleIdentity = operationKeys.length
    ? and(eq(actReplacementApplyOperations.runId, runId), notInArray(actReplacementApplyOperations.operationKey, operationKeys))
    : eq(actReplacementApplyOperations.runId, runId);
  return and(staleIdentity, notInArray(actReplacementApplyOperations.status, ["applied", "already_present"]));
}

type OperationSemantics = Pick<ManifestOperation, "sourceRecordId" | "sourceVersionId" | "targetType" | "action" | "payload" | "dependencyOperationKeys" | "requiredForSourceOutcome" | "safeByDefault">;

export function operationSemanticsMatch(left: OperationSemantics, right: OperationSemantics): boolean {
  const effectMatches = left.sourceRecordId === right.sourceRecordId
    && left.sourceVersionId === right.sourceVersionId
    && left.targetType === right.targetType
    && left.action === right.action
    && left.requiredForSourceOutcome === right.requiredForSourceOutcome
    && left.safeByDefault === right.safeByDefault
    && fingerprintSourceContent(left.payload) === fingerprintSourceContent(right.payload);
  if (!effectMatches) return false;
  if (left.action === "create" || left.action === "link_existing") return true;
  return fingerprintSourceContent({ dependencyOperationKeys: [...left.dependencyOperationKeys].sort() })
    === fingerprintSourceContent({ dependencyOperationKeys: [...right.dependencyOperationKeys].sort() });
}
export function lockBulkSourceRowsQuery(scope: SourceDatabaseScope, sourceRecordIds: readonly string[]): SQL {
  const sourceIds = [...new Set(sourceRecordIds)].sort();
  return sql`select ${actSourceRecords.id}::text as "sourceRecordId",
      ${actSourceRecords.latestVersionId}::text as "sourceVersionId",
      ${actSourceRecords.streamType} as "streamType"
    from ${actSourceRecords}
    where ${actSourceRecords.sourceDatabaseKey} = ${scope.sourceDatabaseKey}
      and ${actSourceRecords.id} in (${sql.join(sourceIds.map((sourceId) => sql`${sourceId}`), sql`, `)})
    order by ${actSourceRecords.id}
    for update`;
}

export function lockAutomaticReviewSourceRowsQuery(scope: SourceDatabaseScope, runId: string): SQL {
  return sql`select ${actSourceRecords.id}::text as "sourceRecordId",
      ${actSourceRecords.latestVersionId}::text as "sourceVersionId",
      ${actSourceRecords.streamType} as "streamType",
      ${actSourceRecords.relationshipEvidence} as "relationshipEvidence"
    from ${actReplacementObservations}
    inner join ${actSourceRecords}
      on ${actSourceRecords.id} = ${actReplacementObservations.sourceRecordId}
      and ${actSourceRecords.sourceDatabaseKey} = ${scope.sourceDatabaseKey}
    where ${actReplacementObservations.runId} = ${runId}
      and ${actReplacementObservations.sourceDatabaseKey} = ${scope.sourceDatabaseKey}
    order by ${actSourceRecords.id}
    for update of ${actSourceRecords}`;
}

export function lockAutomaticReviewTargetRowsQuery(
  entityType: AssignmentTargetEntityType,
  targetEntityIds: readonly string[],
): SQL {
  const ids = [...new Set(targetEntityIds)].sort();
  const lock = (table: SQLWrapper, id: SQLWrapper) => sql`select ${id}::text as id
    from ${table}
    where ${id} in (${sql.join(ids.map((targetId) => sql`${targetId}`), sql`, `)})
    order by ${id}
    for update`;
  if (entityType === "organization") return lock(organizations, organizations.id);
  if (entityType === "contact") return lock(contacts, contacts.id);
  if (entityType === "booking") return lock(bookings, bookings.id);
  if (entityType === "calling_list") return lock(callingLists, callingLists.id);
  return lock(activities, activities.id);
}

const automaticTargetTypeByStream: Readonly<Record<string, AssignmentTargetEntityType>> = {
  company: "organization",
  contact: "contact",
  opportunity: "booking",
  group: "calling_list",
  activity: "activity",
  note: "activity",
  history: "activity",
};

const relationshipDisplayKeysByStream: Readonly<Record<string, ReadonlySet<string>>> = {
  contact: new Set(["company", "companyname", "organization", "organizationname"]),
  opportunity: new Set(["company", "companyname", "organization", "organizationname", "contact", "contactname"]),
  group: new Set(["contact", "contactname"]),
  activity: new Set(["company", "companyname", "organization", "organizationname", "contact", "contactname", "opportunity", "opportunityname", "booking", "bookingname", "event", "eventname", "regarding"]),
  note: new Set(["company", "companyname", "organization", "organizationname", "contact", "contactname", "opportunity", "opportunityname", "booking", "bookingname", "event", "eventname", "regarding"]),
  history: new Set(["company", "companyname", "organization", "organizationname", "contact", "contactname", "opportunity", "opportunityname", "booking", "bookingname", "event", "eventname", "regarding"]),
};

function automaticSafeDisplay(source: ReviewSourceRecord): AutomaticReviewSourceProjection["display"] {
  const relationshipKeys = relationshipDisplayKeysByStream[source.streamType.toLowerCase()] ?? new Set<string>();
  return Object.fromEntries(
    Object.entries(projectActReviewDisplay(source.streamType, source.display))
      .filter(([key]) => !relationshipKeys.has(key.toLowerCase())),
  ) as AutomaticReviewSourceProjection["display"];
}

function automaticSourceLabel(source: Pick<AutomaticReviewSourceProjection, "streamType" | "display">): string {
  const values = Object.fromEntries(Object.entries(source.display).map(([key, value]) => [key.toLowerCase(), value]));
  const scalar = (...keys: string[]) => {
    for (const key of keys) {
      const value = values[key.toLowerCase()];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  if (source.streamType.toLowerCase() === "contact") {
    return scalar("fullName", "displayName", "name")
      || `${scalar("firstName")} ${scalar("lastName")}`.trim();
  }
  return scalar("name", "displayName", "companyName", "opportunityName", "title", "subject");
}

const automaticReviewReasonCodes = new Set([
  "ambiguous_match", "field_conflict", "relationship_unresolved", "unassigned",
  "unsupported_record", "unsupported_field",
]);

function automaticReviewRecords(manifest: ActOrganizeManifest): AutomaticReviewRecord[] {
  return manifest.outcomes.map((outcome) => {
    const issues = stableRelationshipIssues(outcome.sourceRecordId, outcome.sourceVersionId, outcome.issues)
      .filter((issue) => automaticReviewReasonCodes.has(issue.code))
      .map((issue) => ({
        code: issue.code as AutomaticReviewIssue["code"],
        ...(typeof issue.reason === "string" ? { reason: issue.reason } : {}),
        ...(typeof issue.relationshipSlot === "string" ? { relationshipSlot: issue.relationshipSlot } : {}),
        ...(Array.isArray(issue.expectedParentTypes) ? { expectedParentTypes: [...issue.expectedParentTypes] } : {}),
        ...(issue.canImportStandalone === true ? { canImportStandalone: true } : {}),
      }));
    return {
      sourceRecordId: outcome.sourceRecordId,
      sourceVersionId: outcome.sourceVersionId,
      issues,
      conflicts: issues
        .filter((issue) => issue.code === "field_conflict" && typeof issue.reason === "string" && issue.reason.trim())
        .map((issue) => ({ fieldName: issue.reason! })),
      unsupportedFieldPaths: [...outcome.unsupportedFieldPaths],
      match: outcome.match as AutomaticReviewRecord["match"],
      unsupportedRecord: issues.some((issue) => issue.code === "unsupported_record"),
    };
  });
}

function automaticReviewDecisionCompare(left: AutomaticReviewDecisionInput, right: AutomaticReviewDecisionInput): number {
  return left.sourceRecordId.localeCompare(right.sourceRecordId)
    || left.scope.localeCompare(right.scope)
    || (left.fieldName ?? "").localeCompare(right.fieldName ?? "")
    || (left.relationshipSlot ?? "").localeCompare(right.relationshipSlot ?? "")
    || (left.targetEntityType ?? "").localeCompare(right.targetEntityType ?? "")
    || (left.targetEntityId ?? "").localeCompare(right.targetEntityId ?? "")
    || left.decision.localeCompare(right.decision)
    || left.sourceVersionId.localeCompare(right.sourceVersionId);
}

export function automaticReviewSummaryFromDecisions(decisions: readonly Decision[]): AutomaticReviewResolutionSummary {
  const summary: AutomaticReviewResolutionSummary = {
    linkedExisting: 0,
    importedNew: 0,
    relationshipsAssigned: 0,
    relationshipsOmitted: 0,
    actValuesSelected: 0,
    unsupportedIgnored: 0,
    manualReview: 0,
    decisionsCreatedOrReplayed: decisions.length,
  };
  for (const decision of decisions) {
    if (decision.scope === "duplicate_identity" && decision.decision === "link_existing") summary.linkedExisting += 1;
    if (decision.scope === "duplicate_identity" && decision.decision === "keep_separate") summary.importedNew += 1;
    if (decision.scope === "relationship" && decision.decision === "assign_parent") summary.relationshipsAssigned += 1;
    if (decision.scope === "relationship" && decision.decision === "keep_unlinked") summary.relationshipsOmitted += 1;
    if (decision.scope === "field_conflict" && decision.decision === "use_source") summary.actValuesSelected += 1;
    if (decision.scope === "unsupported_record" && decision.decision === "ignore_source") summary.unsupportedIgnored += 1;
  }
  return summary;
}

function durableAutomaticReviewSummary(
  value: unknown,
  decisions: readonly Decision[],
): AutomaticReviewResolutionSummary {
  const stored = object(value);
  const keys: Array<keyof AutomaticReviewResolutionSummary> = [
    "linkedExisting", "importedNew", "relationshipsAssigned", "relationshipsOmitted",
    "actValuesSelected", "unsupportedIgnored", "manualReview", "decisionsCreatedOrReplayed",
  ];
  if (keys.every((key) => Number.isSafeInteger(stored[key]) && Number(stored[key]) >= 0)
    && stored.decisionsCreatedOrReplayed === decisions.length) {
    return Object.fromEntries(keys.map((key) => [key, Number(stored[key])])) as AutomaticReviewResolutionSummary;
  }
  return automaticReviewSummaryFromDecisions(decisions);
}
/** Rebuilds the exact deterministic manifest representation written by the organizer. */
export function manifestFromRows(input: { operations: Array<Record<string, unknown>>; outcomes: Array<Record<string, unknown>> }, durableDigest?: string): ActOrganizeManifest {
  const operations: ManifestOperation[] = input.operations
    .map((row) => ({
      operationKey: text(row.operationKey),
      sourceRecordId: text(row.sourceRecordId),
      sourceVersionId: text(row.sourceVersionId),
      targetType: row.targetType as ManifestOperation["targetType"],
      action: row.action as ManifestOperation["action"],
      payload: strictJsonObject(row.payload),
      dependencyOperationKeys: strictStringArray(row.dependencyOperationKeys),
      requiredForSourceOutcome: Boolean(row.requiredForSourceOutcome),
      safeByDefault: Boolean(row.safeByDefault),
    }))
    .sort(compareManifestOperations);
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
      issues: strictManifestIssues(row.issues),
      candidates: strictObjectArray(row.candidates),
      match: row.match === null || row.match === undefined ? null : strictJsonObject(row.match),
      mappingWarnings: strictStringArray(row.mappingWarnings),
      unsupportedFieldPaths: strictStringArray(row.unsupportedFieldPaths),
      operationKeys: operationKeysBySource.get(text(row.sourceRecordId)) ?? [],
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
    : digestManifestRows(operations, outcomes);
  return { operations, outcomes, diagnostics, digest };
}

const manifestDigestMismatch = (): never => {
  throw Object.assign(new Error("manifest_digest_mismatch"), { code: "manifest_digest_mismatch", status: 409 });
};

export function verifyProtectedManifestDigest(input: {
  storedDigest: string;
  digestVersion: string | null | undefined;
  durableManifest: ActOrganizeManifest;
  protectedManifest: ActOrganizeManifest;
  protectedLegacyManifest?: ActOrganizeManifest;
}): string {
  if (input.durableManifest.digest !== input.protectedManifest.digest) manifestDigestMismatch();
  if (input.digestVersion === null) {
    const protectedLegacyManifest = input.protectedLegacyManifest ?? manifestDigestMismatch();
    const protectedLegacyDigest = digestLegacyManifestRows(
      protectedLegacyManifest.operations,
      protectedLegacyManifest.outcomes,
    );
    if (protectedLegacyDigest !== protectedLegacyManifest.digest || protectedLegacyDigest !== input.storedDigest)
      manifestDigestMismatch();
  } else if (input.digestVersion === undefined || input.digestVersion === canonicalManifestDigestVersion) {
    if (input.protectedManifest.digest !== input.storedDigest) manifestDigestMismatch();
  } else {
    manifestDigestMismatch();
  }
  return input.protectedManifest.digest;
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
    approvalMode: unknown;
    approvalModeVersion: unknown;
  },
): ApprovalRequest {
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
  const approvalMode = actApprovalModes.includes(row.approvalMode as ActApprovalMode)
    ? row.approvalMode as ActApprovalMode
    : null;
  return {
    selectedOperationIds,
    approvedOperationIds,
    dependencyOperationIds: approvedOperationIds.filter((id) => !selected.has(id)),
    rejectedOperationIds,
    selectedCount: row.selectedCount,
    dependencyCount: row.dependencyCount,
    rejectedCount: row.rejectedCount,
    manifestDigest: row.manifestDigest,
    approvalMode,
    approvalModeVersion: typeof row.approvalModeVersion === "number" ? row.approvalModeVersion : null,
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

type OrganizerDecisionRow = Pick<Decision, "id" | "sourceRecordId" | "sourceVersionId" | "scope" | "decision" | "fieldName" | "relationshipSlot" | "targetEntityType" | "targetEntityId" | "reviewedSourceValue" | "reviewedSourceValueFingerprint" | "reviewedLocalValue" | "reviewedLocalValueFingerprint" | "decidedBy" | "active"> & { createdAt: Date };
type OrganizerLocalCandidates = {
  organizations?: readonly LocalOrganizationCandidate[];
  contacts?: readonly LocalContactCandidate[];
  bookings?: readonly LocalBookingCandidate[];
  organizationContacts?: readonly { organizationId: string; contactId: string }[];
  bookingContacts?: readonly { bookingId: string; contactId: string }[];
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
const localParentTypeForStream: Record<string, string> = {
  company: "organization",
  contact: "contact",
  opportunity: "booking",
};
const supportedParentsByRootStream: Readonly<Record<string, ReadonlySet<string>>> = {
  contact: new Set(["organization"]),
  opportunity: new Set(["contact"]),
  group: new Set(["contact"]),
  activity: new Set(["organization", "contact", "booking"]),
  note: new Set(["organization", "contact", "booking"]),
  history: new Set(["organization", "contact", "booking"]),
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
      relationshipSlot: row.sourceRecordId,
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
    relationshipSlot: row.sourceRecordId,
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
  const rootById = new Map(roots.map((row) => [row.sourceRecordId, row]));
  const decisionsBySourceVersion = new Map<string, OrganizerDecisionRow[]>();
  for (const decision of input.decisions ?? []) {
    if (!decision.active) continue;
    const key = `${decision.sourceRecordId}\u0000${decision.sourceVersionId}`;
    const rows = decisionsBySourceVersion.get(key) ?? [];
    rows.push(decision);
    decisionsBySourceVersion.set(key, rows);
  }
  const assignmentsBySource = new Map<string, ActSourceAssignmentEvidence[]>();
  for (const assignment of input.assignments ?? []) {
    if (assignment.active === false || assignment.manualAuthority === false) continue;
    const rows = assignmentsBySource.get(assignment.sourceRecordId) ?? [];
    rows.push(assignment);
    assignmentsBySource.set(assignment.sourceRecordId, rows);
  }
  const localCandidateById = new Map(
    [
      ...(input.localCandidates?.organizations ?? []),
      ...(input.localCandidates?.contacts ?? []),
      ...(input.localCandidates?.bookings ?? []),
    ].map((candidate) => [candidate.id, candidate] as const),
  );
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
  const relationshipIssues = new Map<string, ManifestReviewIssue[]>();
  for (const diagnostic of [...resolution.conflicts, ...resolution.unresolved]) {
    const root = rootById.get(diagnostic.sourceRecordId);
    if (!root) continue;
    const issues = relationshipIssues.get(diagnostic.sourceRecordId) ?? [];
    const otherStream = root.streamType === diagnostic.parentStream
      ? diagnostic.childStream
      : root.streamType === diagnostic.childStream
        ? diagnostic.parentStream
        : undefined;
    const expectedParentType = otherStream ? localParentTypeForStream[otherStream] : undefined;
    const relationshipSlot = diagnostic.context.relationshipSlot || `relationship:${fingerprintSourceContent({
      sourceRecordId: diagnostic.sourceRecordId,
      code: diagnostic.code,
      parentStream: diagnostic.parentStream ?? null,
      childStream: diagnostic.childStream ?? null,
      evidenceKind: diagnostic.evidenceKind ?? null,
      context: diagnostic.context,
    })}`;
    const actionable = diagnostic.code === "unresolved_exact_relationship"
      && Boolean(relationshipSlot)
      && Boolean(expectedParentType)
      && Boolean(supportedParentsByRootStream[root.streamType]?.has(expectedParentType!));
    issues.push({
      code: "relationship_unresolved",
      reason: diagnostic.code,
      relationshipSlot,
      expectedParentTypes: actionable ? [expectedParentType!] : [],
      canImportStandalone: actionable,
    });
    relationshipIssues.set(diagnostic.sourceRecordId, issues);
  }
  const relationshipProvenanceBySource = new Map<string, string[]>();
  for (const [key, evidence] of resolution.provenance) {
    const sourceRecordId = key.split(":", 1)[0]!;
    const rows = relationshipProvenanceBySource.get(sourceRecordId) ?? [];
    rows.push(...evidence);
    relationshipProvenanceBySource.set(sourceRecordId, rows);
  }

  const baseRelationshipsForRow = (row: ArchivedOrganizerSourceRow): ManifestSourceInput["relationships"] =>
    row.streamType === "contact"
      ? { organizationSourceIds: [...(resolution.graph.companiesByContact.get(row.sourceRecordId) ?? [])] }
      : row.streamType === "opportunity"
        ? {
            organizationSourceIds: [...(resolution.graph.companiesByOpportunity.get(row.sourceRecordId) ?? [])],
            contactSourceIds: [...(resolution.graph.contactsByOpportunity.get(row.sourceRecordId) ?? [])],
          }
        : row.streamType === "group"
          ? { contactSourceIds: [...(resolution.graph.contactsByGroup.get(row.sourceRecordId) ?? [])] }
          : ["activity", "note", "history"].includes(row.streamType)
            ? {
                organizationSourceIds: [...(resolution.graph.timelineParents.get(row.sourceRecordId)?.companyIds ?? [])],
                contactSourceIds: [...(resolution.graph.timelineParents.get(row.sourceRecordId)?.contactIds ?? [])],
                bookingSourceIds: [...(resolution.graph.timelineParents.get(row.sourceRecordId)?.opportunityIds ?? [])],
              }
            : undefined;
  const normalizedBySource = new Map(roots.map((row) => [
    row.sourceRecordId,
    normalizeArchivedSource(row, baseRelationshipsForRow(row)),
  ]));
  const exactTargetForRow = (row: ArchivedOrganizerSourceRow) => {
    const decisions = decisionsBySourceVersion.get(`${row.sourceRecordId}\u0000${row.sourceVersionId}`) ?? [];
    const decision = decisions.find((candidate) => candidate.scope === "duplicate_identity");
    if (decision?.decision === "keep_separate") return null;
    if (decision?.decision === "link_existing") return decision.targetEntityId;
    return (assignmentsBySource.get(row.sourceRecordId) ?? [])
      .find((candidate) => candidate.targetEntityType === targetForStream[row.streamType])?.targetEntityId ?? null;
  };
  const isKeepSeparate = (row: ArchivedOrganizerSourceRow) =>
    (decisionsBySourceVersion.get(`${row.sourceRecordId}\u0000${row.sourceVersionId}`) ?? [])
      .some((candidate) => candidate.scope === "duplicate_identity" && candidate.decision === "keep_separate");
  const authoritativeOr = (row: ArchivedOrganizerSourceRow, automatic: () => MatchResult): MatchResult => {
    if (isKeepSeparate(row)) return { kind: "none", reason: "manual_keep_separate" };
    const target = exactTargetForRow(row);
    return target ? { kind: "exact", localId: target, reason: "manual_review" } : automatic();
  };
  const companyMatches = new Map<string, MatchResult>();
  for (const row of roots.filter((candidate) => candidate.streamType === "company")) {
    const normalized = normalizedBySource.get(row.sourceRecordId)!;
    companyMatches.set(row.sourceRecordId, authoritativeOr(row, () => normalized.ok && normalized.value.kind === "organization"
      ? matchOrganization({ ...normalized.value, sourceRecordId: row.sourceRecordId, externalLinks: input.localCandidates?.externalLinks }, input.localCandidates?.organizations ?? [], { sourceDatabaseKey: input.sourceDatabaseKey, sourceEntityType: row.streamType, sourceActRecordId: row.actRecordId })
      : { kind: "none", reason: "organization_normalization_failed" }));
  }
  const contactMatches = new Map<string, MatchResult>();
  const refreshContactMatches = () => {
    for (const row of roots.filter((candidate) => candidate.streamType === "contact")) {
      const normalized = normalizedBySource.get(row.sourceRecordId)!;
      const companySourceIds = baseRelationshipsForRow(row)?.organizationSourceIds ?? [];
      const resolvedCompanyIds = uniqueSorted(companySourceIds.flatMap((sourceId) => {
        const match = companyMatches.get(sourceId);
        return match?.kind === "exact" ? [match.localId] : [];
      }));
      contactMatches.set(row.sourceRecordId, authoritativeOr(row, () => normalized.ok && normalized.value.kind === "contact"
        ? matchContact({
            ...normalized.value,
            sourceRecordId: row.sourceRecordId,
            resolvedOrganizationId: resolvedCompanyIds.length === 1 ? resolvedCompanyIds[0] : null,
            externalLinks: input.localCandidates?.externalLinks,
          }, input.localCandidates?.contacts ?? [], { sourceDatabaseKey: input.sourceDatabaseKey, sourceEntityType: row.streamType, sourceActRecordId: row.actRecordId })
        : { kind: "none", reason: "contact_normalization_failed" }));
    }
  };
  const localContactById = new Map(
    (input.localCandidates?.contacts ?? []).map((contact) => [contact.id, contact] as const),
  );
  const contactSourceIdsByCompany = new Map<string, string[]>();
  for (const [contactSourceId, companySourceIds] of resolution.graph.companiesByContact) {
    for (const companySourceId of companySourceIds) {
      const contactSourceIds = contactSourceIdsByCompany.get(companySourceId) ?? [];
      contactSourceIds.push(contactSourceId);
      contactSourceIdsByCompany.set(companySourceId, contactSourceIds);
    }
  }
  const strengthenCompanyMatchesFromContacts = () => {
    for (const row of roots.filter((candidate) => candidate.streamType === "company")) {
      const current = companyMatches.get(row.sourceRecordId);
      if (!current || current.kind !== "ambiguous" || current.overflow) continue;
      const nameCandidates = new Set(current.candidateIds);
      const relationshipCandidates = uniqueSorted(
        (contactSourceIdsByCompany.get(row.sourceRecordId) ?? []).flatMap((contactSourceId) => {
          const contactMatch = contactMatches.get(contactSourceId);
          if (contactMatch?.kind !== "exact") return [];
          return localContactById.get(contactMatch.localId)?.organizationIds ?? [];
        }),
      ).filter((organizationId) => nameCandidates.has(organizationId));
      if (relationshipCandidates.length !== 1) continue;
      const localId = relationshipCandidates[0]!;
      companyMatches.set(row.sourceRecordId, {
        kind: "exact",
        localId,
        reason: "resolved_by_contact_relationship_context",
        evidence: [
          ...(current.evidence ?? []).filter((clue) => clue.targetEntityId === localId),
          {
            family: "archive_relationship",
            label: "exact ACT contact belongs to the local organization",
            targetEntityType: "organization",
            targetEntityId: localId,
            authority: "authoritative",
          },
        ],
      });
    }
  };
  refreshContactMatches();
  strengthenCompanyMatchesFromContacts();
  // A newly resolved company can provide the independent organization clue
  // needed to resolve its remaining name-only contacts.
  refreshContactMatches();
  strengthenCompanyMatchesFromContacts();
  const contextIndex = buildActContextIndex(roots, input.localCandidates ?? {});
  const inferredTimelineParents = new Map<string, { organizationSourceIds: string[]; contactSourceIds: string[]; bookingSourceIds: string[] }>();
  for (const row of roots.filter((candidate) => ["activity", "note", "history"].includes(candidate.streamType))) {
    const raw = row.rawSnapshot;
    const mentions = contextIndex.narrativeMentions({
      subject: text(raw.subject) || text(raw.Subject),
      regarding: text(raw.regarding) || text(raw.Regarding),
      details: text(raw.details) || text(raw.Details),
      body: text(raw.body) || text(raw.Body),
    });
    const mentionedContacts = uniqueSorted(mentions.filter((mention) => mention.streamType === "contact" && contactMatches.get(mention.sourceRecordId)?.kind === "exact").map((mention) => mention.sourceRecordId));
    const mentionedCompanies = uniqueSorted(mentions.filter((mention) => mention.streamType === "company" && companyMatches.get(mention.sourceRecordId)?.kind === "exact").map((mention) => mention.sourceRecordId));
    const compatiblePairs = mentionedContacts.flatMap((contactSourceId) =>
      mentionedCompanies.filter((companySourceId) => resolution.graph.companiesByContact.get(contactSourceId)?.has(companySourceId)).map((companySourceId) => ({ contactSourceId, companySourceId })),
    );
    const explicit = baseRelationshipsForRow(row);
    if (compatiblePairs.length === 1 && !(explicit?.contactSourceIds?.length || explicit?.organizationSourceIds?.length)) {
      inferredTimelineParents.set(row.sourceRecordId, {
        contactSourceIds: [compatiblePairs[0]!.contactSourceId],
        organizationSourceIds: [compatiblePairs[0]!.companySourceId],
        bookingSourceIds: [],
      });
      relationshipProvenanceBySource.set(row.sourceRecordId, [
        ...(relationshipProvenanceBySource.get(row.sourceRecordId) ?? []),
        "context:subject_or_body_mentions_resolved_parent",
      ]);
    }
  }

  return roots
    .map((row): ManifestSourceInput => {
      const relationships = inferredTimelineParents.get(row.sourceRecordId) ?? baseRelationshipsForRow(row);
      const normalized = normalizedBySource.get(row.sourceRecordId)!;
      const activeDecisions = decisionsBySourceVersion.get(`${row.sourceRecordId}\u0000${row.sourceVersionId}`) ?? [];
      const decision = activeDecisions.find((candidate) => candidate.scope === "duplicate_identity");
      const activeAssignments = assignmentsBySource.get(row.sourceRecordId) ?? [];
      const identityAssignment = activeAssignments.find((candidate) => candidate.targetEntityType === targetForStream[row.streamType]);
      const exactTarget = decision?.decision === "link_existing" ? decision.targetEntityId : identityAssignment?.targetEntityId;
      const organizationMatchForBooking = () => {
        if (!normalized.ok || normalized.value.kind !== "booking") return { kind: "none", reason: "organization_match_not_exact" } as const;
        const organizationSourceId = normalized.value.organizationSourceId;
        if (!organizationSourceId) return { kind: "none", reason: "organization_source_not_found" } as const;
        const organizationRow = rootById.get(organizationSourceId);
        if (!organizationRow || organizationRow.streamType !== "company") return { kind: "none", reason: "organization_source_not_found" } as const;
        const organizationDecision = (decisionsBySourceVersion.get(`${organizationRow.sourceRecordId}\u0000${organizationRow.sourceVersionId}`) ?? []).find((candidate) => candidate.scope === "duplicate_identity");
        const organizationAssignment = (assignmentsBySource.get(organizationRow.sourceRecordId) ?? []).find((candidate) => candidate.targetEntityType === "organization");
        const localId = organizationDecision?.decision === "link_existing" ? organizationDecision.targetEntityId : organizationAssignment?.targetEntityId;
        if (localId) return { kind: "exact", localId, reason: "manual_review" } as const;
        const organization = normalizeCompany(organizationRow.rawSnapshot);
        return organization.ok
          ? matchOrganization({ ...organization.value, sourceRecordId: organizationRow.sourceRecordId, externalLinks: input.localCandidates?.externalLinks }, input.localCandidates?.organizations ?? [], { sourceDatabaseKey: input.sourceDatabaseKey, sourceEntityType: organizationRow.streamType, sourceActRecordId: organizationRow.actRecordId })
          : ({ kind: "none", reason: "organization_normalization_failed" } as const);
      };
      const automaticMatch = exactTarget
        ? ({ kind: "none", reason: "manual_review" } as const)
        : row.streamType === "company"
        ? companyMatches.get(row.sourceRecordId) ?? { kind: "none", reason: "no_candidate" }
        : row.streamType === "contact"
          ? contactMatches.get(row.sourceRecordId) ?? { kind: "none", reason: "no_candidate" }
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
        ? localCandidateById.get(match.localId)
        : undefined;
      const normalizationWarnings = normalized.ok ? normalized.warnings : [...normalized.warnings, normalized.issueCode];
      const relationshipProvenance = relationshipProvenanceBySource.get(row.sourceRecordId) ?? [];
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
        reviewDecisions: activeDecisions
          .slice()
          .sort((a, b) => a.scope.localeCompare(b.scope) || (a.fieldName ?? "").localeCompare(b.fieldName ?? "") || a.id.localeCompare(b.id))
          .map((activeDecision) => ({
            decisionId: activeDecision.id,
            sourceVersionId: activeDecision.sourceVersionId,
            scope: activeDecision.scope,
            decision: activeDecision.decision,
            fieldName: activeDecision.fieldName,
            relationshipSlot: activeDecision.relationshipSlot,
            targetEntityType: activeDecision.targetEntityType,
            targetEntityId: activeDecision.targetEntityId,
            ...(activeDecision.reviewedSourceValueFingerprint
              ? {
                  reviewedSourceValue: activeDecision.reviewedSourceValue,
                  reviewedSourceValueFingerprint: activeDecision.reviewedSourceValueFingerprint,
                }
              : {}),
            ...(activeDecision.reviewedLocalValueFingerprint
              ? {
                  reviewedLocalValue: activeDecision.reviewedLocalValue,
                  reviewedLocalValueFingerprint: activeDecision.reviewedLocalValueFingerprint,
                }
              : {}),
            decidedBy: activeDecision.decidedBy,
            createdAt: activeDecision.createdAt.toISOString(),
          })),
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

  async loadSources(runId: string, excludedDecisionIds: readonly string[] = []): Promise<readonly ManifestSourceInput[]> {
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
    const [assignments, decisions, localOrganizations, localContacts, localBookings, localOrganizationContacts, localBookingContacts, externalLinks] = await Promise.all([
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
      this.database.select({ id: contacts.id, organizationId: contacts.organizationId, firstName: contacts.firstName, lastName: contacts.lastName, email: contacts.email, phone: contacts.phone, jobTitle: contacts.jobTitle, address1: contacts.address1, address2: contacts.address2, city: contacts.city, region: contacts.region, postalCode: contacts.postalCode }).from(contacts),
      this.database.select({ id: bookings.id, name: bookings.name, organizationId: bookings.organizationId, venueName: bookings.venueName, address1: bookings.address1, city: bookings.city, region: bookings.region, postalCode: bookings.postalCode, startsAt: bookings.startsAt, endsAt: bookings.endsAt, localStatus: bookings.status, localProbability: bookings.probability, notes: bookings.notes }).from(bookings),
      this.database.select({ organizationId: organizationContacts.organizationId, contactId: organizationContacts.contactId }).from(organizationContacts).where(eq(organizationContacts.active, true)),
      this.database.select({ bookingId: bookingContacts.bookingId, contactId: bookingContacts.contactId }).from(bookingContacts),
      this.database.select({ localId: actExternalLinks.entityId, entityType: actExternalLinks.entityType, sourceEntityType: actExternalLinks.sourceEntityType, actRecordId: actExternalLinks.actRecordId, sourceRecordId: actExternalLinks.sourceRecordId, sourceDatabaseKey: actExternalLinks.sourceDatabaseKey }).from(actExternalLinks),
    ]);
    const organizationIdsByContact = new Map<string, Set<string>>();
    for (const relationship of localOrganizationContacts) {
      const organizationIds = organizationIdsByContact.get(relationship.contactId) ?? new Set<string>();
      organizationIds.add(relationship.organizationId);
      organizationIdsByContact.set(relationship.contactId, organizationIds);
    }
    for (const contact of localContacts) {
      if (!contact.organizationId) continue;
      const organizationIds = organizationIdsByContact.get(contact.id) ?? new Set<string>();
      organizationIds.add(contact.organizationId);
      organizationIdsByContact.set(contact.id, organizationIds);
    }
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
      decisions: decisions.filter((decision) => !excludedDecisionIds.includes(decision.id)).map((decision) => ({
        id: decision.id,
        sourceRecordId: decision.sourceRecordId,
        sourceVersionId: decision.sourceVersionId,
        scope: decision.scope as Decision["scope"],
        decision: decision.decision as Decision["decision"],
        fieldName: decision.fieldName,
        relationshipSlot: decision.relationshipSlot,
        targetEntityType: decision.targetEntityType,
        targetEntityId: decision.targetEntityId,
        reviewedSourceValue: decision.reviewedSourceValue,
        reviewedSourceValueFingerprint: decision.reviewedSourceValueFingerprint,
        reviewedLocalValue: decision.reviewedLocalValue,
        reviewedLocalValueFingerprint: decision.reviewedLocalValueFingerprint,
        decidedBy: decision.decidedBy,
        createdAt: decision.createdAt,
        active: decision.active,
      })),
      localCandidates: {
        organizations: localOrganizations,
        contacts: localContacts.map(({ organizationId: _organizationId, ...contact }) => ({
          ...contact,
          organizationIds: [...(organizationIdsByContact.get(contact.id) ?? [])].sort(),
        })),
        bookings: localBookings.map((booking) => ({ ...booking, startsAt: booking.startsAt?.toISOString() ?? null, endsAt: booking.endsAt?.toISOString() ?? null })),
        organizationContacts: localOrganizationContacts,
        bookingContacts: localBookingContacts,
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
        const terminalRows = await transaction
          .select()
          .from(actReplacementApplyOperations)
          .where(and(
            eq(actReplacementApplyOperations.runId, runId),
            inArray(actReplacementApplyOperations.operationKey, operations.map((operation) => operation.operationKey)),
            inArray(actReplacementApplyOperations.status, ["applied", "already_present"]),
          ));
        const incomingByKey = new Map(operations.map((operation) => [operation.operationKey, operation]));
        for (const terminal of terminalRows) {
          const incoming = incomingByKey.get(terminal.operationKey);
          if (incoming && !operationSemanticsMatch(terminal as OperationSemantics, incoming)) {
            throw Object.assign(new Error("terminal_operation_key_collision"), {
              code: "terminal_operation_key_collision",
              status: 409,
            });
          }
        }
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
      await transaction.delete(actReplacementApplyOperations).where(staleNonterminalOperationPredicate(runId, operationKeys));
      const completed = await transaction
        .update(actReplacementRuns)
        .set({
          phase: "ready_to_apply",
          manifestDigestVersion: canonicalManifestDigestVersion,
          summary: sql`coalesce(${actReplacementRuns.summary}, '{}'::jsonb) || ${JSON.stringify({ manifestDigest: manifest.digest })}::jsonb`,
          lastErrorCode: null,
          organizerToken: null,
          organizerLeaseExpiresAt: null,
          updatedAt: organizedAt,
        })
        .where(and(
          eq(actReplacementRuns.id, runId),
          eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey),
          eq(actReplacementRuns.phase, "organizing"),
          eq(actReplacementRuns.organizerToken, claimToken),
        ))
        .returning({ id: actReplacementRuns.id });
      if (!completed.length)
        throw Object.assign(new Error("organizer_claim_lost"), { code: "organizer_claim_lost", status: 409 });
    });
  }

  async complete(runId: string, claimToken: string, phase: "ready_to_apply", digest: string) {
    const completed = await this.database
      .update(actReplacementRuns)
      .set({
        phase,
        manifestDigestVersion: canonicalManifestDigestVersion,
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

const reviewIssueCodes: readonly ReviewIssueCode[] = [
  "ambiguous_match",
  "field_conflict",
  "relationship_unresolved",
  "unassigned",
  "unsupported_record",
  "unsupported_field",
];
const decisionReviewStates = ["awaiting_review", "unassigned", "unsupported"] as const;
const universalReviewDisplayFields = ["name", "displayname", "title", "subject"] as const;
const reviewDisplayFieldsByStream: Readonly<Record<string, readonly string[]>> = {
  company: [...universalReviewDisplayFields, "company", "companyname", "phone", "website", "address", "address1", "address2", "city", "state", "region", "postalcode", "zipcode", "country"],
  contact: [...universalReviewDisplayFields, "firstname", "lastname", "fullname", "company", "companyname", "jobtitle", "email", "phone", "city", "state", "region"],
  opportunity: [...universalReviewDisplayFields, "opportunityname", "stage", "status", "estimatedclosedate", "city", "state", "region"],
  group: [...universalReviewDisplayFields, "description"],
  activity: [...universalReviewDisplayFields, "type", "starttime", "endtime", "occurredat", "regarding"],
  note: [...universalReviewDisplayFields, "type", "occurredat", "regarding"],
  history: [...universalReviewDisplayFields, "type", "occurredat", "regarding"],
};

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = object(result).rows;
  return Array.isArray(rows) ? rows as T[] : [];
}

function integer(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function normalizedSearch(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ").toLowerCase();
  return normalized ? `%${normalized}%` : null;
}

function displayFieldPredicate(fields: readonly string[]): SQL {
  return sql`lower(display_field.key) in (${sql.join(fields.map((field) => sql`${field}`), sql`, `)})`;
}

function safeReviewDisplaySearchText(): SQL {
  const streamCases = Object.entries(reviewDisplayFieldsByStream).map(([streamType, fields]) =>
    sql`when ${actSourceRecords.streamType} = ${streamType} then ${displayFieldPredicate(fields)}`,
  );
  return sql`coalesce((
    select string_agg(concat_ws(' ', display_field.key, coalesce(display_field.value #>> '{}', 'null')), ' ')
    from jsonb_each(
      case when jsonb_typeof(${actSourceRecordVersions.rawSnapshot}) = 'object'
        then ${actSourceRecordVersions.rawSnapshot} else '{}'::jsonb end
    ) as display_field(key, value)
    where jsonb_typeof(display_field.value) in ('string', 'number', 'boolean', 'null')
      and case ${sql.join(streamCases, sql` `)}
        else ${displayFieldPredicate(universalReviewDisplayFields)}
      end
  ), '')`;
}

function targetIdClause(column: SQLWrapper, ids: readonly string[] | undefined): SQL {
  if (!ids) return sql``;
  if (!ids.length) return sql`where false`;
  return sql`where ${column} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`;
}

function assignmentTargetSql(input: { ids?: readonly string[]; search?: string; exactSearch?: string; entityType?: string; entityTypes?: readonly string[] }) {
  if (input.entityType && !isAssignmentTargetEntityType(input.entityType)) return null;
  if (input.entityTypes?.some((entityType) => !isAssignmentTargetEntityType(entityType))) return null;
  const entityTypes: AssignmentTargetEntityType[] = input.entityType
    ? [input.entityType as AssignmentTargetEntityType]
    : input.entityTypes?.length
      ? [...new Set(input.entityTypes as AssignmentTargetEntityType[])]
    : [...assignmentTargetEntityTypes];
  const branches: SQL[] = [];
  if (entityTypes.includes("organization")) branches.push(sql`
    select ${organizations.id}::text as id, ${"organization"}::text as "entityType",
      ${organizations.name}::text as label,
      nullif(concat_ws(', ', nullif(${organizations.city}, ''), nullif(${organizations.region}, '')), '')::text as detail,
      jsonb_build_object(
        'name', ${organizations.name}, 'phone', ${organizations.phone}, 'website', ${organizations.website},
        'industry', ${organizations.actIndustry}, 'address1', ${organizations.address1}, 'address2', ${organizations.address2},
        'city', ${organizations.city}, 'region', ${organizations.region}, 'postalCode', ${organizations.postalCode}
      ) as fields
    from ${organizations} ${targetIdClause(organizations.id, input.ids)}`);
  if (entityTypes.includes("contact")) branches.push(sql`
    select ${contacts.id}::text as id, ${"contact"}::text as "entityType",
      concat_ws(' ', ${contacts.firstName}, ${contacts.lastName})::text as label,
      coalesce(nullif(${contacts.email}, ''), nullif(${contacts.phone}, ''))::text as detail,
      jsonb_build_object(
        'firstName', ${contacts.firstName}, 'lastName', ${contacts.lastName}, 'email', ${contacts.email},
        'phone', ${contacts.phone}, 'jobTitle', ${contacts.jobTitle}, 'address1', ${contacts.address1},
        'address2', ${contacts.address2}, 'city', ${contacts.city}, 'region', ${contacts.region},
        'postalCode', ${contacts.postalCode}
      ) as fields
    from ${contacts} ${targetIdClause(contacts.id, input.ids)}`);
  if (entityTypes.includes("booking")) branches.push(sql`
    select ${bookings.id}::text as id, ${"booking"}::text as "entityType",
      ${bookings.name}::text as label,
      nullif(concat_ws(', ', nullif(${bookings.city}, ''), nullif(${bookings.region}, '')), '')::text as detail,
      jsonb_build_object(
        'name', ${bookings.name}, 'venueName', ${bookings.venueName}, 'address1', ${bookings.address1},
        'city', ${bookings.city}, 'region', ${bookings.region}, 'postalCode', ${bookings.postalCode},
        'startsAt', ${bookings.startsAt}, 'endsAt', ${bookings.endsAt}, 'localStatus', ${bookings.status},
        'localProbability', ${bookings.probability}, 'notes', ${bookings.notes}
      ) as fields
    from ${bookings} ${targetIdClause(bookings.id, input.ids)}`);
  if (entityTypes.includes("calling_list")) branches.push(sql`
    select ${callingLists.id}::text as id, ${"calling_list"}::text as "entityType",
      ${callingLists.name}::text as label, ${callingLists.kind}::text as detail,
      jsonb_build_object('name', ${callingLists.name}) as fields
    from ${callingLists} ${targetIdClause(callingLists.id, input.ids)}`);
  if (entityTypes.includes("activity")) branches.push(sql`
    select ${activities.id}::text as id, ${"activity"}::text as "entityType",
      coalesce(nullif(${activities.subject}, ''), left(${activities.body}, 80), 'Activity')::text as label,
      coalesce(${activities.status}, ${activities.sourceType})::text as detail,
      jsonb_build_object(
        'category', ${activities.kind}, 'subject', ${activities.subject}, 'status', ${activities.status},
        'body', ${activities.body}, 'sourceOccurredAt', ${activities.occurredAt},
        'timelineSortAt', ${activities.timelineSortAt}, 'dateIsImportFallback', ${activities.dateIsImportFallback},
        'endsAt', ${activities.endsAt}, 'sourceType', ${activities.sourceType}
      ) as fields
    from ${activities} ${targetIdClause(activities.id, input.ids)}`);
  const search = assignmentTargetLikePattern(input.search);
  const normalizedLabel = sql`lower(regexp_replace(trim(label), ${"\\s+"}, ${" "}, ${"g"}))`;
  const normalizedExactSearch = typeof input.exactSearch === "string" && input.exactSearch.trim()
    ? sql`lower(regexp_replace(trim(${input.exactSearch}), ${"\\s+"}, ${" "}, ${"g"}))`
    : null;
  return sql`
    select id, "entityType", label, detail, fields
    from (${sql.join(branches, sql` union all `)}) as owner_visible_targets
    ${normalizedExactSearch
      ? sql`where ${normalizedLabel} = ${normalizedExactSearch}`
      : search ? sql`where ${normalizedLabel} like ${search} escape ${"\\"}` : sql``}
    order by ${normalizedLabel} collate "C", id collate "C", "entityType" collate "C"
    ${input.ids ? sql`` : normalizedExactSearch ? sql`limit ${2}` : sql`limit ${25}`}`;
}

export function automaticTargetExactMatchQuery(entityType: AssignmentTargetEntityType, label: string) {
  return assignmentTargetSql({ exactSearch: label, entityType });
}

class DrizzleActReviewReaderBase implements ReviewReader {
  constructor(
    protected readonly database: DrizzleDatabase,
    protected readonly scope: ReviewReaderScope,
  ) {
    if (!scope.sourceDatabaseKey.trim()) throw new Error("source_database_key_required");
  }
  protected ownedRunPredicate(runId: string) {
    const conditions = [
      eq(actReplacementRuns.id, runId),
      eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey),
    ];
    if (this.scope.requestedBy)
      conditions.push(eq(actReplacementRuns.requestedBy, this.scope.requestedBy));
    return and(...conditions)!;
  }
  protected ownedRunSql(runId: string) {
    return sql`exists (
      select 1 from ${actReplacementRuns} as owned_review_run
      where owned_review_run.id = ${runId}
        and owned_review_run.source_database_key = ${this.scope.sourceDatabaseKey}
        ${this.scope.requestedBy
          ? sql`and owned_review_run.requested_by = ${this.scope.requestedBy}`
          : sql``}
    )`;
  }
  async ownsRun(runId: string) {
    const [run] = await this.database
      .select({ id: actReplacementRuns.id })
      .from(actReplacementRuns)
      .where(this.ownedRunPredicate(runId))
      .limit(1);
    return Boolean(run);
  }
  async getManifest(runId: string) {
    const [run] = await this.database
      .select({ summary: actReplacementRuns.summary })
      .from(actReplacementRuns)
      .where(this.ownedRunPredicate(runId))
      .limit(1);
    if (!run) return null;
    const [operationRows, outcomeRows] = await Promise.all([this.database.select().from(actReplacementApplyOperations).where(eq(actReplacementApplyOperations.runId, runId)), this.database.select().from(actReplacementOutcomes).where(eq(actReplacementOutcomes.runId, runId))]);
    return manifestFromRows({
      operations: operationRows as unknown as Array<Record<string, unknown>>,
      outcomes: outcomeRows as unknown as Array<Record<string, unknown>>,
    }, text(object(run.summary).manifestDigest));
  }
  async getComputedManifest(runId: string) {
    const manifest = await this.getManifest(runId);
    if (!manifest) return null;
    return {
      ...manifest,
      digest: digestManifestRows(manifest.operations, manifest.outcomes),
    };
  }
  async recomputeAutomaticReviewManifest(runId: string, excludedDecisionIds: readonly string[] = []) {
    const sources = await new DrizzleProductionOrganizerStore(this.database, this.scope).loadSources(runId, excludedDecisionIds);
    return buildActOrganizeManifest({ runId, sources });
  }
  async recomputeLegacyAutomaticReviewManifest(runId: string, excludedDecisionIds: readonly string[] = []) {
    const sources = await new DrizzleProductionOrganizerStore(this.database, this.scope).loadSources(runId, excludedDecisionIds);
    return buildLegacyActOrganizeManifest({ runId, sources });
  }
  protected async protectedCurrentManifest(
    runId: string,
    storedDigest: string,
    digestVersion: string | null | undefined,
    excludedDecisionIds: readonly string[] = [],
  ): Promise<{ manifest: ActOrganizeManifest; lockedById: Map<string, { sourceRecordId: string; sourceVersionId: string; streamType: string; relationshipEvidence?: unknown }> }> {
    const initialManifest = await this.getComputedManifest(runId);
    if (!initialManifest)
      throw Object.assign(new Error("manifest_not_found"), { code: "manifest_not_found", status: 404 });
    const sourceIds = [...new Set(initialManifest.outcomes.map((outcome) => outcome.sourceRecordId))].sort();
    const lockedSources = resultRows<{ sourceRecordId: string; sourceVersionId: string; streamType: string; relationshipEvidence?: unknown }>(
      await this.database.execute(lockAutomaticReviewSourceRowsQuery(this.scope, runId)),
    );
    const lockedById = new Map(lockedSources.map((source) => [source.sourceRecordId, source]));
    if (sourceIds.some((sourceId) => !lockedById.has(sourceId)))
      throw Object.assign(new Error("run_not_found"), { code: "run_not_found", status: 404 });
    const currentManifest = await this.getComputedManifest(runId);
    if (!currentManifest)
      throw Object.assign(new Error("manifest_not_found"), { code: "manifest_not_found", status: 404 });
    if (currentManifest.digest !== initialManifest.digest) manifestDigestMismatch();
    for (const outcome of currentManifest.outcomes) {
      const source = lockedById.get(outcome.sourceRecordId);
      if (!source || source.sourceVersionId !== outcome.sourceVersionId)
        throw Object.assign(new Error("stale_source_version"), { code: "stale_source_version", status: 409 });
    }
    const protectedManifest = excludedDecisionIds.length
      ? await this.recomputeAutomaticReviewManifest(runId, excludedDecisionIds)
      : await this.recomputeAutomaticReviewManifest(runId);
    const protectedLegacyManifest = digestVersion === null
      ? excludedDecisionIds.length
        ? await this.recomputeLegacyAutomaticReviewManifest(runId, excludedDecisionIds)
        : await this.recomputeLegacyAutomaticReviewManifest(runId)
      : undefined;
    verifyProtectedManifestDigest({
      storedDigest,
      digestVersion,
      durableManifest: currentManifest,
      protectedManifest,
      protectedLegacyManifest,
    });
    return { manifest: currentManifest, lockedById };
  }
  async ownsSourceInRun(runId: string, sourceRecordId: string) {
    const [row] = await this.database
      .select({ sourceRecordId: actReplacementOutcomes.sourceRecordId })
      .from(actReplacementOutcomes)
      .innerJoin(actSourceRecords, eq(actSourceRecords.id, actReplacementOutcomes.sourceRecordId))
      .where(and(
        eq(actReplacementOutcomes.runId, runId),
        eq(actReplacementOutcomes.sourceRecordId, sourceRecordId),
        eq(actSourceRecords.sourceDatabaseKey, this.scope.sourceDatabaseKey),
      ))
      .limit(1);
    return Boolean(row);
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

  async readReviewPage(input: ReviewReadInput): Promise<ReviewPage> {
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const pageSize = [25, 50, 100, 200].includes(input.pageSize ?? 50) ? (input.pageSize ?? 50) : 50;
    const offset = (page - 1) * pageSize;
    const summaryResult = await this.database.execute(sql`
      with scoped_run as (
        select ${actReplacementRuns.summary} as summary
        from ${actReplacementRuns}
        where ${actReplacementRuns.id} = ${input.runId}
          and ${actReplacementRuns.sourceDatabaseKey} = ${this.scope.sourceDatabaseKey}
          ${this.scope.requestedBy
            ? sql`and ${actReplacementRuns.requestedBy} = ${this.scope.requestedBy}`
            : sql``}
        limit 1
      ), issue_rows as (
        select ${actReplacementOutcomes.sourceRecordId}::text as source_id, issue.value->>'code' as code
        from ${actReplacementOutcomes}
        cross join scoped_run
        cross join lateral jsonb_array_elements(coalesce(${actReplacementOutcomes.issues}, '[]'::jsonb)) as issue(value)
        where ${actReplacementOutcomes.runId} = ${input.runId}
          and issue.value->>'code' in (${sql.join(reviewIssueCodes.map((code) => sql`${code}`), sql`, `)})
      ), issue_counts as (
        select code, count(*)::int as total from issue_rows group by code
      )
      select nullif(scoped_run.summary->>'manifestDigest', '') as "manifestDigest",
        0::int as "decisionRequired",
        (select count(distinct ${actReplacementOutcomes.sourceRecordId})::int
          from ${actReplacementOutcomes} cross join scoped_run
          where ${actReplacementOutcomes.runId} = ${input.runId}
            and ${actReplacementOutcomes.state} in (${sql.join(decisionReviewStates.map((state) => sql`${state}`), sql`, `)})) as "archivedOnly",
        coalesce((select jsonb_object_agg(code, total) from issue_counts where code <> ${"unsupported_field"}), '{}'::jsonb) as "issueCounts",
        coalesce((select jsonb_object_agg(code, total) from issue_counts where code = ${"unsupported_field"}), '{}'::jsonb) as "diagnosticCounts"
      from scoped_run`);
    const [summaryRow] = resultRows<Record<string, unknown>>(summaryResult);
    if (!summaryRow) throw Object.assign(new Error("manifest_not_found"), { code: "manifest_not_found" });

    const conditions: SQL[] = [
      sql`${actReplacementOutcomes.runId} = ${input.runId}`,
      sql`${actSourceRecords.sourceDatabaseKey} = ${this.scope.sourceDatabaseKey}`,
      this.ownedRunSql(input.runId),
    ];
    if (input.state === "needs_review") conditions.push(sql`${actReplacementOutcomes.state} in ('awaiting_review', 'unassigned', 'unsupported')`);
    else if (input.state) conditions.push(sql`${actReplacementOutcomes.state} = ${input.state}`);
    if (input.issue) conditions.push(sql`exists (
      select 1 from jsonb_array_elements(coalesce(${actReplacementOutcomes.issues}, '[]'::jsonb)) as filtered_issue(value)
      where filtered_issue.value->>'code' = ${input.issue}
    )`);
    const search = normalizedSearch(input.search);
    if (search) conditions.push(sql`lower(concat_ws(' ', ${actReplacementOutcomes.sourceRecordId}::text, ${actSourceRecords.streamType}, ${safeReviewDisplaySearchText()})) like ${search}`);
    const joins = sql`
      from ${actReplacementOutcomes}
      inner join ${actSourceRecords} on ${actSourceRecords.id} = ${actReplacementOutcomes.sourceRecordId}
      inner join ${actSourceRecordVersions} on ${actSourceRecordVersions.id} = ${actReplacementOutcomes.sourceVersionId}`;
    const where = sql.join(conditions, sql` and `);
    const countResult = await this.database.execute(sql`
      with filtered_outcomes as (
        select ${actReplacementOutcomes.issues} as issues
        ${joins} where ${where}
      ), filtered_issue_counts as (
        select issue.value->>'code' as code, count(*)::int as total
        from filtered_outcomes
        cross join lateral jsonb_array_elements(coalesce(filtered_outcomes.issues, '[]'::jsonb)) as issue(value)
        where issue.value->>'code' in (${sql.join(reviewIssueCodes.map((code) => sql`${code}`), sql`, `)})
        group by issue.value->>'code'
      )
      select count(*)::int as total,
        coalesce((select jsonb_object_agg(code, total) from filtered_issue_counts), '{}'::jsonb) as "filteredIssueCounts"
      from filtered_outcomes`);
    const [countRow] = resultRows<Record<string, unknown>>(countResult);
    const total = integer(countRow?.total);
    const pageResult = await this.database.execute(sql`
      select ${actReplacementOutcomes.sourceRecordId}::text as "sourceRecordId",
        ${actReplacementOutcomes.sourceVersionId}::text as "sourceVersionId",
        ${actReplacementOutcomes.state} as state, ${actReplacementOutcomes.issues} as issues,
        ${actReplacementOutcomes.candidates} as candidates, ${actReplacementOutcomes.match} as match,
        ${actSourceRecords.streamType} as "streamType", ${actSourceRecordVersions.rawSnapshot} as "rawSnapshot"
      ${joins} where ${where}
      order by ${actReplacementOutcomes.sourceRecordId}
      limit ${pageSize} offset ${offset}`);
    const pageRows = resultRows<Record<string, unknown>>(pageResult);
    const sourceIds = pageRows.map((row) => text(row.sourceRecordId)).filter(Boolean);
    let operationRows: Array<Record<string, unknown>> = [];
    if (sourceIds.length) {
      const operationResult = await this.database.execute(sql`
        select ${actReplacementApplyOperations.sourceRecordId}::text as "sourceRecordId",
          ${actReplacementApplyOperations.operationKey} as "operationKey",
          ${actReplacementApplyOperations.targetType} as "targetType",
          ${actReplacementApplyOperations.action} as action,
          ${actReplacementApplyOperations.payload} as payload
        from ${actReplacementApplyOperations}
        where ${actReplacementApplyOperations.runId} = ${input.runId}
          and ${actReplacementApplyOperations.sourceRecordId} in (${sql.join(sourceIds.map((sourceId) => sql`${sourceId}`), sql`, `)})
        order by ${actReplacementApplyOperations.operationKey}`);
      operationRows = resultRows<Record<string, unknown>>(operationResult);
    }
    const targetIds = new Set<string>();
    for (const row of pageRows) {
      for (const candidate of array<Record<string, unknown>>(row.candidates)) {
        const candidateId = text(candidate.candidateId);
        if (candidateId) targetIds.add(candidateId);
      }
      const matchId = text(object(row.match).localId);
      if (matchId) targetIds.add(matchId);
    }
    for (const operation of operationRows) {
      const payload = object(operation.payload);
      const targetId = text(payload.localId) || text(payload.entityId);
      if (targetId) targetIds.add(targetId);
    }
    let targets: ReviewTargetProjection[] = [];
    if (targetIds.size) {
      const query = assignmentTargetSql({ ids: [...targetIds] });
      if (query) targets = resultRows<ReviewTargetProjection>(await this.database.execute(query));
    }
    const operationsBySource = new Map<string, Array<{ sourceRecordId: string; targetType: ManifestOperation["targetType"]; action: ManifestOperation["action"]; payload: Record<string, unknown>; operationKey: string }>>();
    for (const row of operationRows) {
      const sourceRecordId = text(row.sourceRecordId);
      const operations = operationsBySource.get(sourceRecordId) ?? [];
      operations.push({
        sourceRecordId,
        targetType: row.targetType as ManifestOperation["targetType"],
        action: row.action as ManifestOperation["action"],
        payload: object(row.payload),
        operationKey: text(row.operationKey),
      });
      operationsBySource.set(sourceRecordId, operations);
    }
    return {
      rows: pageRows.map((row) => {
        const sourceRecordId = text(row.sourceRecordId);
        const operations = operationsBySource.get(sourceRecordId) ?? [];
        return projectReviewRow({
          outcome: {
            sourceRecordId,
            sourceVersionId: text(row.sourceVersionId),
            state: row.state as ManifestOutcome["state"],
            issues: array<{ code: string; reason?: string }>(row.issues),
            candidates: array<Record<string, unknown>>(row.candidates),
            match: Object.keys(object(row.match)).length ? object(row.match) : null,
            mappingWarnings: [],
            unsupportedFieldPaths: [],
            operationKeys: operations.map((operation) => operation.operationKey).filter(Boolean),
          },
          source: {
            sourceRecordId,
            sourceVersionId: text(row.sourceVersionId),
            streamType: text(row.streamType),
            display: projectActReviewDisplay(text(row.streamType), row.rawSnapshot),
          },
          operations,
          targets,
        });
      }),
      page,
      pageSize,
      total,
      manifestDigest: typeof summaryRow.manifestDigest === "string" ? summaryRow.manifestDigest : null,
      filteredIssueCounts: object(countRow?.filteredIssueCounts) as Partial<Record<ReviewIssueCode, number>>,
      summary: {
        decisionRequired: integer(summaryRow.decisionRequired),
        archivedOnly: integer(summaryRow.archivedOnly),
        issueCounts: object(summaryRow.issueCounts) as Partial<Record<ReviewIssueCode, number>>,
        diagnosticCounts: object(summaryRow.diagnosticCounts) as Partial<Record<ReviewIssueCode, number>>,
      },
    };
  }

  async listAssignmentTargets(query: { search?: string; entityType?: string; entityTypes?: string[] }): Promise<ReviewCandidate[]> {
    const targetQuery = assignmentTargetSql(query);
    if (!targetQuery) return [];
    return resultRows<ReviewTargetProjection>(await this.database.execute(targetQuery)).map(({ fields: _fields, ...target }) => target);
  }
}

export class DrizzleActReviewReader extends DrizzleActReviewReaderBase {
  constructor(database: DrizzleDatabase, scope: OwnedSourceDatabaseScope) {
    if (!scope.requestedBy.trim()) throw new Error("requested_by_required");
    super(database, scope);
  }
}

export function automaticReviewProofSql(payload: SQLWrapper): SQL<unknown> {
  const proof = sql`((${payload})::jsonb -> 'automaticReview'::text)`;
  return sql`case
    when jsonb_typeof(${proof}) = 'object' then case
      when ${proof} ?& array['version','eligible','disposition','basis']::text[]
        and (${proof} - 'version'::text - 'eligible'::text - 'disposition'::text - 'basis'::text) = '{}'::jsonb
        and jsonb_typeof(${proof}->'version') = 'number'
        and ${proof}->'version' = '1'::jsonb
        and jsonb_typeof(${proof}->'eligible') = 'boolean'
        and jsonb_typeof(${proof}->'disposition') = 'string'
        and jsonb_typeof(${proof}->'basis') = 'string'
      then ${proof}
      else null
    end
    else null
  end`;
}

export const approvalOperationSelection = {
  operationKey: actReplacementApplyOperations.operationKey,
  sourceRecordId: actReplacementApplyOperations.sourceRecordId,
  sourceVersionId: actReplacementApplyOperations.sourceVersionId,
  targetType: actReplacementApplyOperations.targetType,
  action: actReplacementApplyOperations.action,
  payload: sql<Record<string, unknown>>`jsonb_strip_nulls(jsonb_build_object(
    'automaticReview', ${automaticReviewProofSql(actReplacementApplyOperations.payload)},
    'entityId', case when ${actReplacementApplyOperations.action} = 'overwrite_reviewed'
      then ${actReplacementApplyOperations.payload}->'entityId' else null end,
    'fieldName', case when ${actReplacementApplyOperations.action} = 'overwrite_reviewed'
      then ${actReplacementApplyOperations.payload}->'fieldName' else null end,
    'value', case when ${actReplacementApplyOperations.action} = 'overwrite_reviewed'
      then ${actReplacementApplyOperations.payload}->'value' else null end,
    'proof', case
      when ${actReplacementApplyOperations.action} = 'overwrite_reviewed'
        and jsonb_typeof(${actReplacementApplyOperations.payload}->'proof') = 'object'
      then jsonb_strip_nulls(jsonb_build_object(
        'localValue', ${actReplacementApplyOperations.payload}#>'{proof,localValue}',
        'sourceValue', ${actReplacementApplyOperations.payload}#>'{proof,sourceValue}'
      ))
      else null
    end,
    'decision', case
      when ${actReplacementApplyOperations.action} = 'overwrite_reviewed'
        and jsonb_typeof(${actReplacementApplyOperations.payload}->'decision') = 'object'
      then jsonb_strip_nulls(jsonb_build_object(
        'id', ${actReplacementApplyOperations.payload}#>'{decision,id}',
        'scope', ${actReplacementApplyOperations.payload}#>'{decision,scope}',
        'decision', ${actReplacementApplyOperations.payload}#>'{decision,decision}',
        'sourceVersionId', ${actReplacementApplyOperations.payload}#>'{decision,sourceVersionId}',
        'fieldName', ${actReplacementApplyOperations.payload}#>'{decision,fieldName}',
        'targetEntityType', ${actReplacementApplyOperations.payload}#>'{decision,targetEntityType}',
        'targetEntityId', ${actReplacementApplyOperations.payload}#>'{decision,targetEntityId}'
      ))
      else null
    end
  ))`,
  dependencyOperationKeys:
    actReplacementApplyOperations.dependencyOperationKeys,
  requiredForSourceOutcome:
    actReplacementApplyOperations.requiredForSourceOutcome,
  safeByDefault: actReplacementApplyOperations.safeByDefault,
  status: actReplacementApplyOperations.status,
};

export const approvalOutcomeSelection = {
  sourceRecordId: actReplacementOutcomes.sourceRecordId,
  sourceVersionId: actReplacementOutcomes.sourceVersionId,
  state: actReplacementOutcomes.state,
};

export function approvalManifestFromRows(input: {
  digest: string;
  operations: readonly Record<string, unknown>[];
  outcomes: readonly Record<string, unknown>[];
}): ApprovalManifest {
  const operations: ApprovalOperation[] = input.operations.map((row) => ({
    operationKey: text(row.operationKey),
    sourceRecordId: text(row.sourceRecordId),
    sourceVersionId: text(row.sourceVersionId),
    targetType: text(row.targetType) as ManifestOperation["targetType"],
    action: text(row.action) as ManifestOperation["action"],
    payload: object(row.payload),
    dependencyOperationKeys: array<string>(row.dependencyOperationKeys),
    requiredForSourceOutcome: row.requiredForSourceOutcome === true,
    safeByDefault: row.safeByDefault === true,
    status: text(row.status),
  }));
  const outcomes: ManifestOutcome[] = input.outcomes.map((row) => ({
    sourceRecordId: text(row.sourceRecordId),
    sourceVersionId: text(row.sourceVersionId),
    state: text(row.state) as ManifestOutcome["state"],
    issues: [],
    candidates: [],
    match: null,
    mappingWarnings: [],
    unsupportedFieldPaths: [],
    operationKeys: [],
  }));
  return { digest: input.digest, operations, outcomes };
}

class DrizzleApprovalRepository implements ApprovalRepository {
  constructor(
    private readonly reader: DrizzleActReviewReaderBase,
    private readonly database: DrizzleDatabase,
    private readonly scope: SourceDatabaseScope,
  ) {}
  async getManifest(runId: string) {
    const [run] = await this.database
      .select({ summary: actReplacementRuns.summary })
      .from(actReplacementRuns)
      .where(and(
        eq(actReplacementRuns.id, runId),
        eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey),
      ))
      .limit(1);
    if (!run) return null;
    const [operations, outcomes] = await Promise.all([
      this.database
        .select(approvalOperationSelection)
        .from(actReplacementApplyOperations)
        .where(eq(actReplacementApplyOperations.runId, runId)),
      this.database
        .select(approvalOutcomeSelection)
        .from(actReplacementOutcomes)
        .where(eq(actReplacementOutcomes.runId, runId)),
    ]);
    return approvalManifestFromRows({
      digest: text(object(run.summary).manifestDigest),
      operations: operations as unknown as Array<Record<string, unknown>>,
      outcomes: outcomes as unknown as Array<Record<string, unknown>>,
    });
  }
  async getRequest(runId: string, requestKey: string) {
    if (!(await this.reader.ownsRun(runId))) return null;
    const [row] = await this.database
      .select()
      .from(actReplacementApprovalRequests)
      .where(and(eq(actReplacementApprovalRequests.runId, runId), eq(actReplacementApprovalRequests.requestKey, requestKey)))
      .limit(1);
    if (!row) return null;
    const manifest = await this.getManifest(runId);
    if (!manifest)
      throw Object.assign(new Error("approval_replay_manifest_not_found"), {
        code: "approval_replay_manifest_not_found",
        status: 409,
      });
    return approvalClosureFromDurableRow(manifest, row);
  }
  async saveRequest(runId: string, requestKey: string, request: ApprovalRequest) {
    if (!(await this.reader.ownsRun(runId))) throw new Error("run_not_found");
    const [row] = await this.database
      .insert(actReplacementApprovalRequests)
      .values({
        runId,
        requestKey,
        manifestDigest: request.manifestDigest,
        approvalMode: request.approvalMode,
        approvalModeVersion: request.approvalModeVersion,
        selectedOperationIds: request.selectedOperationIds,
        dependencyClosedOperationIds: request.approvedOperationIds,
        selectedCount: request.selectedCount,
        dependencyCount: request.dependencyCount,
        rejectedCount: request.rejectedCount,
      })
      .onConflictDoNothing({ target: [actReplacementApprovalRequests.runId, actReplacementApprovalRequests.requestKey] })
      .returning();
    if (row) return request;
    const prior = await this.getRequest(runId, requestKey);
    if (!prior) throw new Error("approval_request_not_saved");
    return prior;
  }
}

function durableDecision(row: typeof actReplacementReviewDecisions.$inferSelect): Decision {
  return {
    id: row.id,
    sourceRecordId: row.sourceRecordId,
    sourceVersionId: row.sourceVersionId,
    scope: row.scope as Decision["scope"],
    decision: row.decision as Decision["decision"],
    requestKey: row.requestKey,
    fieldName: row.fieldName,
    relationshipSlot: row.relationshipSlot,
    targetEntityType: row.targetEntityType,
    targetEntityId: row.targetEntityId,
    ...(row.reviewedSourceValueFingerprint
      ? { reviewedSourceValue: row.reviewedSourceValue, reviewedSourceValueFingerprint: row.reviewedSourceValueFingerprint }
      : {}),
    ...(row.reviewedLocalValueFingerprint
      ? { reviewedLocalValue: row.reviewedLocalValue, reviewedLocalValueFingerprint: row.reviewedLocalValueFingerprint }
      : {}),
    decidedBy: row.decidedBy,
    active: row.active,
    ...(row.supersededAt ? { supersededAt: row.supersededAt.toISOString() } : {}),
    ...(row.supersededBy ? { supersededBy: row.supersededBy } : {}),
  };
}

export class DrizzleActReviewCommandStore extends DrizzleActReviewReaderBase implements ReviewCommandStore {
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
          errorCode: organizerErrorCode(error),
          err: error,
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
      sourceRecordId,
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
  private async lockedConflictTarget(entityType: string, entityId: string): Promise<ReviewTargetProjection | null> {
    let locked = false;
    if (entityType === "organization") locked = Boolean((await this.database.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, entityId)).limit(1).for("update"))[0]);
    else if (entityType === "contact") locked = Boolean((await this.database.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, entityId)).limit(1).for("update"))[0]);
    else if (entityType === "booking") locked = Boolean((await this.database.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, entityId)).limit(1).for("update"))[0]);
    else if (entityType === "calling_list") locked = Boolean((await this.database.select({ id: callingLists.id }).from(callingLists).where(eq(callingLists.id, entityId)).limit(1).for("update"))[0]);
    else if (entityType === "activity") locked = Boolean((await this.database.select({ id: activities.id }).from(activities).where(eq(activities.id, entityId)).limit(1).for("update"))[0]);
    if (!locked || !isAssignmentTargetEntityType(entityType)) return null;
    const query = assignmentTargetSql({ ids: [entityId], entityType });
    return query ? resultRows<ReviewTargetProjection>(await this.database.execute(query))[0] ?? null : null;
  }
  private async conflictState(runId: string, sourceRecordId: string, fieldName: string, currentManifest?: ActOrganizeManifest): Promise<ConflictReviewState | null> {
    const manifest = currentManifest ?? await this.getManifest(runId);
    const outcome = manifest?.outcomes.find((candidate) => candidate.sourceRecordId === sourceRecordId);
    const matchId = text(object(outcome?.match).localId);
    const root = manifest?.operations.find((operation) => operation.sourceRecordId === sourceRecordId && operation.action === "link_existing" && text(operation.payload.localId) === matchId);
    const normalized = object(root?.payload.normalized);
    if (!manifest || !outcome || !root || !matchId || !outcome.issues.some((issue) => issue.code === "field_conflict" && issue.reason === fieldName) || !Object.hasOwn(normalized, fieldName)) return null;
    const target = await this.lockedConflictTarget(root.targetType, matchId);
    if (!target?.fields || !Object.hasOwn(target.fields, fieldName)) return null;
    return {
      sourceRecordId,
      sourceVersionId: outcome.sourceVersionId,
      fieldName,
      sourceValue: normalized[fieldName],
      targetEntityType: root.targetType,
      targetEntityId: matchId,
      localValue: target.fields[fieldName],
    };
  }
  private async validatedConflictDecision(runId: string, input: SaveDecisionInput, currentManifest?: ActOrganizeManifest): Promise<SaveDecisionInput> {
    if (input.scope !== "field_conflict" || input.decision !== "use_source") return input;
    const state = await this.conflictState(runId, input.sourceRecordId, input.fieldName ?? "", currentManifest);
    if (!state) throw Object.assign(new Error("stale_review_token"), { code: "stale_review_token", status: 409 });
    return decisionWithReviewedProof(input, state);
  }
  private async supersedeProofStaleFieldDecision(
    runId: string,
    input: SaveDecisionInput,
    currentManifest: ActOrganizeManifest,
  ): Promise<void> {
    if (input.scope !== "field_conflict") return;
    const fieldName = text(input.fieldName).trim();
    if (!fieldName) return;
    const [prior] = await this.database
      .select()
      .from(actReplacementReviewDecisions)
      .where(and(
        eq(actReplacementReviewDecisions.sourceRecordId, input.sourceRecordId),
        eq(actReplacementReviewDecisions.scope, "field_conflict"),
        eq(actReplacementReviewDecisions.fieldName, fieldName),
        eq(actReplacementReviewDecisions.active, true),
      ))
      .limit(1)
      .for("update");
    if (!prior) return;
    const state = await this.conflictState(runId, input.sourceRecordId, input.fieldName ?? "", currentManifest);
    if (!state)
      throw Object.assign(new Error("stale_review_token"), { code: "stale_review_token", status: 409 });
    const durablePrior = durableDecision(prior);
    if (durablePrior.decision !== "use_source" || hasCurrentReviewedFieldProof(durablePrior, state))
      throw Object.assign(new Error("decision_already_active"), { code: "decision_already_active", status: 409 });
    const superseded = await this.database
      .update(actReplacementReviewDecisions)
      .set({ active: false, supersededAt: new Date(), supersededBy: input.decidedBy })
      .where(and(
        eq(actReplacementReviewDecisions.id, prior.id),
        eq(actReplacementReviewDecisions.active, true),
      ))
      .returning({ id: actReplacementReviewDecisions.id });
    if (superseded.length !== 1)
      throw Object.assign(new Error("decision_already_active"), { code: "decision_already_active", status: 409 });
  }
  private async validatedIndividualDecision(
    runId: string,
    input: SaveDecisionInput,
    currentManifest: ActOrganizeManifest,
    currentSource: { sourceVersionId: string; streamType?: string },
  ): Promise<SaveDecisionInput> {
    validateIndividualDecisionAgainstCurrentState(input, currentManifest, currentSource);
    if (input.decision === "link_existing" || input.decision === "assign_parent") {
      const target = await this.lockedConflictTarget(input.targetEntityType ?? "", input.targetEntityId ?? "");
      if (!target)
        throw Object.assign(new Error("review_target_not_found"), { code: "review_target_not_found", status: 409 });
    }
    return this.validatedConflictDecision(runId, input, currentManifest);
  }
  async listDecisions(sourceRecordId: string): Promise<Decision[]> {
    await this.assertSource(sourceRecordId);
    const rows = await this.database
      .select()
      .from(actReplacementReviewDecisions)
      .where(and(eq(actReplacementReviewDecisions.sourceRecordId, sourceRecordId), eq(actReplacementReviewDecisions.active, true)));
    return rows.map(durableDecision);
  }
  private async findDecisionReplay(input: SaveDecisionInput): Promise<Decision | null> {
    const requestFingerprint = input.requestFingerprint ?? individualDecisionRequestFingerprint(input);
    const [prior] = await this.database
      .select()
      .from(actReplacementReviewDecisions)
      .where(and(eq(actReplacementReviewDecisions.sourceRecordId, input.sourceRecordId), eq(actReplacementReviewDecisions.requestKey, input.requestKey)))
      .limit(1);
    if (!prior) return null;
    if (prior.requestFingerprint !== requestFingerprint)
      throw Object.assign(new Error("request_replay_mismatch"), { code: "request_replay_mismatch", status: 409 });
    return durableDecision(prior);
  }
  async saveDecision(input: SaveDecisionInput, sourceAlreadyLocked = false, replayAlreadyChecked = false): Promise<Decision> {
    const requestFingerprint = input.requestFingerprint ?? individualDecisionRequestFingerprint(input);
    if (!replayAlreadyChecked) {
      const replay = await this.findDecisionReplay(input);
      if (replay) return replay;
    }
    if (!sourceAlreadyLocked) {
      const source = await this.assertSource(input.sourceRecordId);
      if (source.sourceVersionId !== input.sourceVersionId)
        throw Object.assign(new Error("stale_source_version"), {
          code: "stale_source_version",
          status: 409,
        });
    }
    const [row] = await this.database
      .insert(actReplacementReviewDecisions)
      .values({
        sourceRecordId: input.sourceRecordId,
        sourceVersionId: input.sourceVersionId,
        scope: input.scope,
        decision: input.decision,
        requestKey: input.requestKey,
        requestFingerprint,
        fieldName: input.fieldName,
        relationshipSlot: input.relationshipSlot,
        targetEntityType: input.targetEntityType,
        targetEntityId: input.targetEntityId,
        reviewedSourceValue: input.reviewedSourceValue,
        reviewedSourceValueFingerprint: input.reviewedSourceValueFingerprint,
        reviewedLocalValue: input.reviewedLocalValue,
        reviewedLocalValueFingerprint: input.reviewedLocalValueFingerprint,
        decidedBy: input.decidedBy,
      })
      .returning();
    if (!row) throw new Error("decision_not_saved");
    return durableDecision(row);
  }
  async discardDecision(decisionId: string) {
    await this.database.delete(actReplacementReviewDecisions).where(eq(actReplacementReviewDecisions.id, decisionId));
  }
  async supersedeDecision(sourceRecordId: string, decisionId: string, actor: string, _requestKey = "", sourceAlreadyLocked = false): Promise<Decision> {
    if (!sourceAlreadyLocked) await this.assertSource(sourceRecordId);
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
    return durableDecision(row);
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
  private async bulkRequestResult(request: { decisionIds: string[]; manifestDigest: string; reviewedOperationIds: string[] }): Promise<BulkReviewDecisionResult> {
    const rows = request.decisionIds.length
      ? await this.database.select().from(actReplacementReviewDecisions).where(inArray(actReplacementReviewDecisions.id, request.decisionIds))
      : [];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const decisions = request.decisionIds.map((id) => byId.get(id)).map((row) => {
      if (!row) throw Object.assign(new Error("bulk_request_incomplete"), { code: "bulk_request_incomplete", status: 409 });
      return durableDecision(row);
    });
    return { decisions, manifestDigest: request.manifestDigest, reviewedOperationIds: request.reviewedOperationIds };
  }
  private automaticSourceProjections(
    manifest: ActOrganizeManifest,
    sources: readonly ReviewSourceRecord[],
  ): AutomaticReviewSourceProjection[] {
    const sourceById = new Map(sources.map((source) => [source.sourceRecordId, source]));
    const projections = manifest.outcomes.map((outcome) => {
      const source = sourceById.get(outcome.sourceRecordId);
      if (!source || source.sourceVersionId !== outcome.sourceVersionId)
        throw Object.assign(new Error("stale_source_version"), { code: "stale_source_version", status: 409 });
      return {
        sourceRecordId: source.sourceRecordId,
        sourceVersionId: source.sourceVersionId,
        streamType: source.streamType,
        display: automaticSafeDisplay(source),
      } satisfies AutomaticReviewSourceProjection;
    });
    const projectionById = new Map(projections.map((source) => [source.sourceRecordId, source]));
    return projections.map((source) => {
      const outcome = manifest.outcomes.find((candidate) => candidate.sourceRecordId === source.sourceRecordId)!;
      const labelsBySlot: Record<string, Partial<Record<AssignmentTargetEntityType, string>>> = {};
      for (const issue of stableRelationshipIssues(outcome.sourceRecordId, outcome.sourceVersionId, outcome.issues)) {
        const slot = issue.relationshipSlot?.trim() ?? "";
        const match = /^source:(organization|contact|booking|calling_list|activity):(.+)$/.exec(slot);
        if (!match) continue;
        const entityType = match[1] as AssignmentTargetEntityType;
        const parentSource = projectionById.get(match[2]!);
        if (!parentSource || automaticTargetTypeByStream[parentSource.streamType.toLowerCase()] !== entityType) continue;
        if (!(issue.expectedParentTypes ?? []).includes(entityType)) continue;
        const label = automaticSourceLabel(parentSource);
        if (!label) continue;
        labelsBySlot[slot] = { ...(labelsBySlot[slot] ?? {}), [entityType]: label };
      }
      return Object.keys(labelsBySlot).length ? { ...source, relationshipLabelsBySlot: labelsBySlot } : source;
    });
  }
  private automaticTargetIds(
    manifest: ActOrganizeManifest,
    sourceRecords: readonly AutomaticReviewSourceProjection[],
  ): Map<AssignmentTargetEntityType, Set<string>> {
    const sourceById = new Map(sourceRecords.map((source) => [source.sourceRecordId, source]));
    const targetIds = new Map<AssignmentTargetEntityType, Set<string>>();
    const add = (entityType: unknown, entityId: unknown) => {
      if (typeof entityType !== "string" || !isAssignmentTargetEntityType(entityType) || typeof entityId !== "string" || !entityId.trim()) return;
      const ids = targetIds.get(entityType) ?? new Set<string>();
      ids.add(entityId.trim());
      targetIds.set(entityType, ids);
    };
    for (const outcome of manifest.outcomes) {
      const source = sourceById.get(outcome.sourceRecordId);
      const sourceType = source ? automaticTargetTypeByStream[source.streamType.toLowerCase()] : undefined;
      for (const candidate of outcome.candidates) add(sourceType, object(candidate).candidateId);
      const match = object(outcome.match);
      add(sourceType, match.localId);
      for (const candidateId of array<string>(match.candidateIds)) add(sourceType, candidateId);
      for (const evidence of array<Record<string, unknown>>(match.evidence)) {
        add(evidence.targetEntityType, evidence.targetEntityId);
      }
      for (const issue of outcome.issues) {
        const raw = object(issue);
        add(raw.targetEntityType, raw.targetEntityId);
      }
    }
    for (const operation of manifest.operations) {
      if (!isAssignmentTargetEntityType(operation.targetType)) continue;
      add(operation.targetType, operation.payload.localId);
      add(operation.targetType, operation.payload.entityId);
    }
    return targetIds;
  }
  private async currentAutomaticTargetIds(
    manifest: ActOrganizeManifest,
    sourceRecords: readonly AutomaticReviewSourceProjection[],
  ): Promise<Map<AssignmentTargetEntityType, Set<string>>> {
    const targetIds = this.automaticTargetIds(manifest, sourceRecords);
    const outcomeBySource = new Map(manifest.outcomes.map((outcome) => [outcome.sourceRecordId, outcome]));
    const labelsByType = new Map<AssignmentTargetEntityType, Set<string>>();
    const addLabel = (entityType: AssignmentTargetEntityType, label: string) => {
      const normalized = label.trim();
      if (!normalized) return;
      const labels = labelsByType.get(entityType) ?? new Set<string>();
      labels.add(normalized);
      labelsByType.set(entityType, labels);
    };
    for (const source of sourceRecords) {
      const outcome = outcomeBySource.get(source.sourceRecordId);
      const matchKind = object(outcome?.match).kind;
      const hasIdentityQuestion = matchKind === "exact"
        || matchKind === "ambiguous"
        || outcome?.issues.some((issue) => issue.code === "ambiguous_match");
      const identityType = automaticTargetTypeByStream[source.streamType.toLowerCase()];
      if (identityType && hasIdentityQuestion) addLabel(identityType, automaticSourceLabel(source));
      for (const labelsByEntityType of Object.values(source.relationshipLabelsBySlot ?? {})) {
        for (const entityType of assignmentTargetEntityTypes) {
          addLabel(entityType, labelsByEntityType[entityType] ?? "");
        }
      }
    }
    for (const entityType of assignmentTargetEntityTypes) {
      const labels = [...(labelsByType.get(entityType) ?? [])].sort();
      const ids = targetIds.get(entityType) ?? new Set<string>();
      if (labels.length > 25) {
        for (let index = 0; index < 26; index += 1) ids.add(`unsafe-label:${entityType}:${index}`);
        targetIds.set(entityType, ids);
        continue;
      }
      for (const label of labels) {
        const query = automaticTargetExactMatchQuery(entityType, label);
        if (!query) continue;
        for (const target of resultRows<ReviewTargetProjection>(await this.database.execute(query))) {
          if (target.entityType === entityType && target.id.trim()) ids.add(target.id.trim());
        }
        if (ids.size > 25) break;
      }
      if (ids.size) targetIds.set(entityType, ids);
    }
    return targetIds;
  }
  private unsafeAutomaticTargets(entityType: AssignmentTargetEntityType): ReviewTargetProjection[] {
    return Array.from({ length: 26 }, (_, index) => ({
      id: `unsafe:${entityType}:${index}`,
      entityType,
      label: "Unavailable protected target context",
      detail: null,
      fields: {},
    }));
  }
  private async lockedAutomaticTargets(
    targetIds: ReadonlyMap<AssignmentTargetEntityType, ReadonlySet<string>>,
  ): Promise<AutomaticReviewContext["targetsByEntityType"]> {
    const targetsByEntityType: Partial<Record<AssignmentTargetEntityType, ReviewTargetProjection[]>> = {};
    for (const entityType of assignmentTargetEntityTypes) {
      const ids = [...(targetIds.get(entityType) ?? [])].sort();
      if (!ids.length) continue;
      if (ids.length > 25) {
        targetsByEntityType[entityType] = this.unsafeAutomaticTargets(entityType);
        continue;
      }
      const locked = resultRows<{ id: string }>(
        await this.database.execute(lockAutomaticReviewTargetRowsQuery(entityType, ids)),
      );
      const lockedIds = [...new Set(locked.map((row) => row.id))].sort();
      if (lockedIds.length !== ids.length || lockedIds.some((id, index) => id !== ids[index])) {
        targetsByEntityType[entityType] = this.unsafeAutomaticTargets(entityType);
        continue;
      }
      const targetQuery = assignmentTargetSql({ ids, entityType });
      const reloaded = targetQuery
        ? resultRows<ReviewTargetProjection>(await this.database.execute(targetQuery))
        : [];
      const byId = new Map(reloaded.map((target) => [target.id, target]));
      if (byId.size !== ids.length || ids.some((id) => !byId.has(id))) {
        targetsByEntityType[entityType] = this.unsafeAutomaticTargets(entityType);
        continue;
      }
      targetsByEntityType[entityType] = ids.map((id) => byId.get(id)!);
    }
    return targetsByEntityType;
  }
  private async protectedAutomaticReviewInput(
    runId: string,
    manifest: ActOrganizeManifest,
  ): Promise<AutomaticReviewInput> {
    const sourceRecords = this.automaticSourceProjections(manifest, await this.listSources(runId));
    const targetsByEntityType = await this.lockedAutomaticTargets(await this.currentAutomaticTargetIds(manifest, sourceRecords));
    return {
      records: automaticReviewRecords(manifest),
      context: { sourceRecords, targetsByEntityType },
    };
  }
  private automaticRequestFingerprint(
    runId: string,
    input: ResolveAutomaticReviewCommandInput,
    decisions: readonly Pick<Decision, "sourceRecordId" | "sourceVersionId" | "scope" | "decision" | "fieldName" | "relationshipSlot" | "targetEntityType" | "targetEntityId">[],
  ) {
    return automaticReviewRequestFingerprint({
      runId,
      expectedManifestDigest: input.expectedManifestDigest,
      actor: input.owner,
      policyVersion: input.policyVersion,
      decisions: decisions.map((decision) => ({
        ...decision,
        relationshipSlot: decision.relationshipSlot ?? null,
      })),
    });
  }
  private async automaticRequestResult(
    runId: string,
    input: ResolveAutomaticReviewCommandInput,
    request: { requestFingerprint: string; decisionIds: string[]; manifestDigest: string; reviewedOperationIds: string[]; automaticSummary?: unknown },
  ): Promise<AutomaticReviewDecisionResult> {
    const result = await this.bulkRequestResult(request);
    if (request.requestFingerprint !== this.automaticRequestFingerprint(runId, input, result.decisions))
      throw Object.assign(new Error("request_replay_mismatch"), { code: "request_replay_mismatch", status: 409 });
    return { ...result, summary: durableAutomaticReviewSummary(request.automaticSummary, result.decisions) };
  }
  private async waitForAutomaticReviewCompletion(
    runId: string,
    input: ResolveAutomaticReviewCommandInput,
  ): Promise<AutomaticReviewDecisionResult> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const [request] = resultRows<{
        requestFingerprint: string; requestedBy: string; decisionIds: string[]; manifestDigest: string;
        reviewedOperationIds: string[]; automaticSummary: unknown;
      }>(await this.database.execute(sql`
        select request_fingerprint as "requestFingerprint", requested_by as "requestedBy",
          decision_ids as "decisionIds", manifest_digest as "manifestDigest",
          reviewed_operation_ids as "reviewedOperationIds", automatic_summary as "automaticSummary"
        from ${actReplacementBulkReviewRequests}
        where run_id = ${runId} and request_key = ${input.requestKey}
      `));
      if (request && request.manifestDigest !== pendingReviewManifestDigest)
        return this.automaticRequestResult(runId, input, request);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw Object.assign(new Error("automatic_review_rebuild_in_progress"), {
      code: "automatic_review_rebuild_in_progress",
      status: 409,
    });
  }
  private async renewAutomaticReviewRebuildLease(
    runId: string,
    input: ResolveAutomaticReviewCommandInput,
    requestFingerprint: string,
    rebuildToken: string,
  ): Promise<boolean> {
    const renewed = resultRows<{ id: string }>(await this.database.execute(sql`
      update ${actReplacementBulkReviewRequests}
      set rebuild_lease_expires_at = ${new Date(Date.now() + automaticReviewRebuildLeaseMs)}
      where run_id = ${runId} and request_key = ${input.requestKey}
        and request_fingerprint = ${requestFingerprint}
        and manifest_digest = ${pendingReviewManifestDigest}
        and rebuild_state = ${"rebuilding"}
        and rebuild_token = ${rebuildToken}::uuid
      returning id::text as id
    `));
    return renewed.length === 1;
  }
  private async releaseAutomaticReviewRebuildLease(
    runId: string,
    input: ResolveAutomaticReviewCommandInput,
    requestFingerprint: string,
    rebuildToken: string,
  ): Promise<void> {
    await this.database.execute(sql`
      update ${actReplacementBulkReviewRequests}
      set rebuild_state = ${"pending"}, rebuild_token = null, rebuild_lease_expires_at = null
      where run_id = ${runId} and request_key = ${input.requestKey}
        and request_fingerprint = ${requestFingerprint}
        and manifest_digest = ${pendingReviewManifestDigest}
        and rebuild_state = ${"rebuilding"}
        and rebuild_token = ${rebuildToken}::uuid
      returning id::text as id
    `);
  }
  private async rebuildWithAutomaticReviewLease(
    runId: string,
    input: ResolveAutomaticReviewCommandInput,
    requestFingerprint: string,
    rebuildToken: string,
  ) {
    let renewal = Promise.resolve();
    let leaseLost = false;
    const renew = () => {
      renewal = renewal.then(async () => {
        if (leaseLost) return;
        try {
          leaseLost = !(await this.renewAutomaticReviewRebuildLease(
            runId, input, requestFingerprint, rebuildToken,
          ));
        } catch (error) {
          logger.error({
            runId,
            requestKey: input.requestKey,
            requestFingerprint,
            status: "failed",
            errorCode: automaticReviewErrorCode(error),
          }, "Automatic review rebuild lease renewal failed");
        }
      });
    };
    const heartbeat = setInterval(renew, automaticReviewRebuildRenewMs);
    heartbeat.unref?.();
    try {
      const rebuilt = await this.rebuildAfterReviewChange(runId);
      if (rebuilt.status !== "ready_to_apply" || !("manifest" in rebuilt) || !rebuilt.manifest)
        throw Object.assign(new Error("manifest_rebuild_incomplete"), { code: "manifest_rebuild_incomplete", status: 409 });
      return rebuilt;
    } catch (error) {
      clearInterval(heartbeat);
      await renewal;
      try {
        await this.releaseAutomaticReviewRebuildLease(
          runId, input, requestFingerprint, rebuildToken,
        );
      } catch (cleanupError) {
        logger.error({
          runId,
          requestKey: input.requestKey,
          requestFingerprint,
          status: "failed",
          errorCode: automaticReviewErrorCode(cleanupError),
        }, "Automatic review rebuild lease cleanup failed");
      }
      throw error;
    } finally {
      clearInterval(heartbeat);
      await renewal;
    }
  }
  private async validatedAutomaticDecision(
    runId: string,
    input: SaveDecisionInput,
    manifest: ActOrganizeManifest,
    source: { sourceVersionId: string; streamType?: string },
  ): Promise<{ decision: SaveDecisionInput; fingerprintInput: SaveDecisionInput }> {
    let fingerprintInput = input;
    if (input.scope === "field_conflict" && input.decision === "use_source") {
      const state = await this.conflictState(runId, input.sourceRecordId, input.fieldName ?? "", manifest);
      if (!state) throw Object.assign(new Error("stale_review_token"), { code: "stale_review_token", status: 409 });
      fingerprintInput = {
        ...input,
        reviewToken: {
          sourceRecordId: state.sourceRecordId,
          sourceVersionId: state.sourceVersionId,
          fieldName: state.fieldName,
          sourceValueFingerprint: fingerprintSourceContent({ value: state.sourceValue }),
          targetEntityType: state.targetEntityType,
          targetEntityId: state.targetEntityId,
          localValueFingerprint: fingerprintSourceContent({ value: state.localValue }),
        },
      };
    }
    return {
      decision: await this.validatedIndividualDecision(runId, fingerprintInput, manifest, source),
      fingerprintInput,
    };
  }
  async getBulkDecisionRequest(runId: string, input: BulkReviewRequestLookup): Promise<BulkReviewDecisionResult | null> {
    const [request] = await this.database
      .select()
      .from(actReplacementBulkReviewRequests)
      .where(and(eq(actReplacementBulkReviewRequests.runId, runId), eq(actReplacementBulkReviewRequests.requestKey, input.requestKey)))
      .limit(1);
    if (!request) return null;
    if (request.requestedBy !== input.owner) throw Object.assign(new Error("run_not_found"), { code: "run_not_found", status: 404 });
    if (request.requestFingerprint !== input.requestFingerprint) throw Object.assign(new Error("request_replay_mismatch"), { code: "request_replay_mismatch", status: 409 });
    if (request.manifestDigest === pendingReviewManifestDigest) return null;
    return this.bulkRequestResult(request);
  }
  private async atomicReviewMutation<T>(runId: string, mutation: (store: DrizzleActReviewCommandStore) => Promise<T>): Promise<T> {
    const result = await this.database.transaction(async (transaction) => {
      const store = new DrizzleActReviewCommandStore(transaction as unknown as DrizzleDatabase, this.scope, this.applyService);
      return mutation(store);
    });
    await this.rebuildAfterReviewChange(runId);
    return result;
  }
  saveAssignmentAndRebuild(runId: string, input: SaveAssignmentInput) { return this.atomicReviewMutation(runId, (store) => store.saveAssignment(input)); }
  supersedeAssignmentAndRebuild(runId: string, sourceRecordId: string, assignmentId: string, actor: string, expectedSourceVersionId: string, requestKey: string) { return this.atomicReviewMutation(runId, (store) => store.supersedeAssignment(sourceRecordId, assignmentId, actor, expectedSourceVersionId, requestKey)); }
  async saveDecisionAndRebuild(runId: string, input: SaveDecisionInput) {
    const saved = await this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({ id: actReplacementRuns.id })
        .from(actReplacementRuns)
        .where(and(
          eq(actReplacementRuns.id, runId),
          eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey),
          eq(actReplacementRuns.requestedBy, input.decidedBy),
        ))
        .limit(1)
        .for("update");
      if (!run) throw Object.assign(new Error("run_not_found"), { code: "run_not_found", status: 404 });
      const store = new DrizzleActReviewCommandStore(transaction as unknown as DrizzleDatabase, this.scope, this.applyService);
      const lockedSources = resultRows<{ sourceRecordId: string; sourceVersionId: string; streamType: string }>(
        await transaction.execute(lockBulkSourceRowsQuery(this.scope, [input.sourceRecordId])),
      );
      const lockedSource = lockedSources[0];
      if (!lockedSource) throw Object.assign(new Error("source_not_found"), { code: "source_not_found", status: 404 });

      const replay = await store.findDecisionReplay(input);
      if (replay) return replay;
      if (lockedSource.sourceVersionId !== input.sourceVersionId)
        throw Object.assign(new Error("stale_source_version"), { code: "stale_source_version", status: 409 });
      const currentManifest = await store.getManifest(runId);
      if (!currentManifest) throw Object.assign(new Error("manifest_not_found"), { code: "manifest_not_found", status: 404 });
      const validated = await store.validatedIndividualDecision(runId, input, currentManifest, lockedSource);
      await store.supersedeProofStaleFieldDecision(runId, validated, currentManifest);
      return store.saveDecision(validated, true, true);
    });
    await this.rebuildAfterReviewChange(runId);
    return saved;
  }
  async saveDecisionsAndRebuild(runId: string, input: SaveDecisionsAndRebuildInput): Promise<SaveDecisionsAndRebuildResult> {
    const transactionResult = await this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({ summary: actReplacementRuns.summary })
        .from(actReplacementRuns)
        .where(and(eq(actReplacementRuns.id, runId), eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey), eq(actReplacementRuns.requestedBy, input.owner)))
        .limit(1)
        .for("update");
      if (!run) throw Object.assign(new Error("run_not_found"), { code: "run_not_found", status: 404 });
      const store = new DrizzleActReviewCommandStore(transaction as unknown as DrizzleDatabase, this.scope, this.applyService);
      const [priorRequest] = await transaction
        .select()
        .from(actReplacementBulkReviewRequests)
        .where(and(eq(actReplacementBulkReviewRequests.runId, runId), eq(actReplacementBulkReviewRequests.requestKey, input.requestKey)))
        .limit(1);
      if (priorRequest) {
        if (priorRequest.requestedBy !== input.owner) throw Object.assign(new Error("run_not_found"), { code: "run_not_found", status: 404 });
        if (priorRequest.requestFingerprint !== input.requestFingerprint)
          throw Object.assign(new Error("request_replay_mismatch"), { code: "request_replay_mismatch", status: 409 });
        return { decisions: (await store.bulkRequestResult(priorRequest)).decisions };
      }
      if (text(object(run.summary).manifestDigest) !== input.expectedManifestDigest)
        throw Object.assign(new Error("manifest_digest_mismatch"), { code: "manifest_digest_mismatch", status: 409 });
      const sourceIds = [...new Set(input.selections.map((selection) => selection.sourceRecordId))].sort();
      const lockedSources = resultRows<{ sourceRecordId: string; sourceVersionId: string; streamType: string }>(
        await transaction.execute(lockBulkSourceRowsQuery(this.scope, sourceIds)),
      );
      const lockedById = new Map(lockedSources.map((source) => [source.sourceRecordId, source]));
      if (lockedById.size !== sourceIds.length) throw Object.assign(new Error("run_not_found"), { code: "run_not_found", status: 404 });
      const currentManifest = await store.getManifest(runId);
      if (!currentManifest) throw Object.assign(new Error("manifest_not_found"), { code: "manifest_not_found", status: 404 });
      const prepared = prepareBulkReviewDecisions(input, currentManifest, lockedById);
      if (prepared.length) {
        const priorDecision = await transaction
          .select({ id: actReplacementReviewDecisions.id })
          .from(actReplacementReviewDecisions)
          .where(and(
            inArray(actReplacementReviewDecisions.sourceRecordId, prepared.map((decision) => decision.sourceRecordId)),
            eq(actReplacementReviewDecisions.requestKey, input.requestKey),
          ))
          .limit(1);
        if (priorDecision.length) throw Object.assign(new Error("request_replay_mismatch"), { code: "request_replay_mismatch", status: 409 });
      }
      const decisions: Decision[] = [];
      for (const decision of prepared) {
        const request = { ...decision, runId, requestKey: input.requestKey, decidedBy: input.owner };
        const validated = await store.validatedConflictDecision(runId, {
            ...request,
            requestFingerprint: individualDecisionRequestFingerprint(request),
          }, currentManifest);
        await store.supersedeProofStaleFieldDecision(runId, validated, currentManifest);
        decisions.push(await store.saveDecision(
          validated,
          true,
          true,
        ));
      }
      await transaction.insert(actReplacementBulkReviewRequests).values({
        runId,
        requestKey: input.requestKey,
        requestFingerprint: input.requestFingerprint,
        requestedBy: input.owner,
        manifestDigest: pendingReviewManifestDigest,
        decisionIds: decisions.map((decision) => decision.id),
        reviewedOperationIds: [],
      });
      return { decisions };
    });
    const rebuilt = await this.rebuildAfterReviewChange(runId);
    const result = {
      decisions: transactionResult.decisions,
      manifestDigest: rebuilt.manifest.digest,
      reviewedOperationIds: reviewedOperationIds(rebuilt.manifest, transactionResult.decisions),
    };
    await this.database
      .update(actReplacementBulkReviewRequests)
      .set({ manifestDigest: result.manifestDigest, reviewedOperationIds: result.reviewedOperationIds })
      .where(and(
        eq(actReplacementBulkReviewRequests.runId, runId),
        eq(actReplacementBulkReviewRequests.requestKey, input.requestKey),
        eq(actReplacementBulkReviewRequests.requestFingerprint, input.requestFingerprint),
      ));
    return result;
  }
  async supersedeDecisionAndRebuild(runId: string, sourceRecordId: string, decisionId: string, actor: string, requestKey: string) {
    const decision = await this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({ id: actReplacementRuns.id })
        .from(actReplacementRuns)
        .where(and(
          eq(actReplacementRuns.id, runId),
          eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey),
          eq(actReplacementRuns.requestedBy, actor),
        ))
        .limit(1)
        .for("update");
      if (!run) throw Object.assign(new Error("run_not_found"), { code: "run_not_found", status: 404 });
      const lockedSources = resultRows<{ sourceRecordId: string }>(
        await transaction.execute(lockBulkSourceRowsQuery(this.scope, [sourceRecordId])),
      );
      if (!lockedSources.length) throw Object.assign(new Error("source_not_found"), { code: "source_not_found", status: 404 });
      const fingerprint = decisionSupersessionRequestFingerprint({ sourceRecordId, decisionId, actor });
      const [priorRequest] = await transaction
        .select()
        .from(actReplacementBulkReviewRequests)
        .where(and(eq(actReplacementBulkReviewRequests.runId, runId), eq(actReplacementBulkReviewRequests.requestKey, requestKey)))
        .limit(1);
      const store = new DrizzleActReviewCommandStore(transaction as unknown as DrizzleDatabase, this.scope, this.applyService);
      if (priorRequest) {
        if (priorRequest.requestedBy !== actor) throw Object.assign(new Error("run_not_found"), { code: "run_not_found", status: 404 });
        if (priorRequest.requestFingerprint !== fingerprint)
          throw Object.assign(new Error("request_replay_mismatch"), { code: "request_replay_mismatch", status: 409 });
        const prior = await store.bulkRequestResult(priorRequest);
        const decision = prior.decisions[0];
        if (!decision) throw Object.assign(new Error("decision_request_incomplete"), { code: "decision_request_incomplete", status: 409 });
        return decision;
      }
      const decision = await store.supersedeDecision(sourceRecordId, decisionId, actor, requestKey, true);
      await transaction.insert(actReplacementBulkReviewRequests).values({
        runId,
        requestKey,
        requestFingerprint: fingerprint,
        requestedBy: actor,
        manifestDigest: pendingReviewManifestDigest,
        decisionIds: [decision.id],
        reviewedOperationIds: [],
      });
      return decision;
    });
    const rebuilt = await this.rebuildAfterReviewChange(runId);
    await this.database
      .update(actReplacementBulkReviewRequests)
      .set({ manifestDigest: rebuilt.manifest.digest })
      .where(and(
        eq(actReplacementBulkReviewRequests.runId, runId),
        eq(actReplacementBulkReviewRequests.requestKey, requestKey),
        eq(actReplacementBulkReviewRequests.requestFingerprint, decisionSupersessionRequestFingerprint({ sourceRecordId, decisionId, actor })),
      ));
    return decision;
  }
  private async automaticReviewLogFingerprint(
    runId: string,
    input: ResolveAutomaticReviewCommandInput,
  ): Promise<string | undefined> {
    try {
      const [request] = resultRows<{ requestFingerprint: string }>(
        await this.database.execute(sql`
          select request_fingerprint as "requestFingerprint"
          from ${actReplacementBulkReviewRequests}
          where run_id = ${runId} and request_key = ${input.requestKey}
            and requested_by = ${input.owner}
        `),
      );
      return request?.requestFingerprint || undefined;
    } catch {
      return undefined;
    }
  }
  async resolveAutomaticReviewAndRebuild(
    runId: string,
    input: ResolveAutomaticReviewCommandInput,
  ): Promise<AutomaticReviewDecisionResult> {
    try {
      const result = await this.resolveAutomaticReviewAndRebuildUnlogged(runId, input);
      const requestFingerprint = this.automaticRequestFingerprint(runId, input, result.decisions);
      logger.info({
        runId,
        requestKey: input.requestKey,
        requestFingerprint,
        counts: {
          linkedExisting: result.summary.linkedExisting,
          importedNew: result.summary.importedNew,
          relationshipsAssigned: result.summary.relationshipsAssigned,
          relationshipsOmitted: result.summary.relationshipsOmitted,
          actValuesSelected: result.summary.actValuesSelected,
          unsupportedIgnored: result.summary.unsupportedIgnored,
          manualReview: result.summary.manualReview,
          decisionsCreatedOrReplayed: result.summary.decisionsCreatedOrReplayed,
          reviewedOperations: result.reviewedOperationIds.length,
        },
        status: "complete",
      }, "Automatic review completed");
      return result;
    } catch (error) {
      const requestFingerprint = await this.automaticReviewLogFingerprint(runId, input);
      logger.error({
        runId,
        requestKey: input.requestKey,
        ...(requestFingerprint ? { requestFingerprint } : {}),
        status: "failed",
        errorCode: automaticReviewErrorCode(error),
      }, "Automatic review failed");
      throw error;
    }
  }
  private async resolveAutomaticReviewAndRebuildUnlogged(
    runId: string,
    input: ResolveAutomaticReviewCommandInput,
  ): Promise<AutomaticReviewDecisionResult> {
    const transactionResult = await this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select({
          summary: actReplacementRuns.summary,
          manifestDigestVersion: actReplacementRuns.manifestDigestVersion,
          phase: actReplacementRuns.phase,
        })
        .from(actReplacementRuns)
        .where(and(
          eq(actReplacementRuns.id, runId),
          eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey),
          eq(actReplacementRuns.requestedBy, input.owner),
        ))
        .limit(1)
        .for("update");
      if (!run) throw Object.assign(new Error("run_not_found"), { code: "run_not_found", status: 404 });
      const store = new DrizzleActReviewCommandStore(transaction as unknown as DrizzleDatabase, this.scope, this.applyService);
      const [priorRequest] = await transaction
        .select()
        .from(actReplacementBulkReviewRequests)
        .where(and(
          eq(actReplacementBulkReviewRequests.runId, runId),
          eq(actReplacementBulkReviewRequests.requestKey, input.requestKey),
        ))
        .limit(1);
      if (priorRequest) {
        if (priorRequest.requestedBy !== input.owner)
          throw Object.assign(new Error("run_not_found"), { code: "run_not_found", status: 404 });
        const [recovery] = resultRows<{
          expectedManifestDigest: string | null; automaticSummary: unknown; rebuildState: string;
          rebuildToken: string | null; rebuildLeaseExpiresAt: Date | string | null;
        }>(await transaction.execute(sql`
          select expected_manifest_digest as "expectedManifestDigest",
            automatic_summary as "automaticSummary", rebuild_state as "rebuildState",
            rebuild_token::text as "rebuildToken", rebuild_lease_expires_at as "rebuildLeaseExpiresAt"
          from ${actReplacementBulkReviewRequests}
          where run_id = ${runId} and request_key = ${input.requestKey}
          for update
        `));
        const durableRequest = { ...priorRequest, ...recovery };
        const replay = await store.automaticRequestResult(runId, input, durableRequest);
        if (priorRequest.manifestDigest !== pendingReviewManifestDigest)
          return { kind: "complete" as const, result: replay };
        const expectedManifestDigest = durableRequest.expectedManifestDigest ?? input.expectedManifestDigest;
        const lockedDigest = text(object(run.summary).manifestDigest);
        if (lockedDigest !== expectedManifestDigest) {
          if (run.phase !== undefined && run.phase !== "ready_to_apply") manifestDigestMismatch();
          const { manifest: rebuiltManifest } = await store.protectedCurrentManifest(
            runId,
            lockedDigest,
            run.manifestDigestVersion,
          );
          const recovered: AutomaticReviewDecisionResult = {
            ...replay,
            manifestDigest: rebuiltManifest.digest,
            reviewedOperationIds: reviewedOperationIds(rebuiltManifest, replay.decisions),
          };
          await transaction.execute(sql`
            update ${actReplacementBulkReviewRequests}
            set manifest_digest = ${recovered.manifestDigest},
              reviewed_operation_ids = ${JSON.stringify(recovered.reviewedOperationIds)}::jsonb,
              rebuild_state = ${"complete"}, rebuild_token = null, rebuild_lease_expires_at = null
            where run_id = ${runId} and request_key = ${input.requestKey}
              and request_fingerprint = ${priorRequest.requestFingerprint}
              and manifest_digest = ${pendingReviewManifestDigest}
          `);
          return { kind: "complete" as const, result: recovered };
        }
        if (run.manifestDigestVersion !== undefined) {
          await store.protectedCurrentManifest(
            runId,
            lockedDigest,
            run.manifestDigestVersion,
            replay.decisions.map((decision) => decision.id),
          );
        }
        const leaseExpiresAt = durableRequest.rebuildLeaseExpiresAt instanceof Date
          ? durableRequest.rebuildLeaseExpiresAt
          : durableRequest.rebuildLeaseExpiresAt ? new Date(durableRequest.rebuildLeaseExpiresAt) : null;
        if (durableRequest.rebuildState === "rebuilding" && leaseExpiresAt && leaseExpiresAt.getTime() > Date.now())
          return { kind: "wait" as const };
        const rebuildToken = randomUUID();
        await transaction.execute(sql`
          update ${actReplacementBulkReviewRequests}
          set rebuild_state = ${"rebuilding"}, rebuild_token = ${rebuildToken}::uuid,
            rebuild_lease_expires_at = ${new Date(Date.now() + automaticReviewRebuildLeaseMs)}
          where run_id = ${runId} and request_key = ${input.requestKey}
            and request_fingerprint = ${priorRequest.requestFingerprint}
            and manifest_digest = ${pendingReviewManifestDigest}
        `);
        return {
          kind: "rebuild" as const,
          decisions: replay.decisions,
          requestFingerprint: priorRequest.requestFingerprint,
          rebuildToken,
          summary: replay.summary,
        };
      }

      const lockedDigest = text(object(run.summary).manifestDigest);
      if (lockedDigest !== input.expectedManifestDigest)
        throw Object.assign(new Error("manifest_digest_mismatch"), { code: "manifest_digest_mismatch", status: 409 });
      let currentManifest: ActOrganizeManifest;
      let lockedById: Map<string, { sourceRecordId: string; sourceVersionId: string; streamType: string; relationshipEvidence?: unknown }>;
      if (run.manifestDigestVersion !== undefined || /^[a-f0-9]{64}$/.test(lockedDigest)) {
        ({ manifest: currentManifest, lockedById } = await store.protectedCurrentManifest(
          runId,
          lockedDigest,
          run.manifestDigestVersion,
        ));
      } else {
        const initialManifest = await store.getComputedManifest(runId);
        if (!initialManifest) throw Object.assign(new Error("manifest_not_found"), { code: "manifest_not_found", status: 404 });
        if (initialManifest.digest !== lockedDigest) manifestDigestMismatch();
        const sourceIds = [...new Set(initialManifest.outcomes.map((outcome) => outcome.sourceRecordId))].sort();
        const lockedSources = resultRows<{ sourceRecordId: string; sourceVersionId: string; streamType: string; relationshipEvidence?: unknown }>(
          await transaction.execute(lockAutomaticReviewSourceRowsQuery(this.scope, runId)),
        );
        lockedById = new Map(lockedSources.map((source) => [source.sourceRecordId, source]));
        if (sourceIds.some((sourceId) => !lockedById.has(sourceId)))
          throw Object.assign(new Error("run_not_found"), { code: "run_not_found", status: 404 });
        const reloaded = await store.getComputedManifest(runId);
        if (!reloaded) throw Object.assign(new Error("manifest_not_found"), { code: "manifest_not_found", status: 404 });
        if (reloaded.digest !== input.expectedManifestDigest) manifestDigestMismatch();
        currentManifest = reloaded;
        for (const outcome of currentManifest.outcomes) {
          const source = lockedById.get(outcome.sourceRecordId);
          if (!source || source.sourceVersionId !== outcome.sourceVersionId)
            throw Object.assign(new Error("stale_source_version"), { code: "stale_source_version", status: 409 });
        }
      }

      const resolution = proposeAutomaticReview(await store.protectedAutomaticReviewInput(runId, currentManifest));
      const proposed = resolution.proposals
        .filter((proposal): proposal is Extract<typeof proposal, { kind: "decision" }> => proposal.kind === "decision")
        .map(({ kind: _kind, reason: _reason, ...decision }) => decision)
        .sort(automaticReviewDecisionCompare);
      const requestFingerprint = store.automaticRequestFingerprint(runId, input, proposed);
      const decisionRequests = proposed.map((decision, index): SaveDecisionInput => ({
        ...decision,
        runId,
        requestKey: `${input.requestKey}:${index + 1}`,
        decidedBy: input.owner,
      }));
      if (decisionRequests.length) {
        const collision = await transaction
          .select({ id: actReplacementReviewDecisions.id })
          .from(actReplacementReviewDecisions)
          .where(and(
            inArray(actReplacementReviewDecisions.sourceRecordId, decisionRequests.map((decision) => decision.sourceRecordId)),
            inArray(actReplacementReviewDecisions.requestKey, decisionRequests.map((decision) => decision.requestKey)),
          ))
          .limit(1);
        if (collision.length)
          throw Object.assign(new Error("request_replay_mismatch"), { code: "request_replay_mismatch", status: 409 });
      }
      const validated: Array<{ decision: SaveDecisionInput; fingerprintInput: SaveDecisionInput }> = [];
      for (const request of decisionRequests) {
        const source = lockedById.get(request.sourceRecordId)!;
        validated.push(await store.validatedAutomaticDecision(runId, request, currentManifest, source));
      }
      const decisions: Decision[] = [];
      for (const prepared of validated) {
        await store.supersedeProofStaleFieldDecision(runId, prepared.decision, currentManifest);
        decisions.push(await store.saveDecision({
          ...prepared.decision,
          requestFingerprint: individualDecisionRequestFingerprint(prepared.fingerprintInput),
        }, true, true));
      }
      const rebuildToken = decisions.length ? randomUUID() : null;
      if (!decisions.length && run.manifestDigestVersion === null) {
        const upgraded = await transaction
          .update(actReplacementRuns)
          .set({
            summary: sql`coalesce(${actReplacementRuns.summary}, '{}'::jsonb) || ${JSON.stringify({ manifestDigest: currentManifest.digest })}::jsonb`,
            manifestDigestVersion: canonicalManifestDigestVersion,
            updatedAt: new Date(),
          })
          .where(and(
            eq(actReplacementRuns.id, runId),
            eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey),
            eq(actReplacementRuns.requestedBy, input.owner),
            isNull(actReplacementRuns.manifestDigestVersion),
            sql`${actReplacementRuns.summary}->>'manifestDigest' = ${lockedDigest}`,
          ))
          .returning({ id: actReplacementRuns.id });
        if (!upgraded.length) manifestDigestMismatch();
      }
      await transaction.insert(actReplacementBulkReviewRequests).values({
        runId,
        requestKey: input.requestKey,
        requestFingerprint,
        requestedBy: input.owner,
        manifestDigest: decisions.length ? pendingReviewManifestDigest : currentManifest.digest,
        decisionIds: decisions.map((decision) => decision.id),
        reviewedOperationIds: [],
      });
      await transaction.execute(sql`
        update ${actReplacementBulkReviewRequests}
        set expected_manifest_digest = ${input.expectedManifestDigest},
          automatic_summary = ${JSON.stringify(resolution.summary)}::jsonb,
          rebuild_state = ${decisions.length ? "rebuilding" : "complete"},
          rebuild_token = ${rebuildToken}::uuid,
          rebuild_lease_expires_at = ${decisions.length ? new Date(Date.now() + automaticReviewRebuildLeaseMs) : null}
        where run_id = ${runId} and request_key = ${input.requestKey}
          and request_fingerprint = ${requestFingerprint}
      `);
      if (!decisions.length) {
        return {
          kind: "complete" as const,
          result: {
            decisions: [],
            manifestDigest: currentManifest.digest,
            reviewedOperationIds: [],
            summary: resolution.summary,
          },
        };
      }
      return {
        kind: "rebuild" as const,
        decisions,
        requestFingerprint,
        rebuildToken: rebuildToken!,
        summary: resolution.summary,
      };
    }, { isolationLevel: "serializable" });
    if (transactionResult.kind === "complete") return transactionResult.result;
    if (transactionResult.kind === "wait") return this.waitForAutomaticReviewCompletion(runId, input);

    const rebuilt = await this.rebuildWithAutomaticReviewLease(
      runId,
      input,
      transactionResult.requestFingerprint,
      transactionResult.rebuildToken,
    );
    if (!("manifest" in rebuilt) || !rebuilt.manifest)
      throw Object.assign(new Error("manifest_rebuild_incomplete"), { code: "manifest_rebuild_incomplete", status: 409 });
    const result: AutomaticReviewDecisionResult = {
      decisions: transactionResult.decisions,
      manifestDigest: rebuilt.manifest.digest,
      reviewedOperationIds: reviewedOperationIds(rebuilt.manifest, transactionResult.decisions),
      summary: transactionResult.summary,
    };
    const finalized = resultRows<{ id: string }>(await this.database.execute(sql`
      update ${actReplacementBulkReviewRequests}
      set manifest_digest = ${result.manifestDigest},
        reviewed_operation_ids = ${JSON.stringify(result.reviewedOperationIds)}::jsonb,
        rebuild_state = ${"complete"}, rebuild_token = null, rebuild_lease_expires_at = null
      where run_id = ${runId} and request_key = ${input.requestKey}
        and request_fingerprint = ${transactionResult.requestFingerprint}
        and manifest_digest = ${pendingReviewManifestDigest}
        and rebuild_token = ${transactionResult.rebuildToken}::uuid
      returning id::text as id
    `));
    if (!finalized.length) return this.waitForAutomaticReviewCompletion(runId, input);
    return result;
  }
}

export type ProductionReviewAdapterFactory = (database: DrizzleDatabase, scope: SourceDatabaseScope, applyService: ActApplyService) => DrizzleActReviewCommandStore;
export const createDrizzleActReviewCommandStore: ProductionReviewAdapterFactory = (database, scope, applyService) => new DrizzleActReviewCommandStore(database, scope, applyService);
