import type { Decision } from "./review-command-service";
import type { MatchResult } from "./matching/match-result";
import {
  resolveContextClues,
  type ContextClueEvidence,
} from "./matching/context-clue-resolver";
import {
  assignmentTargetLabelsEqual,
  isAssignmentTargetEntityType,
  type AssignmentTargetEntityType,
  type ReviewSafeValue,
  type ReviewSourceRecord,
  type ReviewTargetProjection,
} from "./review-reader";

export const AUTOMATIC_REVIEW_POLICY_VERSION = "2026-08-12";

/** Reasons are deliberately bounded to review issue codes plus reliable identity. */
export type AutomaticReviewReason =
  | "ambiguous_match"
  | "field_conflict"
  | "relationship_unresolved"
  | "unassigned"
  | "unsupported_record"
  | "unsupported_field"
  | "reliable_identity";

export type AutomaticReviewProposal =
  | {
      kind: "decision";
      sourceRecordId: string;
      sourceVersionId: string;
      scope: Decision["scope"];
      decision: Decision["decision"];
      fieldName: string | null;
      relationshipSlot: string | null;
      targetEntityType: string | null;
      targetEntityId: string | null;
      reason: AutomaticReviewReason;
    }
  | {
      kind: "manual_review";
      sourceRecordId: string;
      sourceVersionId: string;
      reason: AutomaticReviewReason;
    };

export type AutomaticReviewResolutionSummary = {
  linkedExisting: number;
  importedNew: number;
  relationshipsAssigned: number;
  relationshipsOmitted: number;
  actValuesSelected: number;
  unsupportedIgnored: number;
  manualReview: number;
  decisionsCreatedOrReplayed: number;
};

export type AutomaticReviewIssue = {
  code: AutomaticReviewReason;
  reason?: string;
  relationshipSlot?: string;
  expectedParentTypes?: readonly string[];
  canImportStandalone?: boolean;
  targetEntityType?: string | null;
  targetEntityId?: string | null;
};

export type AutomaticReviewRelationshipIssue = AutomaticReviewIssue & {
  code: "relationship_unresolved" | "unassigned";
  relationshipSlot: string;
};

export type AutomaticReviewConflict = { fieldName: string };

export type AutomaticReviewRecord = {
  sourceRecordId: string;
  sourceVersionId: string;
  issues?: readonly AutomaticReviewIssue[];
  relationshipIssues?: readonly AutomaticReviewRelationshipIssue[];
  conflicts?: readonly AutomaticReviewConflict[];
  unsupportedFieldPaths?: readonly string[];
  match?: MatchResult | null;
  targetEntityType?: string | null;
  unsupportedRecord?: boolean;
};

const automaticReviewSafeDisplayBaseKeys = [
  "name", "displayName", "companyName", "opportunityName", "title", "subject",
  "fullName", "firstName", "lastName", "company", "organization", "organizationName",
  "contact", "contactName", "opportunity", "booking", "bookingName", "event", "eventName",
  "group", "groupName", "callingList", "callingListName", "activity", "activityName", "regarding",
  "email", "emailAddress", "phone", "businessPhone", "mobilePhone", "website", "address",
  "address1", "address2", "city", "state", "region", "postalCode", "zipCode", "country",
  "jobTitle", "stage", "status", "estimatedCloseDate", "description", "type", "startTime",
  "endTime", "occurredAt",
] as const;

type AutomaticReviewSafeDisplayBaseKey = typeof automaticReviewSafeDisplayBaseKeys[number];

export type AutomaticReviewSafeDisplayKey =
  | AutomaticReviewSafeDisplayBaseKey
  | Capitalize<AutomaticReviewSafeDisplayBaseKey>;

export type AutomaticReviewSafeDisplay = Readonly<
  Partial<Record<AutomaticReviewSafeDisplayKey, ReviewSafeValue>>
>;

export type AutomaticReviewSourceProjection = Pick<
  ReviewSourceRecord,
  "sourceRecordId" | "sourceVersionId" | "streamType"
> & {
  display: AutomaticReviewSafeDisplay;
  relationshipLabelsBySlot?: Readonly<
    Record<string, Readonly<Partial<Record<AssignmentTargetEntityType, string>>>>
  >;
};

export type AutomaticReviewContext = {
  sourceRecords: readonly AutomaticReviewSourceProjection[];
  targetsByEntityType: Readonly<
    Partial<Record<AssignmentTargetEntityType, readonly ReviewTargetProjection[]>>
  >;
};

export type AutomaticReviewInput = {
  records: readonly AutomaticReviewRecord[];
  context?: AutomaticReviewContext;
};

export type AutomaticReviewResolution = {
  proposals: AutomaticReviewProposal[];
  summary: AutomaticReviewResolutionSummary;
};

const emptySummary = (): AutomaticReviewResolutionSummary => ({
  linkedExisting: 0,
  importedNew: 0,
  relationshipsAssigned: 0,
  relationshipsOmitted: 0,
  actValuesSelected: 0,
  unsupportedIgnored: 0,
  manualReview: 0,
  decisionsCreatedOrReplayed: 0,
});

const issueReason = (issue: AutomaticReviewIssue): AutomaticReviewReason => issue.code;

function decision(
  source: AutomaticReviewRecord,
  values: Omit<Extract<AutomaticReviewProposal, { kind: "decision" }>, "kind" | "sourceRecordId" | "sourceVersionId">,
): Extract<AutomaticReviewProposal, { kind: "decision" }> {
  return { kind: "decision", sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, ...values };
}

function manualReview(source: AutomaticReviewRecord, reason: AutomaticReviewReason): Extract<AutomaticReviewProposal, { kind: "manual_review" }> {
  return { kind: "manual_review", sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersionId, reason };
}

function relationshipIssues(source: AutomaticReviewRecord): AutomaticReviewRelationshipIssue[] {
  const issues = [
    ...(source.relationshipIssues ?? []),
    ...(source.issues ?? [])
      .filter((issue): issue is AutomaticReviewIssue & { code: "relationship_unresolved" | "unassigned" } => issue.code === "relationship_unresolved" || issue.code === "unassigned")
      .map((issue) => ({ ...issue, relationshipSlot: typeof issue.relationshipSlot === "string" ? issue.relationshipSlot.trim() : "" })),
  ].map((issue) => ({
    ...issue,
    relationshipSlot: typeof issue.relationshipSlot === "string" ? issue.relationshipSlot.trim() : "",
    reason: typeof issue.reason === "string" ? issue.reason.trim() : undefined,
    expectedParentTypes: [...new Set(
      (issue.expectedParentTypes ?? []).map((value) => value.trim()).filter(Boolean),
    )].sort(),
    canImportStandalone: issue.canImportStandalone === true,
    targetEntityType: issue.targetEntityType?.trim() || null,
    targetEntityId: issue.targetEntityId?.trim() || null,
  }));
  const unique = new Map<string, AutomaticReviewRelationshipIssue>();
  const signature = (issue: AutomaticReviewRelationshipIssue) => JSON.stringify({
    code: issue.code,
    reason: issue.reason ?? null,
    expectedParentTypes: issue.expectedParentTypes ?? [],
    canImportStandalone: issue.canImportStandalone === true,
    targetEntityType: issue.targetEntityType ?? null,
    targetEntityId: issue.targetEntityId ?? null,
  });
  for (const issue of issues) {
    const key = issue.relationshipSlot;
    const current = unique.get(key);
    if (!current) {
      unique.set(key, issue);
      continue;
    }
    if (signature(current) !== signature(issue)) {
      const code = [current.code, issue.code].sort()[0]!;
      const reason = [current.reason ?? "", issue.reason ?? ""].sort()[0] || undefined;
      unique.set(key, {
        code,
        reason,
        relationshipSlot: issue.relationshipSlot,
        expectedParentTypes: [],
        canImportStandalone: false,
        targetEntityType: null,
        targetEntityId: null,
      });
    }
  }
  return [...unique.values()].sort((left, right) =>
    left.relationshipSlot.localeCompare(right.relationshipSlot)
    || left.code.localeCompare(right.code)
    || (left.reason ?? "").localeCompare(right.reason ?? ""),
  );
}

function fieldNames(source: AutomaticReviewRecord): string[] {
  const names = [
    ...(source.conflicts ?? []).map((conflict) => conflict.fieldName),
    ...(source.issues ?? [])
      .filter((issue) => issue.code === "field_conflict" && typeof issue.reason === "string")
      .map((issue) => issue.reason!),
  ];
  return [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort();
}

function isUnsupportedRecord(source: AutomaticReviewRecord): boolean {
  return source.unsupportedRecord === true || (source.issues ?? []).some((issue) => issue.code === "unsupported_record");
}

function hasAmbiguousIdentity(source: AutomaticReviewRecord): boolean {
  return source.match?.kind === "ambiguous" || (source.issues ?? []).some((issue) => issue.code === "ambiguous_match");
}

const identityTypeByStream: Readonly<Record<string, AssignmentTargetEntityType>> = {
  company: "organization",
  contact: "contact",
  opportunity: "booking",
  group: "calling_list",
  activity: "activity",
  note: "activity",
  history: "activity",
};

const automaticReviewTargetLimit = 25;
const automaticReviewRelationshipLabelLimit = 25;

type ContextTargetSelection =
  | { kind: "resolved"; target: ReviewTargetProjection }
  | { kind: "none" }
  | { kind: "unsafe" };

type SourceProjectionSelection =
  | { kind: "resolved"; source: AutomaticReviewSourceProjection }
  | { kind: "none" }
  | { kind: "unsafe" };

const clean = (value: unknown): string => typeof value === "string" ? value.trim() : "";

const safeDisplayKeys = new Set<string>(
  automaticReviewSafeDisplayBaseKeys.map((key) => key.toLowerCase()),
);

function isSafeScalar(value: unknown): value is ReviewSafeValue {
  return value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function hasSafeProjectionShape(source: AutomaticReviewSourceProjection): boolean {
  if (!source.display || typeof source.display !== "object" || Array.isArray(source.display)) return false;
  for (const [key, value] of Object.entries(source.display)) {
    if (!safeDisplayKeys.has(key.toLowerCase()) || !isSafeScalar(value)) return false;
  }
  const relationships = source.relationshipLabelsBySlot;
  if (relationships === undefined) return true;
  if (!relationships || typeof relationships !== "object" || Array.isArray(relationships)) return false;
  const slots = Object.entries(relationships);
  if (slots.length > automaticReviewRelationshipLabelLimit) return false;
  return slots.every(([slot, labels]) =>
    Boolean(slot.trim())
    && Boolean(labels)
    && typeof labels === "object"
    && !Array.isArray(labels)
    && Object.entries(labels).every(([entityType, label]) =>
      isAssignmentTargetEntityType(entityType)
      && typeof label === "string"
      && Boolean(label.trim())
    )
  );
}

function displayValues(
  values: Readonly<Record<string, unknown>>,
  names: readonly string[],
): string[] {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const selected: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (wanted.has(name.toLowerCase())) {
      const text = clean(value);
      if (text) selected.push(text);
    }
  }
  return selected;
}

function displayValue(
  values: Readonly<Record<string, unknown>>,
  names: readonly string[],
): string {
  return displayValues(values, names)[0] ?? "";
}

function sourceIdentityLabel(source: AutomaticReviewSourceProjection): string {
  if (source.streamType.toLowerCase() === "contact") {
    const fullName = displayValue(source.display, ["fullName", "displayName", "name"]);
    if (fullName && fullName.trim().split(/\s+/).filter(Boolean).length >= 2) return fullName;
    const firstName = displayValue(source.display, ["firstName"]);
    const lastName = displayValue(source.display, ["lastName"]);
    return firstName && lastName ? `${firstName} ${lastName}`.trim() : "";
  }
  return displayValue(source.display, [
    "name",
    "displayName",
    "companyName",
    "opportunityName",
    "title",
    "subject",
  ]);
}

function relationshipLabel(
  source: AutomaticReviewSourceProjection,
  targetEntityType: AssignmentTargetEntityType,
): string {
  const fieldsByType: Readonly<Record<AssignmentTargetEntityType, readonly string[]>> = {
    organization: ["company", "companyName", "organization", "organizationName"],
    contact: ["contact", "contactName"],
    booking: ["opportunity", "opportunityName", "booking", "bookingName", "event", "eventName"],
    calling_list: ["group", "groupName", "callingList", "callingListName"],
    activity: ["activity", "activityName", "regarding"],
  };
  return displayValue(source.display, fieldsByType[targetEntityType]);
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizedPhone(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizedDirectValues(
  values: Readonly<Record<string, unknown>>,
  names: readonly string[],
  normalize: (value: string) => string,
): Set<string> {
  return new Set(displayValues(values, names).map(normalize).filter(Boolean));
}

function directValuesConflict(source: Set<string>, target: Set<string>): boolean {
  if (source.size > 1 || target.size > 1) return true;
  if (!source.size || !target.size) return false;
  return source.values().next().value !== target.values().next().value;
}

function directContactConflict(
  source: AutomaticReviewSourceProjection,
  target: ReviewTargetProjection,
): boolean {
  const sourceEmail = normalizedDirectValues(source.display, ["email", "emailAddress"], normalizedEmail);
  const targetEmail = normalizedDirectValues(target.fields ?? {}, ["email", "emailAddress"], normalizedEmail);
  if (directValuesConflict(sourceEmail, targetEmail)) return true;
  const sourcePhone = normalizedDirectValues(source.display, ["phone", "businessPhone", "mobilePhone"], normalizedPhone);
  const targetPhone = normalizedDirectValues(target.fields ?? {}, ["phone", "businessPhone", "mobilePhone"], normalizedPhone);
  return directValuesConflict(sourcePhone, targetPhone);
}

function contextTargets(
  context: AutomaticReviewContext,
  entityType: AssignmentTargetEntityType,
): { targets: ReviewTargetProjection[]; unsafe: boolean } {
  const supplied = context.targetsByEntityType[entityType] ?? [];
  if (supplied.length > automaticReviewTargetLimit) return { targets: [], unsafe: true };
  const targets = new Map<string, ReviewTargetProjection>();
  let unsafe = false;
  for (const target of supplied) {
    const id = target.id.trim();
    if (!id || target.entityType !== entityType) {
      unsafe = true;
      continue;
    }
    const current = targets.get(id);
    if (current) {
      unsafe = true;
      continue;
    }
    targets.set(id, { ...target, id });
  }
  return {
    targets: [...targets.values()].sort((left, right) => left.id.localeCompare(right.id)),
    unsafe,
  };
}

function sourceProjection(
  source: AutomaticReviewRecord,
  context: AutomaticReviewContext,
): SourceProjectionSelection {
  const matches = context.sourceRecords.filter((candidate) =>
    candidate.sourceRecordId === source.sourceRecordId
    && candidate.sourceVersionId === source.sourceVersionId
  );
  if (!matches.length) return { kind: "none" };
  if (matches.length !== 1 || !hasSafeProjectionShape(matches[0]!)) return { kind: "unsafe" };
  return { kind: "resolved", source: matches[0]! };
}

function evidenceSelection(
  evidence: readonly ContextClueEvidence[],
  entityType: AssignmentTargetEntityType,
  targets: readonly ReviewTargetProjection[],
  source: AutomaticReviewSourceProjection,
): ContextTargetSelection {
  if (!evidence.length) return { kind: "none" };
  const targetById = new Map(targets.map((target) => [target.id, target]));
  if (evidence.some((clue) =>
    clue.targetEntityType !== entityType
    || !targetById.has(clue.targetEntityId.trim())
  )) return { kind: "unsafe" };
  const resolution = resolveContextClues(evidence);
  if (resolution.kind === "ambiguous") return { kind: "unsafe" };
  if (resolution.kind !== "resolved" || resolution.targetEntityType !== entityType) return { kind: "none" };
  const target = targetById.get(resolution.targetEntityId);
  if (!target || directContactConflict(source, target)) return { kind: "unsafe" };
  return { kind: "resolved", target };
}

function reliableIdentityTarget(
  source: AutomaticReviewRecord,
  context: AutomaticReviewContext,
): ContextTargetSelection {
  if (source.match?.kind === "ambiguous" && source.match.overflow) return { kind: "unsafe" };
  const sourceSelection = sourceProjection(source, context);
  if (sourceSelection.kind !== "resolved") return sourceSelection;
  const projection = sourceSelection.source;
  const requestedType = source.targetEntityType?.trim()
    || identityTypeByStream[projection.streamType.toLowerCase()];
  if (!requestedType || !isAssignmentTargetEntityType(requestedType)) return { kind: "none" };
  const { targets, unsafe } = contextTargets(context, requestedType);
  if (unsafe) return { kind: "unsafe" };
  const exactMatch = source.match?.kind === "exact" ? source.match : null;
  const trustedExistingReason = exactMatch
    && ["exact_external_link", "manual_assignment", "manual_review"].includes(exactMatch.reason ?? "");
  if (trustedExistingReason && exactMatch) {
    const target = targets.find((candidate) => candidate.id === exactMatch.localId.trim());
    return target ? { kind: "resolved", target } : { kind: "unsafe" };
  }
  const label = sourceIdentityLabel(projection);
  const exactTargets = label
    ? targets.filter((target) => assignmentTargetLabelsEqual(target.label, label))
    : [];
  if (exactTargets.length > 1) return { kind: "unsafe" };

  const evidence = source.match?.evidence ?? [];
  if (exactTargets.length === 1) {
    const target = exactTargets[0]!;
    if (
      directContactConflict(projection, target)
      || (source.match?.kind === "exact" && source.match.localId.trim() !== target.id)
      || evidence.some((clue) => clue.targetEntityType !== requestedType || clue.targetEntityId.trim() !== target.id)
    ) return { kind: "unsafe" };
    return { kind: "resolved", target };
  }

  // Context clue family `web_identity` is the canonical website/company proof.
  const selected = evidenceSelection(evidence, requestedType, targets, projection);
  if (selected.kind !== "none") return selected;
  return source.match?.kind === "exact" ? { kind: "unsafe" } : { kind: "none" };
}

function contextualRelationshipTarget(
  source: AutomaticReviewRecord,
  issue: AutomaticReviewRelationshipIssue,
  context: AutomaticReviewContext,
  repeatedExpectedTypes: ReadonlySet<AssignmentTargetEntityType>,
): ContextTargetSelection {
  const sourceSelection = sourceProjection(source, context);
  if (sourceSelection.kind !== "resolved") return sourceSelection;
  const projection = sourceSelection.source;
  const expectedTypes = [...new Set(issue.expectedParentTypes ?? [])]
    .filter(isAssignmentTargetEntityType)
    .sort();
  if (!expectedTypes.length) return { kind: "none" };
  const candidates: ReviewTargetProjection[] = [];
  for (const entityType of expectedTypes) {
    const { targets, unsafe } = contextTargets(context, entityType);
    if (unsafe) return { kind: "unsafe" };
    const slotLabel = projection.relationshipLabelsBySlot?.[issue.relationshipSlot]?.[entityType]?.trim() ?? "";
    const label = slotLabel || (repeatedExpectedTypes.has(entityType) ? "" : relationshipLabel(projection, entityType));
    if (!label) continue;
    candidates.push(...targets.filter((target) => assignmentTargetLabelsEqual(target.label, label)));
  }
  if (candidates.length > 1) return { kind: "unsafe" };
  if (candidates.length === 1) {
    return { kind: "resolved", target: candidates[0]! };
  }
  return { kind: "none" };
}

function addSummary(summary: AutomaticReviewResolutionSummary, proposal: AutomaticReviewProposal): void {
  if (proposal.kind === "manual_review") {
    summary.manualReview += 1;
    return;
  }
  summary.decisionsCreatedOrReplayed += 1;
  if (proposal.scope === "duplicate_identity" && proposal.decision === "link_existing") summary.linkedExisting += 1;
  if (proposal.scope === "duplicate_identity" && proposal.decision === "keep_separate") summary.importedNew += 1;
  if (proposal.scope === "relationship" && proposal.decision === "assign_parent") summary.relationshipsAssigned += 1;
  if (proposal.scope === "relationship" && proposal.decision === "keep_unlinked") summary.relationshipsOmitted += 1;
  if (proposal.scope === "field_conflict" && proposal.decision === "use_source") summary.actValuesSelected += 1;
  if (proposal.scope === "unsupported_record" && proposal.decision === "ignore_source") summary.unsupportedIgnored += 1;
}

/**
 * Produces review decisions without touching a manifest, database, or target record.
 * Records and relationship slots are sorted so callers receive the same result for
 * equivalent inputs in a different order.
 */
export function proposeAutomaticReview(input: AutomaticReviewInput): AutomaticReviewResolution {
  const proposals: AutomaticReviewProposal[] = [];
  const summary = emptySummary();
  const records = [...input.records].sort((left, right) =>
    left.sourceRecordId.localeCompare(right.sourceRecordId) || left.sourceVersionId.localeCompare(right.sourceVersionId),
  );

  for (const source of records) {
    // Required relationships are evaluated before the broad ambiguous-identity fallback,
    // but every stable slot remains independent from a reliable source-identity decision.
    const slots = relationshipIssues(source);
    const relationshipTypeCounts = new Map<AssignmentTargetEntityType, number>();
    for (const issue of slots) {
      for (const entityType of [...new Set(issue.expectedParentTypes ?? [])].filter(isAssignmentTargetEntityType)) {
        relationshipTypeCounts.set(entityType, (relationshipTypeCounts.get(entityType) ?? 0) + 1);
      }
    }
    const repeatedRelationshipTypes = new Set(
      [...relationshipTypeCounts].filter(([, count]) => count > 1).map(([entityType]) => entityType),
    );
    let blockedByRelationship = false;
    for (const issue of slots) {
      let targetEntityId = issue.targetEntityId?.trim() || "";
      let targetEntityType = issue.targetEntityType?.trim() || "";
      let targetIsUnsafe = false;
      const suppliedTarget = Boolean(targetEntityId || targetEntityType);
      if (suppliedTarget) {
        const targetTypeIsExpected = Boolean(targetEntityType)
          && (issue.expectedParentTypes ?? []).includes(targetEntityType);
        targetIsUnsafe = !input.context || !(targetEntityId && targetTypeIsExpected);
        if (!targetIsUnsafe && input.context) {
          if (!isAssignmentTargetEntityType(targetEntityType)) {
            targetIsUnsafe = true;
          } else {
            const visible = contextTargets(input.context, targetEntityType);
            targetIsUnsafe = visible.unsafe || !visible.targets.some((target) => target.id === targetEntityId);
          }
        }
      } else if (input.context) {
        const selected = contextualRelationshipTarget(source, issue, input.context, repeatedRelationshipTypes);
        if (selected.kind === "resolved") {
          targetEntityId = selected.target.id;
          targetEntityType = selected.target.entityType;
        } else if (selected.kind === "unsafe") {
          targetIsUnsafe = true;
        }
      }
      const proposal = !issue.relationshipSlot
        ? manualReview(source, issueReason(issue))
        : targetEntityId && targetEntityType && !targetIsUnsafe
        ? decision(source, {
            scope: "relationship",
            decision: "assign_parent",
            fieldName: null,
            relationshipSlot: issue.relationshipSlot,
            targetEntityType,
            targetEntityId,
            reason: issueReason(issue),
          })
          : targetIsUnsafe
            ? manualReview(source, issueReason(issue))
            : issue.canImportStandalone === true
              ? decision(source, {
                  scope: "relationship",
                  decision: "keep_unlinked",
                  fieldName: null,
                  relationshipSlot: issue.relationshipSlot,
                  targetEntityType: null,
                  targetEntityId: null,
                  reason: issueReason(issue),
                })
              : manualReview(source, issueReason(issue));
      proposals.push(proposal);
      addSummary(summary, proposal);
      if (proposal.kind === "manual_review") blockedByRelationship = true;
    }

    const addUnsupportedRecordDecision = () => {
      if (!isUnsupportedRecord(source)) return;
      const proposal = decision(source, {
        scope: "unsupported_record",
        decision: "ignore_source",
        fieldName: null,
        relationshipSlot: null,
        targetEntityType: null,
        targetEntityId: null,
        reason: "unsupported_record",
      });
      proposals.push(proposal);
      addSummary(summary, proposal);
    };

    const identityDecisionRequired = hasAmbiguousIdentity(source)
      || (source.issues ?? []).some((issue) =>
        issue.code === "unassigned" && !clean(issue.relationshipSlot));
    const hasIdentityQuestion = source.match?.kind === "exact" || identityDecisionRequired;
    const contextualIdentity = hasIdentityQuestion
      ? input.context
        ? reliableIdentityTarget(source, input.context)
        : source.match?.kind === "exact"
          ? { kind: "unsafe" as const }
          : null
      : null;
    const reliableTarget = contextualIdentity?.kind === "resolved"
      ? {
          targetEntityType: contextualIdentity.target.entityType,
          targetEntityId: contextualIdentity.target.id,
        }
      : null;

    if (reliableTarget) {
      if (identityDecisionRequired) {
        const proposal = decision(source, {
          scope: "duplicate_identity",
          decision: "link_existing",
          fieldName: null,
          relationshipSlot: null,
          targetEntityType: reliableTarget.targetEntityType,
          targetEntityId: reliableTarget.targetEntityId,
          reason: "reliable_identity",
        });
        proposals.push(proposal);
        addSummary(summary, proposal);
      }

      for (const fieldName of fieldNames(source)) {
        const fieldProposal = decision(source, {
          scope: "field_conflict",
          decision: "use_source",
          fieldName,
          relationshipSlot: null,
          targetEntityType: reliableTarget.targetEntityType,
          targetEntityId: reliableTarget.targetEntityId,
          reason: "field_conflict",
        });
        proposals.push(fieldProposal);
        addSummary(summary, fieldProposal);
      }
      if (!blockedByRelationship) addUnsupportedRecordDecision();
      continue;
    }

    if (contextualIdentity?.kind === "unsafe") {
      const proposal = manualReview(source, "ambiguous_match");
      proposals.push(proposal);
      addSummary(summary, proposal);
      continue;
    }

    if (blockedByRelationship) continue;

    if (hasAmbiguousIdentity(source)) {
      const proposal = decision(source, {
        scope: "duplicate_identity",
        decision: "keep_separate",
        fieldName: null,
        relationshipSlot: null,
        targetEntityType: null,
        targetEntityId: null,
        reason: "ambiguous_match",
      });
      proposals.push(proposal);
      addSummary(summary, proposal);
    }
    addUnsupportedRecordDecision();
    // unsupported_field is intentionally diagnostic-only; it has no proposal.
  }

  summary.manualReview = new Set(proposals
    .filter((proposal): proposal is Extract<AutomaticReviewProposal, { kind: "manual_review" }> => proposal.kind === "manual_review")
    .map((proposal) => `${proposal.sourceRecordId}\u0000${proposal.sourceVersionId}`)).size;
  return { proposals, summary };
}
