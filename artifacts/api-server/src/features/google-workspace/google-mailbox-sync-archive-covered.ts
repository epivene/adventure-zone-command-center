import type { AccountClaim, SyncRepository } from "./google-mailbox-sync-repository";

// Reconcile queue metadata only. Never rewrite saved mail or infer that partial
// attachments are complete. Verify current and historical message coverage.
export async function completeCoveredArchives(repo: SyncRepository, a: AccountClaim): Promise<number> {
  if (a.mode !== "active") return 0;
  return repo.db.transaction(async tx => {
    if (!(await repo.valid(tx,a))) return 0;
    await tx.query("LOCK TABLE google_workspace_validation_mappings IN SHARE ROW EXCLUSIVE MODE");
    const result = await tx.query(`WITH covered AS (
      SELECT j.connection_id,j.thread_id,j.fingerprint,to_jsonb(j) AS job_before,
        s.profile_id AS destination_profile_id,repair.entity_id AS repair_audit_id
      FROM google_sync_archive_jobs j
      JOIN google_sync_snapshots s ON s.connection_id=j.connection_id AND s.thread_id=j.thread_id AND s.availability='available'
      LEFT JOIN LATERAL (
        SELECT e.entity_id FROM audit_entries e
        WHERE s.profile_id<>j.profile_id AND e.entity_type='email_profile_mapping' AND e.action='repair'
        AND e."before"->>'gmailConnectionId'=j.connection_id::text
        AND e."before"->>'threadId'=j.thread_id
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(e."before"->'mappings','[]')) m WHERE m->>'organization_id'=j.profile_id::text)
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(e."after"->'mappings','[]')) m WHERE m->>'organization_id'=s.profile_id::text)
        AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(e."after"->'mappings','[]')) m WHERE m->>'organization_id' IS DISTINCT FROM s.profile_id::text)
        ORDER BY e.entity_id LIMIT 1
      ) repair ON true
      WHERE j.connection_id=$1 AND j.status='pending' AND j.retry_at<=now()
      AND (s.profile_id=j.profile_id OR repair.entity_id IS NOT NULL)
      AND EXISTS(SELECT 1 FROM google_workspace_validation_mappings m WHERE m.connection_id=j.connection_id AND m.thread_id=j.thread_id AND m.organization_id=s.profile_id)
      AND NOT EXISTS(SELECT 1 FROM google_workspace_validation_mappings m WHERE m.connection_id=j.connection_id AND m.thread_id=j.thread_id AND m.organization_id IS DISTINCT FROM s.profile_id)
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s.snapshot->'messages','[]')) m WHERE NOT COALESCE(m->'labelIds','[]') ?| ARRAY['DRAFT','TRASH'])
      AND EXISTS(
        SELECT 1 FROM google_workspace_profile_email_thread_sources src
        JOIN google_workspace_profile_email_threads t ON t.id=src.conversation_id AND t.connection_id=j.connection_id AND t.organization_id=s.profile_id AND t.archive_state='complete'
        WHERE src.connection_id=j.connection_id AND src.gmail_thread_id=j.thread_id
        AND NOT EXISTS(
          SELECT 1 FROM (
            SELECT m FROM jsonb_array_elements(COALESCE(s.snapshot->'messages','[]')) m
            UNION ALL
            SELECT m FROM google_sync_history h CROSS JOIN LATERAL jsonb_array_elements(COALESCE(h.snapshot->'messages','[]')) m
            WHERE h.connection_id=j.connection_id AND h.thread_id=j.thread_id
              AND (s.profile_id<>j.profile_id OR h.profile_id=j.profile_id)
          ) observed
          WHERE NOT COALESCE(m->'labelIds','[]') ?| ARRAY['DRAFT','TRASH']
          AND NOT EXISTS(SELECT 1 FROM google_workspace_profile_email_messages saved WHERE saved.connection_id=j.connection_id AND saved.conversation_id=t.id AND saved.gmail_message_id=m->>'id')
        )
      )
      ORDER BY j.retry_at,j.thread_id LIMIT 100
    ), updated AS (UPDATE google_sync_archive_jobs j SET status='complete',error_code=NULL
      FROM covered c WHERE j.connection_id=c.connection_id AND j.thread_id=c.thread_id AND j.fingerprint=c.fingerprint
        AND j.status='pending'
      RETURNING j.thread_id,c.job_before,to_jsonb(j) AS job_after,c.destination_profile_id,c.repair_audit_id
    ), audited AS (
      INSERT INTO audit_entries(entity_type,entity_id,action,"before","after")
      SELECT 'google_sync_archive_job',gen_random_uuid(),'reconcile_mapping_repair',job_before,
        jsonb_build_object('job',job_after,'destinationProfileId',destination_profile_id,'repairAuditId',repair_audit_id)
      FROM updated WHERE repair_audit_id IS NOT NULL
      RETURNING entity_id
    ) SELECT thread_id FROM updated`,[a.connectionId]);
    return result.rows.length;
  });
}
