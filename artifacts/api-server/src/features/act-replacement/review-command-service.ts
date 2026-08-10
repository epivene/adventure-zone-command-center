import type { ActApplyService, ApplyBatchStatus } from "./apply-service";
import { ActApprovalService, type ApprovalClosure, type ApprovalRepository } from "./approval-service";
import { stableRelationshipIssues, type ActOrganizeManifest, type ManifestReviewIssue } from "./manifest-builder";
import type { ConflictReviewToken } from "./review-reader";
import { fingerprintSourceContent } from "./source-fingerprint";

export type Assignment = { id: string; sourceRecordId: string; targetEntityType: string; targetEntityId: string; role: string; isPrimary: boolean; manualAuthority: true; assignedBy: string; sourceVersionId: string; active: boolean; supersededAt?: string };
export type Decision = { id: string; sourceRecordId: string; sourceVersionId: string; scope: "duplicate_identity" | "field_conflict" | "relationship" | "unsupported_record"; decision: "link_existing" | "keep_separate" | "keep_local" | "use_source" | "assign_parent" | "keep_unlinked" | "ignore_source"; requestKey: string; fieldName: string | null; relationshipSlot?: string | null; targetEntityType: string | null; targetEntityId: string | null; reviewedSourceValue?: unknown; reviewedSourceValueFingerprint?: string | null; reviewedLocalValue?: unknown; reviewedLocalValueFingerprint?: string | null; decidedBy: string; active: boolean; };
export type SaveAssignmentInput = Omit<Assignment, "id" | "active"> & { requestKey: string };
export type SaveDecisionInput = Omit<Decision, "id" | "active"> & {
  runId?: string;
  requestFingerprint?: string;
  reviewToken?: ConflictReviewToken;
};
export type BulkReviewDecisionInput = {
  runId: string;
  expectedManifestDigest: string;
  scope: "duplicate_identity" | "field_conflict" | "relationship" | "unsupported_record";
  decision: "link_existing" | "keep_separate" | "keep_local" | "use_source" | "keep_unlinked" | "ignore_source";
  fieldName: string | null;
  requestedBy: string;
  requestKey: string;
  selections: readonly { sourceRecordId: string; sourceVersionId: string; reviewToken?: ConflictReviewToken }[];
};
export type SaveDecisionsAndRebuildInput = {
  expectedManifestDigest: string;
  owner: string;
  requestKey: string;
  requestFingerprint: string;
  scope: BulkReviewDecisionInput["scope"];
  decision: BulkReviewDecisionInput["decision"];
  fieldName: string | null;
  selections: BulkReviewDecisionInput["selections"];
};
export type BulkReviewDecisionResult = {
  decisions: Decision[];
  manifestDigest: string;
  reviewedOperationIds: string[];
};
export type SaveDecisionsAndRebuildResult = BulkReviewDecisionResult;
export type BulkReviewRequestLookup = { owner: string; requestKey: string; requestFingerprint: string };
type ReviewSourceState = { sourceVersionId: string; streamType?: string; localFields?: Record<string, unknown> };
export type ConflictReviewState = {
  sourceRecordId: string;
  sourceVersionId: string;
  fieldName: string;
  sourceValue: unknown;
  targetEntityType: string;
  targetEntityId: string;
  localValue: unknown;
};

export type ReviewCommandStore = {
  getManifest(runId: string): Promise<ActOrganizeManifest | null>;
  organize(runId: string): Promise<{ status: "ready_to_apply" | "complete_with_issues"; manifest: ActOrganizeManifest }>;
  startOrganize(runId: string): Promise<{ status: "organizing" }>;
  getSource(sourceRecordId: string): Promise<ReviewSourceState | null>;
  listAssignments(sourceRecordId: string): Promise<Assignment[]>;
  saveAssignment(input: SaveAssignmentInput): Promise<Assignment>;
  saveAssignmentAndRebuild(runId: string, input: SaveAssignmentInput): Promise<Assignment>;
  supersedeAssignment(sourceRecordId: string, assignmentId: string, actor: string, expectedSourceVersionId: string, requestKey: string): Promise<Assignment>;
  supersedeAssignmentAndRebuild(runId: string, sourceRecordId: string, assignmentId: string, actor: string, expectedSourceVersionId: string, requestKey: string): Promise<Assignment>;
  listDecisions(sourceRecordId: string): Promise<Decision[]>;
  saveDecision(input: SaveDecisionInput): Promise<Decision>;
  saveDecisionAndRebuild(runId: string, input: SaveDecisionInput): Promise<Decision>;
  getBulkDecisionRequest(runId: string, input: BulkReviewRequestLookup): Promise<BulkReviewDecisionResult | null>;
  saveDecisionsAndRebuild(runId: string, input: SaveDecisionsAndRebuildInput): Promise<SaveDecisionsAndRebuildResult>;
  supersedeDecision(sourceRecordId: string, decisionId: string, actor: string, requestKey: string): Promise<Decision>;
  supersedeDecisionAndRebuild(runId: string, sourceRecordId: string, decisionId: string, actor: string, requestKey: string): Promise<Decision>;
  getApprovalRepository(): ApprovalRepository;
  getApplyService(): ActApplyService;
  /** Production adapters must durably rebuild after every active review change. */
  rebuildAfterReviewChange(runId: string): Promise<{ status: string }>;
};

const assignmentTypes = new Set(["organization", "contact", "booking", "calling_list", "activity"]);
const decisionsByScope: Record<string, readonly string[]> = {
  duplicate_identity: ["link_existing", "keep_separate"],
  field_conflict: ["keep_local", "use_source"],
  relationship: ["assign_parent", "keep_unlinked", "ignore_source"],
  unsupported_record: ["ignore_source"],
};
const bulkDecisionsByScope: Record<string, readonly string[]> = {
  duplicate_identity: ["link_existing", "keep_separate"],
  field_conflict: ["keep_local", "use_source"],
  relationship: ["keep_unlinked", "ignore_source"],
  unsupported_record: ["ignore_source"],
};
const parentDecisionWords = new Set(["assign", "link_parent", "unlink_parent"]);
const identityTargetByStream: Readonly<Record<string, string>> = {
  company: "organization",
  contact: "contact",
  opportunity: "booking",
  group: "calling_list",
  activity: "activity",
  note: "activity",
  history: "activity",
};
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function fail(code: string, status = 400): never { throw Object.assign(new Error(code), { code, status }); }

const contextClueFamilies = new Set(["identity", "direct_contact", "web_identity", "location", "archive_relationship", "event_context", "narrative_context"]);
function contextIdentityRecommendation(outcome: ActOrganizeManifest["outcomes"][number], source: ReviewSourceState) {
  const match = object(outcome.match);
  const targetEntityId = clean(match.localId);
  const targetEntityType = identityTargetByStream[clean(source.streamType).toLowerCase()];
  if (match.kind !== "exact" || !targetEntityId || !targetEntityType || !Array.isArray(match.evidence)) return null;
  const families = new Set<string>();
  let authoritative = false;
  for (const rawEvidence of match.evidence) {
    const evidence = object(rawEvidence);
    if (evidence.targetEntityId !== targetEntityId || evidence.targetEntityType !== targetEntityType) return null;
    if (typeof evidence.family !== "string" || !contextClueFamilies.has(evidence.family)) return null;
    families.add(evidence.family);
    if (evidence.authority === "authoritative") authoritative = true;
  }
  if (!authoritative && families.size < 2) return null;
  return {
    targetEntityType,
    targetEntityId,
    signature: `${targetEntityType}\u0000${authoritative ? "authoritative" : "two_independent_clues"}\u0000${[...families].sort().join(",")}`,
  };
}
export function decisionWithReviewedProof(input: SaveDecisionInput, state: ConflictReviewState): SaveDecisionInput {
  const token = input.reviewToken;
  if (!token) fail("review_token_required", 409);
  if (
    token.sourceRecordId !== state.sourceRecordId
    || token.sourceVersionId !== state.sourceVersionId
    || input.sourceVersionId !== state.sourceVersionId
    || token.fieldName !== state.fieldName
    || input.fieldName !== state.fieldName
    || token.targetEntityType !== state.targetEntityType
    || token.targetEntityId !== state.targetEntityId
    || token.sourceValueFingerprint !== fingerprintSourceContent({ value: state.sourceValue })
    || token.localValueFingerprint !== fingerprintSourceContent({ value: state.localValue })
  ) fail("stale_review_token", 409);
  const { reviewToken: _reviewToken, ...decision } = input;
  return {
    ...decision,
    targetEntityType: state.targetEntityType,
    targetEntityId: state.targetEntityId,
    reviewedSourceValue: state.sourceValue,
    reviewedSourceValueFingerprint: token.sourceValueFingerprint,
    reviewedLocalValue: state.localValue,
    reviewedLocalValueFingerprint: token.localValueFingerprint,
  };
}
export function bulkReviewRequestFingerprint(input: Pick<BulkReviewDecisionInput, "scope" | "decision" | "fieldName" | "selections">): string {
  return fingerprintSourceContent({
    scope: input.scope,
    decision: input.decision,
    fieldName: input.fieldName,
    selections: [...input.selections]
      .map(({ sourceRecordId, sourceVersionId, reviewToken }) => ({ sourceRecordId, sourceVersionId, ...(reviewToken ? { reviewToken } : {}) }))
      .sort((left, right) => left.sourceRecordId.localeCompare(right.sourceRecordId) || left.sourceVersionId.localeCompare(right.sourceVersionId)),
  });
}
export function individualDecisionRequestFingerprint(input: Pick<SaveDecisionInput,
  "runId" | "sourceRecordId" | "sourceVersionId" | "scope" | "decision" | "fieldName" | "relationshipSlot" | "targetEntityType" | "targetEntityId" | "decidedBy" | "reviewToken"
>): string {
  return fingerprintSourceContent({
    runId: clean(input.runId),
    sourceRecordId: input.sourceRecordId,
    sourceVersionId: input.sourceVersionId,
    scope: input.scope,
    decision: input.decision,
    fieldName: input.scope === "field_conflict" ? input.fieldName : null,
    relationshipSlot: input.scope === "relationship" ? input.relationshipSlot ?? null : null,
    targetEntityType: input.scope === "relationship" || input.scope === "duplicate_identity" ? input.targetEntityType ?? null : null,
    targetEntityId: input.scope === "relationship" || input.scope === "duplicate_identity" ? input.targetEntityId ?? null : null,
    decidedBy: clean(input.decidedBy),
    reviewToken: input.reviewToken ?? null,
  });
}

export function decisionSupersessionRequestFingerprint(input: {
  sourceRecordId: string;
  decisionId: string;
  actor: string;
}): string {
  return fingerprintSourceContent({
    operation: "supersede_decision",
    sourceRecordId: input.sourceRecordId,
    decisionId: input.decisionId,
    actor: clean(input.actor),
  });
}

export function validateIndividualDecisionAgainstCurrentState(
  input: SaveDecisionInput,
  manifest: ActOrganizeManifest,
  source: ReviewSourceState,
): { relationshipIssue?: ManifestReviewIssue } {
  const outcome = manifest.outcomes.find((candidate) => candidate.sourceRecordId === input.sourceRecordId);
  if (!outcome) fail("decision_not_applicable", 409);
  if (source.sourceVersionId !== input.sourceVersionId || outcome.sourceVersionId !== input.sourceVersionId)
    fail("stale_source_version", 409);
  const hasTargetType = Boolean(clean(input.targetEntityType));
  const hasTargetId = Boolean(clean(input.targetEntityId));

  if (input.scope === "duplicate_identity") {
    const recommendation = contextIdentityRecommendation(outcome, source);
    if (recommendation) {
      if (input.fieldName || input.relationshipSlot) fail("decision_field_not_allowed", 409);
      if (input.decision === "keep_separate") {
        if (hasTargetType || hasTargetId) fail("decision_target_not_allowed", 409);
        return {};
      }
      if (input.targetEntityType !== recommendation.targetEntityType || input.targetEntityId !== recommendation.targetEntityId)
        fail("invalid_duplicate_target", 409);
      return {};
    }
    const ambiguous = outcome.issues.some((issue) => issue.code === "ambiguous_match");
    const unassigned = outcome.issues.some((issue) => issue.code === "unassigned");
    if (input.fieldName || input.relationshipSlot) fail("decision_field_not_allowed", 409);
    if (input.decision === "keep_separate") {
      if (!ambiguous) fail("decision_not_applicable", 409);
      if (hasTargetType || hasTargetId) fail("decision_target_not_allowed", 409);
      return {};
    }
    if (!ambiguous && !unassigned) fail("decision_not_applicable", 409);
    if (!hasTargetType || !hasTargetId || identityTargetByStream[clean(source.streamType).toLowerCase()] !== input.targetEntityType)
      fail("invalid_duplicate_target", 409);
    return {};
  }

  if (input.scope === "field_conflict") {
    if (!clean(input.fieldName) || !outcome.issues.some((issue) => issue.code === "field_conflict" && issue.reason === input.fieldName))
      fail("decision_not_applicable", 409);
    if (input.relationshipSlot || (input.decision !== "use_source" && (hasTargetType || hasTargetId))) fail("decision_target_not_allowed", 409);
    return {};
  }

  if (input.scope === "unsupported_record") {
    if (!outcome.issues.some((issue) => issue.code === "unsupported_record")) fail("decision_not_applicable", 409);
    if (input.fieldName || input.relationshipSlot || hasTargetType || hasTargetId) fail("decision_target_not_allowed", 409);
    return {};
  }

  const relationshipIssue = stableRelationshipIssues(input.sourceRecordId, input.sourceVersionId, outcome.issues)
    .find((issue) =>
      (issue.code === "relationship_unresolved" || issue.code === "unassigned")
      && issue.relationshipSlot === clean(input.relationshipSlot));
  if (!relationshipIssue) fail("relationship_issue_not_found", 409);
  if (input.fieldName) fail("decision_field_not_allowed", 409);
  const allowedTypes = new Set(relationshipIssue.expectedParentTypes ?? []);
  if (input.decision === "assign_parent") {
    if (!hasTargetType || !hasTargetId || !allowedTypes.has(input.targetEntityType!)) fail("invalid_relationship_parent", 409);
  } else {
    if (hasTargetId || (hasTargetType && !allowedTypes.has(input.targetEntityType!))) fail("decision_target_not_allowed", 409);
    if (input.decision === "keep_unlinked" && relationshipIssue.canImportStandalone !== true)
      fail("standalone_import_not_supported", 409);
  }
  return { relationshipIssue };
}
export function reviewedOperationIds(manifest: ActOrganizeManifest, decisions: readonly Decision[]): string[] {
  const selectedDecision = new Set(decisions
    .filter((decision) => decision.decision === "use_source" && decision.fieldName)
    .map((decision) => `${decision.sourceRecordId}\u0000${decision.sourceVersionId}\u0000${decision.fieldName}`));
  return manifest.operations
    .filter((operation) => operation.action === "overwrite_reviewed" && selectedDecision.has(`${operation.sourceRecordId}\u0000${operation.sourceVersionId}\u0000${clean(operation.payload.fieldName)}`))
    .map((operation) => operation.operationKey);
}

export function prepareBulkReviewDecisions(
  input: Pick<SaveDecisionsAndRebuildInput, "scope" | "decision" | "fieldName" | "selections">,
  manifest: ActOrganizeManifest,
  sourceById: ReadonlyMap<string, ReviewSourceState>,
): Array<Omit<SaveDecisionInput, "decidedBy" | "requestKey">> {
  const outcomeBySource = new Map(manifest.outcomes.map((outcome) => [outcome.sourceRecordId, outcome]));
  for (const selection of input.selections) {
    const source = sourceById.get(selection.sourceRecordId);
    if (!source) fail("run_not_found", 404);
    const outcome = outcomeBySource.get(selection.sourceRecordId);
    if (source.sourceVersionId !== selection.sourceVersionId || outcome?.sourceVersionId !== selection.sourceVersionId)
      fail("stale_source_version", 409);
  }

  const homogeneity: string[] = [];
  const decisions = input.selections.map((selection) => {
    const outcome = outcomeBySource.get(selection.sourceRecordId)!;
    const source = sourceById.get(selection.sourceRecordId)!;
    let targetEntityType: string | null = null;
    let targetEntityId: string | null = null;
    let relationshipSlot: string | null = null;
    if (input.scope === "duplicate_identity") {
      const recommendation = contextIdentityRecommendation(outcome, source);
      if (!recommendation) fail("bulk_selection_not_applicable", 409);
      homogeneity.push(recommendation.signature);
      if (input.decision === "link_existing") {
        targetEntityType = recommendation.targetEntityType;
        targetEntityId = recommendation.targetEntityId;
      }
    } else if (input.scope === "field_conflict") {
      const applicable = outcome.issues.some((issue) => issue.code === "field_conflict" && issue.reason === input.fieldName);
      if (!applicable) fail("bulk_selection_not_applicable", 409);
      if (input.decision === "use_source") {
        const matchId = clean(outcome.match?.localId);
        const root = manifest.operations.find((operation) => operation.sourceRecordId === selection.sourceRecordId && operation.action === "link_existing" && clean(operation.payload.localId) === matchId);
        if (!matchId || !root) fail("bulk_selection_not_applicable", 409);
        targetEntityType = root.targetType;
        targetEntityId = matchId;
      }
    } else if (input.scope === "unsupported_record") {
      const reasons = [...new Set(outcome.issues.filter((issue) => issue.code === "unsupported_record").map((issue) => clean(issue.reason)).filter(Boolean))];
      if (reasons.length !== 1 || !clean(source.streamType)) fail("bulk_selection_not_applicable", 409);
      homogeneity.push(`${source.streamType}\u0000${reasons[0]}`);
    } else {
      const issues = outcome.issues.filter((issue) =>
        (issue.code === "relationship_unresolved" || issue.code === "unassigned")
        && clean(issue.relationshipSlot)
        && Array.isArray(issue.expectedParentTypes)
        && issue.expectedParentTypes.length > 0);
      if (issues.length !== 1) fail("bulk_selection_not_applicable", 409);
      const issue = issues[0]!;
      const expectedParentTypes = issue.expectedParentTypes!.filter((value): value is string => typeof value === "string").sort();
      if (input.decision === "keep_unlinked" && issue.canImportStandalone !== true) fail("bulk_selection_not_applicable", 409);
      relationshipSlot = clean(issue.relationshipSlot);
      targetEntityType = expectedParentTypes.length === 1 ? expectedParentTypes[0]! : null;
      homogeneity.push(`${expectedParentTypes.join(",")}\u0000${issue.code}\u0000${clean(issue.reason)}`);
    }
    return {
      sourceRecordId: selection.sourceRecordId,
      sourceVersionId: selection.sourceVersionId,
      scope: input.scope,
      decision: input.decision,
      fieldName: input.fieldName,
      relationshipSlot,
      targetEntityType,
      targetEntityId,
      ...(selection.reviewToken ? { reviewToken: selection.reviewToken } : {}),
    };
  });
  if (homogeneity.length && new Set(homogeneity).size !== 1) fail("bulk_selection_not_homogeneous", 409);
  return decisions;
}

export class InMemoryReviewCommandStore implements ReviewCommandStore {
  manifests = new Map<string, ActOrganizeManifest>(); assignments = new Map<string, Assignment[]>(); decisions = new Map<string, Decision[]>();
  private bulkRequests = new Map<string, { requestFingerprint: string; owner: string; result: BulkReviewDecisionResult }>();
  private decisionRequestFingerprints = new Map<string, string>();
  private decisionSupersessionRequests = new Map<string, { fingerprint: string; result: Decision }>();
  private targets = new Set<string>();
  private approvals: ApprovalRepository; private apply: ActApplyService; private sources = new Map<string, ReviewSourceState>(); private runOwners = new Map<string, string>();
  constructor(approvals: ApprovalRepository, apply: ActApplyService, private readonly testOptions: { unsafeForTests: true } = { unsafeForTests: true }) { this.approvals = approvals; this.apply = apply; }
  seed(runId: string, manifest: ActOrganizeManifest, sourceVersions: Record<string, string | ReviewSourceState> = {}, owner = "owner") { this.manifests.set(runId, manifest); this.runOwners.set(runId, owner); for (const [id, version] of Object.entries(sourceVersions)) this.sources.set(id, typeof version === "string" ? { sourceVersionId: version } : { ...version }); }
  seedTarget(entityType: string, entityId: string) { this.targets.add(`${entityType}\u0000${entityId}`); }
  async getManifest(runId: string) { return this.manifests.get(runId) ?? null; }
  async organize(runId: string) { const manifest = this.manifests.get(runId); if (!manifest) fail("organize_unavailable", 409); return { status: "ready_to_apply" as const, manifest }; }
  async startOrganize(runId: string) { await this.organize(runId); return { status: "organizing" as const }; }
  async getSource(id: string) { return this.sources.get(id) ?? null; }
  async listAssignments(id: string) { return (this.assignments.get(id) ?? []).filter((row) => row.active); }
  async saveAssignment(input: SaveAssignmentInput) { const rows = this.assignments.get(input.sourceRecordId) ?? []; const prior = rows.find((row) => row.targetEntityType === input.targetEntityType && row.targetEntityId === input.targetEntityId && row.active); if (prior) return prior; const row: Assignment = { ...input, id: `${input.sourceRecordId}:${rows.length + 1}`, active: true }; rows.push(row); this.assignments.set(input.sourceRecordId, rows); return row; }
  async discardAssignment(assignmentId: string) { for (const rows of this.assignments.values()) { const index = rows.findIndex((row) => row.id === assignmentId); if (index >= 0) rows.splice(index, 1); } }
  async supersedeAssignment(sourceRecordId: string, id: string, _actor: string, _version: string, _key: string) { const row = (this.assignments.get(sourceRecordId) ?? []).find((candidate) => candidate.id === id); if (!row) fail("assignment_not_found", 404); row.active = false; row.supersededAt = new Date().toISOString(); return row; }
  async listDecisions(id: string) { return (this.decisions.get(id) ?? []).filter((row) => row.active); }
  async saveDecision(input: SaveDecisionInput) {
    const rows = this.decisions.get(input.sourceRecordId) ?? [];
    const fingerprint = input.requestFingerprint ?? individualDecisionRequestFingerprint(input);
    const replay = rows.find((row) => row.requestKey === input.requestKey);
    if (replay) {
      if (this.decisionRequestFingerprints.get(`${input.sourceRecordId}\u0000${input.requestKey}`) !== fingerprint)
        fail("request_replay_mismatch", 409);
      return replay;
    }
    const prior = rows.find((row) => row.active && row.scope === input.scope && row.fieldName === input.fieldName);
    if (prior) fail("decision_already_active", 409);
    const { reviewToken: _reviewToken, requestFingerprint: _requestFingerprint, runId: _runId, ...decision } = input;
    const row: Decision = { ...decision, id: `${input.sourceRecordId}:decision:${rows.length + 1}`, active: true };
    rows.push(row);
    this.decisions.set(input.sourceRecordId, rows);
    this.decisionRequestFingerprints.set(`${input.sourceRecordId}\u0000${input.requestKey}`, fingerprint);
    return row;
  }
  async discardDecision(decisionId: string) { for (const rows of this.decisions.values()) { const index = rows.findIndex((row) => row.id === decisionId); if (index >= 0) rows.splice(index, 1); } }
  async supersedeDecision(sourceRecordId: string, id: string, actor: string, requestKey: string) {
    const fingerprint = decisionSupersessionRequestFingerprint({ sourceRecordId, decisionId: id, actor });
    const priorRequest = this.decisionSupersessionRequests.get(requestKey);
    if (priorRequest) {
      if (priorRequest.fingerprint !== fingerprint) fail("request_replay_mismatch", 409);
      return structuredClone(priorRequest.result);
    }
    const row = (this.decisions.get(sourceRecordId) ?? []).find((candidate) => candidate.id === id && candidate.active);
    if (!row) fail("decision_not_found", 404);
    row.active = false;
    this.decisionSupersessionRequests.set(requestKey, { fingerprint, result: structuredClone(row) });
    return row;
  }
  getApprovalRepository() { return this.approvals; } getApplyService() { return this.apply; }
  async rebuildAfterReviewChange(_runId: string) { if (!this.testOptions.unsafeForTests) fail("assignment_rebuild_unavailable", 503); return { status: "ready_to_apply" }; }
  private async atomically<T>(runId: string, mutation: () => Promise<T>): Promise<T> {
    const assignments = structuredClone(this.assignments);
    const decisions = structuredClone(this.decisions);
    const manifests = structuredClone(this.manifests);
    try { const result = await mutation(); await this.rebuildAfterReviewChange(runId); return result; }
    catch (error) { this.assignments = assignments; this.decisions = decisions; this.manifests = manifests; throw error; }
  }
  saveAssignmentAndRebuild(runId: string, input: SaveAssignmentInput) { return this.atomically(runId, () => this.saveAssignment(input)); }
  supersedeAssignmentAndRebuild(runId: string, sourceRecordId: string, assignmentId: string, actor: string, expectedSourceVersionId: string, requestKey: string) { return this.atomically(runId, () => this.supersedeAssignment(sourceRecordId, assignmentId, actor, expectedSourceVersionId, requestKey)); }
  private conflictState(runId: string, sourceRecordId: string, fieldName: string): ConflictReviewState | null {
    const manifest = this.manifests.get(runId);
    const source = this.sources.get(sourceRecordId);
    const outcome = manifest?.outcomes.find((candidate) => candidate.sourceRecordId === sourceRecordId);
    const matchId = clean(outcome?.match?.localId);
    const root = manifest?.operations.find((operation) => operation.sourceRecordId === sourceRecordId && operation.action === "link_existing" && clean(operation.payload.localId) === matchId);
    const normalized = object(root?.payload.normalized);
    if (!manifest || !source || !outcome || !root || !matchId || !outcome.issues.some((issue) => issue.code === "field_conflict" && issue.reason === fieldName) || !Object.hasOwn(normalized, fieldName) || !source.localFields || !Object.hasOwn(source.localFields, fieldName)) return null;
    return { sourceRecordId, sourceVersionId: source.sourceVersionId, fieldName, sourceValue: normalized[fieldName], targetEntityType: root.targetType, targetEntityId: matchId, localValue: source.localFields[fieldName] };
  }
  private validatedDecision(runId: string, input: SaveDecisionInput): SaveDecisionInput {
    const manifest = this.manifests.get(runId);
    const source = this.sources.get(input.sourceRecordId);
    if (!manifest || !source) fail("source_not_found", 404);
    validateIndividualDecisionAgainstCurrentState(input, manifest, source);
    if ((input.decision === "link_existing" || input.decision === "assign_parent")
      && !this.targets.has(`${input.targetEntityType}\u0000${input.targetEntityId}`))
      fail("review_target_not_found", 409);
    if (input.scope !== "field_conflict" || input.decision !== "use_source") return input;
    if (!input.reviewToken) fail("review_token_required", 409);
    const state = this.conflictState(runId, input.sourceRecordId, input.fieldName ?? "");
    if (!state) fail("stale_review_token", 409);
    return decisionWithReviewedProof(input, state);
  }
  async saveDecisionAndRebuild(runId: string, input: SaveDecisionInput) {
    const decisions = structuredClone(this.decisions);
    const manifests = structuredClone(this.manifests);
    const fingerprints = structuredClone(this.decisionRequestFingerprints);
    try {
      const rows = this.decisions.get(input.sourceRecordId) ?? [];
      const fingerprint = input.requestFingerprint ?? individualDecisionRequestFingerprint(input);
      const replay = rows.find((row) => row.requestKey === input.requestKey);
      if (replay) {
        if (this.decisionRequestFingerprints.get(`${input.sourceRecordId}\u0000${input.requestKey}`) !== fingerprint)
          fail("request_replay_mismatch", 409);
        return replay;
      }
      const saved = await this.saveDecision(this.validatedDecision(runId, input));
      await this.rebuildAfterReviewChange(runId);
      return saved;
    } catch (error) {
      this.decisions = decisions;
      this.manifests = manifests;
      this.decisionRequestFingerprints = fingerprints;
      throw error;
    }
  }
  async getBulkDecisionRequest(runId: string, input: BulkReviewRequestLookup): Promise<BulkReviewDecisionResult | null> {
    if (this.runOwners.get(runId) !== input.owner) fail("run_not_found", 404);
    const prior = this.bulkRequests.get(`${runId}:${input.requestKey}`);
    if (!prior) return null;
    if (prior.requestFingerprint !== input.requestFingerprint) fail("request_replay_mismatch", 409);
    return structuredClone(prior.result);
  }
  async saveDecisionsAndRebuild(runId: string, input: SaveDecisionsAndRebuildInput): Promise<SaveDecisionsAndRebuildResult> {
    const decisionsSnapshot = structuredClone(this.decisions);
    const manifestsSnapshot = structuredClone(this.manifests);
    const requestsSnapshot = structuredClone(this.bulkRequests);
    const fingerprintsSnapshot = structuredClone(this.decisionRequestFingerprints);
    try {
      const replay = await this.getBulkDecisionRequest(runId, input);
      if (replay) return replay;
      const manifest = await this.getManifest(runId);
      if (!manifest) fail("manifest_not_found", 404);
      if (manifest.digest !== input.expectedManifestDigest) fail("manifest_digest_mismatch", 409);
      const sourceById = new Map(input.selections.map((selection) => [selection.sourceRecordId, this.sources.get(selection.sourceRecordId)!]));
      const prepared = prepareBulkReviewDecisions(input, manifest, sourceById);
      if (prepared.some((decision) => (this.decisions.get(decision.sourceRecordId) ?? []).some((row) => row.requestKey === input.requestKey))) fail("request_replay_mismatch", 409);
      const saved: Decision[] = [];
      for (const decision of prepared) {
        const request = { ...decision, runId, requestKey: input.requestKey, decidedBy: input.owner };
        saved.push(await this.saveDecision(this.validatedDecision(runId, {
          ...request,
          requestFingerprint: individualDecisionRequestFingerprint(request),
        })));
      }
      await this.rebuildAfterReviewChange(runId);
      const rebuilt = await this.getManifest(runId);
      if (!rebuilt) fail("manifest_not_found", 404);
      const result = { decisions: saved, manifestDigest: rebuilt.digest, reviewedOperationIds: reviewedOperationIds(rebuilt, saved) };
      this.bulkRequests.set(`${runId}:${input.requestKey}`, { requestFingerprint: input.requestFingerprint, owner: input.owner, result: structuredClone(result) });
      return result;
    } catch (error) {
      this.decisions = decisionsSnapshot;
      this.manifests = manifestsSnapshot;
      this.bulkRequests = requestsSnapshot;
      this.decisionRequestFingerprints = fingerprintsSnapshot;
      throw error;
    }
  }
  async supersedeDecisionAndRebuild(runId: string, sourceRecordId: string, decisionId: string, actor: string, requestKey: string) {
    const prior = this.decisionSupersessionRequests.get(requestKey);
    const fingerprint = decisionSupersessionRequestFingerprint({ sourceRecordId, decisionId, actor });
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail("request_replay_mismatch", 409);
      return structuredClone(prior.result);
    }
    const requests = structuredClone(this.decisionSupersessionRequests);
    try {
      return await this.atomically(runId, () => this.supersedeDecision(sourceRecordId, decisionId, actor, requestKey));
    } catch (error) {
      this.decisionSupersessionRequests = requests;
      throw error;
    }
  }
}

export class ReviewCommandService {
  constructor(private readonly store: ReviewCommandStore) {}
  organize(runId: string) { return this.store.organize(runId); }
  startOrganize(runId: string) { return this.store.startOrganize(runId); }
  async assign(input: { runId: string; sourceRecordId: string; targetEntityType: string; targetEntityId: string; sourceVersionId: string; expectedSourceVersionId: string; assignedBy: string; requestKey: string; role?: string; isPrimary?: boolean }) {
    if (!assignmentTypes.has(input.targetEntityType) || !clean(input.targetEntityId) || !clean(input.assignedBy) || !clean(input.requestKey)) fail("invalid_assignment");
    const source = await this.store.getSource(input.sourceRecordId); if (!source) fail("source_not_found", 404);
    if (source.sourceVersionId !== input.expectedSourceVersionId) fail("stale_source_version", 409);
    if (input.sourceVersionId !== source.sourceVersionId) fail("stale_source_version", 409);
    const existing = await this.store.listAssignments(input.sourceRecordId); if (existing.some((row) => row.targetEntityType === input.targetEntityType && row.targetEntityId === input.targetEntityId)) return existing.find((row) => row.targetEntityType === input.targetEntityType && row.targetEntityId === input.targetEntityId)!;
    return this.store.saveAssignmentAndRebuild(input.runId, { ...input, role: clean(input.role) || "primary", isPrimary: input.isPrimary ?? false, manualAuthority: true });
  }
  async decide(input: { runId: string; sourceRecordId: string; sourceVersionId: string; scope: string; decision: string; requestKey: string; decidedBy: string; fieldName?: string | null; relationshipSlot?: string | null; targetEntityType?: string | null; targetEntityId?: string | null; reviewToken?: ConflictReviewToken }) {
    if (!decisionsByScope[input.scope]?.includes(input.decision) || parentDecisionWords.has(input.decision) || !clean(input.requestKey) || !clean(input.decidedBy)) fail("invalid_decision");
    if (input.scope === "field_conflict" && !clean(input.fieldName)) fail("field_name_required");
    if (input.scope !== "field_conflict" && input.fieldName) fail("field_name_not_allowed");
    if (input.scope !== "relationship" && input.relationshipSlot) fail("relationship_slot_not_allowed");
    if (input.scope === "field_conflict" && input.decision === "use_source" && !input.reviewToken) fail("review_token_required", 409);
    const request: SaveDecisionInput = {
      ...input,
      scope: input.scope as Decision["scope"],
      decision: input.decision as Decision["decision"],
      fieldName: input.fieldName ?? null,
      relationshipSlot: input.relationshipSlot ?? null,
      targetEntityType: input.targetEntityType ?? null,
      targetEntityId: input.targetEntityId ?? null,
    };
    return this.store.saveDecisionAndRebuild(input.runId, {
      ...request,
      requestFingerprint: individualDecisionRequestFingerprint(request),
    });
  }
  async bulkDecide(input: BulkReviewDecisionInput): Promise<BulkReviewDecisionResult> {
    if (!bulkDecisionsByScope[input.scope]?.includes(input.decision) || !clean(input.requestKey) || !clean(input.requestedBy)) fail("invalid_decision");
    if (!Array.isArray(input.selections) || input.selections.length < 1 || input.selections.length > 200) fail("invalid_bulk_selection");
    if (input.scope === "field_conflict" && !clean(input.fieldName)) fail("field_name_required");
    if (input.scope !== "field_conflict" && input.fieldName !== null) fail("field_name_not_allowed");
    if (input.selections.some((selection) => !clean(selection.sourceRecordId) || !clean(selection.sourceVersionId))) fail("invalid_bulk_selection");
    if (new Set(input.selections.map((selection) => selection.sourceRecordId)).size !== input.selections.length) fail("duplicate_bulk_selection");
    if (input.scope === "field_conflict" && input.decision === "use_source" && input.selections.some((selection) => !selection.reviewToken)) fail("review_token_required", 409);
    const requestFingerprint = bulkReviewRequestFingerprint(input);
    const replay = await this.store.getBulkDecisionRequest(input.runId, {
      owner: input.requestedBy,
      requestKey: input.requestKey,
      requestFingerprint,
    });
    if (replay) return replay;

    return this.store.saveDecisionsAndRebuild(input.runId, {
      expectedManifestDigest: input.expectedManifestDigest,
      owner: input.requestedBy,
      requestKey: input.requestKey,
      requestFingerprint,
      scope: input.scope,
      decision: input.decision,
      fieldName: input.fieldName,
      selections: input.selections,
    });
  }
  assignments(sourceRecordId: string) { return this.store.listAssignments(sourceRecordId); }
  decisions(sourceRecordId: string) { return this.store.listDecisions(sourceRecordId); }
  removeAssignment(input: { runId: string; sourceRecordId: string; assignmentId: string; actor: string; expectedSourceVersionId: string; requestKey: string }) { return this.store.supersedeAssignmentAndRebuild(input.runId, input.sourceRecordId, input.assignmentId, input.actor, input.expectedSourceVersionId, input.requestKey); }
  removeDecision(input: { runId: string; sourceRecordId: string; decisionId: string; actor: string; requestKey: string }) { return this.store.supersedeDecisionAndRebuild(input.runId, input.sourceRecordId, input.decisionId, input.actor, input.requestKey); }
  async approve(input: { runId: string; operationIds: string[]; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> { return new ActApprovalService(this.store.getApprovalRepository()).approve({ ...input, includeDependencies: true }); }
  async approveSafeDefaults(input: { runId: string; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> { return new ActApprovalService(this.store.getApprovalRepository()).approveSafeDefaults(input); }
  async approveReady(input: { runId: string; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> { return new ActApprovalService(this.store.getApprovalRepository()).approveReady(input); }
  async apply(input: { runId: string; approvedOperationIds: string[]; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApplyBatchStatus> { return this.store.getApplyService().apply(input); }
}
