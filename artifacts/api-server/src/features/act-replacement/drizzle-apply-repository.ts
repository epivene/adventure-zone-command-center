import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import type { ManifestOperation } from "./manifest-builder";
import type { ApplyAttempt, ApplyBatchClaim, ApplyBatchRecord, ApplyOrigin, ApplyRepository, ApplyTarget, FillMissingResult, ReviewedOverwriteInput, StoredApproval, StoredOperation } from "./apply-repository";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import { localValueFingerprint } from "./local-edit-policy";
import { writableFieldAcceptsBlank, writablePhysicalColumn, writableTargetFieldColumns } from "./writable-target-fields";

type DrizzleDatabase = typeof database;
type SqlExecutor = Pick<DrizzleDatabase, "execute">;
type Row = Record<string, unknown>;
const entityTables: Record<string, string> = { organization: "organizations", contact: "contacts", booking: "bookings", calling_list: "calling_lists", activity: "activities" };
const targetTypes = new Set(Object.keys(entityTables));
const rows = (value: unknown): Row[] => Array.isArray((value as { rows?: unknown[] })?.rows) ? ((value as { rows: Row[] }).rows) : [];
const asString = (value: unknown) => typeof value === "string" ? value : value == null ? "" : String(value);
const asJson = <T>(value: unknown, fallback: T): T => value == null ? fallback : value as T;
const normalizedContactPhone = (value: unknown) => typeof value === "string" ? normalizeNorthAmericanPhone(value) : null;

/** Durable SQL adapter. It deliberately uses the normalized Phase-2 tables and only the
 * allow-listed local target tables. Unsupported target shapes fail closed instead of
 * guessing columns or writing arbitrary SQL. */
export class DrizzleApplyRepository implements ApplyRepository {
  readonly durableApply = true as const;
  constructor(private readonly database: DrizzleDatabase, private readonly options: { manifestDigest?: (runId: string) => Promise<string | null> } = {}) {}

  private async query(query: ReturnType<typeof sql>, executor: SqlExecutor = this.database): Promise<Row[]> { return rows(await executor.execute(query)); }
  private lostAttempt(): never { throw Object.assign(new Error("apply_attempt_lost"), { code: "apply_attempt_lost", status: 409 }); }
  private async withAttempt<T>(attempt: ApplyAttempt, mutation: (executor: SqlExecutor) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const executor = transaction as unknown as SqlExecutor;
      const renewed = await this.query(sql`update act_replacement_apply_batches set lease_expires_at = now() + interval '2 minutes', updated_at = now() where id = ${attempt.batchId} and attempt_token = ${attempt.attemptToken} and state = 'applying' and lease_expires_at > now() returning id`, executor);
      if (renewed.length !== 1) this.lostAttempt();
      return mutation(executor);
    });
  }
  async getOperations(runId: string, ids: string[]) {
    return this.getOperationsWith(this.database, runId, ids);
  }
  private async getOperationsWith(executor: SqlExecutor, runId: string, ids: string[]) {
    if (!ids.length) return [];
    const result = await this.query(sql`select operations.id, operations.run_id as "runId", operations.source_record_id as "sourceRecordId", operations.source_version_id as "sourceVersionId", operations.operation_key as "operationKey", operations.target_type as "targetType", operations.action, operations.payload, operations.dependency_operation_keys as "dependencyOperationKeys", operations.required_for_source_outcome as "requiredForSourceOutcome", operations.safe_by_default as "safeByDefault", operations.status, operations.attempt_count as "attemptCount", operations.last_error_code as "lastErrorCode", outcomes.state as "outcomeState", sources.latest_version_id as "latestSourceVersionId" from act_replacement_apply_operations operations inner join act_replacement_outcomes outcomes on outcomes.run_id = operations.run_id and outcomes.source_record_id = operations.source_record_id inner join act_source_records sources on sources.id = operations.source_record_id where operations.run_id = ${runId} and operations.operation_key in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`, executor);
    return result.map((r) => this.operation(r));
  }
  async getManifestDigest(runId: string) {
    if (this.options.manifestDigest) return this.options.manifestDigest(runId);
    const result = await this.query(sql`select summary->>'manifestDigest' as digest from act_replacement_runs where id = ${runId} limit 1`);
    return result[0]?.digest ? asString(result[0].digest) : null;
  }
  async getApproval(runId: string, requestKey: string): Promise<StoredApproval | null> {
    const result = await this.query(sql`select manifest_digest as "manifestDigest", approval_mode as "approvalMode", approval_mode_version as "approvalModeVersion", dependency_closed_operation_ids as "approvedOperationIds" from act_replacement_approval_requests where run_id = ${runId} and request_key = ${requestKey} limit 1`);
    const row = result[0];
    return row ? {
      manifestDigest: asString(row.manifestDigest),
      approvedOperationIds: asJson<string[]>(row.approvedOperationIds, []),
      approvalMode: row.approvalMode === "automatic_safe" || row.approvalMode === "explicit_manual" ? row.approvalMode : null,
      approvalModeVersion: typeof row.approvalModeVersion === "number" ? row.approvalModeVersion : null,
    } : null;
  }
  async listApprovalBatches(runId: string, approvalRequestKey: string) {
    const result = await this.query(sql`select request_key as "requestKey" from act_replacement_apply_batches where run_id = ${runId} and approval_request_key = ${approvalRequestKey} order by start_cursor asc, created_at asc, id asc`);
    const batches = await Promise.all(result.map((row) => this.getBatch(runId, asString(row.requestKey))));
    return batches.filter((batch): batch is ApplyBatchRecord => Boolean(batch));
  }
  async updateRunPhase(runId: string, phase: "ready_to_apply" | "applying" | "complete" | "complete_with_issues", errorCode?: string) {
    await this.database.execute(sql`update act_replacement_runs set phase = ${phase}, last_error_code = ${errorCode ?? null}, completed_at = case when ${phase} in ('complete','complete_with_issues') then now() else null end, updated_at = now() where id = ${runId} and phase in ('ready_to_apply','applying','complete_with_issues')`);
  }
  async createBatch(input: Omit<ApplyBatchRecord, "completed" | "alreadyPresent" | "blocked" | "failed">): Promise<ApplyBatchClaim> {
    return this.database.transaction(async (transaction) => {
      const executor = transaction as unknown as SqlExecutor;
      const gated = await this.query(sql`update act_replacement_runs set phase = 'applying', last_error_code = null, completed_at = null, updated_at = now() where id = ${input.runId} and phase in ('ready_to_apply','applying','complete_with_issues') and summary->>'manifestDigest' = ${input.manifestDigest} and organizer_token is null returning id`, executor);
      if (gated.length !== 1) throw Object.assign(new Error("apply_run_not_claimable"), { code: "apply_run_not_claimable", status: 409 });
      const claimed = await this.query(sql`update act_replacement_apply_batches set state = ${input.state}, replay_fingerprint = ${input.fingerprint ?? null}, lease_owner = ${input.leaseOwner ?? null}, lease_expires_at = ${input.leaseExpiresAt ? new Date(input.leaseExpiresAt) : null}, attempt_token = ${input.attemptToken ?? null}, started_at = coalesce(started_at, now()), attempt_count = attempt_count + 1, updated_at = now() where run_id = ${input.runId} and request_key = ${input.requestKey} and manifest_digest = ${input.manifestDigest} and dependency_closed_operation_ids = ${JSON.stringify(input.operationIds)}::jsonb and approval_request_key is not distinct from ${input.approvalRequestKey ?? null} and start_cursor is not distinct from ${input.startCursor ?? null} and (state = 'queued' or (state = 'applying' and lease_expires_at <= now())) returning id`, executor);
      if (claimed.length) { const batch = await this.getBatchWith(executor, input.runId, input.requestKey); if (!batch) throw new Error("apply_batch_claim_failed"); return { batch, claimed: true }; }
      const existing = await this.getBatchWith(executor, input.runId, input.requestKey); if (existing) return { batch: existing, claimed: false };
      const inserted = await this.query(sql`insert into act_replacement_apply_batches (request_key, run_id, approval_request_key, start_cursor, manifest_digest, replay_fingerprint, selected_operation_ids, dependency_closed_operation_ids, selected_count, dependency_count, state, lease_owner, lease_expires_at, attempt_token, started_at, updated_at) values (${input.requestKey}, ${input.runId}, ${input.approvalRequestKey ?? null}, ${input.startCursor ?? null}, ${input.manifestDigest}, ${input.fingerprint ?? null}, ${JSON.stringify(input.operationIds)}::jsonb, ${JSON.stringify(input.operationIds)}::jsonb, ${input.operationIds.length}, 0, ${input.state}, ${input.leaseOwner ?? null}, ${input.leaseExpiresAt ? new Date(input.leaseExpiresAt) : null}, ${input.attemptToken ?? null}, now(), now()) on conflict do nothing returning id`, executor);
      const created = await this.getBatchWith(executor, input.runId, input.requestKey); if (!created) throw new Error("apply_batch_create_failed"); return { batch: created, claimed: inserted.length > 0 };
    });
  }
  async getBatch(runId: string, requestKey: string): Promise<ApplyBatchRecord | null> {
    return this.getBatchWith(this.database, runId, requestKey);
  }
  private async getBatchWith(executor: SqlExecutor, runId: string, requestKey: string): Promise<ApplyBatchRecord | null> {
    const result = await this.query(sql`select id, run_id as "runId", request_key as "requestKey", approval_request_key as "approvalRequestKey", start_cursor as "startCursor", manifest_digest as "manifestDigest", dependency_closed_operation_ids as "operationIds", state, replay_fingerprint as "fingerprint", lease_owner as "leaseOwner", lease_expires_at as "leaseExpiresAt", attempt_token as "attemptToken" from act_replacement_apply_batches where run_id = ${runId} and request_key = ${requestKey} limit 1`, executor);
    const row = result[0]; if (!row) return null;
    const operationIds = asJson<string[]>(row.operationIds, []); const operationRows = await this.getOperationsWith(executor, runId, operationIds);
    const counts = operationRows.reduce((a, o) => { if (o.status === "applied") a.completed++; else if (o.status === "already_present") a.alreadyPresent++; else if (o.status === "blocked") a.blocked++; else if (o.status === "failed") a.failed++; return a; }, { completed: 0, alreadyPresent: 0, blocked: 0, failed: 0 });
    return { batchId: asString(row.id), runId: asString(row.runId), requestKey: asString(row.requestKey), approvalRequestKey: row.approvalRequestKey ? asString(row.approvalRequestKey) : undefined, startCursor: row.startCursor == null ? undefined : Number(row.startCursor), manifestDigest: asString(row.manifestDigest), operationIds, state: asString(row.state) as ApplyBatchRecord["state"], leaseOwner: row.leaseOwner ? asString(row.leaseOwner) : undefined, leaseExpiresAt: row.leaseExpiresAt ? new Date(String(row.leaseExpiresAt)).getTime() : undefined, attemptToken: row.attemptToken ? asString(row.attemptToken) : undefined, fingerprint: row.fingerprint ? asString(row.fingerprint) : undefined, ...counts };
  }
  async saveOperation(operation: StoredOperation, attempt: ApplyAttempt) {
    const leased = operation.status === "leased";
    await this.withAttempt(attempt, async (executor) => { await executor.execute(sql`update act_replacement_apply_operations set status = ${operation.status}, attempt_count = ${operation.attemptCount}, last_error_code = ${operation.lastErrorCode ?? null}, lease_owner = case when ${leased} then 'act-apply' else null end, lease_expires_at = case when ${leased} then now() + interval '2 minutes' else null end, updated_at = now(), executed_at = case when ${operation.status} in ('applied','already_present','blocked','failed') then now() else executed_at end where id = ${operation.id}`); });
  }
  async getTarget(entityType: string, id: string): Promise<ApplyTarget | null> {
    return this.getTargetWith(this.database, entityType, id);
  }
  private target(entityType: string, row: Row, sourceRecordId?: string): ApplyTarget {
    const values = { ...row };
    for (const [logical, physical] of Object.entries(writableTargetFieldColumns[entityType] ?? {})) values[logical] = row[physical];
    return { id: asString(row.id), entityType, values, sourceIds: new Set([sourceRecordId ?? asString(row.source_record_id ?? row.act_record_id ?? row.actRecordId)].filter(Boolean)) };
  }
  private async getTargetWith(executor: SqlExecutor, entityType: string, id: string): Promise<ApplyTarget | null> {
    const table = entityTables[entityType]; if (!table || !id) return null;
    const result = await this.query(sql`select * from ${sql.raw(table)} where id = ${id} limit 1`, executor); const row = result[0]; if (!row) return null;
    return this.target(entityType, row);
  }
  async findTargetBySource(entityType: string, sourceRecordId: string) {
    return this.findTargetBySourceWith(this.database, entityType, sourceRecordId);
  }
  private async findTargetBySourceWith(executor: SqlExecutor, entityType: string, sourceRecordId: string) {
    const table = entityTables[entityType]; if (!table) return null;
    if (entityType === "activity") {
      const result = await this.query(sql`select * from activities where source_record_id = ${sourceRecordId} limit 1`, executor); const row = result[0];
      return row ? this.target(entityType, row, sourceRecordId) : null;
    }
    const linked = await this.query(sql`select target.* from act_external_links links inner join ${sql.raw(table)} target on target.id = links.entity_id where links.source_record_id = ${sourceRecordId} and links.entity_type = ${entityType} limit 1`, executor);
    if (linked[0]) return this.target(entityType, linked[0], sourceRecordId);
    const source = await this.sourceIdentity(sourceRecordId, executor);
    if (!source.actRecordId) return null;
    const legacyLinked = await this.query(sql`select target.* from act_external_links links inner join ${sql.raw(table)} target on target.id = links.entity_id where links.source_record_id is null and links.source_database_key = ${source.sourceDatabaseKey} and links.source_entity_type = ${source.streamType} and links.act_record_id = ${source.actRecordId} and links.entity_type = ${entityType} limit 1`, executor);
    if (legacyLinked[0]) return this.target(entityType, legacyLinked[0], sourceRecordId);
    if (entityType === "calling_list") return null;
    const result = await this.query(sql`select * from ${sql.raw(table)} where act_record_id = ${source.actRecordId} limit 1`, executor); const row = result[0]; return row ? this.target(entityType, row, sourceRecordId) : null;
  }
  private async sourceIdentity(sourceRecordId: string, executor: SqlExecutor = this.database) {
    const result = await this.query(sql`select source_database_key as "sourceDatabaseKey", stream_type as "streamType", act_record_id as "actRecordId" from act_source_records where id = ${sourceRecordId} limit 1`, executor);
    const row = result[0];
    if (!row) return { sourceDatabaseKey: "", streamType: "", actRecordId: "" };
    return { sourceDatabaseKey: asString(row.sourceDatabaseKey), streamType: asString(row.streamType), actRecordId: asString(row.actRecordId) };
  }
  async createTarget(entityType: string, values: Record<string, unknown>, sourceRecordId: string, sourceVersionId: string | undefined, attempt: ApplyAttempt) {
    if (!targetTypes.has(entityType)) throw Object.assign(new Error("unsupported_target_type"), { code: "unsupported_target_type" });
    return this.withAttempt(attempt, async (executor) => {
      const existing = await this.findTargetBySourceWith(executor, entityType, sourceRecordId); if (existing) return { target: existing, alreadyPresent: true };
      const normalized = (values.normalized as Record<string, unknown> | undefined) ?? values;
      const table = entityTables[entityType];
      const source = entityType === "activity" ? null : await this.sourceIdentity(sourceRecordId, executor);
      if (entityType !== "activity" && !source?.actRecordId) throw Object.assign(new Error("source_act_id_missing"), { code: "source_act_id_missing" });
      const payload = this.targetColumns(entityType, normalized, sourceRecordId, sourceVersionId, source?.actRecordId ?? "");
      if (entityType === "calling_list" && source) {
        const result = await this.query(sql`with locked as materialized (
        select pg_advisory_xact_lock(hashtextextended(${`act-calling-list:${sourceRecordId}`}, 0))
      ), existing as (
        select target.*, true as "alreadyPresent"
        from locked
        inner join act_external_links links on links.source_record_id = ${sourceRecordId} and links.entity_type = 'calling_list'
        inner join calling_lists target on target.id = links.entity_id
      ), inserted as (
        insert into calling_lists (name, kind)
        select ${payload.name}, ${payload.kind} from locked
        where not exists (select 1 from existing)
        returning *, false as "alreadyPresent"
      ), chosen as (
        select * from existing union all select * from inserted limit 1
      ), linked as (
        insert into act_external_links (entity_type, entity_id, source_entity_type, act_record_id, source_database_key, source_record_id)
        select 'calling_list', chosen.id, 'group', ${source.actRecordId}, ${source.sourceDatabaseKey}, ${sourceRecordId} from chosen
        on conflict (source_record_id) where source_record_id is not null do update
        set entity_type = excluded.entity_type, entity_id = excluded.entity_id,
            source_entity_type = excluded.source_entity_type, act_record_id = excluded.act_record_id,
            source_database_key = excluded.source_database_key
        returning entity_id
        ) select chosen.* from chosen inner join linked on linked.entity_id = chosen.id`, executor);
        const row = result[0]; if (!row) throw new Error("target_create_failed");
        return { target: this.target(entityType, row, sourceRecordId), alreadyPresent: Boolean(row.alreadyPresent) };
      }
      const columns = Object.keys(payload);
      const result = await this.query(sql`insert into ${sql.raw(table)} (${sql.join(columns.map((key) => sql.raw(key)), sql.raw(", "))}) values (${sql.join(columns.map((key) => sql`${payload[key]}`), sql.raw(", "))}) returning *`, executor);
      const row = result[0]; if (!row) throw new Error("target_create_failed");
      if (entityType === "booking") {
        const sales = normalized.salesMilestones as { estimatedCloseDate?: unknown; actualCloseDate?: unknown } | undefined;
        const dates = sales
          ? [["public_start", sales.estimatedCloseDate], ["public_end", sales.actualCloseDate]]
          : [["public_start", normalized.startsAt ?? normalized.starts_at], ["public_end", normalized.endsAt ?? normalized.ends_at]];
        for (const [field, value] of dates) {
          if (typeof value !== "string" || !value) continue;
          await executor.execute(sql`insert into booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor)
            values (${row.id}::uuid,${field},${sales ? "sales_milestone" : "unknown_import"},${value},'instant',1,'act_source_record',${sourceRecordId},${sourceVersionId ?? "unknown_version"},'act-import')
            on conflict do nothing`);
        }
      }
      return { target: this.target(entityType, row, sourceRecordId), alreadyPresent: false };
    });
  }
  private targetColumns(entityType: string, value: Record<string, unknown>, sourceRecordId: string, sourceVersionId: string | undefined, actRecordId: string): Record<string, unknown> {
    const pick = (...keys: string[]) => { for (const key of keys) if (value[key] !== undefined && value[key] !== null && value[key] !== "") return value[key]; return null; };
    if (entityType === "organization") return { name: pick("name") ?? "Unnamed organization", act_record_id: actRecordId, phone: pick("phone"), website: pick("website"), act_industry: pick("industry", "act_industry"), address_1: pick("address1", "address_1"), address_2: pick("address2", "address_2"), city: pick("city"), region: pick("region"), postal_code: pick("postalCode", "postal_code") };
    if (entityType === "contact") { const phone = pick("phone"); return { first_name: pick("firstName", "first_name") ?? "Unknown", last_name: pick("lastName", "last_name") ?? "Contact", email: pick("email"), phone, normalized_phone: normalizedContactPhone(phone), act_record_id: actRecordId, job_title: pick("jobTitle", "job_title"), address_1: pick("address1", "address_1"), address_2: pick("address2", "address_2"), city: pick("city"), region: pick("region"), postal_code: pick("postalCode", "postal_code") }; }
    if (entityType === "booking") return { name: pick("name") ?? "Unnamed booking", city: pick("city") ?? "Unknown", region: pick("region") ?? "Unknown", act_record_id: actRecordId, venue_name: pick("venueName", "venue_name"), address_1: pick("address1", "address_1"), postal_code: pick("postalCode", "postal_code"), starts_at: null, ends_at: null, status: pick("localStatus", "status") ?? "new_lead", probability: pick("localProbability", "probability") ?? "possible", notes: pick("notes") };
    if (entityType === "calling_list") return { name: pick("name") ?? "Imported calling list", kind: "static" };
    return { kind: pick("category") ?? "act_history", subject: pick("subject"), status: pick("status"), body: String(pick("body", "text", "name") ?? "Imported activity"), occurred_at: pick("sourceOccurredAt", "occurredAt", "occurred_at"), timeline_sort_at: pick("timelineSortAt", "timeline_sort_at") ?? new Date(), date_is_import_fallback: pick("dateIsImportFallback", "date_is_import_fallback") ?? false, ends_at: pick("endsAt", "ends_at"), source_record_id: sourceRecordId, source_version_id: sourceVersionId ?? null, source_type: pick("sourceType", "source_type") ?? "activity" };
  }
  private requireVerifiedEventDates(entityType: string, column: string | null) {
    if (entityType === "booking" && (column === "starts_at" || column === "ends_at"))
      throw Object.assign(new Error("Use booking date repair with verified event evidence."), { code: "verified_event_date_required", status: 409 });
  }
  async writeTarget(target: ApplyTarget, field: string, value: unknown, attempt: ApplyAttempt) {
    const table = entityTables[target.entityType];
    const column = writablePhysicalColumn(target.entityType, field);
    this.requireVerifiedEventDates(target.entityType, column);
    if (!table || !column) throw Object.assign(new Error("unsupported_target_field"), { code: "unsupported_target_field" });
    const normalizedAssignment = target.entityType === "contact" && field === "phone"
      ? sql`, normalized_phone = ${normalizedContactPhone(value)}`
      : sql``;
    await this.withAttempt(attempt, async (executor) => { await executor.execute(sql`update ${sql.raw(table)} set ${sql.raw(column)} = ${value}${normalizedAssignment}, updated_at = now() where id = ${target.id}`); });
  }
  async applyReviewedOverwrite(input: ReviewedOverwriteInput, attempt: ApplyAttempt) {
    const table = entityTables[input.target.entityType];
    const column = writablePhysicalColumn(input.target.entityType, input.field);
    this.requireVerifiedEventDates(input.target.entityType, column);
    if (!table || !column) throw Object.assign(new Error("unsupported_target_field"), { code: "unsupported_target_field" });
    if (localValueFingerprint(input.expectedLocalValue) !== input.expectedLocalValueFingerprint) throw Object.assign(new Error("local_edit_detected"), { code: "local_edit_detected" });
    const normalizedAssignment = input.target.entityType === "contact" && input.field === "phone"
      ? sql`, normalized_phone = ${normalizedContactPhone(input.value)}`
      : sql``;
    await this.withAttempt(attempt, async (executor) => {
      const applied = await this.query(sql`with overwritten as (
        update ${sql.raw(table)} set ${sql.raw(column)} = ${input.value}${normalizedAssignment}, updated_at = now()
        where id = ${input.target.id} and ${sql.raw(column)} is not distinct from ${input.expectedLocalValue}
        returning id
      ), origin as (
        insert into act_imported_field_origins (entity_type, entity_id, field_name, source_record_id, source_version_id, operation_id, source_value_fingerprint)
        select ${input.origin.entityType}, ${input.origin.entityId}, ${input.origin.fieldName}, ${input.origin.sourceRecordId}, ${input.origin.sourceVersionId}, ${input.origin.operationId}, ${input.origin.sourceValueFingerprint}
        from overwritten
        on conflict (entity_type, entity_id, field_name) do update set source_record_id = excluded.source_record_id, source_version_id = excluded.source_version_id, operation_id = excluded.operation_id, source_value_fingerprint = excluded.source_value_fingerprint, updated_at = now()
        returning operation_id
      ), completed as (
        update act_replacement_apply_operations set status = 'applied', attempt_count = ${input.operation.attemptCount}, last_error_code = null, lease_owner = null, lease_expires_at = null, updated_at = now(), executed_at = now()
        where id = ${input.operation.id} and status = 'leased' and exists (select 1 from origin)
        returning id as "operationId"
      ) select "operationId" from completed`, executor);
      if (applied.length !== 1) throw Object.assign(new Error("local_edit_detected"), { code: "local_edit_detected", status: 409 });
    });
  }
  async fillMissingTarget(target: ApplyTarget, field: string, value: unknown, attempt: ApplyAttempt): Promise<FillMissingResult> {
    const table = entityTables[target.entityType];
    const column = writablePhysicalColumn(target.entityType, field);
    this.requireVerifiedEventDates(target.entityType, column);
    if (!table || !column) throw Object.assign(new Error("unsupported_target_field"), { code: "unsupported_target_field" });
    return this.withAttempt(attempt, async (executor) => {
      const blankCondition = writableFieldAcceptsBlank(target.entityType, field) ? sql` or ${sql.raw(column)} = ''` : sql``;
      const normalizedAssignment = target.entityType === "contact" && field === "phone"
        ? sql`, normalized_phone = ${normalizedContactPhone(value)}`
        : sql``;
      const updated = await this.query(sql`update ${sql.raw(table)} set ${sql.raw(column)} = ${value}${normalizedAssignment}, updated_at = now() where id = ${target.id} and (${sql.raw(column)} is null${blankCondition}) returning ${sql.raw(column)} as value`, executor);
      if (updated.length === 1) return "applied";
      const current = await this.query(sql`select ${sql.raw(column)} as value, ${sql.raw(column)} is not distinct from ${value} as "sameValue" from ${sql.raw(table)} where id = ${target.id} limit 1`, executor);
      if (current.length !== 1) throw Object.assign(new Error("target_not_found"), { code: "target_not_found" });
      return Boolean(current[0]?.sameValue) ? "already_present" : "local_value_nonempty";
    });
  }
  async recordOrigin(input: ApplyOrigin, attempt: ApplyAttempt) {
    await this.withAttempt(attempt, async (executor) => { await executor.execute(sql`insert into act_imported_field_origins (entity_type, entity_id, field_name, source_record_id, source_version_id, operation_id, source_value_fingerprint) values (${input.entityType}, ${input.entityId}, ${input.fieldName}, ${input.sourceRecordId}, ${input.sourceVersionId}, ${input.operationId}, ${input.sourceValueFingerprint}) on conflict (entity_type, entity_id, field_name) do update set source_record_id = excluded.source_record_id, source_version_id = excluded.source_version_id, operation_id = excluded.operation_id, source_value_fingerprint = excluded.source_value_fingerprint, updated_at = now()`); });
  }
  async createRelationship(operation: StoredOperation, attempt: ApplyAttempt): Promise<"applied" | "already_present"> {
    return this.withAttempt(attempt, async (executor) => {
      const childType = operation.targetType === "organization_contact" ? "contact" : operation.targetType === "booking_contact" ? "booking" : operation.targetType === "calling_list_member" ? "calling_list" : "activity";
      const child = await this.findTargetBySourceWith(executor, childType, operation.sourceRecordId);
      const parentEntityId = asString(operation.payload.parentEntityId);
      const parentType = asString(operation.payload.parentType);
      const parentSourceRecordId = asString(operation.payload.parentSourceRecordId);
      const parentTarget = parentEntityId
        ? await this.getTargetWith(executor, parentType, parentEntityId)
        : parentSourceRecordId
          ? await this.findParent(parentSourceRecordId, executor)
          : null;
      if (!child || !parentTarget) throw new Error(parentEntityId || parentSourceRecordId ? "relationship_target_missing" : "relationship_parent_missing");
      if (operation.targetType === "organization_contact") return this.link("organization_contacts", "organization_id", parentTarget.id, "contact_id", child.id, executor);
      if (operation.targetType === "booking_contact") return this.link("booking_contacts", "booking_id", child.id, "contact_id", parentTarget.id, executor);
      if (operation.targetType === "calling_list_member") return this.link("calling_list_memberships", "calling_list_id", child.id, "contact_id", parentTarget.id, executor);
      if (operation.targetType === "activity_association") return this.link("activity_associations", "activity_id", child.id, `${asString(operation.payload.parentType) === "organization" ? "organization_id" : asString(operation.payload.parentType) === "contact" ? "contact_id" : "booking_id"}`, parentTarget.id, executor);
      throw new Error("unsupported_relationship");
    });
  }
  private async findParent(sourceRecordId: string, executor: SqlExecutor) { for (const type of ["organization", "contact", "booking", "calling_list", "activity"]) { const target = await this.findTargetBySourceWith(executor, type, sourceRecordId); if (target) return target; } return null; }
  private async link(table: string, left: string, leftId: string, right: string, rightId: string, executor: SqlExecutor): Promise<"applied" | "already_present"> {
    const inserted = await this.query(sql`insert into ${sql.raw(table)} (${sql.raw(left)}, ${sql.raw(right)}) values (${leftId}, ${rightId}) on conflict do nothing returning 1 as inserted`, executor);
    return inserted.length ? "applied" : "already_present";
  }
  async recordProvenance(operation: StoredOperation, attempt: ApplyAttempt) {
    const sourceTypeByTarget: Record<string, string> = {
      organization: "company",
      contact: "contact",
      booking: "opportunity",
      calling_list: "group",
    };
    const sourceEntityType = sourceTypeByTarget[operation.targetType];
    const table = entityTables[operation.targetType];
    if (!sourceEntityType || !table) return;

    await this.withAttempt(attempt, async (executor) => {

    const sourceRows = await this.query(sql`select source_database_key as "sourceDatabaseKey", stream_type as "streamType", act_record_id as "actRecordId" from act_source_records where id = ${operation.sourceRecordId} limit 1`, executor);
    const source = sourceRows[0];
    const actRecordId = source?.actRecordId ? asString(source.actRecordId) : "";
    if (!source || asString(source.streamType) !== sourceEntityType || !actRecordId) {
      throw Object.assign(new Error("provenance_source_missing"), { code: "provenance_source_missing" });
    }

    const explicitLocalId = operation.payload.localId;
    const target = typeof explicitLocalId === "string" && explicitLocalId
      ? await this.getTargetWith(executor, operation.targetType, explicitLocalId)
      : await this.findTargetBySourceWith(executor, operation.targetType, operation.sourceRecordId);
    if (!target) throw Object.assign(new Error("provenance_target_missing"), { code: "provenance_target_missing" });

    const upgradedLegacy = await this.query(sql`update act_external_links set source_record_id = ${operation.sourceRecordId}, updated_at = now() where source_record_id is null and source_database_key = ${asString(source.sourceDatabaseKey)} and source_entity_type = ${sourceEntityType} and act_record_id = ${actRecordId} and entity_type = ${operation.targetType} and entity_id = ${target.id} returning id`, executor);
    if (!upgradedLegacy.length) await executor.execute(sql`insert into act_external_links (entity_type, entity_id, source_entity_type, act_record_id, source_database_key, source_record_id) values (${operation.targetType}, ${target.id}, ${sourceEntityType}, ${actRecordId}, ${asString(source.sourceDatabaseKey)}, ${operation.sourceRecordId}) on conflict (source_record_id) where source_record_id is not null do update set entity_type = excluded.entity_type, entity_id = excluded.entity_id, source_entity_type = excluded.source_entity_type, act_record_id = excluded.act_record_id, source_database_key = excluded.source_database_key`);
    });
  }
  async finishBatch(batch: ApplyBatchRecord, attempt: ApplyAttempt) {
    await this.withAttempt(attempt, async (executor) => {
      await executor.execute(sql`with current_operations as (
        select operations.*
        from act_replacement_apply_operations operations
        inner join act_replacement_runs runs on runs.id = operations.run_id
        where operations.run_id = ${batch.runId}
          and operations.manifest_generation is not distinct from runs.manifest_generation
      )
      update act_replacement_outcomes outcomes
        set state = case
          when exists (select 1 from current_operations operations where operations.source_record_id = outcomes.source_record_id and operations.status = 'failed') then 'failed'
          when exists (select 1 from current_operations operations where operations.source_record_id = outcomes.source_record_id and operations.status = 'blocked') then 'awaiting_review'
          when not exists (select 1 from current_operations operations where operations.source_record_id = outcomes.source_record_id and operations.status not in ('applied','already_present'))
            then case when exists (select 1 from current_operations operations where operations.source_record_id = outcomes.source_record_id and operations.status = 'applied') then 'applied' else 'already_present' end
          else outcomes.state
        end,
        updated_at = now()
        where outcomes.run_id = ${batch.runId}
          and outcomes.source_record_id in (
            select distinct operations.source_record_id
            from current_operations operations
            where operations.operation_key in (select jsonb_array_elements_text(${JSON.stringify(batch.operationIds)}::jsonb))
          )
          and (
            exists (select 1 from current_operations operations where operations.source_record_id = outcomes.source_record_id and operations.status in ('blocked','failed'))
            or not exists (select 1 from current_operations operations where operations.source_record_id = outcomes.source_record_id and operations.status not in ('applied','already_present'))
          )`);
      const finished = await this.query(sql`update act_replacement_apply_batches set state = ${batch.state}, lease_owner = null, lease_expires_at = null, attempt_token = null, last_error_code = ${batch.failed ? "apply_failed" : null}, completed_at = case when ${batch.state} in ('complete','complete_with_issues') then now() else completed_at end, updated_at = now() where id = ${attempt.batchId} and attempt_token = ${attempt.attemptToken} and state = 'applying' returning id`, executor);
      if (finished.length !== 1) this.lostAttempt();
    });
  }
  private operation(row: Row): StoredOperation { return { id: asString(row.id), operationKey: asString(row.operationKey), sourceRecordId: asString(row.sourceRecordId), sourceVersionId: asString(row.sourceVersionId), targetType: asString(row.targetType) as ManifestOperation["targetType"], action: asString(row.action) as ManifestOperation["action"], payload: asJson(row.payload, {}), dependencyOperationKeys: asJson(row.dependencyOperationKeys, []), requiredForSourceOutcome: Boolean(row.requiredForSourceOutcome), safeByDefault: Boolean(row.safeByDefault), status: asString(row.status) as StoredOperation["status"], attemptCount: Number(row.attemptCount ?? 0), lastErrorCode: row.lastErrorCode ? asString(row.lastErrorCode) : undefined, outcomeState: asString(row.outcomeState), latestSourceVersionId: row.latestSourceVersionId ? asString(row.latestSourceVersionId) : null }; }
}

/** Lazy production factory: callers inject the already-configured db client so this
 * module never opens a connection during import or in preview-only deployments. */
export const createDrizzleApplyRepository = (database: DrizzleDatabase, options?: { manifestDigest?: (runId: string) => Promise<string | null> }) => new DrizzleApplyRepository(database, options);
