create table if not exists equipment_handoffs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'suggested' check (status in ('suggested','dismissed','approved','needs_review')),
  from_leg_id uuid not null references travel_legs(id) on delete restrict,
  to_leg_id uuid not null references travel_legs(id) on delete restrict,
  from_trip_id uuid references trips(id) on delete set null,
  to_trip_id uuid references trips(id) on delete set null,
  resource_id uuid not null references resources(id) on delete restrict,
  meetup_label text not null,
  meetup_latitude double precision not null,
  meetup_longitude double precision not null,
  window_starts_at timestamptz not null,
  window_ends_at timestamptz not null,
  from_previous_booking_id uuid references bookings(id) on delete set null,
  from_next_booking_id uuid references bookings(id) on delete set null,
  to_previous_booking_id uuid references bookings(id) on delete set null,
  to_next_booking_id uuid references bookings(id) on delete set null,
  direct_miles double precision,
  direct_minutes double precision,
  from_detour_miles double precision not null default 0,
  from_detour_minutes double precision not null default 0,
  to_detour_miles double precision not null default 0,
  to_detour_minutes double precision not null default 0,
  combined_detour_miles double precision not null default 0,
  available_buffer_minutes double precision,
  opportunity_band text not null check (opportunity_band in ('strong','possible','weak')),
  explanation text not null,
  dependency_fingerprint text not null,
  approved_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_leg_id <> to_leg_id),
  check (window_ends_at >= window_starts_at)
);

create unique index if not exists equipment_handoffs_fingerprint_unique
  on equipment_handoffs(dependency_fingerprint);
create index if not exists equipment_handoffs_status_window_idx
  on equipment_handoffs(status, window_starts_at);
create index if not exists equipment_handoffs_from_trip_idx on equipment_handoffs(from_trip_id);
create index if not exists equipment_handoffs_to_trip_idx on equipment_handoffs(to_trip_id);
