import { pool as defaultPool } from "@workspace/db";

import type { GoogleValidationMappingInput } from "./google-validation-repository";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = { query(text: string, values?: unknown[]): Promise<QueryResult> };

type ManualMapping = {
  messageId: string;
  threadId: string;
  organizationId: string;
  evidenceCodes: string[];
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

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

  private async insertMapping(
    connectionId: string,
    row: GoogleValidationMappingInput,
  ): Promise<void> {
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

  async reconcile(input: {
    messageIds: string[];
    rows: GoogleValidationMappingInput[];
  }): Promise<void> {
    const messageIds = [
      ...new Set(input.messageIds.map((id) => id.trim()).filter(Boolean)),
    ];
    if (!messageIds.length) return;
    const connectionId = await this.currentConnectionId();

    const manualResult = await this.pool.query(
      `SELECT message_id,
              thread_id,
              resolved_organization_id,
              evidence_codes
         FROM google_workspace_validation_review_items
        WHERE connection_id = $1
          AND message_id = ANY($2::text[])
          AND review_state = 'resolved'
          AND resolved_organization_id IS NOT NULL`,
      [connectionId, messageIds],
    );
    const manualMappings: ManualMapping[] = manualResult.rows.flatMap((row) => {
      if (
        typeof row.message_id !== "string" ||
        typeof row.thread_id !== "string" ||
        typeof row.resolved_organization_id !== "string"
      ) {
        return [];
      }
      const evidenceCodes = [...new Set([
        ...stringArray(row.evidence_codes),
        "manual_profile_assignment",
      ])];
      return [{
        messageId: row.message_id,
        threadId: row.thread_id,
        organizationId: row.resolved_organization_id,
        evidenceCodes,
      }];
    });
    const manualIds = new Set(manualMappings.map((row) => row.messageId));

    await this.pool.query(
      `DELETE FROM google_workspace_validation_mappings
        WHERE connection_id = $1
          AND message_id = ANY($2::text[])`,
      [connectionId, messageIds],
    );

    for (const row of input.rows) {
      if (manualIds.has(row.messageId)) continue;
      await this.insertMapping(connectionId, row);
    }

    for (const manual of manualMappings) {
      await this.insertMapping(connectionId, {
        messageId: manual.messageId,
        threadId: manual.threadId,
        organizationId: manual.organizationId,
        contactId: null,
        evidenceCodes: manual.evidenceCodes,
      });
    }
  }
}
