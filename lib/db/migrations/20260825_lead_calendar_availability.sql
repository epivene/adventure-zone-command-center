create table if not exists lead_availability_snapshots (
  id uuid primary key default gen_random_uuid(),
  row_id uuid not null references lead_import_rows(id) on delete cascade,
  review_version integer not null,
  proposed_start_date date not null,
  proposed_end_date date not null,
  ready boolean not null,
  checked_by text not null,
  checked_at timestamptz not null,
  selected_calendar_ids jsonb not null,
  source_events jsonb not null,
  reservations jsonb not null,
  constraint lead_availability_snapshots_window_valid check (proposed_end_date >= proposed_start_date),
  constraint lead_availability_snapshots_calendar_ids_array check (jsonb_typeof(selected_calendar_ids) = 'array'),
  constraint lead_availability_snapshots_source_events_array check (jsonb_typeof(source_events) = 'array'),
  constraint lead_availability_snapshots_reservations_array check (jsonb_typeof(reservations) = 'array')
);
create index if not exists lead_availability_snapshots_row_checked_idx on lead_availability_snapshots (row_id, checked_at desc);