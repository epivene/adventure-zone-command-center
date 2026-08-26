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
    loadOne(here, "20260825_lead_organization_inbox.sql"),
    loadOne(here, "20260825_lead_relationship_classification.sql"),
    loadOne(here, "20260825_lead_calendar_availability.sql"),
  ]);
  return sql.join("\n\n");
}

export async function ensureLeadIntakeSchema(
  client: MigrationClient,
  options?: { loadSql?: () => Promise<string> },
): Promise<boolean> {
  const readinessSql = `
    select
      (
      to_regclass(current_schema() || '.lead_import_batches') is not null
      and to_regclass(current_schema() || '.lead_import_rows') is not null
      and to_regclass(current_schema() || '.lead_import_evidence') is not null
      and (
        select count(*) = 11 from information_schema.columns
        where table_schema = current_schema() and table_name = 'lead_availability_snapshots'
          and column_name = any(array['id','row_id','review_version','proposed_start_date','proposed_end_date','ready','checked_by','checked_at','selected_calendar_ids','source_events','reservations'])
      )
      and (select count(*) = 6 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = any(array['lead_availability_snapshots_row_fk','lead_availability_snapshots_row_version_unique','lead_availability_snapshots_window_valid','lead_availability_snapshots_calendar_ids_array','lead_availability_snapshots_source_events_array','lead_availability_snapshots_reservations_array']))
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and contype = 'f' and confdeltype = 'r')
      and not exists (
        select 1 from information_schema.columns
        where table_schema = current_schema() and table_name = 'lead_availability_snapshots'
          and ((column_name in ('id','row_id') and data_type <> 'uuid')
            or (column_name = 'review_version' and data_type <> 'integer')
            or (column_name in ('proposed_start_date','proposed_end_date') and data_type <> 'date')
            or (column_name = 'ready' and data_type <> 'boolean')
            or (column_name = 'checked_by' and data_type <> 'text')
            or (column_name = 'checked_at' and data_type <> 'timestamp with time zone')
            or (column_name in ('selected_calendar_ids','source_events','reservations') and data_type <> 'jsonb'))
      )
      and exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'lead_availability_snapshots_row_checked_idx' and position('(row_id, checked_at desc)' in lower(indexdef)) > 0)
      and (
        select count(*) = 8 from information_schema.columns
        where table_schema = current_schema() and table_name = 'lead_import_batches'
          and column_name = any(array[
            'id', 'original_filename', 'file_sha256', 'status', 'row_count', 'imported_by',
            'created_at', 'updated_at'
          ])
      )
      and (
        select count(*) = 42 from information_schema.columns
        where table_schema = current_schema() and table_name = 'lead_import_rows'
          and column_name = any(array[
            'id', 'batch_id', 'sheet_name', 'source_row_number', 'source_fingerprint',
            'original_values', 'company', 'phone', 'address_1', 'address_2', 'city', 'region',
            'postal_code', 'website', 'industry', 'warnings', 'state', 'created_at', 'updated_at',
            'review_version', 'selected_organization_id', 'selected_contact_id', 'contact_mode',
            'confirmed_event_name', 'confirmed_start_date', 'confirmed_end_date', 'confirmed_contact_name',
            'confirmed_contact_role', 'confirmed_recipient_email', 'recipient_confirmed',
            'introduction_suitable', 'confirmed_by', 'confirmed_at',
            'relationship_outcome', 'relationship_anchor_at', 'relationship_cutoff_date',
            'relationship_evidence_ids', 'latest_outbound_at', 'latest_verified_response_at',
            'relationship_review_required', 'relationship_classified_at', 'relationship_classified_by'
          ])
      )
      and (
        select count(*) = 8 from pg_constraint
        where conrelid = to_regclass(current_schema() || '.lead_import_rows')
          and conname = any(array[
            'lead_import_rows_review_version_nonnegative', 'lead_import_rows_contact_mode_valid',
            'lead_import_rows_confirmed_date_range_valid', 'lead_import_rows_selected_organization_fk',
            'lead_import_rows_selected_contact_fk', 'lead_import_rows_relationship_outcome_valid',
            'lead_import_rows_relationship_evidence_array',
            'lead_import_rows_relationship_classification_complete'
          ])
      )
      and exists (
        select 1 from pg_constraint
        where conrelid = to_regclass(current_schema() || '.lead_import_rows')
          and conname = 'lead_import_rows_contact_mode_valid'
          and position('organization_inbox' in lower(pg_get_constraintdef(oid))) > 0
      )
      and (
        select count(*) = 9 from information_schema.columns
        where table_schema = current_schema() and table_name = 'lead_import_evidence'
          and column_name = any(array[
            'id', 'row_id', 'field', 'candidate_value', 'source_kind', 'source_reference',
            'selected', 'created_by', 'created_at'
          ])
      )
      and (
        select count(*) = 5 from pg_constraint
        where conrelid = to_regclass(current_schema() || '.lead_import_evidence')
          and conname = any(array[
            'lead_import_evidence_row_fk', 'lead_import_evidence_field_valid',
            'lead_import_evidence_source_kind_valid', 'lead_import_evidence_reference_nonblank',
            'lead_import_evidence_created_by_nonblank'
          ])
      )
      and to_regclass(current_schema() || '.lead_import_evidence_row_field_idx') is not null
      and to_regclass(current_schema() || '.lead_import_evidence_one_selected_field') is not null
      and to_regclass(current_schema() || '.lead_import_rows_relationship_outcome_idx') is not null
      ) as ready
  `;
  const marker = await client.query(readinessSql);
  if (marker.rows[0]?.["ready"] === true) return false;
  await client.query(await (options?.loadSql ?? loadMigrationSql)());
  const verified = await client.query(readinessSql);
  if (verified.rows[0]?.["ready"] !== true) {
    throw new Error("Lead intake schema is incomplete after migration; startup stopped to protect review data.");
  }
  return true;
}
