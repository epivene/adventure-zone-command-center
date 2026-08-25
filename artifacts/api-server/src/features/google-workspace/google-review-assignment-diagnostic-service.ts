import { pool as defaultPool } from "@workspace/db";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = { query(text: string, values?: unknown[]): Promise<QueryResult> };

export type GoogleReviewAssignmentStage = "update" | "mapping" | "audit";

export class GoogleReviewAssignmentDiagnosticError extends Error {
  readonly stage: GoogleReviewAssignmentStage;
  readonly postgresCode: string | null;

  constructor(input: {
    safeCode: string;
    stage: GoogleReviewAssignmentStage;
    cause: unknown;
  }) {
    super(input.safeCode, { cause: input.cause });
    this.name = "GoogleReviewAssignmentDiagnosticError";
    this.stage = input.stage;
    const code =
      input.cause && typeof input.cause === "object" && "code" in input.cause
        ? (input.cause as { code?: unknown }).code
        : null;
    this.postgresCode = typeof code === "string" ? code : null;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

async function stageQuery(input: {
  pool: SqlPool;
  stage: GoogleReviewAssignmentStage;
  safeCode: string;
  text: string;
  values: unknown[];
}): Promise<QueryResult> {
  try {
    return await input.pool.query(input.text, input.values);
  } catch (cause) {
    throw new GoogleReviewAssignmentDiagnosticError({
      safeCode: input.safeCode,
      stage: input.stage,
      cause,
    });
  }
}

export class GoogleReviewAssignmentDiagnosticService {
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

  async resolve(input: {
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

    const changed = await stageQuery({
      pool: this.pool,
      stage: "update",
      safeCode: "GOOGLE_WORKSPACE_REVIEW_UPDATE_FAILED",
      text: `UPDATE google_workspace_validation_review_items
          SET review_state = 'resolved',
              resolved_organization_id = $3,
              reviewed_by = $4,
              reviewed_at = $5,
              updated_at = $5
        WHERE connection_id = $1
          AND message_id = $2
        RETURNING thread_id, evidence_codes`,
      values: [connectionId, input.messageId, input.organizationId, input.actorId, input.now],
    });
    const review = changed.rows[0];
    if (!review || typeof review.thread_id !== "string") {
      throw new Error("GOOGLE_WORKSPACE_REVIEW_ITEM_NOT_FOUND");
    }

    const manualEvidence = [...new Set([
      ...stringArray(review.evidence_codes),
      "manual_profile_assignment",
    ])];

    await stageQuery({
      pool: this.pool,
      stage: "mapping",
      safeCode: "GOOGLE_WORKSPACE_REVIEW_MAPPING_FAILED",
      text: `INSERT INTO google_workspace_validation_mappings (
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
      values: [
        connectionId,
        input.messageId,
        review.thread_id,
        input.organizationId,
        JSON.stringify(manualEvidence),
        input.now,
      ],
    });

    await stageQuery({
      pool: this.pool,
      stage: "audit",
      safeCode: "GOOGLE_WORKSPACE_REVIEW_AUDIT_FAILED",
      text: `INSERT INTO google_workspace_audit_events (
         actor_kind, actor_id, action, target_type, target_id, metadata, created_at
       ) VALUES ('owner', $1, 'validation_review_resolved', 'gmail_message', $2,
                 jsonb_build_object('organizationId', $3), $4)`,
      values: [input.actorId, input.messageId, input.organizationId, input.now],
    });
  }
}
