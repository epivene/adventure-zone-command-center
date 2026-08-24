import { pool as defaultPool } from "@workspace/db";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = { query(text: string, values?: unknown[]): Promise<QueryResult> };

export class GoogleValidationReviewReconciler {
  constructor(private readonly pool: SqlPool = defaultPool as unknown as SqlPool) {}

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

  async reconcile(input: {
    sampleMessageIds: string[];
    pendingMessageIds: string[];
  }): Promise<void> {
    const sampleMessageIds = [
      ...new Set(input.sampleMessageIds.map((id) => id.trim()).filter(Boolean)),
    ];
    if (!sampleMessageIds.length) return;

    const pendingMessageIds = [
      ...new Set(input.pendingMessageIds.map((id) => id.trim()).filter(Boolean)),
    ];
    const connectionId = await this.currentConnectionId();

    await this.pool.query(
      `DELETE FROM google_workspace_validation_review_items
        WHERE connection_id = $1
          AND message_id = ANY($2::text[])
          AND review_state = 'pending'
          AND NOT (message_id = ANY($3::text[]))`,
      [connectionId, sampleMessageIds, pendingMessageIds],
    );
  }
}
