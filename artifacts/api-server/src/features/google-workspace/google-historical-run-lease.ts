import { pool as defaultPool } from "@workspace/db";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = { query(text: string, values?: unknown[]): Promise<QueryResult> };

const DEFAULT_STALE_AFTER_MS = 120_000;

export class GoogleHistoricalRunLease {
  private readonly staleAfterMs: number;

  constructor(
    private readonly pool: SqlPool = defaultPool as unknown as SqlPool,
    options?: { staleAfterMs?: number },
  ) {
    const requested = options?.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.staleAfterMs = Math.max(30_000, Math.trunc(requested));
  }

  private async connectionId(): Promise<string> {
    const result = await this.pool.query(
      `SELECT id
         FROM google_workspace_connections
        WHERE status IN ('connected','reauthorization_required')
        ORDER BY updated_at DESC
        LIMIT 1`,
    );
    const id = result.rows[0]?.id;
    if (typeof id !== "string" || !id) {
      throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    }
    return id;
  }

  async recoverStale(): Promise<boolean> {
    const connectionId = await this.connectionId();
    const recovered = await this.pool.query(
      `UPDATE google_workspace_historical_gmail_backfill_state
          SET status = 'error', updated_at = now()
        WHERE connection_id = $1
          AND status = 'running'
          AND updated_at < now() - ($2::bigint * interval '1 millisecond')
      RETURNING connection_id`,
      [connectionId, this.staleAfterMs],
    );
    if (recovered.rows.length === 0) return false;

    await this.pool.query(
      `UPDATE google_workspace_historical_gmail_batches
          SET status = 'error', finished_at = COALESCE(finished_at, now())
        WHERE connection_id = $1
          AND status = 'running'`,
      [connectionId],
    );
    return true;
  }

  async acquire(): Promise<boolean> {
    const connectionId = await this.connectionId();
    const result = await this.pool.query(
      `UPDATE google_workspace_historical_gmail_backfill_state
          SET status = 'running', updated_at = now()
        WHERE connection_id = $1
          AND status IN ('not_started','ready','error')
      RETURNING connection_id`,
      [connectionId],
    );
    return result.rows.length === 1;
  }

  async heartbeat(): Promise<void> {
    const connectionId = await this.connectionId();
    await this.pool.query(
      `UPDATE google_workspace_historical_gmail_backfill_state
          SET updated_at = now()
        WHERE connection_id = $1
          AND status = 'running'`,
      [connectionId],
    );
  }

  async markErrorIfRunning(): Promise<void> {
    const connectionId = await this.connectionId();
    await this.pool.query(
      `UPDATE google_workspace_historical_gmail_backfill_state
          SET status = 'error', updated_at = now()
        WHERE connection_id = $1
          AND status = 'running'`,
      [connectionId],
    );
    await this.pool.query(
      `UPDATE google_workspace_historical_gmail_batches
          SET status = 'error', finished_at = COALESCE(finished_at, now())
        WHERE connection_id = $1
          AND status = 'running'`,
      [connectionId],
    );
  }
}
