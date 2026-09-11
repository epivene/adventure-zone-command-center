do $$
begin
  if not exists (select 1 from pg_type where typname = 'phone_status') then
    create type phone_status as enum ('active', 'questionable', 'inactive');
  end if;
end
$$;

create table if not exists paper_note_batches (
  id uuid primary key default gen_random_uuid(),
  name text,
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'extracting', 'review', 'importing', 'imported', 'failed', 'archived')),
  created_by text not null default 'owner',
  page_count integer not null default 0 check (page_count >= 0),
  import_request_key uuid unique,
  import_summary jsonb,
  failure_code text,
  failure_message text,
  extraction_started_at timestamptz,
  review_started_at timestamptz,
  import_started_at timestamptz,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists paper_note_batches_status_updated_idx
  on paper_note_batches(status, updated_at desc);

create table if not exists paper_note_pages (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references paper_note_batches(id) on delete cascade,
  sort_order integer not null check (sort_order >= 0),
  original_filename text not null check (btrim(original_filename) <> ''),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null default 0 check (size_bytes >= 0 and size_bytes <= 12582912),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  rotation_degrees integer not null default 0 check (rotation_degrees in (0, 90, 180, 270)),
  original_object_key text not null check (btrim(original_object_key) <> ''),
  analysis_object_key text,
  sha256 text,
  status text not null default 'uploading'
    check (status in ('uploading', 'uploaded', 'queued', 'extracting', 'extracted', 'needs_retry', 'reviewed_empty')),
  current_stage text check (current_stage is null or current_stage in ('prepare', 'segment', 'extract_entries', 'complete')),
  page_heading text,
  page_activity_date date,
  page_context jsonb not null default '{}'::jsonb,
  rough_transcription text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_token text,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists paper_note_pages_batch_sort_unique
  on paper_note_pages(batch_id, sort_order);
create unique index if not exists paper_note_pages_batch_sha256_unique
  on paper_note_pages(batch_id, sha256)
  where sha256 is not null;
create index if not exists paper_note_pages_work_queue_idx
  on paper_note_pages(status, lease_expires_at, created_at)
  where status in ('queued', 'extracting', 'needs_retry');

create table if not exists paper_note_entries (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references paper_note_batches(id) on delete cascade,
  page_id uuid not null references paper_note_pages(id) on delete cascade,
  source_order integer not null check (source_order >= 0),
  source_region jsonb,
  extraction_payload jsonb not null default '{}'::jsonb,
  review_payload jsonb not null default '{}'::jsonb,
  review_version integer not null default 0 check (review_version >= 0),
  state text not null default 'needs_review'
    check (state in ('needs_review', 'ready', 'approved', 'skipped', 'imported')),
  destination_mode text
    check (destination_mode is null or destination_mode in ('existing_profile', 'existing_profile_new_location', 'new_profile', 'skip')),
  selected_organization_id uuid references organizations(id) on delete restrict,
  selected_organization_location_id uuid references organization_locations(id) on delete restrict,
  target_snapshot jsonb,
  validation_issues jsonb not null default '[]'::jsonb,
  approved_at timestamptz,
  imported_organization_id uuid references organizations(id) on delete restrict,
  imported_organization_location_id uuid references organization_locations(id) on delete restrict,
  imported_activity_id uuid references activities(id) on delete set null,
  import_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists paper_note_entries_page_source_order_unique
  on paper_note_entries(page_id, source_order);
create index if not exists paper_note_entries_batch_state_idx
  on paper_note_entries(batch_id, state, source_order);

alter table contact_phones
  add column if not exists instructions text;
alter table contact_phones
  add column if not exists status phone_status not null default 'active';
alter table contact_phones
  add column if not exists source_paper_note_entry_id uuid references paper_note_entries(id) on delete set null;

create index if not exists contact_phones_source_paper_note_entry_idx
  on contact_phones(source_paper_note_entry_id)
  where source_paper_note_entry_id is not null;

create table if not exists organization_phones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  organization_location_id uuid references organization_locations(id) on delete cascade,
  number text not null check (btrim(number) <> ''),
  normalized_number text,
  type contact_phone_type not null default 'unknown',
  extension text,
  normalized_extension text generated always as (nullif(regexp_replace(coalesce(extension, ''), '[^0-9]', '', 'g'), '')) stored,
  label text,
  instructions text,
  status phone_status not null default 'active',
  "primary" boolean not null default false,
  source text not null default 'local'
    check (source in ('local', 'legacy_backfill', 'paper_note')),
  source_paper_note_entry_id uuid references paper_note_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organization_phones_normalized_number_idx
  on organization_phones(normalized_number);
create index if not exists organization_phones_source_paper_note_entry_idx
  on organization_phones(source_paper_note_entry_id)
  where source_paper_note_entry_id is not null;
create unique index if not exists organization_phones_general_destination_unique
  on organization_phones(organization_id, normalized_number, coalesce(normalized_extension, ''))
  where organization_location_id is null and normalized_number is not null;
create unique index if not exists organization_phones_location_destination_unique
  on organization_phones(organization_id, organization_location_id, normalized_number, coalesce(normalized_extension, ''))
  where organization_location_id is not null and normalized_number is not null;
create unique index if not exists organization_phones_one_active_primary_general
  on organization_phones(organization_id)
  where organization_location_id is null and "primary" and status = 'active';
create unique index if not exists organization_phones_one_active_primary_location
  on organization_phones(organization_location_id)
  where organization_location_id is not null and "primary" and status = 'active';

create or replace function validate_organization_phone_location()
returns trigger
language plpgsql
as $$
begin
  if new.organization_location_id is not null and not exists (
    select 1
    from organization_locations locations
    where locations.id = new.organization_location_id
      and locations.organization_id = new.organization_id
  ) then
    raise exception 'Organization phone location must belong to the same organization';
  end if;
  return new;
end
$$;

drop trigger if exists organization_phones_validate_location on organization_phones;
create trigger organization_phones_validate_location
before insert or update of organization_id, organization_location_id
on organization_phones
for each row
execute function validate_organization_phone_location();

insert into organization_phones (
  organization_id,
  organization_location_id,
  number,
  normalized_number,
  type,
  status,
  "primary",
  source
)
select
  organizations.id,
  null,
  organizations.phone,
  organizations.normalized_phone,
  'unknown'::contact_phone_type,
  'active'::phone_status,
  not exists (
    select 1
    from organization_phones existing_primary
    where existing_primary.organization_id = organizations.id
      and existing_primary.organization_location_id is null
      and existing_primary."primary"
      and existing_primary.status = 'active'
  ),
  'legacy_backfill'
from organizations
where nullif(btrim(organizations.phone), '') is not null
  and not exists (
    select 1
    from organization_phones existing
    where existing.organization_id = organizations.id
      and existing.organization_location_id is null
      and (
        (organizations.normalized_phone is not null and existing.normalized_number = organizations.normalized_phone)
        or (organizations.normalized_phone is null and existing.number = organizations.phone)
      )
  );

alter table activities
  add column if not exists paper_note_entry_id uuid references paper_note_entries(id) on delete restrict;

create unique index if not exists activities_paper_note_entry_unique
  on activities(paper_note_entry_id)
  where paper_note_entry_id is not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'activities'::regclass
      and conname = 'activities_parent_required'
  ) then
    alter table activities drop constraint activities_parent_required;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'activities'::regclass
      and conname = 'activities_occurred_at_required_for_local'
  ) then
    alter table activities drop constraint activities_occurred_at_required_for_local;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'activities'::regclass
      and conname = 'activities_source_type_valid'
  ) then
    alter table activities drop constraint activities_source_type_valid;
  end if;
  if exists (
    select 1 from pg_constraint
    where conrelid = 'activities'::regclass
      and conname = 'activities_paper_note_unknown_date_requires_fallback'
  ) then
    alter table activities drop constraint activities_paper_note_unknown_date_requires_fallback;
  end if;
end
$$;

alter table activities add constraint activities_parent_required check (
  organization_id is not null
  or contact_id is not null
  or booking_id is not null
  or source_record_id is not null
  or paper_note_entry_id is not null
);
alter table activities add constraint activities_occurred_at_required_for_local check (
  occurred_at is not null
  or source_record_id is not null
  or paper_note_entry_id is not null
);
alter table activities add constraint activities_source_type_valid check (
  source_type is null
  or source_type in ('note', 'history', 'activity', 'paper_note')
);
alter table activities add constraint activities_paper_note_unknown_date_requires_fallback check (
  paper_note_entry_id is null
  or occurred_at is not null
  or date_is_import_fallback
);