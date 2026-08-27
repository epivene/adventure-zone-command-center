create table if not exists booking_opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  event_year integer not null
    check (event_year between 2000 and 2200),
  booking_id uuid references bookings(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  status text not null default 'new_lead'
    check (status in (
      'new_lead',
      'researching',
      'ready_to_contact',
      'contacted',
      'follow_up',
      'interested',
      'booking_in_progress',
      'booked',
      'not_pursuing',
      'declined',
      'no_response',
      'territory_hold',
      'needs_review',
      'cancelled'
    )),
  priority text not null default 'normal'
    check (priority in ('normal', 'high', 'urgent')),
  next_action_kind text,
  next_action_due_at timestamptz,
  hold_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists booking_opportunities_organization_year_unique
  on booking_opportunities(organization_id, event_year);
create index if not exists booking_opportunities_status_due_idx
  on booking_opportunities(status, next_action_due_at);
create index if not exists booking_opportunities_booking_idx
  on booking_opportunities(booking_id);

create table if not exists booking_opportunity_queue_overrides (
  opportunity_id uuid not null
    references booking_opportunities(id) on delete cascade,
  business_date date not null,
  pinned boolean not null default false,
  manual_order integer
    check (manual_order is null or manual_order >= 0),
  snoozed_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (opportunity_id, business_date)
);

create index if not exists booking_opportunity_queue_overrides_date_idx
  on booking_opportunity_queue_overrides(
    business_date,
    pinned,
    manual_order
  );
