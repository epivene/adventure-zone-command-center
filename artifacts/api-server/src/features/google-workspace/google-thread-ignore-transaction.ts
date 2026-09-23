import { pool as defaultPool } from "@workspace/db";

export type ReviewIgnoreInput = {
  messageId: string;
  actorId: string;
  now: Date;
};

export type MatchedIgnoreInput = ReviewIgnoreInput & {
  threadId: string;
  subject: string;
  from: string;
  to: string;
  internalDateMs: number | null;
  hasAttachments: boolean;
};

export interface GoogleThreadIgnoreTransactionPort {
  ignoreReview(input: ReviewIgnoreInput): Promise<void>;
  ignoreMatched(input: MatchedIgnoreInput): Promise<void>;
}

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};
type SqlPool = {
  connect(): Promise<SqlClient>;
};

type Stage = "connection" | "review" | "intent_lock" | "ignore" | "audit";

export class GoogleThreadIgnoreTransactionError extends Error {
  readonly stage: Stage;
  readonly postgresCode: string | null;

  constructor(stage: Stage, cause: unknown) {
    const original = cause instanceof Error ? cause.message : null;
    super(
      original?.startsWith("GOOGLE_WORKSPACE_")
        ? original
        : "GOOGLE_WORKSPACE_THREAD_IGNORE_TRANSACTION_FAILED",
      { cause },
    );
    this.name = "GoogleThreadIgnoreTransactionError";
    this.stage = stage;
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? (cause as { code?: unknown }).code
        : null;
    this.postgresCode = typeof code === "string" ? code : null;
  }
}

function valid(input: ReviewIgnoreInput): boolean {
  return Boolean(
    input.messageId.trim() &&
      input.actorId.trim() &&
      Number.isFinite(input.now.getTime()),
  );
}

export class PostgresGoogleThreadIgnoreTransaction
implements GoogleThreadIgnoreTransactionPort {
  constructor(
    private readonly pool: SqlPool = defaultPool as unknown as SqlPool,
  ) {}

  async ignoreReview(input: ReviewIgnoreInput): Promise<void> {
    if (!valid(input)) {
      throw new Error("GOOGLE_WORKSPACE_REVIEW_DECISION_INVALID");
    }
    await this.transaction(async (client, connectionId, stage) => {
      stage.set("review");
      const review = await client.query(
        `SELECT thread_id
           FROM google_workspace_validation_review_items
          WHERE connection_id = $1 AND message_id = $2
          FOR UPDATE`,
        [connectionId, input.messageId],
      );
      const threadId = review.rows[0]?.thread_id;
      if (typeof threadId !== "string" || !threadId) {
        throw new Error("GOOGLE_WORKSPACE_REVIEW_ITEM_NOT_FOUND");
      }

      await this.lockAndCancel(client, {
        connectionId,
        threadId,
        now: input.now,
        stage,
      });
      await client.query(
        `UPDATE google_workspace_validation_review_items
            SET review_state = 'ignored',
                resolved_organization_id = NULL,
                evidence_codes = CASE
                  WHEN evidence_codes @> '["manual_ignore"]'::jsonb
                  THEN evidence_codes
                  ELSE evidence_codes || '["manual_ignore"]'::jsonb
                END,
                reviewed_by = $4,
                reviewed_at = $5,
                gmail_sync_state = 'not_requested',
                gmail_sync_error_code = NULL,
                gmail_sync_mutation_id = NULL,
                updated_at = $5
          WHERE connection_id = $1
            AND thread_id = $2
            AND (review_state <> 'ignored' OR message_id = $3)`,
        [connectionId, threadId, input.messageId, input.actorId, input.now],
      );
      await this.finishIgnore(client, {
        connectionId,
        messageId: input.messageId,
        actorId: input.actorId,
        action: "validation_review_ignored",
        now: input.now,
        stage,
      });
    });
  }

  async ignoreMatched(input: MatchedIgnoreInput): Promise<void> {
    if (!valid(input) || !input.threadId.trim()) {
      throw new Error("GOOGLE_WORKSPACE_MATCHED_CORRECTION_INVALID");
    }
    await this.transaction(async (client, connectionId, stage) => {
      await this.lockAndCancel(client, {
        connectionId,
        threadId: input.threadId,
        now: input.now,
        stage,
      });
      stage.set("review");
      await client.query(
        `INSERT INTO google_workspace_validation_review_items (
           connection_id, message_id, thread_id, subject, from_header, to_header,
           internal_date_ms, evidence_codes, candidate_organizations,
           has_attachments, review_state, resolved_organization_id,
           reviewed_by, reviewed_at, gmail_sync_state, gmail_sync_error_code,
           gmail_sync_mutation_id, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,'["manual_ignore"]'::jsonb,'[]'::jsonb,$8,
           'ignored',NULL,$9,$10,'not_requested',NULL,NULL,$10,$10
         )
         ON CONFLICT (connection_id, message_id) DO UPDATE SET
           thread_id = EXCLUDED.thread_id,
           subject = EXCLUDED.subject,
           from_header = EXCLUDED.from_header,
           to_header = EXCLUDED.to_header,
           internal_date_ms = EXCLUDED.internal_date_ms,
           evidence_codes = EXCLUDED.evidence_codes,
           has_attachments = EXCLUDED.has_attachments,
           review_state = 'ignored',
           resolved_organization_id = NULL,
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = EXCLUDED.reviewed_at,
           gmail_sync_state = 'not_requested',
           gmail_sync_error_code = NULL,
           gmail_sync_mutation_id = NULL,
           updated_at = EXCLUDED.updated_at`,
        [
          connectionId,
          input.messageId,
          input.threadId,
          input.subject,
          input.from,
          input.to,
          input.internalDateMs,
          input.hasAttachments,
          input.actorId,
          input.now,
        ],
      );
      await this.finishIgnore(client, {
        connectionId,
        messageId: input.messageId,
        actorId: input.actorId,
        action: "validation_matched_email_ignored",
        now: input.now,
        stage,
      });
    });
  }

  private async lockAndCancel(
    client: SqlClient,
    input: {
      connectionId: string;
      threadId: string;
      now: Date;
      stage: { set(value: Stage): void };
    },
  ): Promise<void> {
    input.stage.set("intent_lock");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [input.connectionId, input.threadId],
    );

    input.stage.set("ignore");
    await client.query(
      `INSERT INTO google_workspace_gmail_thread_intents (
         connection_id, thread_id, generation, intent_kind,
         organization_id, current_mutation_id, created_at, updated_at
       ) VALUES ($1,$2,1,'ignore',NULL,NULL,$3,$3)
       ON CONFLICT (connection_id, thread_id) DO UPDATE SET
         generation = CASE
           WHEN google_workspace_gmail_thread_intents.intent_kind = 'ignore'
           THEN google_workspace_gmail_thread_intents.generation
           ELSE google_workspace_gmail_thread_intents.generation + 1
         END,
         intent_kind = 'ignore',
         organization_id = NULL,
         current_mutation_id = NULL,
         updated_at = EXCLUDED.updated_at`,
      [input.connectionId, input.threadId, input.now],
    );
    await client.query(
      `UPDATE google_workspace_gmail_mutations
          SET state = 'permanent_error',
              last_error_code = 'GOOGLE_WORKSPACE_THREAD_INTENT_IGNORED',
              next_attempt_at = NULL,
              processing_lease_expires_at = NULL,
              updated_at = $3
        WHERE connection_id = $1
          AND thread_id = $2
          AND operation IN ('assign_thread','label_inbound_message')
          AND state IN ('pending','processing','retryable_error')`,
      [input.connectionId, input.threadId, input.now],
    );
  }

  private async finishIgnore(
    client: SqlClient,
    input: {
      connectionId: string;
      messageId: string;
      actorId: string;
      action: string;
      now: Date;
      stage: { set(value: Stage): void };
    },
  ): Promise<void> {
    await client.query(
      `DELETE FROM google_workspace_validation_mappings
        WHERE connection_id = $1
          AND thread_id = (
            SELECT thread_id
              FROM google_workspace_validation_review_items
             WHERE connection_id = $1 AND message_id = $2
             LIMIT 1
          )`,
      [input.connectionId, input.messageId],
    );
    input.stage.set("audit");
    await client.query(
      `INSERT INTO google_workspace_audit_events (
         actor_kind, actor_id, action, target_type, target_id, metadata, created_at
       ) VALUES ('owner',$1,$2,'gmail_message',$3,'{}'::jsonb,$4)`,
      [input.actorId, input.action, input.messageId, input.now],
    );
  }

  private async transaction(
    operation: (
      client: SqlClient,
      connectionId: string,
      stage: { set(value: Stage): void },
    ) => Promise<void>,
  ): Promise<void> {
    let client: SqlClient;
    try {
      client = await this.pool.connect();
    } catch (cause) {
      throw new GoogleThreadIgnoreTransactionError("connection", cause);
    }

    let currentStage: Stage = "connection";
    const stage = {
      set(value: Stage) {
        currentStage = value;
      },
    };
    try {
      await client.query("BEGIN");
      const connection = await client.query(
        `SELECT id::text
           FROM google_workspace_connections
          WHERE status IN ('connected', 'reauthorization_required')
          ORDER BY updated_at DESC
          LIMIT 1
          FOR UPDATE`,
      );
      const connectionId = connection.rows[0]?.id;
      if (typeof connectionId !== "string" || !connectionId) {
        throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
      }
      await operation(client, connectionId, stage);
      await client.query("COMMIT");
    } catch (cause) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new GoogleThreadIgnoreTransactionError(currentStage, cause);
    } finally {
      client.release();
    }
  }
}
