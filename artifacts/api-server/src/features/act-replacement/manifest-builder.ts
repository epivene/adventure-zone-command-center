import type { ActApplyAction, ActApplyTargetType, ActReplacementStreamType } from "./import-types";
import { digestManifestRows } from "./manifest-digest";
import type { MatchResult } from "./matching/match-result";
import { automaticReviewProof } from "./automatic-review-policy";
import { fingerprintSourceContent } from "./source-fingerprint";
import { isMateriallyPopulated, isNormalizedMetadataField, writablePhysicalColumn } from "./writable-target-fields";

export type ManifestNormalized = Record<string, unknown> & { kind: string };
export type ManifestRelationships = { organizationSourceIds?: readonly string[]; contactSourceIds?: readonly string[]; bookingSourceIds?: readonly string[]; };
export type ManifestReviewDecision = {
  decisionId: string; sourceVersionId: string;
  scope: "duplicate_identity" | "field_conflict" | "relationship" | "unsupported_record";
  decision: "link_existing" | "keep_separate" | "keep_local" | "use_source" | "assign_parent" | "keep_unlinked" | "ignore_source";
  fieldName: string | null; relationshipSlot?: string | null; targetEntityType: string | null; targetEntityId: string | null;
  reviewedSourceValue?: unknown; reviewedSourceValueFingerprint?: string | null;
  reviewedLocalValue?: unknown; reviewedLocalValueFingerprint?: string | null;
  decidedBy: string; createdAt: string;
};
export type ManifestSourceInput = {
  sourceRecordId: string; sourceVersionId: string; streamType: ActReplacementStreamType | string;
  normalized: ManifestNormalized | null; match?: MatchResult; warnings?: readonly string[]; unsupportedFieldPaths?: readonly string[];
  relationships?: ManifestRelationships; provenance?: readonly string[];
  localFields?: Readonly<Record<string, unknown>>;
  reviewIssues?: readonly ManifestReviewIssue[];
  reviewDecisions?: readonly ManifestReviewDecision[];
};
export type ManifestOperation = {
  operationKey: string; sourceRecordId: string; sourceVersionId: string; targetType: ActApplyTargetType; action: ActApplyAction;
  payload: Record<string, unknown>; dependencyOperationKeys: string[]; requiredForSourceOutcome: boolean; safeByDefault: boolean;
};
export type ManifestReviewIssue = { code: string; reason?: string; relationshipSlot?: string; expectedParentTypes?: readonly string[]; canImportStandalone?: boolean };
export type ManifestOutcome = { sourceRecordId: string; sourceVersionId: string; state: "ready" | "already_present" | "awaiting_review" | "unassigned" | "unsupported" | "ignored"; issues: ManifestReviewIssue[]; candidates: Record<string, unknown>[]; match: Record<string, unknown> | null; mappingWarnings: string[]; unsupportedFieldPaths: string[]; operationKeys: string[] };
export type ManifestDiagnostic = { code: "unsupported_field" | "ambiguous_match" | "unassigned" | "unsupported_record" | "relationship_unresolved" | "field_conflict" | "archive_incomplete"; sourceRecordId: string; path?: string };
export type ActOrganizeManifest = { operations: ManifestOperation[]; outcomes: ManifestOutcome[]; diagnostics: ManifestDiagnostic[]; digest: string };

const targetForKind: Record<string, ActApplyTargetType> = { organization: "organization", contact: "contact", booking: "booking", calling_list: "calling_list", timeline: "activity" };
const rank: Record<string, number> = { organization: 10, contact: 20, calling_list: 30, booking: 40, activity: 50, organization_contact: 60, booking_contact: 70, calling_list_member: 80, activity_association: 90, provenance: 100 };
const sorted = (values: readonly string[] | undefined) => [...new Set((values ?? []).filter((value) => value.trim()))].sort();
const operationKey = (target: string, source: string, suffix = "") => `${target}:${source}${suffix ? `:${suffix}` : ""}`;
const relationshipParentTypes = new Set(["organization", "contact", "booking"]);

export function stableRelationshipIssues(
  sourceRecordId: string,
  sourceVersionId: string,
  issues: readonly ManifestReviewIssue[],
): ManifestReviewIssue[] {
  const occurrences = new Map<string, number>();
  return issues.map((issue) => {
    if (issue.code !== "relationship_unresolved" && issue.code !== "unassigned") return { ...issue };
    const reason = issue.reason?.trim() || issue.code;
    const occurrenceKey = `${issue.code}\u0000${reason}`;
    const occurrence = occurrences.get(occurrenceKey) ?? 0;
    occurrences.set(occurrenceKey, occurrence + 1);
    const relationshipSlot = issue.relationshipSlot?.trim() || `relationship:${fingerprintSourceContent({
      sourceRecordId,
      sourceVersionId,
      code: issue.code,
      reason,
      occurrence,
    })}`;
    return {
      ...issue,
      reason,
      relationshipSlot,
      expectedParentTypes: sorted(issue.expectedParentTypes),
      canImportStandalone: issue.canImportStandalone === true,
    };
  });
}

function derivedRelationshipIssues(source: ManifestSourceInput, sourceById: ReadonlyMap<string, ManifestSourceInput>): ManifestReviewIssue[] {
  const kind = source.normalized?.kind;
  const references: Array<{ sourceRecordId: string; targetType: string }> = [];
  const add = (sourceRecordIds: readonly string[] | undefined, targetType: string) => {
    for (const sourceRecordId of sorted(sourceRecordIds)) references.push({ sourceRecordId, targetType });
  };
  if (kind === "contact") add(source.relationships?.organizationSourceIds, "organization");
  else if (kind === "booking") {
    add(source.relationships?.organizationSourceIds, "organization");
    add(source.relationships?.contactSourceIds, "contact");
  } else if (kind === "calling_list") add(source.relationships?.contactSourceIds, "contact");
  else if (kind === "timeline") {
    add(source.relationships?.organizationSourceIds, "organization");
    add(source.relationships?.contactSourceIds, "contact");
    add(source.relationships?.bookingSourceIds, "booking");
  }
  return stableRelationshipIssues(source.sourceRecordId, source.sourceVersionId, references.flatMap((reference) => {
    const parent = sourceById.get(reference.sourceRecordId);
    const parentType = targetForKind[parent?.normalized?.kind ?? ""];
    if (parent && parentType && parent.match?.kind !== "ambiguous") return [];
    return [{
      code: "relationship_unresolved",
      reason: "parent_source_not_found_or_ambiguous",
      relationshipSlot: `source:${reference.targetType}:${reference.sourceRecordId}`,
      expectedParentTypes: [reference.targetType],
      canImportStandalone: true,
    }];
  }));
}

function relationshipTarget(kind: string, parentType: string): ActApplyTargetType | null {
  if (kind === "timeline" && relationshipParentTypes.has(parentType)) return "activity_association";
  if (kind === "contact" && parentType === "organization") return "organization_contact";
  if (kind === "booking" && parentType === "contact") return "booking_contact";
  if (kind === "calling_list" && parentType === "contact") return "calling_list_member";
  return null;
}

function relationshipDecisionMatches(decision: ManifestReviewDecision, issue: ManifestReviewIssue): boolean {
  if (decision.scope !== "relationship" || !issue.relationshipSlot) return false;
  if (!decision.relationshipSlot) return decision.decision === "keep_unlinked" && issue.code === "unassigned" && issue.relationshipSlot === "timeline-parent";
  if (decision.relationshipSlot !== issue.relationshipSlot) return false;
  return !decision.targetEntityType || !issue.expectedParentTypes?.length || issue.expectedParentTypes.includes(decision.targetEntityType);
}

function identityOperationKey(source: ManifestSourceInput, targetType: ActApplyTargetType): string {
  return source.match?.kind === "exact"
    ? operationKey(targetType, source.sourceRecordId, `identity:${source.match.localId}`)
    : operationKey(targetType, source.sourceRecordId);
}

function baseOperation(source: ManifestSourceInput, targetType: ActApplyTargetType, action: ActApplyAction, payload: Record<string, unknown>, dependencies: string[], required = true, safeByDefault = true): ManifestOperation {
  const key = identityOperationKey(source, targetType);
  return { operationKey: key, sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, targetType, action, payload, dependencyOperationKeys: sorted(dependencies), requiredForSourceOutcome: required, safeByDefault };
}

function revisionedOperation(baseKey: string, operation: ManifestOperation): ManifestOperation {
  const revision = fingerprintSourceContent({
    sourceVersionId: operation.sourceVersionId,
    targetType: operation.targetType,
    action: operation.action,
    payload: operation.payload,
    dependencyOperationKeys: [...operation.dependencyOperationKeys].sort(),
    requiredForSourceOutcome: operation.requiredForSourceOutcome,
    safeByDefault: operation.safeByDefault,
  }).slice(0, 20);
  return { ...operation, operationKey: `${baseKey}:revision:${revision}` };
}

function replayedDecisions(source: ManifestSourceInput) {
  return [...(source.reviewDecisions ?? [])]
    .filter((decision) => decision.sourceVersionId === source.sourceVersionId)
    .sort((a, b) => a.scope.localeCompare(b.scope) || (a.fieldName ?? "").localeCompare(b.fieldName ?? "") || a.decisionId.localeCompare(b.decisionId));
}

function reviewedOverwriteOperation(source: ManifestSourceInput, targetType: ActApplyTargetType, targetEntityId: string, fieldName: string, decision: ManifestReviewDecision): ManifestOperation {
  const localValue = decision.reviewedLocalValue;
  const value = decision.reviewedSourceValue;
  return {
    ...baseOperation(source, targetType, "overwrite_reviewed", {
      entityId: targetEntityId,
      fieldName,
      value,
      decision: {
        id: decision.decisionId,
        sourceVersionId: decision.sourceVersionId,
        scope: decision.scope,
        decision: decision.decision,
        fieldName: decision.fieldName,
        relationshipSlot: decision.relationshipSlot ?? null,
        targetEntityType: decision.targetEntityType,
        targetEntityId: decision.targetEntityId,
        decidedBy: decision.decidedBy,
        createdAt: decision.createdAt,
      },
      proof: {
        entityType: targetType,
        entityId: targetEntityId,
        fieldName,
        sourceVersionId: decision.sourceVersionId,
        expectedLocalValueFingerprint: decision.reviewedLocalValueFingerprint,
        decisionId: decision.decisionId,
        decision: decision.decision,
        localValue,
        sourceValue: value,
      },
    }, [identityOperationKey(source, targetType)], true, false),
    // A reviewed overwrite is a new, proof-bound action. It must not reuse a
    // terminal fill/overwrite key and be mistaken for work already completed.
    operationKey: operationKey(targetType, source.sourceRecordId, `field:${fieldName}:decision:${decision.decisionId}`),
  };
}

function hasImmutableOverwriteProof(
  decision: ManifestReviewDecision,
  targetType: ActApplyTargetType,
  targetEntityId: string,
  fieldName: string,
): boolean {
  return decision.decision === "use_source"
    && decision.fieldName === fieldName
    && decision.targetEntityType === targetType
    && decision.targetEntityId === targetEntityId
    && typeof decision.reviewedSourceValueFingerprint === "string"
    && decision.reviewedSourceValueFingerprint === fingerprintSourceContent({ value: decision.reviewedSourceValue })
    && typeof decision.reviewedLocalValueFingerprint === "string"
    && decision.reviewedLocalValueFingerprint === fingerprintSourceContent({ value: decision.reviewedLocalValue });
}

/** Pure, deterministic manifest construction. It never selects an ambiguous match. */
export function buildActOrganizeManifest(input: { runId: string; sources: readonly ManifestSourceInput[] }): ActOrganizeManifest {
  const sources = input.sources.map((source) => ({
    ...source,
    ...(source.match?.evidence
      ? {
          match: {
            ...source.match,
            evidence: [...source.match.evidence].sort((left, right) =>
              left.family.localeCompare(right.family)
              || left.label.localeCompare(right.label)
              || left.targetEntityId.localeCompare(right.targetEntityId)),
          },
        }
      : {}),
  })).sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId));
  const sourceById = new Map(sources.map((source) => [source.sourceRecordId, source]));
  const operations: ManifestOperation[] = []; const outcomes: ManifestOutcome[] = []; const diagnostics: ManifestDiagnostic[] = [];
  for (const source of sources) {
    const warnings = sorted(source.warnings); const unsupported = sorted(source.unsupportedFieldPaths);
    const relationshipSourceIds = [...sorted(source.relationships?.organizationSourceIds), ...sorted(source.relationships?.contactSourceIds), ...sorted(source.relationships?.bookingSourceIds)];
    const sourceReviewIssues = stableRelationshipIssues(source.sourceRecordId, source.sourceVersionId, source.reviewIssues ?? []);
    const generatedRelationshipIssues = derivedRelationshipIssues(source, sourceById);
    const hasRelationshipIssue = sourceReviewIssues.some((issue) => issue.code === "relationship_unresolved") || generatedRelationshipIssues.length > 0;
    const hasRelationshipEvidence = relationshipSourceIds.length > 0 || hasRelationshipIssue;
    const standaloneUnassigned = source.normalized?.kind === "timeline" && source.match?.kind === "none" && !hasRelationshipEvidence;
    const unsupportedWholeRecord = !source.normalized || !targetForKind[source.normalized.kind];
    const decisions = replayedDecisions(source);
    const syntheticUnassignedIssue: ManifestReviewIssue | null = standaloneUnassigned ? {
      code: "unassigned",
      reason: "no_resolved_parent",
      relationshipSlot: "timeline-parent",
      expectedParentTypes: ["organization", "contact", "booking"],
      canImportStandalone: true,
    } : null;
    const relationshipIssues = [
      ...sourceReviewIssues.filter((issue) => issue.code === "relationship_unresolved" || issue.code === "unassigned"),
      ...generatedRelationshipIssues,
      ...(syntheticUnassignedIssue ? [syntheticUnassignedIssue] : []),
    ];
    const ignored = decisions.find((decision) =>
      (decision.scope === "unsupported_record" && decision.decision === "ignore_source" && unsupportedWholeRecord)
      || (decision.scope === "relationship" && decision.decision === "ignore_source" && relationshipIssues.some((issue) => relationshipDecisionMatches(decision, issue))),
    );
    const resolvedRelationshipIssues = new Set(relationshipIssues
      .filter((issue) => decisions.some((decision) =>
        relationshipDecisionMatches(decision, issue)
        && ((decision.decision === "keep_unlinked" && issue.canImportStandalone === true)
          || (decision.decision === "assign_parent" && Boolean(decision.targetEntityId) && Boolean(decision.targetEntityType)
            && Boolean(source.normalized && relationshipTarget(source.normalized.kind, decision.targetEntityType!))))))
      .map((issue) => issue.relationshipSlot));
    const assignedParents = decisions.filter((decision) =>
      decision.scope === "relationship"
      && decision.decision === "assign_parent"
      && Boolean(decision.targetEntityId)
      && Boolean(decision.targetEntityType)
      && relationshipIssues.some((issue) => resolvedRelationshipIssues.has(issue.relationshipSlot) && relationshipDecisionMatches(decision, issue)));
    const reviewIssues = [...sourceReviewIssues, ...generatedRelationshipIssues]
      .filter((issue) => !resolvedRelationshipIssues.has(issue.relationshipSlot))
      .sort((a, b) => a.code.localeCompare(b.code) || (a.reason ?? "").localeCompare(b.reason ?? ""));
    const issues: ManifestReviewIssue[] = [...reviewIssues];
    for (const path of unsupported) { diagnostics.push({ code: "unsupported_field", sourceRecordId: source.sourceRecordId, path }); issues.push({ code: "unsupported_field", reason: path }); }
    for (const issue of reviewIssues) diagnostics.push({ code: issue.code === "archive_incomplete" ? "archive_incomplete" : "relationship_unresolved", sourceRecordId: source.sourceRecordId });
    if (ignored) { outcomes.push({ sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, state: "ignored", issues, candidates: [], match: null, mappingWarnings: warnings, unsupportedFieldPaths: unsupported, operationKeys: [] }); continue; }
    if (!source.normalized) { issues.push({ code: "unsupported_record", reason: "normalization_failed" }); diagnostics.push({ code: "unsupported_record", sourceRecordId: source.sourceRecordId }); outcomes.push({ sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, state: "unsupported", issues, candidates: [], match: null, mappingWarnings: warnings, unsupportedFieldPaths: unsupported, operationKeys: [] }); continue; }
    const candidates = source.match?.kind === "ambiguous" ? source.match.candidateIds.map((candidateId) => ({ candidateId })) : [];
    if (source.match?.kind === "ambiguous") { issues.push({ code: "ambiguous_match", reason: source.match.reason }); diagnostics.push({ code: "ambiguous_match", sourceRecordId: source.sourceRecordId }); }
    const hasBlockingPreOperationIssue = reviewIssues.length > 0 || source.match?.kind === "ambiguous";
    if (hasBlockingPreOperationIssue) { outcomes.push({ sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, state: "awaiting_review", issues, candidates, match: source.match ? source.match as unknown as Record<string, unknown> : null, mappingWarnings: warnings, unsupportedFieldPaths: unsupported, operationKeys: [] }); continue; }
    if (standaloneUnassigned && !resolvedRelationshipIssues.has(syntheticUnassignedIssue?.relationshipSlot)) { issues.push(syntheticUnassignedIssue!); diagnostics.push({ code: "unassigned", sourceRecordId: source.sourceRecordId }); outcomes.push({ sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, state: "unassigned", issues, candidates: [], match: source.match as unknown as Record<string, unknown>, mappingWarnings: warnings, unsupportedFieldPaths: unsupported, operationKeys: [] }); continue; }
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
    }
    const sourceOps: ManifestOperation[] = []; const rootAction: ActApplyAction = source.match?.kind === "exact" ? "link_existing" : "create";
    // keep_unlinked resolves only its specific missing slot; known parents remain.
    const rawParentIds = source.normalized.kind === "timeline" ? [...sorted(source.relationships?.organizationSourceIds), ...sorted(source.relationships?.contactSourceIds), ...sorted(source.relationships?.bookingSourceIds)] : [];
    const parentIds = rawParentIds.filter((id) => {
      const parent = sourceById.get(id);
      return Boolean(parent?.normalized) && parent?.match?.kind !== "ambiguous";
    });
    // Linking an exact identity only verifies the target and records provenance.
    // Field writes remain separate fill_missing or proof-gated overwrite operations.
    // Parent ordering belongs to the relationship operations below. Keeping
    // identity roots dependency-free prevents a later parent rematch from
    // changing the semantics of an already-terminal identity operation.
    sourceOps.push(baseOperation(source, targetType, rootAction, { normalized: source.normalized, ...(source.match?.kind === "exact" ? { localId: source.match.localId } : {}) }, [], true, true));
    for (const decision of assignedParents) {
      const parentType = decision.targetEntityType!;
      const relationTarget = relationshipTarget(source.normalized.kind, parentType);
      if (!relationTarget) continue;
      const assignedRelationship = baseOperation(source, relationTarget, "create_relationship", {
          parentEntityId: decision.targetEntityId,
          parentType,
          relationshipSlot: decision.relationshipSlot,
          decision: {
            id: decision.decisionId,
            sourceVersionId: decision.sourceVersionId,
            scope: decision.scope,
            decision: decision.decision,
            relationshipSlot: decision.relationshipSlot,
            targetEntityType: decision.targetEntityType,
            targetEntityId: decision.targetEntityId,
            decidedBy: decision.decidedBy,
            createdAt: decision.createdAt,
          },
        }, [identityOperationKey(source, targetType)], true, true);
      sourceOps.push(revisionedOperation(
        operationKey(relationTarget, source.sourceRecordId, `local:${parentType}:${decision.targetEntityId}:decision:${decision.decisionId}`),
        assignedRelationship,
      ));
    }
    if (source.normalized.kind !== "timeline") {
      if (rootAction === "link_existing" && source.match?.kind === "exact" && source.localFields) {
        const localId = source.match.localId;
        const values = Object.entries(source.normalized).filter(([key, value]) => Boolean(writablePhysicalColumn(targetType, key)) && isMateriallyPopulated(value));
        for (const [fieldName, value] of values) {
          const localValue = source.localFields[fieldName];
          if (localValue !== null && localValue !== undefined && localValue !== "" && localValue !== value) {
            const fieldDecision = decisions.find((decision) => decision.scope === "field_conflict" && decision.fieldName === fieldName);
            if (fieldDecision?.decision === "keep_local") continue;
            if (fieldDecision?.decision === "use_source" && hasImmutableOverwriteProof(fieldDecision, targetType, localId, fieldName)) { sourceOps.push(reviewedOverwriteOperation(source, targetType, localId, fieldName, fieldDecision)); continue; }
            issues.push({ code: "field_conflict", reason: fieldName }); diagnostics.push({ code: "field_conflict", sourceRecordId: source.sourceRecordId, path: fieldName }); continue;
          }
          if (localValue === null || localValue === undefined || localValue === "") {
            const fill = baseOperation(source, targetType, "fill_missing", { entityId: localId, fieldName, value }, [identityOperationKey(source, targetType)], true, true);
            sourceOps.push(revisionedOperation(operationKey(targetType, source.sourceRecordId, `field:${fieldName}`), fill));
          }
        }
      }
      const relationshipParents = source.normalized.kind === "contact" ? sorted(source.relationships?.organizationSourceIds) : source.normalized.kind === "booking" ? [...sorted(source.relationships?.organizationSourceIds), ...sorted(source.relationships?.contactSourceIds)] : source.normalized.kind === "calling_list" ? sorted(source.relationships?.contactSourceIds) : [];
      const relationshipType: ActApplyTargetType | null = source.normalized.kind === "contact" ? "organization_contact" : source.normalized.kind === "booking" ? "booking_contact" : source.normalized.kind === "calling_list" ? "calling_list_member" : null;
      if (relationshipType) for (const parentId of relationshipParents) {
        const parent = sourceById.get(parentId);
        const parentType = targetForKind[parent?.normalized?.kind ?? ""];
        if (!parent || !parentType || parent.match?.kind === "ambiguous") continue;
        const relationship = baseOperation(source, relationshipType, "create_relationship", { parentSourceRecordId: parentId }, [identityOperationKey(source, targetType), identityOperationKey(parent, parentType)], true, true);
        sourceOps.push(revisionedOperation(operationKey(relationshipType, source.sourceRecordId, parentId), relationship));
      }
    }
    if (source.normalized.kind === "timeline") {
      for (const parentId of parentIds) {
        const parent = sourceById.get(parentId);
        const parentType = targetForKind[parent?.normalized?.kind ?? ""];
        if (!parent || !parentType || parent.match?.kind === "ambiguous") continue;
        const relationshipTarget: ActApplyTargetType = "activity_association";
        const relationship = baseOperation(source, relationshipTarget, "create_relationship", { parentSourceRecordId: parentId, parentType }, [identityOperationKey(source, "activity"), identityOperationKey(parent, parentType)], true, true);
        sourceOps.push(revisionedOperation(operationKey(relationshipTarget, source.sourceRecordId, parentId), relationship));
      }
    }
    const matchEvidenceFamilies = [...new Set(source.match?.evidence?.map((item) => item.family) ?? [])].sort();
    const provenance = baseOperation(source, targetType, "record_provenance", { evidence: sorted(source.provenance), matchEvidenceFamilies, mappingWarnings: warnings, unsupportedFieldPaths: unsupported, unsupportedNormalizedFields }, sourceOps.map((operation) => operation.operationKey), false, true);
    sourceOps.push(revisionedOperation(operationKey("provenance", source.sourceRecordId), provenance));
    const outcome: ManifestOutcome = { sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, state: issues.some((issue) => issue.code === "relationship_unresolved" || issue.code === "field_conflict") ? "awaiting_review" : "ready", issues, candidates, match: source.match ? source.match as unknown as Record<string, unknown> : null, mappingWarnings: warnings, unsupportedFieldPaths: unsupported, operationKeys: sourceOps.map((operation) => operation.operationKey) };
    const policyOperations = sourceOps.map((operation) => ({
      ...operation,
      status: "pending",
    }));
    sourceOps.forEach((operation, index) => {
      operation.payload = {
        ...operation.payload,
        automaticReview: automaticReviewProof({
          outcome,
          operations: policyOperations,
          operation: policyOperations[index]!,
        }),
      };
    });
    operations.push(...sourceOps);
    outcomes.push(outcome);
  }
  const order = (operation: ManifestOperation) => operation.operationKey.startsWith("provenance:") ? rank.provenance : rank[operation.targetType] ?? 999;
  operations.sort((a, b) => order(a) - order(b) || a.operationKey.localeCompare(b.operationKey));
  outcomes.sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId)); diagnostics.sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId) || (a.path ?? "").localeCompare(b.path ?? ""));
  const digest = digestManifestRows(operations, outcomes);
  return { operations, outcomes, diagnostics, digest };
}
