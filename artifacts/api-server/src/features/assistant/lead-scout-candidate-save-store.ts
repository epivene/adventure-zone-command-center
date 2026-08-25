import { pool as defaultPool } from "@workspace/db";

export interface LeadScoutCandidateSaveLinker {
  markSaved(input: {
    runId: string;
    actorId: string;
    candidateId: string;
    profileId: string;
    bookingId: string;
  }): Promise<boolean>;
}

type QueryDb = {
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
};

export class PostgresLeadScoutCandidateSaveLinker implements LeadScoutCandidateSaveLinker {
  constructor(private readonly db: QueryDb = defaultPool as unknown as QueryDb) {}

  async markSaved(input: {
    runId: string;
    actorId: string;
    candidateId: string;
    profileId: string;
    bookingId: string;
  }): Promise<boolean> {
    const result = await this.db.query(
      `with saved as (
         update lead_scout_candidates candidate
         set review_status = 'saved',
             crm_match_status = 'existing',
             matched_organization_id = $4,
             matched_booking_id = $5,
             saved_organization_id = $4,
             saved_booking_id = $5,
             updated_at = now()
         where candidate.id = $3
           and candidate.run_id = $1
           and candidate.crm_match_status = 'new_prospect'
           and candidate.review_status in ('unreviewed', 'shortlisted')
           and exists (
             select 1 from lead_scout_runs run
             where run.id = $1 and run.actor_id = $2
           )
         returning candidate.id, candidate.run_id, candidate.enriched_at
       ), activated as (
         insert into scout_alert_watches (
           candidate_id,
           actor_id,
           organization_id,
           booking_id,
           status,
           next_evaluation_at,
           next_research_at,
           created_at,
           updated_at
         )
         select
           saved.id,
           run.actor_id,
           $4,
           $5,
           'active',
           now(),
           coalesce(saved.enriched_at, now()) + interval '7 days',
           now(),
           now()
         from saved
         inner join lead_scout_runs run
           on run.id = saved.run_id and run.actor_id = $2
         on conflict (candidate_id) do update
         set actor_id = excluded.actor_id,
             organization_id = excluded.organization_id,
             booking_id = excluded.booking_id,
             status = 'active',
             next_evaluation_at = least(scout_alert_watches.next_evaluation_at, now()),
             updated_at = now()
         returning candidate_id
       )
       select candidate_id from activated`,
      [input.runId, input.actorId, input.candidateId, input.profileId, input.bookingId],
    );
    return result.rows.length > 0;
  }
}
