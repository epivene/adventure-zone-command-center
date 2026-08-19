alter table lead_scout_candidates
  add column if not exists candidate_key text;

update lead_scout_candidates
set candidate_key = md5(
  lower(regexp_replace(trim(name), '\s+', ' ', 'g')) || '|' ||
  lower(regexp_replace(coalesce(trim(city), ''), '\s+', ' ', 'g')) || '|' ||
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
