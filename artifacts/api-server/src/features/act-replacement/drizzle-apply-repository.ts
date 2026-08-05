import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import type { ManifestOperation } from "./manifest-builder";
import type { ApplyBatchRecord, ApplyRepository, ApplyTarget, StoredOperation } from "./apply-repository";

type DrizzleDatabase = typeof database;
type Row = Record<string, unknown>;
const entityTables: Record<string, string> = { organization: "organizations", contact: "contacts", booking: "bookings", calling_list: "calling_lists", activity: "activities" };
const targetTypes = new Set(Object.keys(entityTables));
const rows = (value: unknown): Row[] => Array.isArray((value as { rows?: unknown[] })?.rows) ? ((value as { rows: Row[] }).rows) : [];
const asString = (value: unknown) => typeof value === "string" ? value : value == null ? "" : String(value);
const asJson = <T>(value: unknown, fallback: T): T => value == null ? fallback : value as T;

/** Durable SQL adapter. It deliberately uses the normalized Phase-2 tables and only the
 * allow-listed local target tables. Unsupported target shapes fail closed instead of
 * guessing columns or writing arbitrary SQL. */
export class DrizzleApplyRepository implements ApplyRepository {
  readonly durableApply = true as const;
  constructor(private readonly database: DrizzleDatabase, private readonly options: { manifestDigest?: (runId: string) => Promise<string | null> } = {}) {}

  private async query(query: ReturnType<typeof sql>): Promise<Row[]> { return rows(await this.database.execute(query)); }
  async getOperations(runId: string, ids: string[]) {
    if (!ids.length) return [];
    const result = await this.query(sql`select id, run_id as "runId", source_record_id as "sourceRecordId", source_version_id as "sourceVersionId", operation_key as "operationKey", target_type as "targetType", action, payload, dependency_operation_keys as "dependencyOperationKeys", required_for_source_outcome as "requiredForSourceOutcome", safe_by_default as "safeByDefault", status, attempt_count as "attemptCount", last_error_code as "lastErrorCode" from act_replacement_apply_operations where run_id = ${runId} and operation_key in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    return result.map((r) => this.operation(r));
  }
  async getManifestDigest(runId: string) {
    if (this.options.manifestDigest) return this.options.manifestDigest(runId);
    const result = await this.query(sql`select summary->>'manifestDigest' as digest from act_replacement_runs where id = ${runId} limit 1`);
    return result[0]?.digest ? asString(result[0].digest) : null;
  }
  async createBatch(input: Omit<ApplyBatchRecord, "completed" | "alreadyPresent" | "blocked" | "failed">): Promise<ApplyBatchRecord> {
    const existing = await this.getBatch(input.runId, input.requestKey); if (existing) return existing;
    await this.database.execute(sql`insert into act_replacement_apply_batches (request_key, run_id, manifest_digest, replay_fingerprint, selected_operation_ids, dependency_closed_operation_ids, selected_count, dependency_count, state, lease_owner, lease_expires_at, started_at, updated_at) values (${input.requestKey}, ${input.runId}, ${input.manifestDigest}, ${input.fingerprint ?? null}, ${JSON.stringify(input.operationIds)}::jsonb, ${JSON.stringify(input.operationIds)}::jsonb, ${input.operationIds.length}, 0, ${input.state}, ${input.leaseOwner ?? null}, ${input.leaseExpiresAt ? new Date(input.leaseExpiresAt) : null}, now(), now())`);
    const created = await this.getBatch(input.runId, input.requestKey); if (!created) throw new Error("apply_batch_create_failed"); return created;
  }
  async getBatch(runId: string, requestKey: string): Promise<ApplyBatchRecord | null> {
    const result = await this.query(sql`select id, run_id as "runId", request_key as "requestKey", manifest_digest as "manifestDigest", selected_operation_ids as "operationIds", state, replay_fingerprint as "fingerprint", lease_owner as "leaseOwner", lease_expires_at as "leaseExpiresAt" from act_replacement_apply_batches where run_id = ${runId} and request_key = ${requestKey} limit 1`);
    const row = result[0]; if (!row) return null;
    const operationIds = asJson<string[]>(row.operationIds, []); const operationRows = await this.getOperations(runId, operationIds);
    const counts = operationRows.reduce((a, o) => { if (o.status === "applied") a.completed++; else if (o.status === "already_present") a.alreadyPresent++; else if (o.status === "blocked") a.blocked++; else if (o.status === "failed") a.failed++; return a; }, { completed: 0, alreadyPresent: 0, blocked: 0, failed: 0 });
    return { batchId: asString(row.id), runId: asString(row.runId), requestKey: asString(row.requestKey), manifestDigest: asString(row.manifestDigest), operationIds, state: asString(row.state) as ApplyBatchRecord["state"], leaseOwner: row.leaseOwner ? asString(row.leaseOwner) : undefined, leaseExpiresAt: row.leaseExpiresAt ? new Date(String(row.leaseExpiresAt)).getTime() : undefined, fingerprint: row.fingerprint ? asString(row.fingerprint) : undefined, ...counts };
  }
  async saveOperation(operation: StoredOperation) {
    const leased = operation.status === "leased";
    await this.database.execute(sql`update act_replacement_apply_operations set status = ${operation.status}, attempt_count = ${operation.attemptCount}, last_error_code = ${operation.lastErrorCode ?? null}, lease_owner = case when ${leased} then 'act-apply' else null end, lease_expires_at = case when ${leased} then now() + interval '2 minutes' else null end, updated_at = now(), executed_at = case when ${operation.status} in ('applied','already_present','blocked','failed') then now() else executed_at end where id = ${operation.id}`);
  }
  async getTarget(entityType: string, id: string): Promise<ApplyTarget | null> {
    const table = entityTables[entityType]; if (!table || !id) return null;
    const result = await this.query(sql`select * from ${sql.raw(table)} where id = ${id} limit 1`); const row = result[0]; if (!row) return null;
    return { id, entityType, values: row, sourceIds: new Set([asString(row.actRecordId)].filter(Boolean)) };
  }
  async findTargetBySource(entityType: string, sourceRecordId: string) {
    const table = entityTables[entityType]; if (!table) return null;
    const result = await this.query(sql`select * from ${sql.raw(table)} where act_record_id = ${sourceRecordId} limit 1`); const row = result[0]; return row ? { id: asString(row.id), entityType, values: row, sourceIds: new Set([sourceRecordId]) } : null;
  }
  async createTarget(entityType: string, values: Record<string, unknown>, sourceRecordId: string) {
    if (!targetTypes.has(entityType)) throw Object.assign(new Error("unsupported_target_type"), { code: "unsupported_target_type" });
    const existing = await this.findTargetBySource(entityType, sourceRecordId); if (existing) return { target: existing, alreadyPresent: true };
    const normalized = (values.normalized as Record<string, unknown> | undefined) ?? values;
    const table = entityTables[entityType];
    const payload = this.targetColumns(entityType, normalized, sourceRecordId);
    const columns = Object.keys(payload);
    const result = await this.query(sql`insert into ${sql.raw(table)} (${sql.join(columns.map((key) => sql.raw(key)), sql.raw(", "))}) values (${sql.join(columns.map((key) => sql`${payload[key]}`), sql.raw(", "))}) returning *`);
    const row = result[0]; if (!row) throw new Error("target_create_failed"); return { target: { id: asString(row.id), entityType, values: row, sourceIds: new Set([sourceRecordId]) }, alreadyPresent: false };
  }
  private targetColumns(entityType: string, value: Record<string, unknown>, sourceRecordId: string): Record<string, unknown> {
    const pick = (...keys: string[]) => { for (const key of keys) if (value[key] !== undefined && value[key] !== null && value[key] !== "") return value[key]; return null; };
    if (entityType === "organization") return { name: pick("name") ?? "Unnamed organization", act_record_id: sourceRecordId, phone: pick("phone"), address_1: pick("address1", "address_1"), city: pick("city"), region: pick("region"), postal_code: pick("postalCode", "postal_code"), website: pick("website") };
    if (entityType === "contact") return { first_name: pick("firstName", "first_name") ?? "Unknown", last_name: pick("lastName", "last_name") ?? "Contact", email: pick("email"), phone: pick("phone"), act_record_id: sourceRecordId, job_title: pick("jobTitle", "job_title") };
    if (entityType === "booking") return { name: pick("name") ?? "Unnamed booking", city: pick("city") ?? "Unknown", region: pick("region") ?? "Unknown", act_record_id: sourceRecordId, venue_name: pick("venueName", "venue_name"), notes: pick("notes") };
    if (entityType === "calling_list") return { name: pick("name") ?? "Imported calling list", kind: "static" };
    return { kind: "note", body: String(pick("body", "text", "name") ?? "Imported activity"), timeline_sort_at: new Date(), source_record_id: sourceRecordId, source_type: "activity" };
  }
  async writeTarget(target: ApplyTarget, field: string, value: unknown) {
    const table = entityTables[target.entityType];
    const allowed: Record<string, Set<string>> = {
      organization: new Set(["name", "phone", "address_1", "city", "region", "postal_code", "website"]),
      contact: new Set(["first_name", "last_name", "email", "phone", "job_title"]),
      booking: new Set(["name", "city", "region", "venue_name", "notes"]),
      calling_list: new Set(["name", "kind"]),
      activity: new Set(["body", "occurred_at", "timeline_sort_at"]),
    };
    if (!table || !allowed[target.entityType]?.has(field)) throw new Error("unsupported_target_field");
    await this.database.execute(sql`update ${sql.raw(table)} set ${sql.raw(field)} = ${value}, updated_at = now() where id = ${target.id}`);
  }
  async recordOrigin(input: { entityType: string; entityId: string; fieldName: string; sourceRecordId: string; sourceVersionId: string; operationId: string; sourceValueFingerprint: string }) {
    await this.database.execute(sql`insert into act_imported_field_origins (entity_type, entity_id, field_name, source_record_id, source_version_id, operation_id, source_value_fingerprint) values (${input.entityType}, ${input.entityId}, ${input.fieldName}, ${input.sourceRecordId}, ${input.sourceVersionId}, ${input.operationId}, ${input.sourceValueFingerprint}) on conflict (entity_type, entity_id, field_name) do update set source_record_id = excluded.source_record_id, source_version_id = excluded.source_version_id, operation_id = excluded.operation_id, source_value_fingerprint = excluded.source_value_fingerprint, updated_at = now()`);
  }
  async createRelationship(operation: StoredOperation): Promise<"applied" | "already_present"> {
    const parent = operation.payload.parentSourceRecordId; if (typeof parent !== "string") throw new Error("relationship_parent_missing");
    const child = await this.findTargetBySource(operation.targetType === "organization_contact" ? "contact" : operation.targetType === "booking_contact" ? "contact" : operation.targetType === "calling_list_member" ? "calling_list" : "activity", operation.sourceRecordId);
    const parentTarget = await this.findParent(parent); if (!child || !parentTarget) throw new Error("relationship_target_missing");
    if (operation.targetType === "organization_contact") return this.link("organization_contacts", "organization_id", parentTarget.id, "contact_id", child.id);
    if (operation.targetType === "booking_contact") return this.link("booking_contacts", "booking_id", parentTarget.id, "contact_id", child.id);
    if (operation.targetType === "calling_list_member") return this.link("calling_list_memberships", "calling_list_id", child.id, "contact_id", parentTarget.id);
    if (operation.targetType === "activity_association") return this.link("activity_associations", "activity_id", child.id, `${asString(operation.payload.parentType) === "organization" ? "organization_id" : asString(operation.payload.parentType) === "contact" ? "contact_id" : "booking_id"}`, parentTarget.id);
    throw new Error("unsupported_relationship");
  }
  private async findParent(sourceRecordId: string) { for (const type of ["organization", "contact", "booking", "calling_list", "activity"]) { const target = await this.findTargetBySource(type, sourceRecordId); if (target) return target; } return null; }
  private async link(table: string, left: string, leftId: string, right: string, rightId: string): Promise<"applied" | "already_present"> { const found = await this.query(sql`select 1 from ${sql.raw(table)} where ${sql.raw(left)} = ${leftId} and ${sql.raw(right)} = ${rightId} limit 1`); if (found.length) return "already_present"; await this.database.execute(sql`insert into ${sql.raw(table)} (${sql.raw(left)}, ${sql.raw(right)}) values (${leftId}, ${rightId})`); return "applied"; }
  async recordProvenance(_operation: StoredOperation) { return; }
  async finishBatch(batch: ApplyBatchRecord) { await this.database.execute(sql`update act_replacement_apply_batches set state = ${batch.state}, lease_owner = null, lease_expires_at = null, last_error_code = ${batch.failed ? "apply_failed" : null}, completed_at = case when ${batch.state} in ('complete','complete_with_issues') then now() else completed_at end, updated_at = now() where run_id = ${batch.runId} and request_key = ${batch.requestKey}`); }
  private operation(row: Row): StoredOperation { return { id: asString(row.id), operationKey: asString(row.operationKey), sourceRecordId: asString(row.sourceRecordId), sourceVersionId: asString(row.sourceVersionId), targetType: asString(row.targetType) as ManifestOperation["targetType"], action: asString(row.action) as ManifestOperation["action"], payload: asJson(row.payload, {}), dependencyOperationKeys: asJson(row.dependencyOperationKeys, []), requiredForSourceOutcome: Boolean(row.requiredForSourceOutcome), safeByDefault: Boolean(row.safeByDefault), status: asString(row.status) as StoredOperation["status"], attemptCount: Number(row.attemptCount ?? 0), lastErrorCode: row.lastErrorCode ? asString(row.lastErrorCode) : undefined }; }
}

/** Lazy production factory: callers inject the already-configured db client so this
 * module never opens a connection during import or in preview-only deployments. */
export const createDrizzleApplyRepository = (database: DrizzleDatabase, options?: { manifestDigest?: (runId: string) => Promise<string | null> }) => new DrizzleApplyRepository(database, options);
