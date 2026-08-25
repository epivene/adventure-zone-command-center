alter table lead_import_rows
  add column if not exists review_version integer not null default 0,
  add column if not exists selected_organization_id uuid references organizations(id) on delete restrict,
  add column if not exists selected_contact_id uuid references contacts(id) on delete restrict,
  add column if not exists contact_mode text,
  add column if not exists confirmed_event_name text,
  add column if not exists confirmed_start_date date,
  add column if not exists confirmed_end_date date,
  add column if not exists confirmed_contact_name text,
  add column if not exists confirmed_contact_role text,
  add column if not exists confirmed_recipient_email text,
  add column if not exists recipient_confirmed boolean not null default false,
  add column if not exists introduction_suitable boolean not null default false,
  add column if not exists confirmed_by text,
  add column if not exists confirmed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lead_import_rows_review_version_nonnegative') then
    alter table lead_import_rows add constraint lead_import_rows_review_version_nonnegative check (review_version >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_import_rows_contact_mode_valid') then
    alter table lead_import_rows add constraint lead_import_rows_contact_mode_valid check (contact_mode is null or contact_mode in ('existing', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'lead_import_rows_confirmed_date_range_valid') then
    alter table lead_import_rows add constraint lead_import_rows_confirmed_date_range_valid
      check (confirmed_start_date is null or confirmed_end_date is null or confirmed_end_date >= confirmed_start_date);
  end if;
end
$$;

create table if not exists lead_import_evidence (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references lead_import_rows(id) on delete cascade,
  field text not null check (field in ('event_dates', 'recipient_email')),
  candidate_value text not null,
  source_kind text not null check (source_kind in ('crm_contact', 'act_description', 'official_website', 'manual')),
  source_reference text not null check (btrim(source_reference) <> ''),
  selected boolean not null default false,
  created_by text not null check (btrim(created_by) <> ''),
  created_at timestamptz not null default now()
);

create index if not exists lead_import_evidence_row_field_idx
  on lead_import_evidence(row_id, field);
create unique index if not exists lead_import_evidence_one_selected_field
  on lead_import_evidence(row_id, field) where selected;
