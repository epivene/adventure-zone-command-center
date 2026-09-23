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

export type GoogleValidationReviewState = "pending" | "resolved" | "ignored";

export type GoogleValidationReviewItem = {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  to: string;
  internalDateMs: number | null;
  evidenceCodes: string[];
  candidates: Array<{ id: string; name: string }>;
  hasAttachments: boolean;
  state: GoogleValidationReviewState;
  resolvedOrganizationId: string | null;
  gmailSyncState:
    | "not_requested"
    | "pending"
    | "completed"
    | "retryable_error"
    | "permanent_error"
    | "conflict";
  gmailSyncErrorCode: string | null;
  gmailSyncMutationId: string | null;
};

export type GoogleValidationReviewInput = Omit<
  GoogleValidationReviewItem,
  | "state"
  | "resolvedOrganizationId"
  | "gmailSyncState"
  | "gmailSyncErrorCode"
  | "gmailSyncMutationId"
>;

type QueryResult = {
  rows: Array<Record<string, unknown>>;
};

type SqlPool = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function candidates(value: unknown): Array<{ id: string; name: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.name !== "string") return [];
    return [{ id: item.id, name: item.name }];
  });
}

function gmailSyncState(
  value: unknown,
): GoogleValidationReviewItem["gmailSyncState"] {
  if (value === "processing") return "pending";
  return value === "pending" ||
    value === "completed" ||
    value === "retryable_error" ||
    value === "permanent_error" ||
    value === "conflict"
    ? value
    : "not_requested";
}

function internalDateMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

  async processedMessageIds(messageIds: string[]): Promise<Set<string>> {
    const ids = [...new Set(messageIds.filter((id) => id.trim()))];
    if (!ids.length) return new Set();
    const connectionId = await this.currentConnectionId();
    const result = await this.pool.query(
      `SELECT message_id
         FROM google_workspace_validation_mappings
        WHERE connection_id = $1
          AND message_id = ANY($2::text[])
       UNION
       SELECT message_id
         FROM google_workspace_validation_review_items
        WHERE connection_id = $1
          AND message_id = ANY($2::text[])
       UNION
       SELECT message_id
         FROM google_workspace_validation_processed_messages
        WHERE connection_id = $1
          AND message_id = ANY($2::text[])`,
      [connectionId, ids],
    );
    return new Set(result.rows.flatMap((row) =>
      typeof row.message_id === "string" ? [row.message_id] : []
    ));
  }

  async markProcessedMessageIds(messageIds: string[]): Promise<void> {
    const ids = [
      ...new Set(messageIds.map((id) => id.trim()).filter(Boolean)),
    ];
    if (!ids.length) return;
    const connectionId = await this.currentConnectionId();
    await this.pool.query(
      `INSERT INTO google_workspace_validation_processed_messages (
         connection_id,
         message_id,
         processed_at
       )
       SELECT $1, message_id, now()
         FROM unnest($2::text[]) AS message_id
       ON CONFLICT (connection_id, message_id) DO UPDATE SET
         processed_at = EXCLUDED.processed_at`,
      [connectionId, ids],
    );
  }

  async upsertRows(rows: GoogleValidationMappingInput[]): Promise<void> {
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

  async upsertReviewItems(items: GoogleValidationReviewInput[]): Promise<void> {
    if (!items.length) return;
    const connectionId = await this.currentConnectionId();
    for (const item of items) {
      if (!item.messageId.trim() || !item.threadId.trim()) {
        throw new Error("GOOGLE_WORKSPACE_REVIEW_ITEM_INVALID");
      }
      await this.pool.query(
        `INSERT INTO google_workspace_validation_review_items (
           connection_id,
           message_id,
           thread_id,
           subject,
           from_header,
           to_header,
           internal_date_ms,
           evidence_codes,
           candidate_organizations,
           has_attachments,
           review_state,
           created_at,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, 'pending', now(), now())
         ON CONFLICT (connection_id, message_id) DO UPDATE SET
           thread_id = EXCLUDED.thread_id,
           subject = EXCLUDED.subject,
           from_header = EXCLUDED.from_header,
           to_header = EXCLUDED.to_header,
           internal_date_ms = EXCLUDED.internal_date_ms,
           evidence_codes = EXCLUDED.evidence_codes,
           candidate_organizations = EXCLUDED.candidate_organizations,
           has_attachments = EXCLUDED.has_attachments,
           updated_at = now()`,
        [
          connectionId,
          item.messageId,
          item.threadId,
          item.subject,
          item.from,
          item.to,
          item.internalDateMs,
          JSON.stringify(item.evidenceCodes),
          JSON.stringify(item.candidates),
          item.hasAttachments,
        ],
      );
    }
  }

  async listReviewItems(): Promise<GoogleValidationReviewItem[]> {
    const connectionId = await this.currentConnectionId();
    const result = await this.pool.query(
      `SELECT DISTINCT ON (lower(btrim(item.from_header)), lower(btrim(item.subject))) item.message_id,
              item.thread_id,
              item.subject,
              item.from_header,
              item.to_header,
              item.internal_date_ms,
              item.evidence_codes,
              item.candidate_organizations,
              item.has_attachments,
              item.review_state,
              item.resolved_organization_id,
              COALESCE(mutation.state, item.gmail_sync_state) AS gmail_sync_state,
              CASE
                WHEN mutation.id IS NOT NULL THEN mutation.last_error_code
                ELSE item.gmail_sync_error_code
              END AS gmail_sync_error_code,
              COALESCE(mutation.id, item.gmail_sync_mutation_id)::text
                AS gmail_sync_mutation_id
         FROM google_workspace_validation_review_items item
         LEFT JOIN google_workspace_gmail_mutations mutation
           ON mutation.id = item.gmail_sync_mutation_id
        WHERE item.connection_id = $1
        ORDER BY lower(btrim(item.from_header)),
                 lower(btrim(item.subject)),
                 CASE item.review_state
                   WHEN 'pending' THEN 0
                   WHEN 'resolved' THEN 1
                   ELSE 2
                 END,
                 item.updated_at DESC,
                 item.message_id DESC`,
      [connectionId],
    );
    return result.rows.flatMap((row) => {
      if (
        typeof row.message_id !== "string" ||
        typeof row.thread_id !== "string" ||
        typeof row.subject !== "string" ||
        typeof row.from_header !== "string" ||
        typeof row.to_header !== "string" ||
        (row.review_state !== "pending" &&
          row.review_state !== "resolved" &&
          row.review_state !== "ignored")
      ) {
        return [];
      }
      return [{
        messageId: row.message_id,
        threadId: row.thread_id,
        subject: row.subject,
        from: row.from_header,
        to: row.to_header,
        internalDateMs: internalDateMs(row.internal_date_ms),
        evidenceCodes: stringArray(row.evidence_codes),
        candidates: candidates(row.candidate_organizations),
        hasAttachments: row.has_attachments === true,
        state: row.review_state,
        resolvedOrganizationId:
          typeof row.resolved_organization_id === "string"
            ? row.resolved_organization_id
            : null,
        gmailSyncState: gmailSyncState(row.gmail_sync_state),
        gmailSyncErrorCode:
          typeof row.gmail_sync_error_code === "string"
            ? row.gmail_sync_error_code
            : null,
        gmailSyncMutationId:
          typeof row.gmail_sync_mutation_id === "string"
            ? row.gmail_sync_mutation_id
            : null,
      }];
    });
  }

  async resolveReviewItem(input: {
    messageId: string;
    organizationId: string;
    actorId: string;
    now: Date;
  }): Promise<void> {
    if (
      !input.messageId.trim() ||
      !input.organizationId.trim() ||
      !input.actorId.trim() ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new Error("GOOGLE_WORKSPACE_REVIEW_DECISION_INVALID");
    }
    const connectionId = await this.currentConnectionId();
    const target = await this.pool.query(
      `SELECT id
         FROM organizations
        WHERE id = $1
          AND consolidated_into_id IS NULL
        LIMIT 1`,
      [input.organizationId],
    );
    if (!target.rows.length) {
      throw new Error("GOOGLE_WORKSPACE_REVIEW_TARGET_NOT_FOUND");
    }

    const changed = await this.pool.query(
      `UPDATE google_workspace_validation_review_items
          SET review_state = 'resolved',
              resolved_organization_id = $3,
              reviewed_by = $4,
              reviewed_at = $5,
              updated_at = $5
        WHERE connection_id = $1
          AND message_id = $2
        RETURNING thread_id, evidence_codes`,
      [connectionId, input.messageId, input.organizationId, input.actorId, input.now],
    );
    const review = changed.rows[0];
    if (!review || typeof review.thread_id !== "string") {
      throw new Error("GOOGLE_WORKSPACE_REVIEW_ITEM_NOT_FOUND");
    }
    const manualEvidence = [...new Set([
      ...stringArray(review.evidence_codes),
      "manual_profile_assignment",
    ])];
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
       ) VALUES ($1, $2, $3, $4, NULL, $5::jsonb, $6, $6)
       ON CONFLICT (connection_id, message_id) DO UPDATE SET
         thread_id = EXCLUDED.thread_id,
         organization_id = EXCLUDED.organization_id,
         contact_id = NULL,
         evidence_codes = EXCLUDED.evidence_codes,
         updated_at = EXCLUDED.updated_at`,
      [
        connectionId,
        input.messageId,
        review.thread_id,
        input.organizationId,
        JSON.stringify(manualEvidence),
        input.now,
      ],
    );
    await this.pool.query(
      `INSERT INTO google_workspace_audit_events (
         actor_kind, actor_id, action, target_type, target_id, metadata, created_at
       ) VALUES ('owner', $1, 'validation_review_resolved', 'gmail_message', $2,
                 jsonb_build_object('organizationId', $3), $4)`,
      [input.actorId, input.messageId, input.organizationId, input.now],
    );
  }

  async ignoreReviewItem(input: {
    messageId: string;
    actorId: string;
    now: Date;
  }): Promise<void> {
    if (
      !input.messageId.trim() ||
      !input.actorId.trim() ||
      !Number.isFinite(input.now.getTime())
    ) {
      throw new Error("GOOGLE_WORKSPACE_REVIEW_DECISION_INVALID");
    }
    const connectionId = await this.currentConnectionId();
    const changed = await this.pool.query(
      `UPDATE google_workspace_validation_review_items
          SET review_state = 'ignored',
              resolved_organization_id = NULL,
              reviewed_by = $3,
              reviewed_at = $4,
              gmail_sync_state = 'not_requested',
              gmail_sync_error_code = NULL,
              gmail_sync_mutation_id = NULL,
              updated_at = $4
        WHERE connection_id = $1
          AND message_id = $2
        RETURNING message_id`,
      [connectionId, input.messageId, input.actorId, input.now],
    );
    if (!changed.rows.length) {
      throw new Error("GOOGLE_WORKSPACE_REVIEW_ITEM_NOT_FOUND");
    }
    await this.pool.query(
      `DELETE FROM google_workspace_validation_mappings
        WHERE connection_id = $1
          AND message_id = $2`,
      [connectionId, input.messageId],
    );
    await this.pool.query(
      `INSERT INTO google_workspace_audit_events (
         actor_kind, actor_id, action, target_type, target_id, metadata, created_at
       ) VALUES ('owner', $1, 'validation_review_ignored', 'gmail_message', $2,
                 '{}'::jsonb, $3)`,
      [input.actorId, input.messageId, input.now],
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
        evidenceCodes: stringArray(row.evidence_codes),
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
