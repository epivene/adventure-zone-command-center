alter table lead_scout_candidates
  add column if not exists enrichment_status text not null default 'needs_enrichment',
  add column if not exists coverage_gaps jsonb not null default '[]'::jsonb,
  add column if not exists fit_reasons jsonb not null default '[]'::jsonb,
  add column if not exists fit_cautions jsonb not null default '[]'::jsonb,
  add column if not exists enrichment_error text,
  add column if not exists enriched_at timestamptz,
  add column if not exists deepen_requested_at timestamptz;

alter table lead_scout_candidates
  drop constraint if exists lead_scout_candidates_enrichment_status_check;

alter table lead_scout_candidates
  add constraint lead_scout_candidates_enrichment_status_check
  check (enrichment_status in ('needs_enrichment', 'enriching', 'enriched', 'enrichment_failed'));

create index if not exists lead_scout_candidates_run_enrichment_idx
  on lead_scout_candidates(run_id, enrichment_status, updated_at);
