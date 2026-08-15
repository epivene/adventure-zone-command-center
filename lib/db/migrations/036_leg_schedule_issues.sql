create table if not exists leg_schedule_issues (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references travel_legs(id) on delete restrict,
  booking_id uuid references bookings(id) on delete set null,
  trip_id uuid references trips(id) on delete set null,
  kind text not null check (kind in ('wrong_datetime','wrong_location','wrong_leg','route_problem','event_details_changed','other')),
  notes text not null,
  status text not null default 'open' check (status in ('open','resolved')),
  client_mutation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_note text,
  constraint leg_schedule_issues_leg_mutation_unique unique (leg_id, client_mutation_id)
);
create index if not exists leg_schedule_issues_leg_status_idx on leg_schedule_issues(leg_id,status);
