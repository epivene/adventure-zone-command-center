const leadScoutRelease3Sql = `
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
`;

export async function ensureLeadScoutRelease3Schema(client: {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<boolean> {
  const marker = await client.query(`
    select
      count(*) = 7
      and to_regclass(current_schema() || '.lead_scout_candidates_run_enrichment_idx') is not null
      and exists (
        select 1 from pg_constraint
        where conrelid = to_regclass(current_schema() || '.lead_scout_candidates')
          and conname = 'lead_scout_candidates_enrichment_status_check'
          and contype = 'c'
      ) as ready
    from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'lead_scout_candidates'
      and column_name in (
        'enrichment_status', 'coverage_gaps', 'fit_reasons', 'fit_cautions',
        'enrichment_error', 'enriched_at', 'deepen_requested_at'
      )
  `);
  if (marker.rows[0]?.["ready"] === true) return false;
  await client.query(leadScoutRelease3Sql);
  return true;
}
