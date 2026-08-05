import type { ActApplyService, ApplyBatchStatus } from "./apply-service";
import { ActApprovalService, type ApprovalClosure, type ApprovalRepository } from "./approval-service";
import type { ActOrganizeManifest } from "./manifest-builder";

export type Assignment = { id: string; sourceRecordId: string; targetEntityType: string; targetEntityId: string; role: string; isPrimary: boolean; manualAuthority: true; assignedBy: string; sourceVersionId: string; active: boolean; supersededAt?: string };
export type Decision = { id: string; sourceRecordId: string; sourceVersionId: string; scope: "duplicate_identity" | "field_conflict" | "unsupported_record"; decision: "link_existing" | "keep_separate" | "keep_local" | "use_source" | "ignore_source"; requestKey: string; fieldName: string | null; targetEntityType: string | null; targetEntityId: string | null; active: boolean; };

export type ReviewCommandStore = {
  getManifest(runId: string): Promise<ActOrganizeManifest | null>;
  organize(runId: string): Promise<{ status: string; manifest: ActOrganizeManifest | null }>;
  getSource(sourceRecordId: string): Promise<{ sourceVersionId: string } | null>;
  listAssignments(sourceRecordId: string): Promise<Assignment[]>;
  saveAssignment(input: Omit<Assignment, "id" | "active"> & { requestKey: string }): Promise<Assignment>;
  supersedeAssignment(sourceRecordId: string, assignmentId: string, actor: string, expectedSourceVersionId: string, requestKey: string): Promise<Assignment>;
  listDecisions(sourceRecordId: string): Promise<Decision[]>;
  saveDecision(input: Omit<Decision, "id" | "active"> & { requestKey: string }): Promise<Decision>;
  supersedeDecision(sourceRecordId: string, decisionId: string, actor: string, requestKey: string): Promise<Decision>;
  getApprovalRepository(): ApprovalRepository;
  getApplyService(): ActApplyService;
  /** Durable adapters must reopen/rebuild a terminal source atomically. */
  reopenAfterAssignment?(input: { sourceRecordId: string; assignmentId: string; sourceVersionId: string }): Promise<{ state: string }>;
};

const assignmentTypes = new Set(["organization", "contact", "booking", "calling_list", "activity"]);
const scopes = new Set(["duplicate_identity", "field_conflict", "unsupported_record"]);
const decisions = new Set(["link_existing", "keep_separate", "keep_local", "use_source", "ignore_source"]);
const parentDecisionWords = new Set(["assign", "link_parent", "unlink_parent", "assign_parent"]);
const clean = (value: unknown) => typeof value === "string" ? value.trim() : "";
function fail(code: string, status = 400): never { throw Object.assign(new Error(code), { code, status }); }

export class InMemoryReviewCommandStore implements ReviewCommandStore {
  manifests = new Map<string, ActOrganizeManifest>(); assignments = new Map<string, Assignment[]>(); decisions = new Map<string, Decision[]>();
  private approvals: ApprovalRepository; private apply: ActApplyService; private sources = new Map<string, { sourceVersionId: string }>();
  constructor(approvals: ApprovalRepository, apply: ActApplyService, private readonly testOptions: { unsafeForTests: true } = { unsafeForTests: true }) { this.approvals = approvals; this.apply = apply; }
  seed(runId: string, manifest: ActOrganizeManifest, sourceVersions: Record<string, string> = {}) { this.manifests.set(runId, manifest); for (const [id, version] of Object.entries(sourceVersions)) this.sources.set(id, { sourceVersionId: version }); }
  async getManifest(runId: string) { return this.manifests.get(runId) ?? null; }
  async organize(runId: string) { return { status: "organizing", manifest: this.manifests.get(runId) ?? null }; }
  async getSource(id: string) { return this.sources.get(id) ?? null; }
  async listAssignments(id: string) { return (this.assignments.get(id) ?? []).filter((row) => row.active); }
  async saveAssignment(input: Omit<Assignment, "id" | "active"> & { requestKey: string }) { const rows = this.assignments.get(input.sourceRecordId) ?? []; const prior = rows.find((row) => row.targetEntityType === input.targetEntityType && row.targetEntityId === input.targetEntityId && row.active); if (prior) return prior; const row: Assignment = { ...input, id: `${input.sourceRecordId}:${rows.length + 1}`, active: true }; rows.push(row); this.assignments.set(input.sourceRecordId, rows); return row; }
  async supersedeAssignment(sourceRecordId: string, id: string, _actor: string, _version: string, _key: string) { const row = (this.assignments.get(sourceRecordId) ?? []).find((candidate) => candidate.id === id); if (!row) fail("assignment_not_found", 404); row.active = false; row.supersededAt = new Date().toISOString(); return row; }
  async listDecisions(id: string) { return (this.decisions.get(id) ?? []).filter((row) => row.active); }
  async saveDecision(input: Omit<Decision, "id" | "active"> & { requestKey: string }) { const rows = this.decisions.get(input.sourceRecordId) ?? []; const prior = rows.find((row) => row.active && row.scope === input.scope && row.fieldName === input.fieldName); if (prior && prior.requestKey === input.requestKey) return prior; if (prior) fail("decision_already_active", 409); const row: Decision = { ...input, id: `${input.sourceRecordId}:decision:${rows.length + 1}`, active: true }; rows.push(row); this.decisions.set(input.sourceRecordId, rows); return row; }
  async supersedeDecision(sourceRecordId: string, id: string, _actor: string, _key: string) { const row = (this.decisions.get(sourceRecordId) ?? []).find((candidate) => candidate.id === id); if (!row) fail("decision_not_found", 404); row.active = false; return row; }
  getApprovalRepository() { return this.approvals; } getApplyService() { return this.apply; }
  async reopenAfterAssignment(_input: { sourceRecordId: string; assignmentId: string; sourceVersionId: string }) { if (!this.testOptions.unsafeForTests) fail("assignment_rebuild_unavailable", 503); return { state: "ready_to_apply" }; }
}

export class ReviewCommandService {
  constructor(private readonly store: ReviewCommandStore) {}
  organize(runId: string) { return this.store.organize(runId); }
  async assign(input: { sourceRecordId: string; targetEntityType: string; targetEntityId: string; sourceVersionId: string; expectedSourceVersionId: string; assignedBy: string; requestKey: string; role?: string; isPrimary?: boolean }) {
    if (!assignmentTypes.has(input.targetEntityType) || !clean(input.targetEntityId) || !clean(input.assignedBy) || !clean(input.requestKey)) fail("invalid_assignment");
    const source = await this.store.getSource(input.sourceRecordId); if (!source) fail("source_not_found", 404);
    if (source.sourceVersionId !== input.expectedSourceVersionId) fail("stale_source_version", 409);
    if (input.sourceVersionId !== source.sourceVersionId) fail("stale_source_version", 409);
    const existing = await this.store.listAssignments(input.sourceRecordId); if (existing.some((row) => row.targetEntityType === input.targetEntityType && row.targetEntityId === input.targetEntityId)) return existing.find((row) => row.targetEntityType === input.targetEntityType && row.targetEntityId === input.targetEntityId)!;
    if (!this.store.reopenAfterAssignment) fail("assignment_rebuild_unavailable", 503);
    const assignment = await this.store.saveAssignment({ ...input, role: clean(input.role) || "primary", isPrimary: input.isPrimary ?? false, manualAuthority: true });
    await this.store.reopenAfterAssignment({ sourceRecordId: input.sourceRecordId, assignmentId: assignment.id, sourceVersionId: source.sourceVersionId });
    return assignment;
  }
  async decide(input: { sourceRecordId: string; sourceVersionId: string; scope: string; decision: string; requestKey: string; fieldName?: string | null; targetEntityType?: string | null; targetEntityId?: string | null }) {
    if (!scopes.has(input.scope) || !decisions.has(input.decision) || parentDecisionWords.has(input.decision) || !clean(input.requestKey)) fail("invalid_decision");
    if (input.scope === "field_conflict" && !clean(input.fieldName)) fail("field_name_required");
    if (input.scope !== "field_conflict" && input.fieldName) fail("field_name_not_allowed");
    const source = await this.store.getSource(input.sourceRecordId); if (!source) fail("source_not_found", 404);
    if (source.sourceVersionId !== input.sourceVersionId) fail("stale_source_version", 409);
    return this.store.saveDecision({ ...input, scope: input.scope as Decision["scope"], decision: input.decision as Decision["decision"], fieldName: input.fieldName ?? null, targetEntityType: input.targetEntityType ?? null, targetEntityId: input.targetEntityId ?? null });
  }
  assignments(sourceRecordId: string) { return this.store.listAssignments(sourceRecordId); }
  decisions(sourceRecordId: string) { return this.store.listDecisions(sourceRecordId); }
  removeAssignment(input: { sourceRecordId: string; assignmentId: string; actor: string; expectedSourceVersionId: string; requestKey: string }) { return this.store.supersedeAssignment(input.sourceRecordId, input.assignmentId, input.actor, input.expectedSourceVersionId, input.requestKey); }
  removeDecision(input: { sourceRecordId: string; decisionId: string; actor: string; requestKey: string }) { return this.store.supersedeDecision(input.sourceRecordId, input.decisionId, input.actor, input.requestKey); }
  async approve(input: { runId: string; operationIds: string[]; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> { return new ActApprovalService(this.store.getApprovalRepository()).approve({ ...input, includeDependencies: true }); }
  async approveSafeDefaults(input: { runId: string; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApprovalClosure> { return new ActApprovalService(this.store.getApprovalRepository()).approveSafeDefaults(input); }
  async apply(input: { runId: string; approvedOperationIds: string[]; expectedManifestDigest: string; requestKey: string; requestedBy: string }): Promise<ApplyBatchStatus> { return this.store.getApplyService().apply(input); }
}
