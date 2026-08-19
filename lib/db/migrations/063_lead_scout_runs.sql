create table if not exists lead_scout_runs (
  id uuid primary key default gen_random_uuid(),
  actor_id text not null,
  original_question text not null,
  criteria jsonb,
  criteria_summary text,
  crm_matches jsonb not null default '[]'::jsonb,
  status text not null default 'interpreting'
    check (status in ('interpreting', 'crm_search', 'crm_ready', 'running', 'stopping', 'stopped', 'complete', 'failed')),
  stage text not null default 'interpreting'
    check (stage in ('interpreting', 'crm_search', 'source_discovery', 'candidate_discovery', 'candidate_enrichment', 'crm_compare', 'fit_rank', 'complete')),
  progress jsonb not null default '{"label":null,"sourcesChecked":0,"candidatesFound":0,"candidatesEnriched":0,"candidatesCompared":0}'::jsonb,
  worker_id text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  web_started_at timestamptz,
  cancel_requested_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_scout_runs_actor_created_idx
  on lead_scout_runs(actor_id, created_at desc);
create index if not exists lead_scout_runs_status_lease_idx
  on lead_scout_runs(status, lease_expires_at);

create table if not exists lead_scout_sources (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references lead_scout_runs(id) on delete cascade,
  url text not null,
  title text not null,
  publisher text,
  category text not null
    check (category in ('official_event', 'government', 'tourism_chamber', 'vendor_application', 'venue_partner', 'news_recap', 'social', 'review_forum', 'other')),
  retrieved_at timestamptz not null,
  excerpt text not null default '',
  created_at timestamptz not null default now(),
  unique(run_id, url)
);

create index if not exists lead_scout_sources_run_idx
  on lead_scout_sources(run_id, created_at);

create table if not exists lead_scout_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references lead_scout_runs(id) on delete cascade,
  name text not null,
  city text,
  region text,
  venue text,
  starts_at date,
  ends_at date,
  organizer_name text,
  organizer_email text,
  organizer_phone text,
  website text,
  event_type text,
  recurrence_summary text,
  attendance_summary text,
  vendor_summary text,
  application_deadline date,
  fit_score integer,
  fit_rationale text,
  crm_match_status text not null default 'new_prospect'
    check (crm_match_status in ('existing', 'possible_match', 'new_prospect')),
  matched_organization_id uuid,
  matched_booking_id uuid,
  review_status text not null default 'unreviewed'
    check (review_status in ('unreviewed', 'shortlisted', 'dismissed', 'saved')),
  saved_organization_id uuid,
  saved_booking_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_scout_candidates_run_fit_idx
  on lead_scout_candidates(run_id, fit_score desc nulls last, created_at);

create table if not exists lead_scout_candidate_facts (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references lead_scout_candidates(id) on delete cascade,
  fact_key text not null,
  fact_value jsonb,
  category text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  rationale text not null,
  source_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_scout_candidate_facts_candidate_idx
  on lead_scout_candidate_facts(candidate_id, created_at);
