import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type MigrationClient = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
};

// Do not resolve/deparse the live relation: to_regclass and expression
// deparsers can acquire relation locks behind an overlapping deployment.
const catalogSql = (namespace: string, table: string) => `
 select a.attname, a.attnum, a.atttypid::text as type_oid, a.attnotnull,
        d.adbin::text as default_tree, c.conbin::text as constraint_tree,
        c.contype, c.convalidated, c.connoinherit,
        coalesce((to_jsonb(c)->>'conenforced')::boolean, true) as enforced
 from pg_catalog.pg_class r
 join pg_catalog.pg_namespace n on n.oid = r.relnamespace
 join pg_catalog.pg_attribute a on a.attrelid = r.oid
 left join pg_catalog.pg_attrdef d on d.adrelid = r.oid and d.adnum = a.attnum
 left join pg_catalog.pg_constraint c on c.conrelid = r.oid
   and c.conname = 'organizations_filler_reason_required'
 where ${namespace} and r.relname = '${table}' and r.relkind in ('r','p')
   and a.attnum > 0 and not a.attisdropped
   and a.attname in ('filler','filler_reason','filler_changed_at')
`;

function normalizeTree(value: unknown, columns: Array<Record<string, unknown>>) {
  if (typeof value !== "string") return null;
  const names = new Map(columns.map(c => [String(c.attnum), String(c.attname)]));
  // Only source positions and attribute numbers differ between the live table
  // and the reference. Preserve all operators, types, functions and constants.
  return value.replace(/:location -?\d+/g, ":location -1")
    .replace(/:(varattno|varattnosyn) (-?\d+)/g,
      (_all, field, number) => `:${field} ${names.get(number) ?? number}`);
}

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
  const actual = (await client.query(catalogSql("n.nspname = current_schema()", "organizations"))).rows;
  if (actual.length !== 3) return false;
  // Let this PostgreSQL server parse the expected contract. This avoids
  // hardcoding version-specific pg_node_tree representations or weakening the
  // check to a constraint name/column list. Only a disposable temp table is used.
  const reference = `az_filler_contract_${randomUUID().replaceAll("-", "")}`;
  await client.query(`CREATE TEMP TABLE ${reference} (
    filler boolean NOT NULL DEFAULT false,
    filler_reason text,
    filler_changed_at timestamptz,
    CONSTRAINT organizations_filler_reason_required
      CHECK (NOT filler OR nullif(pg_catalog.btrim(filler_reason), '') IS NOT NULL)
  )`);
  let failed = false;
  try {
    const expected = (await client.query(catalogSql("n.oid = pg_my_temp_schema()", reference))).rows;
    return expected.length === 3 && expected.every(e => {
      const a = actual.find(a => a.attname === e.attname);
      return a && a.type_oid === e.type_oid && a.attnotnull === e.attnotnull
        && a.contype === "c" && a.convalidated === true && a.connoinherit === false
        && a.enforced === true
        && normalizeTree(a.default_tree, actual) === normalizeTree(e.default_tree, expected)
        && normalizeTree(a.constraint_tree, actual) === normalizeTree(e.constraint_tree, expected);
    });
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // On failure the caller rolls back/destroys the connection. In particular,
    // never queue cleanup behind a client-side read timeout.
    if (!failed) await client.query(`DROP TABLE pg_temp.${reference}`);
  }
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
