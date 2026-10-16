import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type MigrationClient = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
};

const profileFillerReadinessSql = `
  with target as materialized (
    select to_regclass(current_schema() || '.organizations') as oid
  ), filler_columns as materialized (
    select a.attrelid, a.attnum, a.attname, a.atttypid, a.attnotnull
    from pg_attribute a
    join target t on t.oid = a.attrelid
    where a.attnum > 0 and not a.attisdropped
      and a.attname in ('filler', 'filler_reason', 'filler_changed_at')
  ), filler_constraint as materialized (
    select c.oid, c.contype, c.convalidated
    from pg_constraint c
    join target t on t.oid = c.conrelid
    where c.conname = 'organizations_filler_reason_required'
  )
  select (
    target.oid is not null
    and (
      select count(*) = 3
      from filler_columns
      where (attname = 'filler' and atttypid = 'boolean'::regtype and attnotnull)
        or (attname = 'filler_reason' and atttypid = 'text'::regtype and not attnotnull)
        or (attname = 'filler_changed_at' and atttypid = 'timestamptz'::regtype and not attnotnull)
    )
    and exists (
      select 1
      from filler_columns a
      join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attname = 'filler'
        and lower(pg_get_expr(d.adbin, d.adrelid)) = 'false'
    )
    and exists (
      select 1
      from filler_constraint
      where contype = 'c'
        and convalidated
        and regexp_replace(lower(pg_get_constraintdef(oid)), '\\s+', '', 'g')
          = 'check(((notfiller)or(nullif(btrim(filler_reason),''''::text)isnotnull)))'
    )
  ) as ready
  from target
`;

async function loadProfileFillerMigrationSql() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "migrations/20260829_profile_filler.sql"),
    path.resolve(here, "../../../../lib/db/migrations/20260829_profile_filler.sql"),
    path.resolve(
      process.cwd(),
      "artifacts/api-server/dist/migrations/20260829_profile_filler.sql",
    ),
    path.resolve(process.cwd(), "lib/db/migrations/20260829_profile_filler.sql"),
  ];

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Profile filler migration could not be loaded.");
}

export async function isProfileFillerSchemaReady(client: MigrationClient): Promise<boolean> {
  const result = await client.query(profileFillerReadinessSql);
  return result.rows[0]?.["ready"] === true;
}

export async function ensureProfileFillerSchema(
  client: MigrationClient,
  options?: { loadSql?: () => Promise<string>; inTransaction?: boolean },
): Promise<boolean> {
  if (await isProfileFillerSchemaReady(client)) return false;

  const ownsTransaction = !options?.inTransaction;
  if (ownsTransaction) await client.query("BEGIN");
  try {
    const sql = await (options?.loadSql ?? loadProfileFillerMigrationSql)();
    await client.query(sql);

    if (!(await isProfileFillerSchemaReady(client))) {
      throw new Error(
        "PROFILE_FILLER_SCHEMA_INCOMPLETE: required organizations filler columns or constraint are missing after migration",
      );
    }

    if (ownsTransaction) await client.query("COMMIT");
    return true;
  } catch (error) {
    if (ownsTransaction) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}