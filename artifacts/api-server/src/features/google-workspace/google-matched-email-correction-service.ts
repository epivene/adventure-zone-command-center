import { pool as defaultPool } from "@workspace/db";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = { query(text: string, values?: unknown[]): Promise<QueryResult> };

type BaseDecision = {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  internalDateMs: number | null;
  hasAttachments: boolean;
  actorId: string;
  now: Date;
};

export class GoogleMatchedEmailCorrectionService {
  constructor(private readonly pool: SqlPool = defaultPool as unknown as SqlPool) {}

  private async connectionId(): Promise<string> {
    const result = await this.pool.query(
      `SELECT id FROM google_workspace_connections
        WHERE status IN ('connected', 'reauthorization_required')
        ORDER BY updated_at DESC LIMIT 1`,
    );
    const id = result.rows[0]?.id;
    if (typeof id !== "string" || !id) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    return id;
  }

  async assign(input: BaseDecision & { organizationId: string }): Promise<void> {
    const connectionId = await this.connectionId();
    const target = await this.pool.query(
      `SELECT id FROM organizations
        WHERE id = $1 AND consolidated_into_id IS NULL LIMIT 1`,
      [input.organizationId],
    );
    if (!target.rows.length) throw new Error("GOOGLE_WORKSPACE_REVIEW_TARGET_NOT_FOUND");

    const evidence = JSON.stringify(["manual_profile_assignment"]);
    await this.pool.query(
      `INSERT INTO google_workspace_validation_review_items (
         connection_id, message_id, thread_id, subject, from_header, to_header,
         internal_date_ms, evidence_codes, candidate_organizations,
         has_attachments, review_state, resolved_organization_id,
         reviewed_by, reviewed_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'[]'::jsonb,$9,'resolved',$10,$11,$12,$12,$12)
       ON CONFLICT (connection_id, message_id) DO UPDATE SET
         thread_id = EXCLUDED.thread_id,
         subject = EXCLUDED.subject,
         from_header = EXCLUDED.from_header,
         to_header = EXCLUDED.to_header,
         internal_date_ms = EXCLUDED.internal_date_ms,
         evidence_codes = EXCLUDED.evidence_codes,
         has_attachments = EXCLUDED.has_attachments,
         review_state = 'resolved',
         resolved_organization_id = EXCLUDED.resolved_organization_id,
         reviewed_by = EXCLUDED.reviewed_by,
         reviewed_at = EXCLUDED.reviewed_at,
         updated_at = EXCLUDED.updated_at`,
      [connectionId, input.messageId, input.threadId, input.subject, input.from, input.to,
       input.internalDateMs, evidence, input.hasAttachments, input.organizationId, input.actorId, input.now],
    );

    await this.pool.query(
      `INSERT INTO google_workspace_validation_mappings (
         connection_id, message_id, thread_id, organization_id, contact_id,
         evidence_codes, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,NULL,$5::jsonb,$6,$6)
       ON CONFLICT (connection_id, message_id) DO UPDATE SET
         thread_id = EXCLUDED.thread_id,
         organization_id = EXCLUDED.organization_id,
         contact_id = NULL,
         evidence_codes = EXCLUDED.evidence_codes,
         updated_at = EXCLUDED.updated_at`,
      [connectionId, input.messageId, input.threadId, input.organizationId, evidence, input.now],
    );
  }

  async ignore(input: BaseDecision): Promise<void> {
    const connectionId = await this.connectionId();
    await this.pool.query(
      `INSERT INTO google_workspace_validation_review_items (
         connection_id, message_id, thread_id, subject, from_header, to_header,
         internal_date_ms, evidence_codes, candidate_organizations,
         has_attachments, review_state, resolved_organization_id,
         reviewed_by, reviewed_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'["manual_ignore"]'::jsonb,'[]'::jsonb,$8,'ignored',NULL,$9,$10,$10,$10)
       ON CONFLICT (connection_id, message_id) DO UPDATE SET
         thread_id = EXCLUDED.thread_id,
         subject = EXCLUDED.subject,
         from_header = EXCLUDED.from_header,
         to_header = EXCLUDED.to_header,
         internal_date_ms = EXCLUDED.internal_date_ms,
         evidence_codes = EXCLUDED.evidence_codes,
         has_attachments = EXCLUDED.has_attachments,
         review_state = 'ignored',
         resolved_organization_id = NULL,
         reviewed_by = EXCLUDED.reviewed_by,
         reviewed_at = EXCLUDED.reviewed_at,
         updated_at = EXCLUDED.updated_at`,
      [connectionId, input.messageId, input.threadId, input.subject, input.from, input.to,
       input.internalDateMs, input.hasAttachments, input.actorId, input.now],
    );
    await this.pool.query(
      `DELETE FROM google_workspace_validation_mappings
        WHERE connection_id = $1 AND message_id = $2`,
      [connectionId, input.messageId],
    );
  }
}
