create table if not exists leg_incidents (
  id uuid primary key,
  leg_id uuid not null references travel_legs(id) on delete restrict,
  booking_id uuid references bookings(id) on delete set null,
  trip_id uuid references trips(id) on delete set null,
  type text not null,
  occurred_at timestamptz not null,
  location_text text,
  people_involved text,
  description text not null,
  action_taken text,
  follow_up_needed boolean not null default false,
  client_mutation_id uuid not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leg_incidents_type_nonblank check (nullif(trim(type),'') is not null),
  constraint leg_incidents_description_nonblank check (nullif(trim(description),'') is not null),
  constraint leg_incidents_revision_positive check (revision >= 1),
  constraint leg_incidents_leg_mutation_unique unique (leg_id, client_mutation_id)
);
create index if not exists leg_incidents_leg_occurred_idx on leg_incidents(leg_id, occurred_at desc);
create table if not exists leg_incident_attachments (
  id uuid primary key,
  leg_id uuid not null references travel_legs(id) on delete restrict,
  incident_id uuid not null references leg_incidents(id) on delete cascade,
  object_key text,
  image_status text not null default 'image_pending',
  mime_type text,
  client_mutation_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leg_incident_attachments_status_valid check (image_status in ('image_pending','image_uploaded','image_failed')),
  constraint leg_incident_attachments_leg_mutation_unique unique (leg_id, client_mutation_id)
);
create index if not exists leg_incident_attachments_incident_idx on leg_incident_attachments(incident_id);
