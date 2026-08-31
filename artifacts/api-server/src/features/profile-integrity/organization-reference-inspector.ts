import { pool as defaultPool } from "@workspace/db";

export type OrganizationReferenceBlocker = {
  schemaName: string;
  tableName: string;
  columnName: string;
  count: number;
};

export interface ReferenceInspectorExecutor {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>;
}

type ReferenceColumn = Omit<OrganizationReferenceBlocker, "count">;

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function numeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export async function inspectOrganizationReferenceBlockers(
  profileId: string,
  executor: ReferenceInspectorExecutor = defaultPool as unknown as ReferenceInspectorExecutor,
): Promise<OrganizationReferenceBlocker[]> {
  const metadata = await executor.query<ReferenceColumn>(`
    SELECT DISTINCT
      namespace.nspname AS "schemaName",
      relation.relname AS "tableName",
      source_attribute.attname AS "columnName"
    FROM pg_constraint constraint_record
    INNER JOIN pg_class relation
      ON relation.oid = constraint_record.conrelid
    INNER JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    INNER JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY source_key(attnum, position)
      ON true
    INNER JOIN LATERAL unnest(constraint_record.confkey) WITH ORDINALITY target_key(attnum, position)
      ON target_key.position = source_key.position
    INNER JOIN pg_attribute source_attribute
      ON source_attribute.attrelid = constraint_record.conrelid
     AND source_attribute.attnum = source_key.attnum
    INNER JOIN pg_attribute target_attribute
      ON target_attribute.attrelid = constraint_record.confrelid
     AND target_attribute.attnum = target_key.attnum
    WHERE constraint_record.contype = 'f'
      AND constraint_record.confrelid = 'organizations'::regclass
      AND target_attribute.attname = 'id'
    ORDER BY namespace.nspname, relation.relname, source_attribute.attname
  `);

  const blockers: OrganizationReferenceBlocker[] = [];
  for (const reference of metadata.rows) {
    const table = `${quoteIdentifier(reference.schemaName)}.${quoteIdentifier(reference.tableName)}`;
    const column = quoteIdentifier(reference.columnName);
    const result = await executor.query<{ count: number | string }>(
      `SELECT count(*)::int AS count FROM ${table} WHERE ${column} = $1::uuid`,
      [profileId],
    );
    const count = numeric(result.rows[0]?.count);
    if (count > 0) blockers.push({ ...reference, count });
  }

  return blockers;
}
