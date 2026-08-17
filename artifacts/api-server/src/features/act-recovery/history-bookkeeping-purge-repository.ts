import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";

export type ActHistoryPurgeCandidate = {
  sourceRecordId: string;
  sourceVersionId: string;
  sourceDatabaseKey: string;
  streamType: "history" | "note" | "activity";
  actRecordId: string | null;
  rawSnapshot: Record<string, unknown>;
  capturedAt: string;
};

type DrizzleDatabase = typeof applicationDatabase;
type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  const result = (value as { rows?: unknown })?.rows;
  return Array.isArray(result) ? result as Row[] : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const raw = text(value);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export class ActHistoryBookkeepingPurgeRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  private async query(executor: Pick<DrizzleDatabase, "execute">, query: ReturnType<typeof sql>) {
    return rows(await executor.execute(query));
  }

  async listCandidates(input: {
    afterSourceRecordId?: string | null;
    limit: number;
  }): Promise<ActHistoryPurgeCandidate[]> {
    const after = input.afterSourceRecordId?.trim() || null;
    const records = await this.query(this.database, sql`
      select
        source.id as "sourceRecordId",
        source.latest_version_id as "sourceVersionId",
        source.source_database_key as "sourceDatabaseKey",
        source.stream_type as "streamType",
        source.act_record_id as "actRecordId",
        version.raw_snapshot as "rawSnapshot",
        version.fetched_at as "capturedAt"
      from act_source_records source
      join act_source_record_versions version on version.id = source.latest_version_id
      where source.stream_type in ('history', 'note', 'activity')
        and (${after}::uuid is null or source.id > ${after}::uuid)
      order by source.id
      limit ${input.limit}
    `);

    return records.flatMap((record) => {
      const streamType = text(record.streamType);
      const sourceRecordId = text(record.sourceRecordId);
      const sourceVersionId = text(record.sourceVersionId);
      const sourceDatabaseKey = text(record.sourceDatabaseKey);
      if (
        !sourceRecordId || !sourceVersionId || !sourceDatabaseKey ||
        (streamType !== "history" && streamType !== "note" && streamType !== "activity")
      ) return [];
      return [{
        sourceRecordId,
        sourceVersionId,
        sourceDatabaseKey,
        streamType,
        actRecordId: text(record.actRecordId) || null,
        rawSnapshot: jsonObject(record.rawSnapshot),
        capturedAt: iso(record.capturedAt),
      }];
    });
  }

  async purgeCandidate(candidate: ActHistoryPurgeCandidate): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const relationshipRows = candidate.actRecordId
        ? await this.query(transaction as never, sql`
            select id
            from act_source_records
            where source_database_key = ${candidate.sourceDatabaseKey}
              and stream_type in (
                ${`${candidate.streamType}_company`},
                ${`${candidate.streamType}_contact`},
                ${`${candidate.streamType}_opportunity`}
              )
              and relationship_evidence->>'parentActRecordId' = ${candidate.actRecordId}
            order by id
          `)
        : [];
      const sourceIds = [
        candidate.sourceRecordId,
        ...relationshipRows.map((row) => text(row.id)).filter(Boolean),
      ];
      const sourceIdSql = sql.join(sourceIds.map((id) => sql`${id}::uuid`), sql`, `);

      const activityRows = await this.query(transaction as never, sql`
        select id from activities where source_record_id = ${candidate.sourceRecordId}::uuid
      `);
      const activityIds = activityRows.map((row) => text(row.id)).filter(Boolean);
      if (activityIds.length) {
        const activityIdSql = sql.join(activityIds.map((id) => sql`${id}::uuid`), sql`, `);
        if (await this.tableExists(transaction as never, "call_sessions")) {
          await transaction.execute(sql`
            update call_sessions set note_activity_id = null
            where note_activity_id in (${activityIdSql})
          `);
        }
        if (await this.tableExists(transaction as never, "activity_revisions")) {
          await transaction.execute(sql`delete from activity_revisions where activity_id in (${activityIdSql})`);
        }
        if (await this.tableExists(transaction as never, "activity_associations")) {
          await transaction.execute(sql`delete from activity_associations where activity_id in (${activityIdSql})`);
        }
        await transaction.execute(sql`delete from activities where id in (${activityIdSql})`);
      }

      await this.deleteBySourceIdsIfPresent(transaction as never, "act_archive_recovery_decisions", sourceIdSql);
      await this.deleteBySourceIdsIfPresent(transaction as never, "act_archive_recovery_items", sourceIdSql);
      await this.deleteBySourceIdsIfPresent(transaction as never, "act_replacement_review_decisions", sourceIdSql);
      await this.deleteBySourceIdsIfPresent(transaction as never, "act_replacement_outcomes", sourceIdSql);
      await this.deleteBySourceIdsIfPresent(transaction as never, "act_source_assignments", sourceIdSql);
      await this.deleteBySourceIdsIfPresent(transaction as never, "act_imported_field_origins", sourceIdSql);
      await this.deleteBySourceIdsIfPresent(transaction as never, "act_replacement_apply_operations", sourceIdSql);
      await this.deleteBySourceIdsIfPresent(transaction as never, "act_replacement_observations", sourceIdSql);
      await this.deleteBySourceIdsIfPresent(transaction as never, "act_archive_profile_import_sources", sourceIdSql);
      await this.deleteBySourceIdsIfPresent(transaction as never, "act_external_links", sourceIdSql);

      if (await this.tableExists(transaction as never, "act_replacement_checkpoints")) {
        await transaction.execute(sql`
          update act_replacement_checkpoints
          set parent_source_record_id = null
          where parent_source_record_id in (${sourceIdSql})
        `);
        await transaction.execute(sql`
          update act_replacement_checkpoints
          set source_record_id = null
          where source_record_id in (${sourceIdSql})
        `);
      }

      await transaction.execute(sql`
        update act_source_records
        set latest_version_id = null, latest_fingerprint = null
        where id in (${sourceIdSql})
      `);
      await transaction.execute(sql`
        delete from act_source_record_versions where source_record_id in (${sourceIdSql})
      `);
      await transaction.execute(sql`
        delete from act_source_records where id in (${sourceIdSql})
      `);
    });
  }

  private async tableExists(executor: Pick<DrizzleDatabase, "execute">, tableName: string): Promise<boolean> {
    const result = await this.query(executor, sql`
      select to_regclass(current_schema() || ${`.${tableName}`}) as relation
    `);
    return Boolean(result[0]?.relation);
  }

  private async deleteBySourceIdsIfPresent(
    executor: Pick<DrizzleDatabase, "execute">,
    tableName: string,
    sourceIdSql: ReturnType<typeof sql.join>,
  ) {
    if (!await this.tableExists(executor, tableName)) return;
    const table = sql.raw(tableName);
    await executor.execute(sql`delete from ${table} where source_record_id in (${sourceIdSql})`);
  }
}
