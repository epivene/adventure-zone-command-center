import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type MigrationClient = { query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> };

async function loadMigrationSql() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "migrations/069_excel_lead_intake.sql"),
    path.resolve(here, "../../../../lib/db/migrations/069_excel_lead_intake.sql"),
    path.resolve(process.cwd(), "artifacts/api-server/dist/migrations/069_excel_lead_intake.sql"),
    path.resolve(process.cwd(), "lib/db/migrations/069_excel_lead_intake.sql"),
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try { return await readFile(candidate, "utf8"); } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("Lead intake migration 069 could not be loaded.");
}

export async function ensureLeadIntakeSchema(
  client: MigrationClient,
  options?: { loadSql?: () => Promise<string> },
): Promise<boolean> {
  const marker = await client.query(`
    select
      to_regclass(current_schema() || '.lead_import_batches') is not null
      and to_regclass(current_schema() || '.lead_import_rows') is not null as ready
  `);
  if (marker.rows[0]?.["ready"] === true) return false;
  await client.query(await (options?.loadSql ?? loadMigrationSql)());
  return true;
}
