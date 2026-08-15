create table if not exists leg_event_income (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references travel_legs(id) on delete restrict,
  booking_id uuid references bookings(id) on delete set null,
  trip_id uuid references trips(id) on delete set null,
  trip_segment_id uuid references trip_segments(id) on delete set null,
  cash_cents integer not null default 0 check (cash_cents >= 0),
  square_cents integer not null default 0 check (square_cents >= 0),
  other_cents integer not null default 0 check (other_cents >= 0),
  other_label text,
  occurred_at timestamptz not null,
  notes text,
  client_mutation_id uuid not null,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (leg_id, client_mutation_id)
);

create table if not exists leg_expenses (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references travel_legs(id) on delete restrict,
  booking_id uuid references bookings(id) on delete set null,
  trip_id uuid references trips(id) on delete set null,
  trip_segment_id uuid references trip_segments(id) on delete set null,
  category text not null check (category in ('fuel','food','rv_park','vehicle_maintenance','trailer_maintenance','supplies','employee_related','other')),
  merchant text,
  amount_cents integer not null check (amount_cents >= 0),
  tax_cents integer not null default 0 check (tax_cents >= 0),
  payment_source text not null check (payment_source in ('adventure_zone_cash','adventure_zone_debit','personal')),
  occurred_at timestamptz not null,
  notes text,
  employee_note text,
  detail_json jsonb,
  client_mutation_id uuid not null,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (leg_id, client_mutation_id)
);

create table if not exists leg_cash_entries (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references travel_legs(id) on delete restrict,
  booking_id uuid references bookings(id) on delete set null,
  trip_id uuid references trips(id) on delete set null,
  trip_segment_id uuid references trip_segments(id) on delete set null,
  kind text not null check (kind in ('event_cash_collected','expense_paid_cash','advance_received','cash_turned_in','cash_returned','manager_reimbursed','adjustment')),
  amount_cents integer not null,
  occurred_at timestamptz not null,
  notes text,
  client_mutation_id uuid not null,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leg_cash_entries_amount_valid check (kind = 'adjustment' or amount_cents >= 0),
  unique (leg_id, client_mutation_id)
);

create table if not exists leg_mileage_entries (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references travel_legs(id) on delete restrict,
  booking_id uuid references bookings(id) on delete set null,
  trip_id uuid references trips(id) on delete set null,
  trip_segment_id uuid references trip_segments(id) on delete set null,
  miles double precision,
  odometer_start double precision,
  odometer_end double precision,
  vehicle_label text,
  occurred_at timestamptz not null,
  notes text,
  client_mutation_id uuid not null,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leg_mileage_entries_distance_valid check (
    (miles is not null and miles >= 0)
    or (odometer_start is not null and odometer_end is not null and odometer_end >= odometer_start)
  ),
  unique (leg_id, client_mutation_id)
);

create table if not exists leg_receipts (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references travel_legs(id) on delete restrict,
  expense_id uuid not null references leg_expenses(id) on delete cascade,
  object_key text,
  image_status text not null default 'image_pending' check (image_status in ('image_pending','image_uploaded','image_failed')),
  mime_type text,
  client_mutation_id uuid not null,
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (leg_id, client_mutation_id)
);

create index if not exists leg_event_income_leg_trip_idx on leg_event_income(leg_id, trip_id);
create index if not exists leg_expenses_leg_trip_idx on leg_expenses(leg_id, trip_id);
create index if not exists leg_cash_entries_leg_trip_idx on leg_cash_entries(leg_id, trip_id);
create index if not exists leg_mileage_entries_leg_trip_idx on leg_mileage_entries(leg_id, trip_id);
create index if not exists leg_receipts_leg_expense_idx on leg_receipts(leg_id, expense_id);
