create table if not exists crew_workers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  normalized_phone text,
  email text,
  city text,
  region text,
  location_text text,
  rehire_status text not null default 'undecided',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crew_workers_name_nonblank check (nullif(trim(name), '') is not null),
  constraint crew_workers_rehire_status_valid check (rehire_status in ('rehirable','undecided','do_not_rehire'))
);
create index if not exists crew_workers_location_idx on crew_workers(region, city);
create index if not exists crew_workers_normalized_phone_idx on crew_workers(normalized_phone) where normalized_phone is not null;

create table if not exists crew_work_history (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references crew_workers(id) on delete restrict,
  leg_id uuid not null references travel_legs(id) on delete restrict,
  booking_id uuid references bookings(id) on delete set null,
  trip_id uuid references trips(id) on delete set null,
  role text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  rating integer,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crew_work_history_role_nonblank check (nullif(trim(role), '') is not null),
  constraint crew_work_history_dates_valid check (ended_at is null or ended_at >= started_at),
  constraint crew_work_history_rating_valid check (rating is null or rating between 0 and 5)
);
create index if not exists crew_work_history_worker_started_idx on crew_work_history(worker_id, started_at desc);
create index if not exists crew_work_history_leg_started_idx on crew_work_history(leg_id, started_at desc);

create table if not exists crew_manager_notes (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references crew_workers(id) on delete restrict,
  leg_id uuid not null references travel_legs(id) on delete restrict,
  booking_id uuid references bookings(id) on delete set null,
  note text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crew_manager_notes_note_nonblank check (nullif(trim(note), '') is not null)
);
create index if not exists crew_manager_notes_worker_created_idx on crew_manager_notes(worker_id, created_at desc);
create index if not exists crew_manager_notes_leg_created_idx on crew_manager_notes(leg_id, created_at desc);
