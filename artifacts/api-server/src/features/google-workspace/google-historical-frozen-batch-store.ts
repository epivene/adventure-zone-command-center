import { pool as defaultPool } from "@workspace/db";
import type { GoogleMessageRef } from "./google-api-types";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = { query(text: string, values?: unknown[]): Promise<QueryResult> };

export type GoogleHistoricalFrozenBatch = {
  batchId: string;
  nextPageToken: string | null;
  messages: GoogleMessageRef[];
};

export class GoogleHistoricalFrozenBatchStore {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly pool: SqlPool = defaultPool as unknown as SqlPool) {}

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return this.schemaReady;
    this.schemaReady = this.pool.query(`
      CREATE TABLE IF NOT EXISTS google_workspace_historical_gmail_batch_messages (
        batch_id uuid NOT NULL REFERENCES google_workspace_historical_gmail_batches(id) ON DELETE CASCADE,
        position integer NOT NULL,
        message_id text NOT NULL,
        thread_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (batch_id, position),
        UNIQUE (batch_id, message_id),
        CHECK (position >= 0 AND position < 250)
      )
    `).then(() => undefined).catch((error) => {
      this.schemaReady = null;
      throw error;
    });
    return this.schemaReady;
  }

  private async connectionId(): Promise<string> {
    await this.ensureSchema();
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

  async load(pageToken: string | null): Promise<GoogleHistoricalFrozenBatch | null> {
    const connectionId = await this.connectionId();
    const batchResult = await this.pool.query(
      `SELECT b.id, b.next_page_token
         FROM google_workspace_historical_gmail_batches b
        WHERE b.connection_id = $1
          AND b.start_page_token IS NOT DISTINCT FROM $2::text
          AND b.status IN ('running', 'error')
          AND EXISTS (
            SELECT 1
              FROM google_workspace_historical_gmail_batch_messages m
             WHERE m.batch_id = b.id
          )
        ORDER BY b.started_at DESC
        LIMIT 1`,
      [connectionId, pageToken],
    );
    const batchId = batchResult.rows[0]?.id;
    if (typeof batchId !== "string" || !batchId) return null;
    const nextPageToken =
      typeof batchResult.rows[0]?.next_page_token === "string"
        ? String(batchResult.rows[0]?.next_page_token)
        : null;
    const memberResult = await this.pool.query(
      `SELECT message_id, thread_id
         FROM google_workspace_historical_gmail_batch_messages
        WHERE batch_id = $1
        ORDER BY position ASC`,
      [batchId],
    );
    const messages = memberResult.rows.flatMap((row) =>
      typeof row.message_id === "string" && typeof row.thread_id === "string"
        ? [{ id: row.message_id, threadId: row.thread_id }]
        : [],
    );
    return messages.length ? { batchId, nextPageToken, messages } : null;
  }

  async freeze(input: {
    batchId: string;
    nextPageToken: string | null;
    messages: GoogleMessageRef[];
  }): Promise<void> {
    await this.ensureSchema();
    if (!input.batchId.trim() || input.messages.length > 250) {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_FROZEN_BATCH_INVALID");
    }
    await this.pool.query(
      `UPDATE google_workspace_historical_gmail_batches
          SET next_page_token = $2
        WHERE id = $1`,
      [input.batchId, input.nextPageToken],
    );
    for (const [position, message] of input.messages.entries()) {
      await this.pool.query(
        `INSERT INTO google_workspace_historical_gmail_batch_messages (
           batch_id, position, message_id, thread_id
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (batch_id, position) DO UPDATE SET
           message_id = EXCLUDED.message_id,
           thread_id = EXCLUDED.thread_id`,
        [input.batchId, position, message.id, message.threadId],
      );
    }
  }
}
