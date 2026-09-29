const profileResearchSchemaSql = `
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
create table if not exists profile_research_saved_sources (
  id uuid primary key default gen_random_uuid(),
  url text not null unique,
  title text not null,
  notes text,
  last_scouted_at timestamptz,
  last_scout_start_date date,
  last_scout_end_date date,
  last_scout_results jsonb not null default '[]'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profile_research_saved_sources_active_idx
  on profile_research_saved_sources(archived_at, last_scouted_at desc, created_at desc);

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
`;

export async function ensureProfileResearchSchema(client: {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<boolean> {
  const marker = await client.query(
    "SELECT to_regclass(current_schema() || '.profile_research_runs') IS NOT NULL " +
      "AND to_regclass(current_schema() || '.profile_research_sources') IS NOT NULL " +
      "AND to_regclass(current_schema() || '.profile_research_suggestions') IS NOT NULL " +
      "AND to_regclass(current_schema() || '.profile_research_saved_sources') IS NOT NULL " +
      "AND to_regclass(current_schema() || '.lead_scout_runs') IS NOT NULL " +
      "AND to_regclass(current_schema() || '.lead_scout_sources') IS NOT NULL " +
      "AND to_regclass(current_schema() || '.lead_scout_candidates') IS NOT NULL " +
      "AND to_regclass(current_schema() || '.lead_scout_candidate_facts') IS NOT NULL AS ready",
  );
  if (marker.rows[0]?.["ready"] === true) return false;
  await client.query(profileResearchSchemaSql);
  return true;
}
