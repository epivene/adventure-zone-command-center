import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type MigrationClient = { query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }> };

const leadReviewStatusReadinessExpression = `
  to_regclass(current_schema() || '.lead_import_rows') is not null
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_import_rows')
      and conname = 'lead_import_rows_territory_status_valid'
      and contype = 'c'
      and lower(pg_get_constraintdef(oid)) like '%territory_status%open%ask_amy_dave%closed%licensing_issue%needs_review%'
      and lower(pg_get_constraintdef(oid)) not like '%check (true)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_import_rows')
      and conname = 'lead_import_rows_fit_status_valid'
      and contype = 'c'
      and lower(pg_get_constraintdef(oid)) like '%fit_status%approved%needs_review%not_a_fit%'
      and lower(pg_get_constraintdef(oid)) not like '%check (true)%'
  )
`;

export async function isLeadReviewStatusSchemaReady(client: MigrationClient): Promise<boolean> {
  const result = await client.query(`select (${leadReviewStatusReadinessExpression}) as ready`);
  return result.rows[0]?.["ready"] === true;
}

const communicationTemplateVersionReadinessExpression = `
  to_regclass(current_schema() || '.communication_templates') is not null
  and exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'communication_templates'
      and column_name = 'template_version'
      and data_type = 'text'
      and is_nullable = 'YES'
  )
`;

export async function isCommunicationTemplateVersionSchemaReady(client: MigrationClient): Promise<boolean> {
  const result = await client.query(`select (${communicationTemplateVersionReadinessExpression}) as ready`);
  return result.rows[0]?.["ready"] === true;
}

const communicationBlockReadinessExpression = `
  to_regclass(current_schema() || '.communication_blocks') is not null
  and to_regclass(current_schema() || '.communication_block_events') is not null
  and (
    select count(*) = 13 from information_schema.columns
    where table_schema = current_schema() and table_name = 'communication_blocks'
      and column_name = any(array['id','target_type','organization_id','contact_id','normalized_email','row_id','reason','active','created_by','created_at','removed_by','removed_at','removal_reason'])
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'communication_blocks'
      and ((column_name in ('id','organization_id','contact_id','row_id') and data_type <> 'uuid')
        or (column_name in ('target_type','normalized_email','reason','created_by','removed_by','removal_reason') and data_type <> 'text')
        or (column_name = 'active' and data_type <> 'boolean')
        or (column_name in ('created_at','removed_at') and data_type <> 'timestamp with time zone'))
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'communication_blocks'
      and column_name = any(array['id','target_type','reason','active','created_by','created_at']) and is_nullable <> 'NO'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'communication_blocks'
      and column_name = any(array['organization_id','contact_id','normalized_email','row_id','removed_by','removed_at','removal_reason']) and is_nullable <> 'YES'
  )
  and exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'communication_blocks' and column_name = 'id' and column_default like '%gen_random_uuid%')
  and exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'communication_blocks' and column_name = 'active' and lower(column_default) in ('true','true::boolean'))
  and exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'communication_blocks' and column_name = 'created_at' and lower(column_default) like '%now()%')
  and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.communication_blocks') and contype = 'p' and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'primarykey(id)%')
  and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.communication_blocks') and conname = 'communication_blocks_target_valid' and contype = 'c' and lower(pg_get_constraintdef(oid)) like '%organization%contact%recipient_email%lead_import_row%internal_preview%')
  and exists (
    select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.communication_blocks')
      and conname = 'communication_blocks_exact_target' and contype = 'c'
      and lower(pg_get_constraintdef(oid)) like '%target_type%organization%organization_id is not null%contact_id is null%normalized_email is null%row_id is null%'
      and lower(pg_get_constraintdef(oid)) like '%target_type%contact%organization_id is null%contact_id is not null%normalized_email is null%row_id is null%'
      and lower(pg_get_constraintdef(oid)) like '%target_type%lead_import_row%organization_id is null%contact_id is null%normalized_email is null%row_id is not null%'
      and lower(pg_get_constraintdef(oid)) like '%target_type%recipient_email%organization_id is null%contact_id is null%row_id is null%normalized_email is not null%lower%btrim%'
      and lower(pg_get_constraintdef(oid)) like '%target_type%internal_preview%organization_id is null%contact_id is null%normalized_email is null%row_id is null%'
  )
  and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.communication_blocks') and conname = 'communication_blocks_organization_fk' and contype = 'f' and confdeltype = 'r' and confrelid = to_regclass(current_schema() || '.organizations'))
  and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.communication_blocks') and conname = 'communication_blocks_contact_fk' and contype = 'f' and confdeltype = 'r' and confrelid = to_regclass(current_schema() || '.contacts'))
  and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.communication_blocks') and conname = 'communication_blocks_row_fk' and contype = 'f' and confdeltype = 'r' and confrelid = to_regclass(current_schema() || '.lead_import_rows'))
  and exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'communication_blocks_active_target_unique' and lower(indexdef) like 'create unique index%' and lower(indexdef) like '%where active%' and lower(indexdef) like '%coalesce%normalized_email%')
  and exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'communication_blocks_active_lookup_idx' and replace(lower(indexdef), ' ', '') like '%(active,normalized_email,organization_id,contact_id,row_id)%')
  and (
    select count(*) = 6 from information_schema.columns
    where table_schema = current_schema() and table_name = 'communication_block_events'
      and column_name = any(array['id','block_id','action','actor_id','reason','created_at'])
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'communication_block_events'
      and ((column_name in ('id','block_id') and data_type <> 'uuid')
        or (column_name in ('action','actor_id','reason') and data_type <> 'text')
        or (column_name = 'created_at' and data_type <> 'timestamp with time zone'))
  )
  and not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'communication_block_events' and column_name = any(array['id','block_id','action','actor_id','reason','created_at']) and is_nullable <> 'NO')
  and exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'communication_block_events' and column_name = 'id' and column_default like '%gen_random_uuid%')
  and exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'communication_block_events' and column_name = 'created_at' and lower(column_default) like '%now()%')
  and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.communication_block_events') and contype = 'p' and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'primarykey(id)%')
  and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.communication_block_events') and conname = 'communication_block_events_block_fk' and contype = 'f' and confdeltype = 'r' and confrelid = to_regclass(current_schema() || '.communication_blocks'))
  and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.communication_block_events') and conname = 'communication_block_events_action_valid' and contype = 'c' and lower(pg_get_constraintdef(oid)) like '%created%removed%')
  and exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'communication_block_events_history_idx' and replace(lower(indexdef), ' ', '') like '%(block_id,created_at)%')
  and exists (select 1 from pg_proc where proname = 'communication_blocks_write_created_event' and lower(pg_get_functiondef(oid)) like '%insert into communication_block_events%created%')
  and exists (select 1 from pg_proc where proname = 'communication_blocks_created_event_backfill_v2_ready')
  and exists (select 1 from pg_trigger where tgrelid = to_regclass(current_schema() || '.communication_blocks') and tgname = 'communication_blocks_created_event' and not tgisinternal and tgenabled <> 'D')
`;

export async function isCommunicationBlockSchemaReady(client: MigrationClient): Promise<boolean> {
  const result = await client.query(`select (${communicationBlockReadinessExpression}) as ready`);
  return result.rows[0]?.["ready"] === true;
}

const leadGmailDraftLinkReadinessExpression = `
  to_regclass(current_schema() || '.lead_gmail_draft_links') is not null
  and (
    select count(*) = 22 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'lead_gmail_draft_links'
      and column_name = any(array[
        'id','row_id','organization_id','contact_id','google_connection_id',
        'communication_template_id','template_version','recipient_email','subject','body',
        'gmail_draft_id','gmail_message_id','activity_id','state','last_error_code',
        'idempotency_key','attempt_count','actor_id','created_at','updated_at',
        'last_attempt_at','completed_at'
      ])
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'lead_gmail_draft_links'
      and (
        (column_name = any(array['id','row_id','organization_id','contact_id','google_connection_id','communication_template_id','activity_id']) and data_type <> 'uuid')
        or (column_name = any(array['template_version','recipient_email','subject','body','gmail_draft_id','gmail_message_id','state','last_error_code','idempotency_key','actor_id']) and data_type <> 'text')
        or (column_name = 'attempt_count' and data_type <> 'integer')
        or (column_name = any(array['created_at','updated_at','last_attempt_at','completed_at']) and data_type <> 'timestamp with time zone')
      )
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'lead_gmail_draft_links'
      and column_name = any(array[
        'id','row_id','organization_id','google_connection_id','communication_template_id',
        'template_version','recipient_email','subject','body','state','idempotency_key',
        'attempt_count','actor_id','created_at','updated_at','last_attempt_at'
      ])
      and is_nullable <> 'NO'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'lead_gmail_draft_links'
      and column_name = any(array[
        'contact_id','gmail_draft_id','gmail_message_id','activity_id',
        'last_error_code','completed_at'
      ])
      and is_nullable <> 'YES'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'lead_gmail_draft_links'
      and column_name = 'id' and lower(column_default) like '%gen_random_uuid%'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'lead_gmail_draft_links'
      and column_name = 'state' and lower(column_default) like '%prepared%'
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'lead_gmail_draft_links'
      and column_name = 'attempt_count' and replace(lower(column_default), ' ', '') in ('1','1::integer')
  )
  and exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'lead_gmail_draft_links'
      and column_name in ('created_at','updated_at')
      and lower(column_default) like '%now()%'
    group by table_name
    having count(*) = 2
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and contype = 'p'
      and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'primarykey(id)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_row_unique' and contype = 'u'
      and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'unique(row_id)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_idempotency_unique' and contype = 'u'
      and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'unique(idempotency_key)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_row_fk' and contype = 'f'
      and confdeltype = 'r' and confrelid = to_regclass(current_schema() || '.lead_import_rows')
      and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'foreignkey(row_id)references%lead_import_rows(id)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_organization_fk' and contype = 'f'
      and confdeltype = 'r' and confrelid = to_regclass(current_schema() || '.organizations')
      and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'foreignkey(organization_id)references%organizations(id)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_contact_fk' and contype = 'f'
      and confdeltype = 'r' and confrelid = to_regclass(current_schema() || '.contacts')
      and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'foreignkey(contact_id)references%contacts(id)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_google_connection_fk' and contype = 'f'
      and confdeltype = 'r' and confrelid = to_regclass(current_schema() || '.google_workspace_connections')
      and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'foreignkey(google_connection_id)references%google_workspace_connections(id)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_template_fk' and contype = 'f'
      and confdeltype = 'r' and confrelid = to_regclass(current_schema() || '.communication_templates')
      and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'foreignkey(communication_template_id)references%communication_templates(id)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_activity_fk' and contype = 'f'
      and confdeltype = 'r' and confrelid = to_regclass(current_schema() || '.activities')
      and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'foreignkey(activity_id)references%activities(id)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_state_valid' and contype = 'c'
      and lower(pg_get_constraintdef(oid)) like '%prepared%created%retryable_error%manual_review%'
      and lower(pg_get_constraintdef(oid)) not like '%check (true)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_email_valid' and contype = 'c'
      and lower(pg_get_constraintdef(oid)) like '%recipient_email%lower%btrim%recipient_email%'
      and lower(pg_get_constraintdef(oid)) not like '%check (true)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_text_nonblank' and contype = 'c'
      and lower(pg_get_constraintdef(oid)) like '%template_version%subject%body%idempotency_key%actor_id%'
      and lower(pg_get_constraintdef(oid)) not like '%check (true)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_attempt_positive' and contype = 'c'
      and replace(lower(pg_get_constraintdef(oid)), ' ', '') like '%attempt_count>0%'
      and lower(pg_get_constraintdef(oid)) not like '%check (true)%'
  )
  and exists (
    select 1 from pg_constraint
    where conrelid = to_regclass(current_schema() || '.lead_gmail_draft_links')
      and conname = 'lead_gmail_draft_links_created_complete' and contype = 'c'
      and lower(pg_get_constraintdef(oid)) like '%state%created%gmail_draft_id%gmail_message_id%activity_id%completed_at%last_error_code%'
      and lower(pg_get_constraintdef(oid)) not like '%check (true)%'
  )
  and exists (
    select 1 from pg_indexes
    where schemaname = current_schema() and indexname = 'lead_gmail_draft_links_gmail_draft_unique'
      and lower(indexdef) like 'create unique index%'
      and replace(lower(indexdef), ' ', '') like '%(gmail_draft_id)%gmail_draft_idisnotnull%'
  )
  and exists (
    select 1 from pg_indexes
    where schemaname = current_schema() and indexname = 'lead_gmail_draft_links_gmail_message_unique'
      and lower(indexdef) like 'create unique index%'
      and replace(lower(indexdef), ' ', '') like '%(gmail_message_id)%gmail_message_idisnotnull%'
  )
  and exists (
    select 1 from pg_indexes
    where schemaname = current_schema() and indexname = 'lead_gmail_draft_links_activity_unique'
      and lower(indexdef) like 'create unique index%'
      and replace(lower(indexdef), ' ', '') like '%(activity_id)%activity_idisnotnull%'
  )
  and exists (
    select 1 from pg_indexes
    where schemaname = current_schema() and indexname = 'lead_gmail_draft_links_state_updated_idx'
      and replace(lower(indexdef), ' ', '') like '%(state,updated_atdesc)%'
  )
  and exists (
    select 1 from pg_indexes
    where schemaname = current_schema() and indexname = 'lead_gmail_draft_links_organization_updated_idx'
      and replace(lower(indexdef), ' ', '') like '%(organization_id,updated_atdesc)%'
  )
`;

export async function isLeadGmailDraftLinkSchemaReady(client: MigrationClient): Promise<boolean> {
  const result = await client.query(`select (${leadGmailDraftLinkReadinessExpression}) as ready`);
  return result.rows[0]?.["ready"] === true;
}

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
    loadOne(here, "20260826_lead_inventory_policy.sql"),
    loadOne(here, "20260826_lead_safe_email.sql"),
    loadOne(here, "20260826_lead_gmail_drafts.sql"),
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
      and (${communicationTemplateVersionReadinessExpression})
      and (
        select count(*) = 12 from information_schema.columns
        where table_schema = current_schema() and table_name = 'lead_availability_snapshots'
          and column_name = any(array['id','row_id','review_version','proposed_start_date','proposed_end_date','ready','checked_by','checked_at','selected_calendar_ids','source_events','reservations','package_availability'])
      )
      and (select count(*) = 7 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = any(array['lead_availability_snapshots_row_fk','lead_availability_snapshots_row_version_unique','lead_availability_snapshots_window_valid','lead_availability_snapshots_calendar_ids_array','lead_availability_snapshots_source_events_array','lead_availability_snapshots_reservations_array','lead_availability_snapshots_package_availability_object']))
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
            or (column_name in ('selected_calendar_ids','source_events','reservations','package_availability') and data_type <> 'jsonb'))
      )
      and not exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'lead_availability_snapshots' and column_name = any(array['id','row_id','review_version','proposed_start_date','proposed_end_date','ready','checked_by','checked_at','selected_calendar_ids','source_events','reservations','package_availability']) and is_nullable <> 'NO')
      and exists (select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'lead_availability_snapshots' and column_name = 'id' and column_default like '%gen_random_uuid%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and contype = 'p' and pg_get_constraintdef(oid) like 'PRIMARY KEY (id)%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_row_fk' and contype = 'f' and confdeltype = 'r' and confrelid = to_regclass(current_schema() || '.lead_import_rows') and pg_get_constraintdef(oid) like 'FOREIGN KEY (row_id) REFERENCES %lead_import_rows(id)%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_row_version_unique' and contype = 'u' and replace(lower(pg_get_constraintdef(oid)), ' ', '') like 'unique(row_id,review_version)%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_window_valid' and contype = 'c' and replace(lower(pg_get_constraintdef(oid)), ' ', '') like '%proposed_end_date>=proposed_start_date%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_calendar_ids_array' and contype = 'c' and lower(pg_get_constraintdef(oid)) like '%jsonb_typeof(selected_calendar_ids)%array%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_source_events_array' and contype = 'c' and lower(pg_get_constraintdef(oid)) like '%jsonb_typeof(source_events)%array%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_reservations_array' and contype = 'c' and lower(pg_get_constraintdef(oid)) like '%jsonb_typeof(reservations)%array%')
      and exists (select 1 from pg_constraint where conrelid = to_regclass(current_schema() || '.lead_availability_snapshots') and conname = 'lead_availability_snapshots_package_availability_object' and contype = 'c' and lower(pg_get_constraintdef(oid)) like '%jsonb_typeof(package_availability)%object%')
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
        select count(*) = 44 from information_schema.columns
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
            'relationship_review_required', 'relationship_classified_at', 'relationship_classified_by', 'territory_status', 'fit_status'
          ])
      )
      and (
        select count(*) = 10 from pg_constraint
        where conrelid = to_regclass(current_schema() || '.lead_import_rows')
          and conname = any(array[
            'lead_import_rows_review_version_nonnegative', 'lead_import_rows_contact_mode_valid',
            'lead_import_rows_confirmed_date_range_valid', 'lead_import_rows_selected_organization_fk',
            'lead_import_rows_selected_contact_fk', 'lead_import_rows_relationship_outcome_valid',
            'lead_import_rows_relationship_evidence_array',
            'lead_import_rows_relationship_classification_complete',
            'lead_import_rows_territory_status_valid', 'lead_import_rows_fit_status_valid'
          ])
      )
      and (${leadReviewStatusReadinessExpression})
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
      and (${communicationBlockReadinessExpression})
      and (${leadGmailDraftLinkReadinessExpression})
      and to_regclass(current_schema() || '.lead_import_evidence_row_field_idx') is not null
      and to_regclass(current_schema() || '.lead_import_evidence_one_selected_field') is not null
      and to_regclass(current_schema() || '.lead_import_rows_relationship_outcome_idx') is not null
      ) as ready
  `;
  const marker = await client.query(readinessSql);
  const wasReady = marker.rows[0]?.["ready"] === true;

  // Always run the forward, idempotent migrations before trusting readiness. This
  // repairs weakened same-name constraints and wrong fail-closed metadata that a
  // fragment-based readiness probe could otherwise mistake for canonical schema.
  await client.query(await (options?.loadSql ?? loadMigrationSql)());

  const verified = await client.query(readinessSql);
  if (verified.rows[0]?.["ready"] !== true) {
    throw new Error("Lead intake schema is incomplete after migration; startup stopped to protect review data.");
  }
  return !wasReady;
}
