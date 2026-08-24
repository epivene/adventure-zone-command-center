import { pool as defaultPool } from "@workspace/db";

import type { GoogleValidationMappingInput } from "./google-validation-repository";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = { query(text: string, values?: unknown[]): Promise<QueryResult> };

export class GoogleValidationMappingReconciler {
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
    messageIds: string[];
    rows: GoogleValidationMappingInput[];
  }): Promise<void> {
    const messageIds = [...new Set(input.messageIds.map((id) => id.trim()).filter(Boolean))];
    if (!messageIds.length) return;
    const connectionId = await this.currentConnectionId();

    const manual = await this.pool.query(
      `SELECT message_id
         FROM google_workspace_validation_review_items
        WHERE connection_id = $1
          AND message_id = ANY($2::text[])
          AND review_state = 'resolved'`,
      [connectionId, messageIds],
    );
    const manualIds = manual.rows.flatMap((row) =>
      typeof row.message_id === "string" ? [row.message_id] : [],
    );
    const manualSet = new Set(manualIds);

    await this.pool.query(
      `DELETE FROM google_workspace_validation_mappings
        WHERE connection_id = $1
          AND message_id = ANY($2::text[])
          AND NOT (message_id = ANY($3::text[]))`,
      [connectionId, messageIds, manualIds],
    );

    for (const row of input.rows) {
      if (manualSet.has(row.messageId)) continue;
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
  }
}
