import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type MigrationClient = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
};

const profileFillerReadinessSql = `
  select (
    to_regclass(current_schema() || '.organizations') is not null
    and (
      select count(*) = 3
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'organizations'
        and column_name in ('filler', 'filler_reason', 'filler_changed_at')
    )
    and not exists (
      select 1
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'organizations'
        and (
          (column_name = 'filler' and (data_type <> 'boolean' or is_nullable <> 'NO'))
          or (column_name in ('filler_reason', 'filler_changed_at') and is_nullable <> 'YES')
          or (column_name = 'filler_reason' and data_type <> 'text')
          or (column_name = 'filler_changed_at' and data_type <> 'timestamp with time zone')
        )
    )
    and exists (
      select 1
      from information_schema.columns
      where table_schema = current_schema()
        and table_name = 'organizations'
        and column_name = 'filler'
        and data_type = 'boolean'
        and lower(column_default) like '%false%'
    )
    and exists (
      select 1
      from pg_constraint
      where conrelid = to_regclass(current_schema() || '.organizations')
        and conname = 'organizations_filler_reason_required'
        and contype = 'c'
        and convalidated
        and regexp_replace(lower(pg_get_constraintdef(oid)), '\\s+', '', 'g')
          = 'check(((notfiller)or(nullif(btrim(filler_reason),''''::text)isnotnull)))'
    )
  ) as ready
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

async function isProfileFillerSchemaReady(client: MigrationClient): Promise<boolean> {
  const result = await client.query(profileFillerReadinessSql);
  return result.rows[0]?.["ready"] === true;
}

export async function ensureProfileFillerSchema(
  client: MigrationClient,
  options?: { loadSql?: () => Promise<string> },
): Promise<boolean> {
  if (await isProfileFillerSchemaReady(client)) return false;

  await client.query("BEGIN");
  try {
    const sql = await (options?.loadSql ?? loadProfileFillerMigrationSql)();
    await client.query(sql);

    if (!(await isProfileFillerSchemaReady(client))) {
      throw new Error(
        "PROFILE_FILLER_SCHEMA_INCOMPLETE: required organizations filler columns or constraint are missing after migration",
      );
    }

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}