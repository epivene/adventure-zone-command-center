begin;

create table if not exists marketing_audiences (
  id uuid primary key default gen_random_uuid(), name text not null, description text,
  created_by text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint marketing_audiences_name_nonblank check (btrim(name) <> '')
);
create table if not exists marketing_audience_members (
  id uuid primary key default gen_random_uuid(), audience_id uuid not null references marketing_audiences(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete restrict,
  contact_id uuid not null references contacts(id) on delete restrict, created_at timestamptz not null default now()
);
create unique index if not exists marketing_audience_members_unique on marketing_audience_members(audience_id, organization_id, contact_id);
create index if not exists marketing_audience_members_audience_idx on marketing_audience_members(audience_id);

create table if not exists marketing_campaigns (
  id uuid primary key default gen_random_uuid(), name text not null,
  audience_id uuid not null references marketing_audiences(id) on delete restrict,
  template_id uuid not null references communication_templates(id) on delete restrict,
  state text not null default 'draft', template_version_snapshot text, template_name_snapshot text,
  subject_template_snapshot text, body_template_snapshot text, required_placeholders_snapshot text[],
  subject_template text, body_template text,
  sender_name text not null, sender_email text, sender_phone text, extra_values jsonb not null default '{}'::jsonb,
  audience_revision integer not null default 0, snapshot_revision integer, snapshot_confirmed_at timestamptz,
  snapshot_recipient_count integer, snapshot_excluded jsonb not null default '[]'::jsonb,
  requested_review_by text, requested_review_at timestamptz, approved_by text, approved_at timestamptz,
  scheduled_for timestamptz, send_started_at timestamptz, sent_at timestamptz, cancelled_at timestamptz,
  last_error text, created_by text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint marketing_campaigns_state_valid check (state in ('draft','needs_review','approved','scheduled','sending','sent','failed','cancelled')),
  constraint marketing_campaigns_name_nonblank check (btrim(name) <> ''),
  constraint marketing_campaigns_revision_valid check (audience_revision >= 0 and (snapshot_revision is null or snapshot_revision >= 0))
);
create index if not exists marketing_campaigns_state_schedule_idx on marketing_campaigns(state, scheduled_for);
alter table marketing_campaigns add column if not exists subject_template text;
alter table marketing_campaigns add column if not exists body_template text;

create table if not exists marketing_campaign_recipients (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references marketing_campaigns(id) on delete restrict,
  snapshot_revision integer not null, organization_id uuid not null references organizations(id) on delete restrict,
  contact_id uuid not null references contacts(id) on delete restrict, recipient_email text not null,
  organization_name text not null, contact_name text not null, subject text not null, body text not null,
  created_at timestamptz not null default now(),
  constraint marketing_campaign_recipients_email_normalized check (recipient_email = lower(btrim(recipient_email)))
);
create unique index if not exists marketing_campaign_recipients_snapshot_unique on marketing_campaign_recipients(campaign_id, snapshot_revision, recipient_email);
create index if not exists marketing_campaign_recipients_campaign_idx on marketing_campaign_recipients(campaign_id, snapshot_revision);

create table if not exists marketing_campaign_deliveries (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references marketing_campaigns(id) on delete restrict,
  recipient_id uuid not null references marketing_campaign_recipients(id) on delete restrict,
  state text not null default 'pending', attempt_count integer not null default 0, claim_token uuid, claimed_at timestamptz,
  provider_message_id text, sent_at timestamptz, last_error text, updated_at timestamptz not null default now(),
  constraint marketing_campaign_deliveries_state_valid check (state in ('pending','sending','sent','failed')),
  constraint marketing_campaign_deliveries_attempts_valid check (attempt_count >= 0)
);
create unique index if not exists marketing_campaign_deliveries_recipient_unique on marketing_campaign_deliveries(recipient_id);
create index if not exists marketing_campaign_deliveries_campaign_state_idx on marketing_campaign_deliveries(campaign_id, state);

create table if not exists marketing_campaign_events (
  id uuid primary key default gen_random_uuid(), campaign_id uuid not null references marketing_campaigns(id) on delete restrict,
  event_type text not null, actor_id text not null, details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists marketing_campaign_events_history_idx on marketing_campaign_events(campaign_id, created_at);

commit;