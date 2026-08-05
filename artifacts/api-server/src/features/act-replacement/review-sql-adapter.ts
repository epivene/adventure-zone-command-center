import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import {
  actReplacementApplyBatches,
  actReplacementApplyOperations,
  actReplacementOutcomes,
  actReplacementRuns,
  actReplacementReviewDecisions,
  actSourceRecordVersions,
  actSourceRecords,
} from "@workspace/db/schema";
import { DrizzleActSourceAssignmentRepository } from "./assignment-repository";
import type { ActApplyService } from "./apply-service";
import type { ApprovalClosure, ApprovalRepository } from "./approval-service";
import type { ActOrganizeManifest, ManifestDiagnostic, ManifestOperation } from "./manifest-builder";
import type { Assignment, Decision, ReviewCommandStore } from "./review-command-service";
import type { ReviewReader, ReviewSourceRecord } from "./review-reader";

type DrizzleDatabase = typeof database;
type SourceDatabaseScope = { sourceDatabaseKey: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const array = <T>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const operationRank: Record<string, number> = { organization: 10, contact: 20, calling_list: 30, booking: 40, activity: 50, organization_contact: 60, booking_contact: 70, calling_list_member: 80, activity_association: 90 };

/** Rebuilds the exact deterministic manifest representation written by the organizer. */
export function manifestFromRows(input: {
  operations: Array<Record<string, unknown>>;
  outcomes: Array<Record<string, unknown>>;
}): ActOrganizeManifest {
  const operations: ManifestOperation[] = input.operations.map((row) => ({
    operationKey: text(row.operationKey), sourceRecordId: text(row.sourceRecordId), sourceVersionId: text(row.sourceVersionId),
    targetType: row.targetType as ManifestOperation["targetType"], action: row.action as ManifestOperation["action"],
    payload: object(row.payload), dependencyOperationKeys: array<string>(row.dependencyOperationKeys),
    requiredForSourceOutcome: Boolean(row.requiredForSourceOutcome), safeByDefault: Boolean(row.safeByDefault),
  })).sort((a, b) => {
    const rank = (operation: ManifestOperation) => operation.operationKey.startsWith("provenance:") ? 100 : operationRank[operation.targetType] ?? 999;
    return rank(a) - rank(b) || a.operationKey.localeCompare(b.operationKey);
  });
  const outcomes = input.outcomes.map((row) => ({
    sourceRecordId: text(row.sourceRecordId), sourceVersionId: text(row.sourceVersionId), state: row.state as ActOrganizeManifest["outcomes"][number]["state"],
    issues: array<{ code: string; reason?: string }>(row.issues), candidates: array<Record<string, unknown>>(row.candidates), match: row.match ? object(row.match) : null,
    mappingWarnings: array<string>(row.mappingWarnings), unsupportedFieldPaths: array<string>(row.unsupportedFieldPaths), operationKeys: array<string>(row.operationKeys),
  })).sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId));
  const diagnostics: ManifestDiagnostic[] = [];
  for (const outcome of outcomes) for (const issue of outcome.issues) {
    const code = issue.code as ManifestDiagnostic["code"];
    if (["unsupported_field", "ambiguous_match", "unassigned", "unsupported_record", "relationship_unresolved", "field_conflict"].includes(code)) diagnostics.push({ code, sourceRecordId: outcome.sourceRecordId, ...(issue.reason && code === "field_conflict" ? { path: issue.reason } : {}) });
  }
  for (const outcome of outcomes) for (const path of outcome.unsupportedFieldPaths) diagnostics.push({ code: "unsupported_field", sourceRecordId: outcome.sourceRecordId, path });
  diagnostics.sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId) || (a.path ?? "").localeCompare(b.path ?? ""));
  const digest = createHash("sha256").update(JSON.stringify({ operations, outcomes })).digest("hex");
  return { operations, outcomes, diagnostics, digest };
}

function safeDisplay(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (["password", "secret", "token", "authorization", "cookie"].some((word) => lower.includes(word))) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") output[key] = value;
  }
  return output;
}

export class DrizzleActReviewReader implements ReviewReader {
  constructor(protected readonly database: DrizzleDatabase, protected readonly scope: SourceDatabaseScope) {
    if (!scope.sourceDatabaseKey.trim()) throw new Error("source_database_key_required");
  }
  async ownsRun(runId: string) {
    const [run] = await this.database.select({ id: actReplacementRuns.id }).from(actReplacementRuns).where(and(eq(actReplacementRuns.id, runId), eq(actReplacementRuns.sourceDatabaseKey, this.scope.sourceDatabaseKey))).limit(1);
    return Boolean(run);
  }
  async getManifest(runId: string) {
    if (!(await this.ownsRun(runId))) return null;
    const [operationRows, outcomeRows] = await Promise.all([
      this.database.select().from(actReplacementApplyOperations).where(eq(actReplacementApplyOperations.runId, runId)),
      this.database.select().from(actReplacementOutcomes).where(eq(actReplacementOutcomes.runId, runId)),
    ]);
    return manifestFromRows({ operations: operationRows as unknown as Array<Record<string, unknown>>, outcomes: outcomeRows as unknown as Array<Record<string, unknown>> });
  }
  async listSources(runId: string): Promise<ReviewSourceRecord[]> {
    if (!(await this.ownsRun(runId))) return [];
    const rows = await this.database.select({ source: actSourceRecords, version: actSourceRecordVersions }).from(actSourceRecords)
      .innerJoin(actReplacementOutcomes, and(eq(actReplacementOutcomes.sourceRecordId, actSourceRecords.id), eq(actReplacementOutcomes.runId, runId)))
      .leftJoin(actSourceRecordVersions, eq(actSourceRecordVersions.id, actSourceRecords.latestVersionId))
      .where(eq(actSourceRecords.sourceDatabaseKey, this.scope.sourceDatabaseKey));
    return rows.map(({ source, version }) => ({
      sourceRecordId: source.id, sourceVersionId: source.latestVersionId ?? version?.id ?? "", streamType: source.streamType, actRecordId: source.actRecordId,
      display: safeDisplay(version?.rawSnapshot), versions: version ? [{ versionId: version.id, fetchedAt: version.fetchedAt.toISOString(), scope: version.snapshotScope, completeness: source.archiveCompleteness }] : [],
    }));
  }
  async getSource(sourceRecordId: string) {
    const [row] = await this.database.select({ source: actSourceRecords, version: actSourceRecordVersions }).from(actSourceRecords)
      .leftJoin(actSourceRecordVersions, eq(actSourceRecordVersions.id, actSourceRecords.latestVersionId))
      .where(and(eq(actSourceRecords.id, sourceRecordId), eq(actSourceRecords.sourceDatabaseKey, this.scope.sourceDatabaseKey))).limit(1);
    if (!row) return null;
    return { sourceRecordId: row.source.id, sourceVersionId: row.source.latestVersionId ?? row.version?.id ?? "", streamType: row.source.streamType, actRecordId: row.source.actRecordId, display: safeDisplay(row.version?.rawSnapshot) };
  }
}

class DrizzleApprovalRepository implements ApprovalRepository {
  constructor(private readonly reader: DrizzleActReviewReader, private readonly database: DrizzleDatabase, private readonly scope: SourceDatabaseScope) {}
  async getManifest(runId: string) { const manifest = await this.reader.getManifest(runId); return manifest ? { digest: manifest.digest, operations: manifest.operations } : null; }
  async getRequest(runId: string, requestKey: string) {
    if (!(await this.reader.ownsRun(runId))) return null;
    const [row] = await this.database.select().from(actReplacementApplyBatches).where(and(eq(actReplacementApplyBatches.runId, runId), eq(actReplacementApplyBatches.requestKey, requestKey))).limit(1);
    if (!row) return null;
    return { selectedOperationIds: array<string>(row.selectedOperationIds), approvedOperationIds: array<string>(row.dependencyClosedOperationIds), dependencyOperationIds: array<string>(row.dependencyClosedOperationIds).filter((id) => !array<string>(row.selectedOperationIds).includes(id)), rejectedOperationIds: [], selectedCount: row.selectedCount, dependencyCount: row.dependencyCount, rejectedCount: row.rejectedCount, manifestDigest: row.manifestDigest };
  }
  async saveRequest(runId: string, requestKey: string, closure: ApprovalClosure) {
    if (!(await this.reader.ownsRun(runId))) throw new Error("run_not_found");
    const [row] = await this.database.insert(actReplacementApplyBatches).values({ runId, requestKey, manifestDigest: closure.manifestDigest, selectedOperationIds: closure.selectedOperationIds, dependencyClosedOperationIds: closure.approvedOperationIds, selectedCount: closure.selectedCount, dependencyCount: closure.dependencyCount, rejectedCount: closure.rejectedCount, state: "queued" }).onConflictDoNothing({ target: actReplacementApplyBatches.requestKey }).returning();
    if (row) return closure;
    const prior = await this.getRequest(runId, requestKey); if (!prior) throw new Error("approval_request_not_saved"); return prior;
  }
}

export class DrizzleActReviewCommandStore extends DrizzleActReviewReader implements ReviewCommandStore {
  private readonly assignments: DrizzleActSourceAssignmentRepository;
  private readonly approval: ApprovalRepository;
  constructor(database: DrizzleDatabase, scope: SourceDatabaseScope, private readonly applyService: ActApplyService, private readonly reopen?: (input: { sourceRecordId: string; assignmentId: string; sourceVersionId: string }) => Promise<{ state: string }>) {
    super(database, scope); this.assignments = new DrizzleActSourceAssignmentRepository(database); this.approval = new DrizzleApprovalRepository(this, database, scope);
  }
  async organize(runId: string) { const manifest = await this.getManifest(runId); return { status: manifest ? "ready_to_apply" : "not_found", manifest }; }
  private async assertSource(sourceRecordId: string) { const source = await super.getSource(sourceRecordId); if (!source) throw Object.assign(new Error("source_not_found"), { code: "source_not_found", status: 404 }); return source; }
  async listAssignments(sourceRecordId: string): Promise<Assignment[]> { await this.assertSource(sourceRecordId); const rows = await this.assignments.listActive(sourceRecordId); return rows.map((row) => ({ id: row.id, sourceRecordId: row.sourceRecordId, targetEntityType: row.targetEntityType, targetEntityId: row.targetEntityId, role: row.role, isPrimary: row.isPrimary, manualAuthority: true, assignedBy: row.assignedBy, sourceVersionId: row.sourceVersionId ?? "", active: row.supersededAt === null })); }
  async saveAssignment(input: Omit<Assignment, "id" | "active"> & { requestKey: string }): Promise<Assignment> { const source = await this.assertSource(input.sourceRecordId); if (source.sourceVersionId !== input.sourceVersionId) throw Object.assign(new Error("stale_source_version"), { code: "stale_source_version", status: 409 }); const row = await this.assignments.assign({ sourceRecordId: input.sourceRecordId, targetEntityType: input.targetEntityType as "organization" | "contact" | "booking" | "calling_list" | "activity", targetEntityId: input.targetEntityId, role: input.role, isPrimary: input.isPrimary, assignedBy: input.assignedBy, sourceVersionId: input.sourceVersionId, expectedSourceVersionId: input.sourceVersionId, requestKey: input.requestKey }); return { id: row.id, sourceRecordId: row.sourceRecordId, targetEntityType: row.targetEntityType, targetEntityId: row.targetEntityId, role: row.role, isPrimary: row.isPrimary, manualAuthority: true, assignedBy: row.assignedBy, sourceVersionId: row.sourceVersionId ?? "", active: row.supersededAt === null }; }
  async supersedeAssignment(sourceRecordId: string, assignmentId: string, actor: string, expectedSourceVersionId: string, _requestKey = ""): Promise<Assignment> { await this.assertSource(sourceRecordId); const row = await this.assignments.supersede({ assignmentId, supersededBy: actor, expectedSourceVersionId }); return { id: row.id, sourceRecordId: row.sourceRecordId, targetEntityType: row.targetEntityType, targetEntityId: row.targetEntityId, role: row.role, isPrimary: row.isPrimary, manualAuthority: true, assignedBy: row.assignedBy, sourceVersionId: row.sourceVersionId ?? "", active: row.supersededAt === null, supersededAt: row.supersededAt?.toISOString() }; }
  async listDecisions(sourceRecordId: string): Promise<Decision[]> { await this.assertSource(sourceRecordId); const rows = await this.database.select().from(actReplacementReviewDecisions).where(and(eq(actReplacementReviewDecisions.sourceRecordId, sourceRecordId), eq(actReplacementReviewDecisions.active, true))); return rows.map((row) => ({ id: row.id, sourceRecordId: row.sourceRecordId, sourceVersionId: row.sourceVersionId, scope: row.scope as Decision["scope"], decision: row.decision as Decision["decision"], requestKey: row.requestKey, fieldName: row.fieldName, targetEntityType: row.targetEntityType, targetEntityId: row.targetEntityId, active: row.active })); }
  async saveDecision(input: Omit<Decision, "id" | "active"> & { requestKey: string }): Promise<Decision> { const source = await this.assertSource(input.sourceRecordId); if (source.sourceVersionId !== input.sourceVersionId) throw Object.assign(new Error("stale_source_version"), { code: "stale_source_version", status: 409 }); const [prior] = await this.database.select().from(actReplacementReviewDecisions).where(and(eq(actReplacementReviewDecisions.sourceRecordId, input.sourceRecordId), eq(actReplacementReviewDecisions.requestKey, input.requestKey))).limit(1); if (prior) return { ...input, id: prior.id, active: prior.active }; const [row] = await this.database.insert(actReplacementReviewDecisions).values({ sourceRecordId: input.sourceRecordId, sourceVersionId: input.sourceVersionId, scope: input.scope, decision: input.decision, requestKey: input.requestKey, fieldName: input.fieldName, targetEntityType: input.targetEntityType, targetEntityId: input.targetEntityId }).returning(); if (!row) throw new Error("decision_not_saved"); return { id: row.id, sourceRecordId: row.sourceRecordId, sourceVersionId: row.sourceVersionId, scope: row.scope as Decision["scope"], decision: row.decision as Decision["decision"], requestKey: row.requestKey, fieldName: row.fieldName, targetEntityType: row.targetEntityType, targetEntityId: row.targetEntityId, active: row.active }; }
  async supersedeDecision(sourceRecordId: string, decisionId: string, actor: string, _requestKey = ""): Promise<Decision> { await this.assertSource(sourceRecordId); if (!/^[0-9a-f-]{36}$/i.test(actor)) throw Object.assign(new Error("decision_actor_uuid_required"), { code: "decision_actor_uuid_required", status: 400 }); const [row] = await this.database.update(actReplacementReviewDecisions).set({ active: false, supersededAt: new Date(), supersededBy: actor }).where(and(eq(actReplacementReviewDecisions.id, decisionId), eq(actReplacementReviewDecisions.sourceRecordId, sourceRecordId), eq(actReplacementReviewDecisions.active, true))).returning(); if (!row) throw Object.assign(new Error("decision_not_found"), { code: "decision_not_found", status: 404 }); return { id: row.id, sourceRecordId: row.sourceRecordId, sourceVersionId: row.sourceVersionId, scope: row.scope as Decision["scope"], decision: row.decision as Decision["decision"], requestKey: row.requestKey, fieldName: row.fieldName, targetEntityType: row.targetEntityType, targetEntityId: row.targetEntityId, active: row.active }; }
  getApprovalRepository() { return this.approval; }
  getApplyService() { return this.applyService; }
  async reopenAfterAssignment(input: { sourceRecordId: string; assignmentId: string; sourceVersionId: string }) { if (!this.reopen) throw Object.assign(new Error("assignment_rebuild_unavailable"), { code: "assignment_rebuild_unavailable", status: 503 }); return this.reopen(input); }
}

export type ProductionReviewAdapterFactory = (database: DrizzleDatabase, scope: SourceDatabaseScope, applyService: ActApplyService, reopen?: DrizzleActReviewCommandStore["reopenAfterAssignment"]) => DrizzleActReviewCommandStore;
export const createDrizzleActReviewCommandStore: ProductionReviewAdapterFactory = (database, scope, applyService, reopen) => new DrizzleActReviewCommandStore(database, scope, applyService, reopen);
