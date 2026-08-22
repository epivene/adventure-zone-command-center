import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type MigrationClient = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
};

type Options = {
  loadSql?: () => Promise<string>;
};

async function loadPaperNotesMigrationSql() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "migrations/066_paper_notes_importer.sql"),
    path.resolve(here, "../../../../lib/db/migrations/066_paper_notes_importer.sql"),
    path.resolve(process.cwd(), "artifacts/api-server/dist/migrations/066_paper_notes_importer.sql"),
    path.resolve(process.cwd(), "lib/db/migrations/066_paper_notes_importer.sql"),
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
    : new Error("Paper Notes migration 066 could not be loaded.");
}

export async function ensurePaperNotesSchema(
  client: MigrationClient,
  options?: Options,
): Promise<boolean> {
  const marker = await client.query(`
    select
      to_regclass(current_schema() || '.paper_note_batches') is not null
      and to_regclass(current_schema() || '.paper_note_pages') is not null
      and to_regclass(current_schema() || '.paper_note_entries') is not null
      and to_regclass(current_schema() || '.organization_phones') is not null
      and exists (
        select 1
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'activities'
          and column_name = 'paper_note_entry_id'
      )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'contact_phones'
          and column_name = 'instructions'
      )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'contact_phones'
          and column_name = 'status'
      )
      and exists (
        select 1
        from information_schema.columns
        where table_schema = current_schema()
          and table_name = 'contact_phones'
          and column_name = 'source_paper_note_entry_id'
      ) as ready
  `);
  if (marker.rows[0]?.["ready"] === true) return false;

  const sql = await (options?.loadSql ?? loadPaperNotesMigrationSql)();
  await client.query(sql);
  return true;
}
