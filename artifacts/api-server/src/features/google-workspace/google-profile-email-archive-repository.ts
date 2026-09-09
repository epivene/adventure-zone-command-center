import { pool as defaultPool } from "@workspace/db";

import type {
  ArchivedProfileEmailMessage,
  ArchivedProfileEmailThread,
  ArchiveThreadInput,
  GoogleProfileEmailArchiveAccess,
  ProfileEmailArchiveState,
} from "./google-profile-email-archive-types";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function archiveState(value: unknown): ProfileEmailArchiveState {
  return value === "complete" ||
    value === "partial" ||
    value === "failed"
    ? value
    : "pending";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function messageFromRow(
  row: Record<string, unknown>,
): ArchivedProfileEmailMessage | null {
  if (
    typeof row.id !== "string" ||
    typeof row.gmail_message_id !== "string" ||
    typeof row.gmail_thread_id !== "string" ||
    typeof row.from_value !== "string" ||
    typeof row.to_value !== "string" ||
    typeof row.cc_value !== "string" ||
    typeof row.subject !== "string" ||
    typeof row.date_value !== "string" ||
    typeof row.body_text !== "string" ||
    (row.direction !== "incoming" &&
      row.direction !== "outgoing" &&
      row.direction !== "unknown")
  ) {
    return null;
  }
  const internal =
    row.internal_date_ms === null || row.internal_date_ms === undefined
      ? null
      : Number(row.internal_date_ms);
  const attachments = Array.isArray(row.attachments_json)
    ? row.attachments_json
    : [];
  return {
    id: row.id,
    gmailMessageId: row.gmail_message_id,
    gmailThreadId: row.gmail_thread_id,
    internalDateMs: internal !== null && Number.isFinite(internal) ? internal : null,
    from: row.from_value,
    to: row.to_value,
    cc: row.cc_value,
    subject: row.subject,
    date: row.date_value,
    direction: row.direction,
    bodyText: row.body_text,
    attachments: attachments.flatMap((attachment) => {
      if (!attachment || typeof attachment !== "object") return [];
      const candidate = attachment as Record<string, unknown>;
      if (
        typeof candidate.attachmentId !== "string" ||
        typeof candidate.filename !== "string" ||
        typeof candidate.mimeType !== "string" ||
        typeof candidate.messageId !== "string"
      ) {
        return [];
      }
      const sizeBytes = Number(candidate.sizeBytes);
      return [{
        attachmentId: candidate.attachmentId,
        filename: candidate.filename,
        mimeType: candidate.mimeType,
        messageId: candidate.messageId,
        sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
      }];
    }),
  };
}

export class PostgresGoogleProfileEmailArchiveRepository
  implements GoogleProfileEmailArchiveAccess
{
  constructor(
    private readonly pool: SqlPool = defaultPool as unknown as SqlPool,
  ) {}

  private async currentConnectionId(): Promise<string> {
    const result = await this.pool.query(
      `SELECT id FROM google_workspace_connections
        WHERE status IN ('connected', 'reauthorization_required')
          AND (role = 'workspace' OR role IS NULL)
        ORDER BY updated_at DESC, id DESC LIMIT 1`,
    );
    const id = result.rows[0]?.id;
    if (typeof id !== "string") {
      throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    }
    return id;
  }

  async upsertThread(
    input: ArchiveThreadInput,
  ): Promise<ArchivedProfileEmailThread> {
    if (
      !input.organizationId.trim() ||
      !input.gmailThreadId.trim() ||
      !Number.isFinite(input.lastSyncedAt.getTime())
    ) {
      throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_ARCHIVE_INPUT_INVALID");
    }
    const connectionId = await this.currentConnectionId();
    let conversationId = input.conversationId?.trim() || "";

    if (conversationId) {
      const owned = await this.pool.query(
        `SELECT id FROM google_workspace_profile_email_threads
          WHERE connection_id = $1 AND organization_id = $2 AND id = $3
          LIMIT 1`,
        [connectionId, input.organizationId, conversationId],
      );
      if (!owned.rows.length) {
        throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_NOT_FOUND");
      }
    } else {
      const result = await this.pool.query(
        `WITH existing AS (
           SELECT thread.id
             FROM google_workspace_profile_email_threads thread
             JOIN google_workspace_profile_email_thread_sources source
               ON source.conversation_id = thread.id
            WHERE source.connection_id = $1
              AND source.gmail_thread_id = $3
              AND thread.organization_id = $2
            LIMIT 1
         ), inserted AS (
           INSERT INTO google_workspace_profile_email_threads (
             connection_id, organization_id, contact_id, subject,
             original_gmail_url, archive_state, last_synced_at,
             last_gmail_error_code, created_at, updated_at
           )
           SELECT $1, $2, $4, $5, $6, $7, $8, NULL, $8, $8
            WHERE NOT EXISTS (SELECT 1 FROM existing)
           RETURNING id
         )
         SELECT id FROM existing
         UNION ALL
         SELECT id FROM inserted
         LIMIT 1`,
        [
          connectionId,
          input.organizationId,
          input.gmailThreadId,
          input.contactId,
          input.subject,
          input.originalGmailUrl,
          input.archiveState,
          input.lastSyncedAt,
        ],
      );
      const id = result.rows[0]?.id;
      if (typeof id !== "string") {
        throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_ARCHIVE_SAVE_FAILED");
      }
      conversationId = id;
    }

    await this.pool.query(
      `INSERT INTO google_workspace_profile_email_thread_sources (
         conversation_id, connection_id, gmail_thread_id
       ) VALUES ($1, $2, $3)
       ON CONFLICT (connection_id, gmail_thread_id) DO UPDATE SET
         conversation_id = EXCLUDED.conversation_id`,
      [conversationId, connectionId, input.gmailThreadId],
    );
    await this.pool.query(
      `UPDATE google_workspace_profile_email_threads
          SET contact_id = COALESCE($3, contact_id),
              subject = CASE WHEN btrim($4) = '' THEN subject ELSE $4 END,
              original_gmail_url = COALESCE($5, original_gmail_url),
              archive_state = $6,
              last_synced_at = $7,
              last_gmail_error_code = NULL,
              updated_at = $7
        WHERE connection_id = $1 AND organization_id = $2 AND id = $8`,
      [
        connectionId,
        input.organizationId,
        input.contactId,
        input.subject,
        input.originalGmailUrl,
        input.archiveState,
        input.lastSyncedAt,
        conversationId,
      ],
    );

    for (const message of input.messages) {
      await this.pool.query(
        `INSERT INTO google_workspace_profile_email_messages (
           conversation_id, connection_id, gmail_message_id, gmail_thread_id,
           internal_date_ms, from_value, to_value, cc_value, subject,
           date_value, direction, body_text, attachments_json,
           created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb,
           $14, $14
         )
         ON CONFLICT (connection_id, gmail_message_id) DO UPDATE SET
           conversation_id = EXCLUDED.conversation_id,
           gmail_thread_id = EXCLUDED.gmail_thread_id,
           internal_date_ms = EXCLUDED.internal_date_ms,
           from_value = EXCLUDED.from_value,
           to_value = EXCLUDED.to_value,
           cc_value = EXCLUDED.cc_value,
           subject = EXCLUDED.subject,
           date_value = EXCLUDED.date_value,
           direction = EXCLUDED.direction,
           body_text = EXCLUDED.body_text,
           attachments_json = EXCLUDED.attachments_json,
           updated_at = EXCLUDED.updated_at`,
        [
          conversationId,
          connectionId,
          message.gmailMessageId,
          message.gmailThreadId,
          message.internalDateMs,
          message.from,
          message.to,
          message.cc,
          message.subject,
          message.date,
          message.direction,
          message.bodyText,
          JSON.stringify(message.attachments),
          input.lastSyncedAt,
        ],
      );
    }

    const saved = await this.getForOrganization({
      organizationId: input.organizationId,
      conversationId,
    });
    if (!saved) {
      throw new Error("GOOGLE_WORKSPACE_PROFILE_EMAIL_ARCHIVE_SAVE_FAILED");
    }
    return saved;
  }

  async listForOrganization(
    organizationId: string,
  ): Promise<ArchivedProfileEmailThread[]> {
    const connectionId = await this.currentConnectionId();
    const rows = await this.threadRows(connectionId, organizationId);
    const conversations = await Promise.all(
      rows.map((row) => this.hydrate(row, connectionId)),
    );
    return conversations.flatMap((item) => (item ? [item] : []));
  }

  async getForOrganization(input: {
    organizationId: string;
    conversationId: string;
  }): Promise<ArchivedProfileEmailThread | null> {
    const connectionId = await this.currentConnectionId();
    const rows = await this.threadRows(
      connectionId,
      input.organizationId,
      input.conversationId,
    );
    return rows[0] ? this.hydrate(rows[0], connectionId) : null;
  }

  async findByProviderThread(input: {
    organizationId: string;
    gmailThreadId: string;
  }): Promise<ArchivedProfileEmailThread | null> {
    const connectionId = await this.currentConnectionId();
    const result = await this.pool.query(
      `SELECT thread.*,
              COALESCE(array_agg(source.gmail_thread_id ORDER BY source.created_at)
                FILTER (WHERE source.gmail_thread_id IS NOT NULL), '{}') AS provider_thread_ids
         FROM google_workspace_profile_email_threads thread
         JOIN google_workspace_profile_email_thread_sources wanted
           ON wanted.conversation_id = thread.id
          AND wanted.connection_id = $1
          AND wanted.gmail_thread_id = $3
         LEFT JOIN google_workspace_profile_email_thread_sources source
           ON source.conversation_id = thread.id
        WHERE thread.connection_id = $1
          AND thread.organization_id = $2
        GROUP BY thread.id
        LIMIT 1`,
      [connectionId, input.organizationId, input.gmailThreadId],
    );
    return result.rows[0] ? this.hydrate(result.rows[0], connectionId) : null;
  }

  async recordSyncFailure(input: {
    conversationId: string;
    code: string;
    now: Date;
  }): Promise<void> {
    const connectionId = await this.currentConnectionId();
    await this.pool.query(
      `UPDATE google_workspace_profile_email_threads
          SET archive_state = CASE WHEN archive_state = 'complete'
            THEN 'complete' ELSE 'failed' END,
              last_gmail_error_code = $3,
              updated_at = $4
        WHERE connection_id = $1 AND id = $2`,
      [connectionId, input.conversationId, input.code, input.now],
    );
  }

  private async threadRows(
    connectionId: string,
    organizationId: string,
    conversationId?: string,
  ): Promise<Array<Record<string, unknown>>> {
    const values: unknown[] = [connectionId, organizationId];
    const idClause = conversationId ? " AND thread.id = $3" : "";
    if (conversationId) values.push(conversationId);
    const result = await this.pool.query(
      `SELECT thread.*,
              COALESCE(array_agg(source.gmail_thread_id ORDER BY source.created_at)
                FILTER (WHERE source.gmail_thread_id IS NOT NULL), '{}') AS provider_thread_ids
         FROM google_workspace_profile_email_threads thread
         LEFT JOIN google_workspace_profile_email_thread_sources source
           ON source.conversation_id = thread.id
        WHERE thread.connection_id = $1
          AND thread.organization_id = $2${idClause}
        GROUP BY thread.id
        ORDER BY thread.last_synced_at DESC NULLS LAST, thread.created_at DESC`,
      values,
    );
    return result.rows;
  }

  private async hydrate(
    row: Record<string, unknown>,
    connectionId: string,
  ): Promise<ArchivedProfileEmailThread | null> {
    if (
      typeof row.id !== "string" ||
      typeof row.organization_id !== "string" ||
      typeof row.subject !== "string"
    ) {
      return null;
    }
    const result = await this.pool.query(
      `SELECT * FROM google_workspace_profile_email_messages
        WHERE connection_id = $1 AND conversation_id = $2
        ORDER BY internal_date_ms ASC NULLS LAST, created_at ASC, id ASC`,
      [connectionId, row.id],
    );
    return {
      id: row.id,
      organizationId: row.organization_id,
      contactId: typeof row.contact_id === "string" ? row.contact_id : null,
      subject: row.subject,
      originalGmailUrl:
        typeof row.original_gmail_url === "string"
          ? row.original_gmail_url
          : null,
      providerThreadIds: strings(row.provider_thread_ids),
      archiveState: archiveState(row.archive_state),
      lastSyncedAt: iso(row.last_synced_at),
      lastGmailErrorCode:
        typeof row.last_gmail_error_code === "string"
          ? row.last_gmail_error_code
          : null,
      messages: result.rows.flatMap((item) => {
        const message = messageFromRow(item);
        return message ? [message] : [];
      }),
    };
  }
}
