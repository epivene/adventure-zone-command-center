create table if not exists scoped_notes (
  id uuid primary key default gen_random_uuid(),
  organization_location_id uuid references organization_locations(id) on delete restrict,
  event_family_id uuid references event_families(id) on delete restrict,
  body text not null,
  source text not null default 'local',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scoped_notes_exactly_one_owner check (
    (organization_location_id is not null)::int +
    (event_family_id is not null)::int = 1
  ),
  constraint scoped_notes_body_nonblank check (nullif(trim(body), '') is not null),
  constraint scoped_notes_source_local check (source = 'local')
);

create index if not exists scoped_notes_location_created_idx
  on scoped_notes(organization_location_id, created_at desc)
  where organization_location_id is not null;

create index if not exists scoped_notes_family_created_idx
  on scoped_notes(event_family_id, created_at desc)
  where event_family_id is not null;
