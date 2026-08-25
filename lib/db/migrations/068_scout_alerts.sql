create table if not exists scout_alert_watches (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references lead_scout_candidates(id) on delete cascade,
  actor_id text not null,
  organization_id uuid not null references organizations(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  status text not null default 'active'
    check (status in ('active','paused','complete')),
  snapshot jsonb,
  next_evaluation_at timestamptz not null default now(),
  next_research_at timestamptz not null default (now() + interval '7 days'),
  last_evaluated_at timestamptz,
  last_researched_at timestamptz,
  last_error text,
  failure_count integer not null default 0 check (failure_count >= 0),
  worker_id text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scout_alert_watches_due_idx
  on scout_alert_watches(status, next_evaluation_at, next_research_at, lease_expires_at);
create index if not exists scout_alert_watches_actor_idx
  on scout_alert_watches(actor_id, status, updated_at desc);
create index if not exists scout_alert_watches_organization_idx
  on scout_alert_watches(organization_id, status);

create table if not exists scout_alerts (
  id uuid primary key default gen_random_uuid(),
  watch_id uuid not null references scout_alert_watches(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  booking_id uuid references bookings(id) on delete set null,
  kind text not null
    check (kind in ('application_opened','deadline_approaching','dates_announced','dates_changed','contact_changed','needs_verification','monitoring_problem')),
  severity text not null
    check (severity in ('info','attention','urgent')),
  title text not null check (nullif(trim(title), '') is not null),
  body text not null check (nullif(trim(body), '') is not null),
  before_value jsonb,
  after_value jsonb,
  sources jsonb not null default '[]'::jsonb
    check (jsonb_typeof(sources) = 'array'),
  confidence text
    check (confidence is null or confidence in ('high','medium','low')),
  fingerprint text not null,
  status text not null default 'open'
    check (status in ('open','snoozed','dismissed','resolved')),
  due_at timestamptz,
  snoozed_until timestamptz,
  detected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'snoozed' or snoozed_until is not null)
);

create unique index if not exists scout_alerts_fingerprint_unique
  on scout_alerts(fingerprint);
create index if not exists scout_alerts_visible_idx
  on scout_alerts(status, snoozed_until, severity, due_at, detected_at desc);
create index if not exists scout_alerts_watch_idx
  on scout_alerts(watch_id, status, detected_at desc);
create index if not exists scout_alerts_organization_idx
  on scout_alerts(organization_id, status, detected_at desc);
