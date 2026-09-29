create table if not exists profile_research_runs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references organizations(id) on delete cascade,
  mode text not null check (mode in ('quick', 'deep')),
  status text not null check (status in ('running', 'complete', 'failed')),
  requested_by text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_message text,
  context_snapshot jsonb not null default '{}'::jsonb,
  summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profile_research_runs_profile_started_idx
  on profile_research_runs(profile_id, started_at desc);

create table if not exists profile_research_sources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references profile_research_runs(id) on delete cascade,
  source_key text not null,
  kind text not null check (kind in ('internal', 'web')),
  title text not null,
  url text,
  publisher text,
  retrieved_at timestamptz not null,
  excerpt text not null default '',
  created_at timestamptz not null default now(),
  unique(run_id, source_key)
);

create table if not exists profile_research_suggestions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references profile_research_runs(id) on delete cascade,
  target_kind text not null check (target_kind in ('organization', 'contact', 'booking', 'event_date_fact')),
  target_id uuid,
  field text not null,
  current_value text,
  suggested_value text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  rationale text not null,
  source_keys jsonb not null default '[]'::jsonb,
  conflict boolean not null default false,
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(run_id, target_kind, target_id, field, suggested_value)
);

create index if not exists profile_research_suggestions_run_status_idx
  on profile_research_suggestions(run_id, review_status);
