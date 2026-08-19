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
