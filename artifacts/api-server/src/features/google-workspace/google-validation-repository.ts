import { pool as defaultPool } from "@workspace/db";

export type GoogleValidationMappingInput = {
  messageId: string;
  threadId: string;
  organizationId: string;
  contactId: string | null;
  evidenceCodes: string[];
};

export type GoogleApprovedValidationMapping = GoogleValidationMappingInput;

export type GoogleValidationStatus =
  | "not_started"
  | "ready_for_review"
  | "approved"
  | "rejected";

type QueryResult = {
  rows: Array<Record<string, unknown>>;
};

type SqlPool = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

function evidenceCodes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export class PostgresGoogleValidationRepository {
  constructor(
    private readonly pool: SqlPool = defaultPool as unknown as SqlPool,
  ) {}

  private async currentConnectionId(): Promise<string> {
    const result = await this.pool.query(
      `SELECT id
         FROM google_workspace_connections
        WHERE status IN ('connected', 'reauthorization_required')
        ORDER BY updated_at DESC
        LIMIT 1`,
    );
    const id = result.rows[0]?.id;
    if (typeof id !== "string" || !id) {
      throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    }
    return id;
  }

  async upsertRows(rows: GoogleValidationMappingInput[]): Promise<void> {
    if (!rows.length) return;
    const connectionId = await this.currentConnectionId();

    for (const row of rows) {
      if (
        !row.messageId.trim() ||
        !row.threadId.trim() ||
        !row.organizationId.trim()
      ) {
        throw new Error("GOOGLE_WORKSPACE_VALIDATION_MAPPING_INVALID");
      }
      await this.pool.query(
        `INSERT INTO google_workspace_validation_mappings (
           connection_id,
           message_id,
           thread_id,
           organization_id,
           contact_id,
           evidence_codes,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, now(), now())
         ON CONFLICT (connection_id, message_id) DO UPDATE SET
           thread_id = EXCLUDED.thread_id,
           organization_id = EXCLUDED.organization_id,
           contact_id = EXCLUDED.contact_id,
           evidence_codes = EXCLUDED.evidence_codes,
           updated_at = now()`,
        [
          connectionId,
          row.messageId,
          row.threadId,
          row.organizationId,
          row.contactId,
          JSON.stringify(row.evidenceCodes),
        ],
      );
    }

    await this.pool.query(
      `INSERT INTO google_workspace_validation_state (
         connection_id,
         validation_status,
         reviewed_by,
         reviewed_at,
         updated_at
       ) VALUES ($1, 'ready_for_review', NULL, NULL, now())
       ON CONFLICT (connection_id) DO UPDATE SET
         validation_status = CASE
           WHEN google_workspace_validation_state.validation_status = 'approved'
             THEN 'approved'
           ELSE 'ready_for_review'
         END,
         updated_at = now()`,
      [connectionId],
    );
  }

  async getStatus(): Promise<GoogleValidationStatus> {
    const connectionId = await this.currentConnectionId();
    const result = await this.pool.query(
      `SELECT validation_status
         FROM google_workspace_validation_state
        WHERE connection_id = $1`,
      [connectionId],
    );
    const status = result.rows[0]?.validation_status;
    return status === "ready_for_review" ||
      status === "approved" ||
      status === "rejected"
      ? status
      : "not_started";
  }

  async setDecision(input: {
    status: "approved" | "rejected";
    actorId: string;
    now: Date;
  }): Promise<void> {
    if (!input.actorId.trim() || !Number.isFinite(input.now.getTime())) {
      throw new Error("GOOGLE_WORKSPACE_VALIDATION_DECISION_INVALID");
    }
    const connectionId = await this.currentConnectionId();
    await this.pool.query(
      `INSERT INTO google_workspace_validation_state (
         connection_id,
         validation_status,
         reviewed_by,
         reviewed_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (connection_id) DO UPDATE SET
         validation_status = EXCLUDED.validation_status,
         reviewed_by = EXCLUDED.reviewed_by,
         reviewed_at = EXCLUDED.reviewed_at,
         updated_at = EXCLUDED.updated_at`,
      [connectionId, input.status, input.actorId, input.now],
    );

    await this.pool.query(
      `INSERT INTO google_workspace_audit_events (
         actor_kind,
         actor_id,
         action,
         target_type,
         target_id,
         metadata,
         created_at
       ) VALUES ('owner', $1, $2, 'connection', $3, '{}'::jsonb, $4)`,
      [
        input.actorId,
        input.status === "approved"
          ? "validation_sample_approved"
          : "validation_sample_rejected",
        connectionId,
        input.now,
      ],
    );
  }

  async listApprovedForOrganization(
    organizationId: string,
  ): Promise<GoogleApprovedValidationMapping[]> {
    const connectionId = await this.currentConnectionId();
    const result = await this.pool.query(
      `SELECT m.message_id, m.thread_id, m.organization_id, m.contact_id, m.evidence_codes
         FROM google_workspace_validation_mappings m
         INNER JOIN google_workspace_validation_state s
           ON s.connection_id = m.connection_id
          AND s.validation_status = 'approved'
        WHERE m.connection_id = $1
          AND m.organization_id = $2
        ORDER BY m.updated_at DESC, m.message_id DESC`,
      [connectionId, organizationId],
    );
    return result.rows.flatMap((row) => {
      if (
        typeof row.message_id !== "string" ||
        typeof row.thread_id !== "string" ||
        typeof row.organization_id !== "string"
      ) {
        return [];
      }
      return [{
        messageId: row.message_id,
        threadId: row.thread_id,
        organizationId: row.organization_id,
        contactId: typeof row.contact_id === "string" ? row.contact_id : null,
        evidenceCodes: evidenceCodes(row.evidence_codes),
      }];
    });
  }

  async organizationOwnsApprovedThread(input: {
    organizationId: string;
    threadId: string;
  }): Promise<boolean> {
    const connectionId = await this.currentConnectionId();
    const result = await this.pool.query(
      `SELECT 1
         FROM google_workspace_validation_mappings m
         INNER JOIN google_workspace_validation_state s
           ON s.connection_id = m.connection_id
          AND s.validation_status = 'approved'
        WHERE m.connection_id = $1
          AND m.organization_id = $2
          AND m.thread_id = $3
        LIMIT 1`,
      [connectionId, input.organizationId, input.threadId],
    );
    return result.rows.length > 0;
  }
}
