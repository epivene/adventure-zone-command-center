import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import type {
  RecoveryCandidate,
  RecoveryReviewItem,
  RecoveryRunStatus,
  RecoveryTerminalState,
} from "./recovery-types";

type DrizzleDatabase = typeof applicationDatabase;
type Executor = Pick<DrizzleDatabase, "execute">;
type Row = Record<string, unknown>;

const leaseMs = 5 * 60_000;

export const recoveryPriority: Readonly<Record<string, number>> = {
  company: 10,
  contact: 20,
  company_contact: 30,
  opportunity: 40,
  opportunity_company: 50,
  opportunity_contact: 50,
  group: 60,
  group_contact: 70,
  note: 80,
  history: 80,
  activity: 80,
  note_contact: 90,
  note_company: 90,
  note_opportunity: 90,
  history_contact: 90,
  history_company: 90,
  history_opportunity: 90,
  activity_contact: 90,
  activity_company: 90,
  activity_opportunity: 90,
};

function resultRows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  const rows = (value as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? rows as Row[] : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function nullableText(value: unknown): string | null {
  const valueText = text(value).trim();
  return valueText ? valueText : null;
}

function number(value: unknown): number {
  return Number(value ?? 0);
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function state(value: unknown): RecoveryRunStatus["state"] {
  return value === "complete" || value === "failed" ? value : "running";
}

function statusFromRow(row: Row): RecoveryRunStatus {
  return {
    runId: text(row.runId),
    state: state(row.state),
    candidateCount: number(row.candidateCount),
    pending: number(row.pending),
    leased: number(row.leased),
    alreadyPresent: number(row.alreadyPresent),
    recovered: number(row.recovered),
    needsReview: number(row.needsReview),
    droppedUnusable: number(row.droppedUnusable),
    retryableFailed: number(row.retryableFailed),
  };
}

function invalid(code: string): Error & { code: string; status: number } {
  return Object.assign(new Error(code), { code, status: 409 });
}

function priorityCase() {
  const clauses = Object.entries(recoveryPriority).map(([streamType, priority]) =>
    sql`when ${streamType} then ${priority}`,
  );
  return sql`case source.stream_type ${sql.join(clauses, sql` `)} else 999 end`;
}

export class DrizzleActArchiveRecoveryRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  private async query(query: ReturnType<typeof sql>, executor: Executor = this.database): Promise<Row[]> {
    return resultRows(await executor.execute(query));
  }

  async createOrGetRun(input: {
    sourceDatabaseKey: string;
    requestKey: string;
    requestedBy: string;
    now: Date;
  }): Promise<RecoveryRunStatus> {
    if (!input.sourceDatabaseKey.trim() || !input.requestKey.trim() || !input.requestedBy.trim()) {
      throw invalid("act_recovery_input_invalid");
    }
    return this.database.transaction(async (transaction) => {
      const executor = transaction as unknown as Executor;
      await executor.execute(sql`
        insert into act_archive_recovery_runs
          (source_database_key, requested_by, request_key, created_at, updated_at)
        values (${input.sourceDatabaseKey}, ${input.requestedBy}, ${input.requestKey}, ${input.now}, ${input.now})
        on conflict (source_database_key, request_key) do nothing
      `);
      const runs = await this.query(sql`
        select id, requested_by as "requestedBy"
        from act_archive_recovery_runs
        where source_database_key = ${input.sourceDatabaseKey}
          and request_key = ${input.requestKey}
        for update
      `, executor);
      const run = runs[0];
      if (!run) throw invalid("act_recovery_run_create_failed");
      if (text(run.requestedBy) !== input.requestedBy) throw invalid("act_recovery_request_owner_mismatch");
      const runId = text(run.id);
      await executor.execute(sql`
        insert into act_archive_recovery_items
          (run_id, source_record_id, source_version_id, stream_type, priority, created_at, updated_at)
        select ${runId}, source.id, source.latest_version_id, source.stream_type,
          ${priorityCase()}, ${input.now}, ${input.now}
        from act_source_records source
        where source.source_database_key = ${input.sourceDatabaseKey}
          and source.latest_version_id is not null
        order by ${priorityCase()}, source.id
        on conflict (run_id, source_record_id) do nothing
      `);
      await executor.execute(sql`
        update act_archive_recovery_runs runs
        set candidate_count = (
          select count(*) from act_archive_recovery_items item where item.run_id = runs.id
        ), updated_at = ${input.now}
        where id = ${runId}
      `);
      return this.statusWith(runId, executor);
    });
  }

  async claimNext(input: { workerId: string; now: Date }): Promise<RecoveryCandidate | null> {
    if (!input.workerId.trim()) throw invalid("act_recovery_worker_invalid");
    return this.database.transaction(async (transaction) => {
      const executor = transaction as unknown as Executor;
      const available = await this.query(sql`
        select id
        from act_archive_recovery_items
        where state = 'pending'
          or (state = 'retryable_failed' and (retry_after is null or retry_after <= ${input.now}))
          or (state = 'leased' and lease_expires_at <= ${input.now})
        order by priority, source_record_id
        for update skip locked
        limit 1
      `, executor);
      if (!available[0]) return null;
      const itemId = text(available[0].id);
      const token = randomUUID();
      const leaseExpiresAt = new Date(input.now.getTime() + leaseMs);
      const claimed = await this.query(sql`
        update act_archive_recovery_items
        set state = 'leased', lease_owner = ${input.workerId}, lease_token = ${token},
          lease_expires_at = ${leaseExpiresAt}, retry_after = null,
          attempt_count = attempt_count + 1, updated_at = ${input.now}
        where id = ${itemId}
        returning id
      `, executor);
      if (!claimed[0]) return null;
      const rows = await this.query(sql`
        select item.id as "itemId", item.run_id as "runId",
          item.source_record_id as "sourceRecordId", item.source_version_id as "sourceVersionId",
          item.stream_type as "streamType", item.lease_token as "leaseToken",
          source.act_record_id as "actRecordId", source.relationship_evidence as "relationshipEvidence",
          version.raw_snapshot as "rawSnapshot"
        from act_archive_recovery_items item
        inner join act_source_records source on source.id = item.source_record_id
        inner join act_source_record_versions version on version.id = item.source_version_id
        where item.id = ${itemId}
      `, executor);
      const row = rows[0];
      if (!row) throw invalid("act_recovery_claim_source_missing");
      return {
        itemId: text(row.itemId),
        runId: text(row.runId),
        sourceRecordId: text(row.sourceRecordId),
        sourceVersionId: text(row.sourceVersionId),
        streamType: text(row.streamType),
        actRecordId: nullableText(row.actRecordId),
        rawSnapshot: jsonObject(row.rawSnapshot),
        relationshipEvidence: jsonObject(row.relationshipEvidence),
        leaseToken: text(row.leaseToken),
      };
    });
  }

  async complete(input: {
    itemId: string;
    leaseToken: string;
    state: RecoveryTerminalState;
    targetSummary?: Record<string, unknown>;
    now: Date;
  }): Promise<void> {
    const rows = await this.query(sql`
      update act_archive_recovery_items
      set state = ${input.state}, target_summary = ${JSON.stringify(input.targetSummary ?? {})}::jsonb,
        last_error_code = null, retry_after = null, lease_owner = null, lease_token = null,
        lease_expires_at = null, completed_at = ${input.now}, updated_at = ${input.now}
      where id = ${input.itemId} and state = 'leased' and lease_token = ${input.leaseToken}
      returning id
    `);
    if (!rows[0]) throw invalid("act_recovery_lease_lost");
  }

  async failRetryable(input: {
    itemId: string;
    leaseToken: string;
    errorCode: string;
    retryAfter: Date;
    now: Date;
  }): Promise<void> {
    const rows = await this.query(sql`
      update act_archive_recovery_items
      set state = 'retryable_failed', last_error_code = ${input.errorCode},
        retry_after = ${input.retryAfter}, lease_owner = null, lease_token = null,
        lease_expires_at = null, completed_at = null, updated_at = ${input.now}
      where id = ${input.itemId} and state = 'leased' and lease_token = ${input.leaseToken}
      returning id
    `);
    if (!rows[0]) throw invalid("act_recovery_lease_lost");
  }

  status(runId: string): Promise<RecoveryRunStatus> {
    return this.statusWith(runId, this.database);
  }

  private async statusWith(runId: string, executor: Executor): Promise<RecoveryRunStatus> {
    const rows = await this.query(sql`
      select runs.id as "runId", runs.state, runs.candidate_count as "candidateCount",
        count(items.id) filter (where items.state = 'pending')::int as pending,
        count(items.id) filter (where items.state = 'leased')::int as leased,
        count(items.id) filter (where items.state = 'already_present')::int as "alreadyPresent",
        count(items.id) filter (where items.state = 'recovered')::int as recovered,
        count(items.id) filter (where items.state = 'needs_review')::int as "needsReview",
        count(items.id) filter (where items.state = 'dropped_unusable')::int as "droppedUnusable",
        count(items.id) filter (where items.state = 'retryable_failed')::int as "retryableFailed"
      from act_archive_recovery_runs runs
      left join act_archive_recovery_items items on items.run_id = runs.id
      where runs.id = ${runId}
      group by runs.id
    `, executor);
    if (!rows[0]) throw invalid("act_recovery_run_not_found");
    return statusFromRow(rows[0]);
  }

  async reviewPage(runId: string, limit = 50): Promise<RecoveryReviewItem[]> {
    const rows = await this.query(sql`
      select item.id as "itemId", item.source_record_id as "sourceRecordId",
        item.source_version_id as "sourceVersionId", item.stream_type as "streamType",
        item.target_summary as "targetSummary", source.act_record_id as "actRecordId",
        source.relationship_evidence as "relationshipEvidence", version.raw_snapshot as "rawSnapshot"
      from act_archive_recovery_items item
      inner join act_source_records source on source.id = item.source_record_id
      inner join act_source_record_versions version on version.id = item.source_version_id
      where item.run_id = ${runId} and item.state = 'needs_review'
      order by item.priority, item.source_record_id
      limit ${Math.max(1, Math.min(200, limit))}
    `);
    return rows.map((row) => ({
      itemId: text(row.itemId),
      sourceRecordId: text(row.sourceRecordId),
      sourceVersionId: text(row.sourceVersionId),
      streamType: text(row.streamType),
      actRecordId: nullableText(row.actRecordId),
      rawSnapshot: jsonObject(row.rawSnapshot),
      relationshipEvidence: jsonObject(row.relationshipEvidence),
      targetSummary: jsonObject(row.targetSummary),
    }));
  }
}
