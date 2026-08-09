import type { ActApplyAction, ActApplyTargetType, ActReplacementStreamType } from "./import-types";
import { digestManifestRows } from "./manifest-digest";
import type { MatchResult } from "./matching/match-result";
import { isMateriallyPopulated, isNormalizedMetadataField, writablePhysicalColumn } from "./writable-target-fields";

export type ManifestNormalized = Record<string, unknown> & { kind: string };
export type ManifestRelationships = { organizationSourceIds?: readonly string[]; contactSourceIds?: readonly string[]; bookingSourceIds?: readonly string[]; };
export type ManifestSourceInput = {
  sourceRecordId: string; sourceVersionId: string; streamType: ActReplacementStreamType | string;
  normalized: ManifestNormalized | null; match?: MatchResult; warnings?: readonly string[]; unsupportedFieldPaths?: readonly string[];
  relationships?: ManifestRelationships; provenance?: readonly string[];
  localFields?: Readonly<Record<string, unknown>>;
  reviewIssues?: readonly { code: string; reason?: string }[];
};
export type ManifestOperation = {
  operationKey: string; sourceRecordId: string; sourceVersionId: string; targetType: ActApplyTargetType; action: ActApplyAction;
  payload: Record<string, unknown>; dependencyOperationKeys: string[]; requiredForSourceOutcome: boolean; safeByDefault: boolean;
};
export type ManifestOutcome = { sourceRecordId: string; sourceVersionId: string; state: "ready" | "already_present" | "awaiting_review" | "unassigned" | "unsupported"; issues: Array<{ code: string; reason?: string }>; candidates: Record<string, unknown>[]; match: Record<string, unknown> | null; mappingWarnings: string[]; unsupportedFieldPaths: string[]; operationKeys: string[] };
export type ManifestDiagnostic = { code: "unsupported_field" | "ambiguous_match" | "unassigned" | "unsupported_record" | "relationship_unresolved" | "field_conflict" | "archive_incomplete"; sourceRecordId: string; path?: string };
export type ActOrganizeManifest = { operations: ManifestOperation[]; outcomes: ManifestOutcome[]; diagnostics: ManifestDiagnostic[]; digest: string };

const targetForKind: Record<string, ActApplyTargetType> = { organization: "organization", contact: "contact", booking: "booking", calling_list: "calling_list", timeline: "activity" };
const rank: Record<string, number> = { organization: 10, contact: 20, calling_list: 30, booking: 40, activity: 50, organization_contact: 60, booking_contact: 70, calling_list_member: 80, activity_association: 90, provenance: 100 };
const sorted = (values: readonly string[] | undefined) => [...new Set((values ?? []).filter((value) => value.trim()))].sort();
const operationKey = (target: string, source: string, suffix = "") => `${target}:${source}${suffix ? `:${suffix}` : ""}`;

function baseOperation(source: ManifestSourceInput, targetType: ActApplyTargetType, action: ActApplyAction, payload: Record<string, unknown>, dependencies: string[], required = true, safeByDefault = true): ManifestOperation {
  const key = operationKey(targetType, source.sourceRecordId);
  return { operationKey: key, sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, targetType, action, payload, dependencyOperationKeys: sorted(dependencies), requiredForSourceOutcome: required, safeByDefault };
}

/** Pure, deterministic manifest construction. It never selects an ambiguous match. */
export function buildActOrganizeManifest(input: { runId: string; sources: readonly ManifestSourceInput[] }): ActOrganizeManifest {
  const sources = [...input.sources].sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId));
  const operations: ManifestOperation[] = []; const outcomes: ManifestOutcome[] = []; const diagnostics: ManifestDiagnostic[] = [];
  const sourceKeys = new Set(sources.map((source) => source.sourceRecordId));
  for (const source of sources) {
    const warnings = sorted(source.warnings); const unsupported = sorted(source.unsupportedFieldPaths);
    const reviewIssues = [...(source.reviewIssues ?? [])].sort((a, b) => a.code.localeCompare(b.code) || (a.reason ?? "").localeCompare(b.reason ?? ""));
    const issues: Array<{ code: string; reason?: string }> = [...reviewIssues];
    for (const path of unsupported) { diagnostics.push({ code: "unsupported_field", sourceRecordId: source.sourceRecordId, path }); issues.push({ code: "unsupported_field", reason: path }); }
    for (const issue of reviewIssues) diagnostics.push({ code: issue.code === "archive_incomplete" ? "archive_incomplete" : "relationship_unresolved", sourceRecordId: source.sourceRecordId });
    if (!source.normalized) { issues.push({ code: "unsupported_record", reason: "normalization_failed" }); diagnostics.push({ code: "unsupported_record", sourceRecordId: source.sourceRecordId }); outcomes.push({ sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, state: "unsupported", issues, candidates: [], match: null, mappingWarnings: warnings, unsupportedFieldPaths: unsupported, operationKeys: [] }); continue; }
    const candidates = source.match?.kind === "ambiguous" ? source.match.candidateIds.map((candidateId) => ({ candidateId })) : [];
    if (source.match?.kind === "ambiguous") { issues.push({ code: "ambiguous_match", reason: source.match.reason }); diagnostics.push({ code: "ambiguous_match", sourceRecordId: source.sourceRecordId }); }
    const hasBlockingPreOperationIssue = reviewIssues.length > 0 || source.match?.kind === "ambiguous";
    if (hasBlockingPreOperationIssue) { outcomes.push({ sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, state: "awaiting_review", issues, candidates, match: source.match ? source.match as unknown as Record<string, unknown> : null, mappingWarnings: warnings, unsupportedFieldPaths: unsupported, operationKeys: [] }); continue; }
    const hasRelationshipInput = Boolean(source.relationships?.organizationSourceIds?.length || source.relationships?.contactSourceIds?.length || source.relationships?.bookingSourceIds?.length);
    if (source.match?.kind === "none" && source.normalized.kind === "timeline" && !hasRelationshipInput) { issues.push({ code: "unassigned", reason: "no_resolved_parent" }); diagnostics.push({ code: "unassigned", sourceRecordId: source.sourceRecordId }); outcomes.push({ sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, state: "unassigned", issues, candidates: [], match: source.match as unknown as Record<string, unknown>, mappingWarnings: warnings, unsupportedFieldPaths: unsupported, operationKeys: [] }); continue; }
    const targetType = targetForKind[source.normalized.kind]; if (!targetType) { issues.push({ code: "unsupported_record", reason: "unknown_normalized_kind" }); diagnostics.push({ code: "unsupported_record", sourceRecordId: source.sourceRecordId }); outcomes.push({ sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, state: "unsupported", issues, candidates: [], match: null, mappingWarnings: warnings, unsupportedFieldPaths: unsupported, operationKeys: [] }); continue; }
    const unsupportedNormalizedFields = Object.entries(source.normalized)
      .filter(([fieldName, value]) => isMateriallyPopulated(value) && !writablePhysicalColumn(targetType, fieldName) && !isNormalizedMetadataField(targetType, fieldName, source.normalized!))
      .map(([fieldName]) => fieldName)
      .sort();
    if (unsupportedNormalizedFields.length) {
      for (const fieldName of unsupportedNormalizedFields) {
        issues.push({ code: "unsupported_field", reason: fieldName });
        diagnostics.push({ code: "unsupported_field", sourceRecordId: source.sourceRecordId, path: fieldName });
      }
      outcomes.push({ sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, state: "awaiting_review", issues, candidates, match: source.match ? source.match as unknown as Record<string, unknown> : null, mappingWarnings: warnings, unsupportedFieldPaths: unsupported, operationKeys: [] });
      continue;
    }
    const sourceOps: ManifestOperation[] = []; const rootAction: ActApplyAction = source.match?.kind === "exact" ? "link_existing" : "create";
    const rawParentIds = source.normalized.kind === "timeline" ? [...sorted(source.relationships?.organizationSourceIds), ...sorted(source.relationships?.contactSourceIds), ...sorted(source.relationships?.bookingSourceIds)] : [];
    const parentIds = rawParentIds.filter((id) => {
      const parent = sources.find((candidate) => candidate.sourceRecordId === id);
      return sourceKeys.has(id) && Boolean(parent?.normalized) && parent?.match?.kind !== "ambiguous";
    });
    const parentOps = parentIds.map((id) => operationKey(targetForKind[sources.find((candidate) => candidate.sourceRecordId === id)?.normalized?.kind ?? ""] ?? "organization", id));
    sourceOps.push(baseOperation(source, targetType, rootAction, { normalized: source.normalized, ...(source.match?.kind === "exact" ? { localId: source.match.localId } : {}) }, parentOps, true, rootAction === "create"));
    if (source.normalized.kind !== "timeline") {
      if (rootAction === "link_existing" && source.localFields) {
        const values = Object.entries(source.normalized).filter(([key, value]) => Boolean(writablePhysicalColumn(targetType, key)) && isMateriallyPopulated(value));
        for (const [fieldName, value] of values) {
          const localValue = source.localFields[fieldName];
          if (localValue !== null && localValue !== undefined && localValue !== "" && localValue !== value) { issues.push({ code: "field_conflict", reason: fieldName }); diagnostics.push({ code: "field_conflict", sourceRecordId: source.sourceRecordId, path: fieldName }); continue; }
          if (localValue === null || localValue === undefined || localValue === "") sourceOps.push({ ...baseOperation(source, targetType, "fill_missing", { fieldName, value }, [operationKey(targetType, source.sourceRecordId)], true, true), operationKey: operationKey(targetType, source.sourceRecordId, `field:${fieldName}`) });
        }
      }
      const relationshipParents = source.normalized.kind === "contact" ? sorted(source.relationships?.organizationSourceIds) : source.normalized.kind === "booking" ? [...sorted(source.relationships?.organizationSourceIds), ...sorted(source.relationships?.contactSourceIds)] : source.normalized.kind === "calling_list" ? sorted(source.relationships?.contactSourceIds) : [];
      const relationshipType: ActApplyTargetType | null = source.normalized.kind === "contact" ? "organization_contact" : source.normalized.kind === "booking" ? "booking_contact" : source.normalized.kind === "calling_list" ? "calling_list_member" : null;
      if (relationshipType) for (const parentId of relationshipParents) {
        const parent = sources.find((candidate) => candidate.sourceRecordId === parentId);
        const parentType = targetForKind[parent?.normalized?.kind ?? ""];
        if (!parent || !parentType || parent.match?.kind === "ambiguous") { issues.push({ code: "relationship_unresolved", reason: "parent_source_not_found_or_ambiguous" }); diagnostics.push({ code: "relationship_unresolved", sourceRecordId: source.sourceRecordId }); continue; }
        sourceOps.push({ ...baseOperation(source, relationshipType, "create_relationship", { parentSourceRecordId: parentId }, [operationKey(targetType, source.sourceRecordId), operationKey(parentType, parentId)], true, true), operationKey: operationKey(relationshipType, source.sourceRecordId, parentId) });
      }
    }
    if (source.normalized.kind === "timeline") {
      for (const parentId of parentIds) {
        const parent = sources.find((candidate) => candidate.sourceRecordId === parentId);
        const parentType = targetForKind[parent?.normalized?.kind ?? ""];
        if (!parentType || parent?.match?.kind === "ambiguous") { issues.push({ code: "relationship_unresolved", reason: "parent_source_not_found_or_ambiguous" }); diagnostics.push({ code: "relationship_unresolved", sourceRecordId: source.sourceRecordId }); continue; }
        const relationshipTarget: ActApplyTargetType = "activity_association";
        sourceOps.push({ ...baseOperation(source, relationshipTarget, "create_relationship", { parentSourceRecordId: parentId, parentType }, [operationKey("activity", source.sourceRecordId), operationKey(parentType, parentId)], true, true), operationKey: operationKey(relationshipTarget, source.sourceRecordId, parentId) });
      }
      if (parentIds.length !== rawParentIds.length) {
        issues.push({ code: "relationship_unresolved", reason: "parent_source_not_found" });
        diagnostics.push({ code: "relationship_unresolved", sourceRecordId: source.sourceRecordId });
      }
    }
    sourceOps.push({ ...baseOperation(source, targetType, "record_provenance", { evidence: sorted(source.provenance), mappingWarnings: warnings, unsupportedFieldPaths: unsupported }, sourceOps.map((operation) => operation.operationKey), false, true), operationKey: operationKey("provenance", source.sourceRecordId) });
    operations.push(...sourceOps);
    outcomes.push({ sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, state: issues.some((issue) => issue.code === "relationship_unresolved" || issue.code === "field_conflict") ? "awaiting_review" : "ready", issues, candidates, match: source.match ? source.match as unknown as Record<string, unknown> : null, mappingWarnings: warnings, unsupportedFieldPaths: unsupported, operationKeys: sourceOps.map((operation) => operation.operationKey) });
  }
  const order = (operation: ManifestOperation) => operation.operationKey.startsWith("provenance:") ? rank.provenance : rank[operation.targetType] ?? 999;
  operations.sort((a, b) => order(a) - order(b) || a.operationKey.localeCompare(b.operationKey));
  outcomes.sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId)); diagnostics.sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId) || (a.path ?? "").localeCompare(b.path ?? ""));
  const digest = digestManifestRows(operations, outcomes);
  return { operations, outcomes, diagnostics, digest };
}
