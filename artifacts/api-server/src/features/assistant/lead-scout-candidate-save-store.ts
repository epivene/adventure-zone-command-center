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
      `update lead_scout_candidates candidate
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
       returning candidate.id`,
      [input.runId, input.actorId, input.candidateId, input.profileId, input.bookingId],
    );
    return result.rows.length > 0;
  }
}
