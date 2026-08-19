const leadScoutRelease2Sql = `
alter table lead_scout_candidates
  add column if not exists candidate_key text;

update lead_scout_candidates
set candidate_key = md5(
  lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) || '|' ||
  lower(regexp_replace(coalesce(trim(city), ''), '\\s+', ' ', 'g')) || '|' ||
  upper(coalesce(trim(region), '')) || '|' ||
  coalesce(starts_at::text, '') || '|' ||
  lower(coalesce(trim(website), ''))
)
where candidate_key is null;

with ranked as (
  select id,
         row_number() over (
           partition by run_id, candidate_key
           order by created_at, id
         ) as duplicate_rank
  from lead_scout_candidates
  where candidate_key is not null
)
delete from lead_scout_candidates candidate
using ranked
where candidate.id = ranked.id
  and ranked.duplicate_rank > 1;

alter table lead_scout_candidates
  alter column candidate_key set not null;

create unique index if not exists lead_scout_candidates_run_candidate_key_uidx
  on lead_scout_candidates(run_id, candidate_key);
`;

export async function ensureLeadScoutRelease2Schema(client: {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<boolean> {
  const marker = await client.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'lead_scout_candidates'
          AND column_name = 'candidate_key'
          AND is_nullable = 'NO'
      )
      AND to_regclass(current_schema() || '.lead_scout_candidates_run_candidate_key_uidx') IS NOT NULL
      AS ready
  `);
  if (marker.rows[0]?.["ready"] === true) return false;
  await client.query(leadScoutRelease2Sql);
  return true;
}
