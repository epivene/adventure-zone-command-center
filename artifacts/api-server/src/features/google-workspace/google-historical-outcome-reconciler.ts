import { pool as defaultPool } from "@workspace/db";

import type { GoogleHistoricalBackfillState } from "./google-historical-backfill-repository";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = { query(text: string, values?: unknown[]): Promise<QueryResult> };

function finiteCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

export class GoogleHistoricalOutcomeReconciler {
  constructor(private readonly pool: SqlPool = defaultPool as unknown as SqlPool) {}

  async reconcile(): Promise<GoogleHistoricalBackfillState["cumulative"]> {
    const connection = await this.pool.query(
      `SELECT id
         FROM google_workspace_connections
        WHERE status IN ('connected','reauthorization_required')
        ORDER BY updated_at DESC
        LIMIT 1`,
    );
    const connectionId = connection.rows[0]?.id;
    if (typeof connectionId !== "string" || !connectionId) {
      throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    }

    const grouped = await this.pool.query(
      `SELECT outcome, COUNT(*)::bigint AS count
         FROM google_workspace_historical_gmail_outcomes
        WHERE connection_id = $1
        GROUP BY outcome`,
      [connectionId],
    );

    const counts = {
      processed: 0,
      attached: 0,
      ignored: 0,
      needsReview: 0,
      failed: 0,
      skipped: 0,
    };
    for (const row of grouped.rows) {
      const count = finiteCount(row.count);
      if (row.outcome === "attached") counts.attached += count;
      else if (row.outcome === "ignored") counts.ignored += count;
      else if (row.outcome === "needs_review") counts.needsReview += count;
      else if (row.outcome === "failed") counts.failed += count;
      else if (row.outcome === "skipped") counts.skipped += count;
    }
    counts.processed =
      counts.attached + counts.ignored + counts.needsReview + counts.failed + counts.skipped;

    await this.pool.query(
      `UPDATE google_workspace_historical_gmail_backfill_state
          SET processed_count = $2,
              attached_count = $3,
              ignored_count = $4,
              needs_review_count = $5,
              failed_count = $6,
              skipped_count = $7,
              updated_at = now()
        WHERE connection_id = $1`,
      [
        connectionId,
        counts.processed,
        counts.attached,
        counts.ignored,
        counts.needsReview,
        counts.failed,
        counts.skipped,
      ],
    );
    return counts;
  }
}
