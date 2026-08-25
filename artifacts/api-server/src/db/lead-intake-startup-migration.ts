import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type MigrationClient = { query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> };

async function loadOne(here: string, filename: string) {
  const candidates = [
    path.resolve(here, `migrations/${filename}`),
    path.resolve(here, `../../../../lib/db/migrations/${filename}`),
    path.resolve(process.cwd(), `artifacts/api-server/dist/migrations/${filename}`),
    path.resolve(process.cwd(), `lib/db/migrations/${filename}`),
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try { return await readFile(candidate, "utf8"); } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error(`Lead intake migration ${filename} could not be loaded.`);
}

async function loadMigrationSql() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = await Promise.all([
    loadOne(here, "069_excel_lead_intake.sql"),
    loadOne(here, "20260825_lead_review_evidence.sql"),
  ]);
  return sql.join("\n\n");
}

export async function ensureLeadIntakeSchema(
  client: MigrationClient,
  options?: { loadSql?: () => Promise<string> },
): Promise<boolean> {
  const marker = await client.query(`
    select
      (
      to_regclass(current_schema() || '.lead_import_batches') is not null
      and to_regclass(current_schema() || '.lead_import_rows') is not null
      and to_regclass(current_schema() || '.lead_import_evidence') is not null
      and (
        select count(*) = 15 from information_schema.columns
        where table_schema = current_schema() and table_name = 'lead_import_rows'
          and column_name = any(array[
            'review_version', 'selected_organization_id', 'selected_contact_id', 'contact_mode',
            'confirmed_event_name', 'confirmed_start_date', 'confirmed_end_date', 'confirmed_contact_name',
            'confirmed_contact_role', 'confirmed_recipient_email', 'recipient_confirmed',
            'introduction_suitable', 'confirmed_by', 'confirmed_at', 'updated_at'
          ])
      )
      and exists (
        select 1 from pg_constraint
        where conname = 'lead_import_rows_confirmed_date_range_valid'
          and conrelid = 'lead_import_rows'::regclass
      )
      and to_regclass(current_schema() || '.lead_import_evidence_one_selected_field') is not null
      ) as ready
  `);
  if (marker.rows[0]?.["ready"] === true) return false;
  await client.query(await (options?.loadSql ?? loadMigrationSql)());
  return true;
}
