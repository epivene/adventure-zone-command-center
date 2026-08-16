import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { DrizzleActArchiveRecoveryRepository } from "./recovery-repository";

type DrizzleDatabase = typeof applicationDatabase;
type Row = Record<string, unknown>;
type TargetEntityType = "organization" | "contact" | "booking";

type StreamCounts = {
  candidateCount: number;
  pending: number;
  leased: number;
  alreadyPresent: number;
  recovered: number;
  needsReview: number;
  droppedUnusable: number;
  retryableFailed: number;
};

export type ActRecoveryStatus = StreamCounts & {
  runId: string;
  sourceDatabaseKey: string;
  state: "running" | "complete" | "failed";
  checkedCount: number;
  complete: boolean;
  byStreamType: Record<string, StreamCounts>;
};

export type ActRecoveryReviewPage = {
  page: number;
  pageSize: number;
  items: Array<{
    itemId: string;
    runId: string;
    sourceRecordId: string;
    sourceVersionId: string;
    streamType: string;
    actRecordId: string | null;
    rawSnapshot: Record<string, unknown>;
    relationshipEvidence: Record<string, unknown>;
    targetSummary: Record<string, unknown>;
  }>;
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

function count(value: unknown): number {
  return Number(value ?? 0);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function conflict(code: string) {
  return Object.assign(new Error(code), { status: 409, code });
}

function notFound(code: string) {
  return Object.assign(new Error(code), { status: 404, code });
}

function invalid(code: string) {
  return Object.assign(new Error(code), { status: 400, code });
}

function countsFromRow(row: Row): StreamCounts {
  return {
    candidateCount: count(row.candidateCount),
    pending: count(row.pending),
    leased: count(row.leased),
    alreadyPresent: count(row.alreadyPresent),
    recovered: count(row.recovered),
    needsReview: count(row.needsReview),
    droppedUnusable: count(row.droppedUnusable),
    retryableFailed: count(row.retryableFailed),
  };
}

export class ActRecoveryReviewService {
  constructor(
    private readonly database: DrizzleDatabase,
    private readonly recoveryRepository = new DrizzleActArchiveRecoveryRepository(database),
  ) {}

  private async query(query: ReturnType<typeof sql>): Promise<Row[]> {
    return resultRows(await this.database.execute(query));
  }

  async startRun(input: {
    requestKey: string;
    requestedBy: string;
    sourceDatabaseKey?: string;
  }): Promise<ActRecoveryStatus> {
    const sourceDatabaseKey = input.sourceDatabaseKey?.trim() || await this.latestArchiveDatabaseKey();
    if (!sourceDatabaseKey) throw notFound("act_recovery_archive_empty");
    const run = await this.recoveryRepository.createOrGetRun({
      sourceDatabaseKey,
      requestKey: input.requestKey,
      requestedBy: input.requestedBy,
      now: new Date(),
    });
    return this.status({ runId: run.runId });
  }

  async status(input: { runId?: string; sourceDatabaseKey?: string } = {}): Promise<ActRecoveryStatus> {
    const run = input.runId
      ? await this.runById(input.runId)
      : await this.latestRun(input.sourceDatabaseKey);
    if (!run) throw notFound("act_recovery_run_not_found");
    const runId = text(run.id);
    const summaryRows = await this.query(sql`
      select
        count(*)::int as "candidateCount",
        count(*) filter (where state = 'pending')::int as pending,
        count(*) filter (where state = 'leased')::int as leased,
        count(*) filter (where state = 'already_present')::int as "alreadyPresent",
        count(*) filter (where state = 'recovered')::int as recovered,
        count(*) filter (where state = 'needs_review')::int as "needsReview",
        count(*) filter (where state = 'dropped_unusable')::int as "droppedUnusable",
        count(*) filter (where state = 'retryable_failed')::int as "retryableFailed"
      from act_archive_recovery_items
      where run_id = ${runId}
    `);
    const counts = countsFromRow(summaryRows[0] ?? {});
    const checkedCount = counts.alreadyPresent + counts.recovered + counts.needsReview + counts.droppedUnusable;
    const complete = checkedCount === counts.candidateCount
      && counts.pending === 0
      && counts.leased === 0
      && counts.retryableFailed === 0;

    if (complete && text(run.state) === "running") {
      await this.database.execute(sql`
        update act_archive_recovery_runs
        set state = 'complete', completed_at = coalesce(completed_at, now()), updated_at = now()
        where id = ${runId} and state = 'running'
      `);
      run.state = "complete";
    }

    const byRows = await this.query(sql`
      select stream_type as "streamType",
        count(*)::int as "candidateCount",
        count(*) filter (where state = 'pending')::int as pending,
        count(*) filter (where state = 'leased')::int as leased,
        count(*) filter (where state = 'already_present')::int as "alreadyPresent",
        count(*) filter (where state = 'recovered')::int as recovered,
        count(*) filter (where state = 'needs_review')::int as "needsReview",
        count(*) filter (where state = 'dropped_unusable')::int as "droppedUnusable",
        count(*) filter (where state = 'retryable_failed')::int as "retryableFailed"
      from act_archive_recovery_items
      where run_id = ${runId}
      group by stream_type
      order by stream_type
    `);
    const byStreamType: Record<string, StreamCounts> = {};
    for (const row of byRows) byStreamType[text(row.streamType)] = countsFromRow(row);

    return {
      runId,
      sourceDatabaseKey: text(run.sourceDatabaseKey),
      state: text(run.state) === "failed" ? "failed" : text(run.state) === "complete" ? "complete" : "running",
      ...counts,
      checkedCount,
      complete,
      byStreamType,
    };
  }

  async reviewPage(input: { page: number; pageSize: number }): Promise<ActRecoveryReviewPage> {
    const run = await this.latestRun();
    if (!run) return { page: input.page, pageSize: input.pageSize, items: [] };
    const page = Math.max(1, input.page);
    const pageSize = Math.max(1, Math.min(100, input.pageSize));
    const offset = (page - 1) * pageSize;
    const rows = await this.query(sql`
      select item.id as "itemId", item.run_id as "runId",
        item.source_record_id as "sourceRecordId", item.source_version_id as "sourceVersionId",
        item.stream_type as "streamType", item.target_summary as "targetSummary",
        source.act_record_id as "actRecordId", source.relationship_evidence as "relationshipEvidence",
        version.raw_snapshot as "rawSnapshot"
      from act_archive_recovery_items item
      inner join act_source_records source on source.id = item.source_record_id
      inner join act_source_record_versions version on version.id = item.source_version_id
      where item.run_id = ${text(run.id)} and item.state = 'needs_review'
      order by item.priority, item.source_record_id
      limit ${pageSize} offset ${offset}
    `);
    return {
      page,
      pageSize,
      items: rows.map((row) => ({
        itemId: text(row.itemId),
        runId: text(row.runId),
        sourceRecordId: text(row.sourceRecordId),
        sourceVersionId: text(row.sourceVersionId),
        streamType: text(row.streamType),
        actRecordId: nullableText(row.actRecordId),
        rawSnapshot: object(row.rawSnapshot),
        relationshipEvidence: object(row.relationshipEvidence),
        targetSummary: object(row.targetSummary),
      })),
    };
  }

  async assign(input: {
    sourceRecordId: string;
    sourceVersionId: string;
    targetEntityType: TargetEntityType;
    targetEntityId: string;
    decidedBy: string;
  }): Promise<{ ok: true }> {
    const item = await this.lockReviewItem(input.sourceRecordId, input.sourceVersionId);
    if (item.streamType !== "note" && item.streamType !== "history" && item.streamType !== "activity") {
      throw invalid("act_recovery_assignment_not_supported");
    }
    await this.assertTargetExists(input.targetEntityType, input.targetEntityId);
    await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into act_archive_recovery_decisions
          (run_id, source_record_id, source_version_id, decision, target_entity_type, target_entity_id, decided_by)
        values (${item.runId}, ${input.sourceRecordId}, ${input.sourceVersionId}, 'assign_parent',
          ${input.targetEntityType}, ${input.targetEntityId}, ${input.decidedBy})
      `);
      await transaction.execute(sql`
        update act_archive_recovery_items
        set state = 'pending', target_summary = '{}'::jsonb, last_error_code = null, retry_after = null,
          lease_owner = null, lease_token = null, lease_expires_at = null, completed_at = null, updated_at = now()
        where id = ${item.itemId}
      `);
      await transaction.execute(sql`
        update act_archive_recovery_runs
        set state = 'running', completed_at = null, updated_at = now()
        where id = ${item.runId}
      `);
    });
    return { ok: true };
  }

  async drop(input: {
    sourceRecordId: string;
    sourceVersionId: string;
    decidedBy: string;
  }): Promise<{ ok: true }> {
    const item = await this.lockReviewItem(input.sourceRecordId, input.sourceVersionId);
    await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into act_archive_recovery_decisions
          (run_id, source_record_id, source_version_id, decision, decided_by)
        values (${item.runId}, ${input.sourceRecordId}, ${input.sourceVersionId}, 'drop_unusable', ${input.decidedBy})
      `);
      await transaction.execute(sql`
        update act_archive_recovery_items
        set state = 'dropped_unusable', target_summary = ${JSON.stringify({ reason: "owner_dropped_unusable" })}::jsonb,
          completed_at = now(), last_error_code = null, retry_after = null,
          lease_owner = null, lease_token = null, lease_expires_at = null, updated_at = now()
        where id = ${item.itemId}
      `);
    });
    return { ok: true };
  }

  async retry(input: {
    sourceRecordId: string;
    sourceVersionId: string;
    decidedBy: string;
  }): Promise<{ ok: true }> {
    const item = await this.lockReviewItem(input.sourceRecordId, input.sourceVersionId);
    await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into act_archive_recovery_decisions
          (run_id, source_record_id, source_version_id, decision, decided_by)
        values (${item.runId}, ${input.sourceRecordId}, ${input.sourceVersionId}, 'retry', ${input.decidedBy})
      `);
      await transaction.execute(sql`
        update act_archive_recovery_items
        set state = 'pending', last_error_code = null, retry_after = null, completed_at = null,
          lease_owner = null, lease_token = null, lease_expires_at = null, updated_at = now()
        where id = ${item.itemId}
      `);
      await transaction.execute(sql`
        update act_archive_recovery_runs
        set state = 'running', completed_at = null, updated_at = now()
        where id = ${item.runId}
      `);
    });
    return { ok: true };
  }

  private async lockReviewItem(sourceRecordId: string, sourceVersionId: string): Promise<{
    itemId: string;
    runId: string;
    streamType: string;
  }> {
    const rows = await this.query(sql`
      select item.id as "itemId", item.run_id as "runId", item.stream_type as "streamType",
        item.source_version_id as "sourceVersionId", source.latest_version_id as "latestVersionId"
      from act_archive_recovery_items item
      inner join act_source_records source on source.id = item.source_record_id
      where item.source_record_id = ${sourceRecordId}
        and item.state = 'needs_review'
      order by item.created_at desc
      limit 1
    `);
    const row = rows[0];
    if (!row) throw notFound("act_recovery_review_item_not_found");
    if (text(row.sourceVersionId) !== sourceVersionId || text(row.latestVersionId) !== sourceVersionId) {
      throw conflict("act_recovery_source_version_stale");
    }
    return {
      itemId: text(row.itemId),
      runId: text(row.runId),
      streamType: text(row.streamType),
    };
  }

  private async assertTargetExists(entityType: TargetEntityType, entityId: string) {
    const rows = entityType === "organization"
      ? await this.query(sql`select id from organizations where id = ${entityId} limit 1`)
      : entityType === "contact"
        ? await this.query(sql`select id from contacts where id = ${entityId} limit 1`)
        : await this.query(sql`select id from bookings where id = ${entityId} limit 1`);
    if (!rows[0]) throw invalid("act_recovery_target_not_found");
  }

  private async latestArchiveDatabaseKey(): Promise<string> {
    const rows = await this.query(sql`
      select source_database_key as "sourceDatabaseKey"
      from act_source_records
      where latest_version_id is not null
      group by source_database_key
      order by max(updated_at) desc nulls last, source_database_key
      limit 1
    `);
    return text(rows[0]?.sourceDatabaseKey);
  }

  private async latestRun(sourceDatabaseKey?: string): Promise<Row | null> {
    const rows = sourceDatabaseKey
      ? await this.query(sql`
          select id, source_database_key as "sourceDatabaseKey", state
          from act_archive_recovery_runs
          where source_database_key = ${sourceDatabaseKey}
          order by created_at desc, id desc limit 1
        `)
      : await this.query(sql`
          select id, source_database_key as "sourceDatabaseKey", state
          from act_archive_recovery_runs
          order by created_at desc, id desc limit 1
        `);
    return rows[0] ?? null;
  }

  private async runById(runId: string): Promise<Row | null> {
    const rows = await this.query(sql`
      select id, source_database_key as "sourceDatabaseKey", state
      from act_archive_recovery_runs where id = ${runId} limit 1
    `);
    return rows[0] ?? null;
  }
}
