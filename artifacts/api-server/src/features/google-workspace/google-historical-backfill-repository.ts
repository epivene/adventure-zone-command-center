import { pool as defaultPool } from "@workspace/db";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = { query(text: string, values?: unknown[]): Promise<QueryResult> };

export type GoogleHistoricalBackfillStatus =
  | "not_started"
  | "running"
  | "awaiting_approval"
  | "ready"
  | "complete"
  | "paused"
  | "error";

export type GoogleHistoricalBackfillOutcome =
  | "attached"
  | "ignored"
  | "needs_review"
  | "failed"
  | "skipped";

export type GoogleHistoricalBackfillState = {
  status: GoogleHistoricalBackfillStatus;
  nextPageToken: string | null;
  firstBatchApproved: boolean;
  cumulative: {
    processed: number;
    attached: number;
    ignored: number;
    needsReview: number;
    failed: number;
    skipped: number;
  };
};

function finiteCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function statusOf(value: unknown): GoogleHistoricalBackfillStatus {
  return value === "running" ||
    value === "awaiting_approval" ||
    value === "ready" ||
    value === "complete" ||
    value === "paused" ||
    value === "error"
    ? value
    : "not_started";
}

export class GoogleHistoricalBackfillRepository {
  private schemaReady: Promise<void> | null = null;

  constructor(private readonly pool: SqlPool = defaultPool as unknown as SqlPool) {}

  private async ensureSchema(): Promise<void> {
    if (this.schemaReady) return this.schemaReady;
    this.schemaReady = (async () => {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS google_workspace_historical_gmail_backfill_state (
          connection_id uuid PRIMARY KEY REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
          status text NOT NULL DEFAULT 'not_started',
          next_page_token text,
          first_batch_approved boolean NOT NULL DEFAULT false,
          processed_count bigint NOT NULL DEFAULT 0,
          attached_count bigint NOT NULL DEFAULT 0,
          ignored_count bigint NOT NULL DEFAULT 0,
          needs_review_count bigint NOT NULL DEFAULT 0,
          failed_count bigint NOT NULL DEFAULT 0,
          skipped_count bigint NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CHECK (status IN ('not_started','running','awaiting_approval','ready','complete','paused','error'))
        )
      `);
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS google_workspace_historical_gmail_batches (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          connection_id uuid NOT NULL REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
          start_page_token text,
          next_page_token text,
          batch_size integer NOT NULL,
          status text NOT NULL DEFAULT 'running',
          processed_count integer NOT NULL DEFAULT 0,
          attached_count integer NOT NULL DEFAULT 0,
          ignored_count integer NOT NULL DEFAULT 0,
          needs_review_count integer NOT NULL DEFAULT 0,
          failed_count integer NOT NULL DEFAULT 0,
          skipped_count integer NOT NULL DEFAULT 0,
          started_at timestamptz NOT NULL DEFAULT now(),
          finished_at timestamptz,
          CHECK (batch_size BETWEEN 1 AND 250),
          CHECK (status IN ('running','complete','awaiting_approval','error'))
        )
      `);
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS google_workspace_historical_gmail_outcomes (
          connection_id uuid NOT NULL REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
          batch_id uuid NOT NULL REFERENCES google_workspace_historical_gmail_batches(id) ON DELETE CASCADE,
          message_id text NOT NULL,
          thread_id text NOT NULL,
          outcome text NOT NULL,
          organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
          error_code text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (connection_id, message_id),
          CHECK (outcome IN ('attached','ignored','needs_review','failed','skipped'))
        )
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS google_workspace_historical_gmail_outcomes_batch_idx
          ON google_workspace_historical_gmail_outcomes(batch_id)
      `);
    })().catch((error) => {
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
        WHERE status IN ('connected','reauthorization_required')
        ORDER BY updated_at DESC
        LIMIT 1`,
    );
    const id = result.rows[0]?.id;
    if (typeof id !== "string" || !id) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    await this.pool.query(
      `INSERT INTO google_workspace_historical_gmail_backfill_state (connection_id)
       VALUES ($1)
       ON CONFLICT (connection_id) DO NOTHING`,
      [id],
    );
    return id;
  }

  async getState(): Promise<GoogleHistoricalBackfillState> {
    const connectionId = await this.connectionId();
    const result = await this.pool.query(
      `SELECT status, next_page_token, first_batch_approved,
              processed_count, attached_count, ignored_count,
              needs_review_count, failed_count, skipped_count
         FROM google_workspace_historical_gmail_backfill_state
        WHERE connection_id = $1`,
      [connectionId],
    );
    const row = result.rows[0] ?? {};
    return {
      status: statusOf(row.status),
      nextPageToken: typeof row.next_page_token === "string" ? row.next_page_token : null,
      firstBatchApproved: row.first_batch_approved === true,
      cumulative: {
        processed: finiteCount(row.processed_count),
        attached: finiteCount(row.attached_count),
        ignored: finiteCount(row.ignored_count),
        needsReview: finiteCount(row.needs_review_count),
        failed: finiteCount(row.failed_count),
        skipped: finiteCount(row.skipped_count),
      },
    };
  }

  async beginBatch(input: { pageToken: string | null; batchSize: number }): Promise<{ batchId: string }> {
    if (!Number.isInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 250) {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_BATCH_SIZE_INVALID");
    }
    const connectionId = await this.connectionId();
    await this.pool.query(
      `UPDATE google_workspace_historical_gmail_backfill_state
          SET status = 'running', updated_at = now()
        WHERE connection_id = $1`,
      [connectionId],
    );
    const result = await this.pool.query(
      `INSERT INTO google_workspace_historical_gmail_batches (
         connection_id, start_page_token, batch_size, status
       ) VALUES ($1,$2,$3,'running')
       RETURNING id`,
      [connectionId, input.pageToken, input.batchSize],
    );
    const batchId = result.rows[0]?.id;
    if (typeof batchId !== "string" || !batchId) {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_BATCH_CREATE_FAILED");
    }
    return { batchId };
  }

  async hasOutcome(messageId: string): Promise<boolean> {
    const id = messageId.trim();
    if (!id) return false;
    const connectionId = await this.connectionId();
    const result = await this.pool.query(
      `SELECT 1
         FROM google_workspace_historical_gmail_outcomes
        WHERE connection_id = $1 AND message_id = $2
        LIMIT 1`,
      [connectionId, id],
    );
    return result.rows.length > 0;
  }

  async recordOutcome(input: {
    batchId: string;
    messageId: string;
    threadId: string;
    outcome: GoogleHistoricalBackfillOutcome;
    organizationId?: string | null;
    errorCode?: string | null;
  }): Promise<void> {
    if (!input.batchId.trim() || !input.messageId.trim() || !input.threadId.trim()) {
      throw new Error("GOOGLE_WORKSPACE_HISTORICAL_OUTCOME_INVALID");
    }
    const connectionId = await this.connectionId();
    await this.pool.query(
      `INSERT INTO google_workspace_historical_gmail_outcomes (
         connection_id, batch_id, message_id, thread_id, outcome,
         organization_id, error_code, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),now())
       ON CONFLICT (connection_id, message_id) DO UPDATE SET
         batch_id = EXCLUDED.batch_id,
         thread_id = EXCLUDED.thread_id,
         outcome = EXCLUDED.outcome,
         organization_id = EXCLUDED.organization_id,
         error_code = EXCLUDED.error_code,
         updated_at = now()`,
      [
        connectionId,
        input.batchId,
        input.messageId,
        input.threadId,
        input.outcome,
        input.organizationId ?? null,
        input.errorCode ?? null,
      ],
    );
  }

  async finishBatch(input: {
    batchId: string;
    nextPageToken: string | null;
    firstBatch: boolean;
    counts?: Partial<GoogleHistoricalBackfillState["cumulative"]>;
  }): Promise<void> {
    const connectionId = await this.connectionId();
    const status: GoogleHistoricalBackfillStatus = input.firstBatch
      ? "awaiting_approval"
      : input.nextPageToken
        ? "ready"
        : "complete";
    const counts = input.counts ?? {};
    await this.pool.query(
      `UPDATE google_workspace_historical_gmail_batches
          SET status = $3,
              next_page_token = $4,
              processed_count = $5,
              attached_count = $6,
              ignored_count = $7,
              needs_review_count = $8,
              failed_count = $9,
              skipped_count = $10,
              finished_at = now()
        WHERE connection_id = $1 AND id = $2`,
      [
        connectionId,
        input.batchId,
        status === "awaiting_approval" ? "awaiting_approval" : "complete",
        input.nextPageToken,
        finiteCount(counts.processed),
        finiteCount(counts.attached),
        finiteCount(counts.ignored),
        finiteCount(counts.needsReview),
        finiteCount(counts.failed),
        finiteCount(counts.skipped),
      ],
    );
    await this.pool.query(
      `UPDATE google_workspace_historical_gmail_backfill_state
          SET status = $2,
              next_page_token = $3,
              processed_count = processed_count + $4,
              attached_count = attached_count + $5,
              ignored_count = ignored_count + $6,
              needs_review_count = needs_review_count + $7,
              failed_count = failed_count + $8,
              skipped_count = skipped_count + $9,
              updated_at = now()
        WHERE connection_id = $1`,
      [
        connectionId,
        status,
        input.nextPageToken,
        finiteCount(counts.processed),
        finiteCount(counts.attached),
        finiteCount(counts.ignored),
        finiteCount(counts.needsReview),
        finiteCount(counts.failed),
        finiteCount(counts.skipped),
      ],
    );
  }

  async approveFirstBatch(actorId: string): Promise<void> {
    if (!actorId.trim()) throw new Error("GOOGLE_WORKSPACE_HISTORICAL_APPROVAL_INVALID");
    const connectionId = await this.connectionId();
    await this.pool.query(
      `UPDATE google_workspace_historical_gmail_backfill_state
          SET first_batch_approved = true,
              status = CASE WHEN next_page_token IS NULL THEN 'complete' ELSE 'ready' END,
              updated_at = now()
        WHERE connection_id = $1
          AND status = 'awaiting_approval'`,
      [connectionId],
    );
  }

  async pause(actorId: string): Promise<void> {
    if (!actorId.trim()) throw new Error("GOOGLE_WORKSPACE_HISTORICAL_PAUSE_INVALID");
    const connectionId = await this.connectionId();
    await this.pool.query(
      `UPDATE google_workspace_historical_gmail_backfill_state
          SET status = 'paused', updated_at = now()
        WHERE connection_id = $1
          AND status <> 'complete'`,
      [connectionId],
    );
  }
}
