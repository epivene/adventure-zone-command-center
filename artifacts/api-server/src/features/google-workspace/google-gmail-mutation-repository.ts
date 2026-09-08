import { pool as defaultPool } from "@workspace/db";

export type GoogleGmailMutationRecord = {
  id: string;
  connectionId: string;
  messageId: string;
  threadId: string;
  organizationId: string;
  operation: "assign_thread" | "label_inbound_message";
  targetLabelId: string | null;
  removeLabelIds: string[];
  idempotencyKey: string;
  state:
    | "pending"
    | "processing"
    | "completed"
    | "retryable_error"
    | "permanent_error"
    | "conflict";
  attemptCount: number;
  intentGeneration: number | null;
  lastErrorCode: string | null;
};

export type GoogleGmailMutationIntent = {
  connectionId: string;
  messageId: string;
  threadId: string;
  organizationId: string;
  operation: "assign_thread" | "label_inbound_message";
  idempotencyKey: string;
  actorId: string | null;
};

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(error?: Error | boolean): void;
};
type SqlPool = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  connect?: () => Promise<SqlClient>;
};

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function record(row: Record<string, unknown> | undefined): GoogleGmailMutationRecord {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.connection_id !== "string" ||
    typeof row.message_id !== "string" ||
    typeof row.thread_id !== "string" ||
    typeof row.organization_id !== "string" ||
    (row.operation !== "assign_thread" && row.operation !== "label_inbound_message") ||
    (row.state !== "pending" &&
      row.state !== "processing" &&
      row.state !== "completed" &&
      row.state !== "retryable_error" &&
      row.state !== "permanent_error" &&
      row.state !== "conflict")
  ) throw new Error("GOOGLE_WORKSPACE_GMAIL_MUTATION_ROW_INVALID");
  return {
    id: row.id,
    connectionId: row.connection_id,
    messageId: row.message_id,
    threadId: row.thread_id,
    organizationId: row.organization_id,
    operation: row.operation,
    targetLabelId:
      typeof row.target_label_id === "string" ? row.target_label_id : null,
    removeLabelIds: strings(row.remove_label_ids),
    idempotencyKey:
      typeof row.idempotency_key === "string" ? row.idempotency_key : "",
    state: row.state,
    attemptCount:
      typeof row.attempt_count === "number" ? row.attempt_count : 0,
    intentGeneration:
      typeof row.intent_generation === "number"
        ? row.intent_generation
        : typeof row.intent_generation === "bigint"
          ? Number(row.intent_generation)
          : typeof row.intent_generation === "string"
          ? Number(row.intent_generation)
          : null,
    lastErrorCode:
      typeof row.last_error_code === "string" ? row.last_error_code : null,
  };
}

const returning = `
  RETURNING id::text, connection_id::text, message_id, thread_id,
            organization_id::text, operation, target_label_id,
            remove_label_ids, idempotency_key, state, attempt_count,
            intent_generation, last_error_code`;

const claimReturning = `
  RETURNING mutation.id::text, mutation.connection_id::text,
            mutation.message_id, mutation.thread_id,
            mutation.organization_id::text, mutation.operation,
            mutation.target_label_id, mutation.remove_label_ids,
            mutation.idempotency_key, mutation.state,
            mutation.attempt_count, mutation.intent_generation,
            mutation.last_error_code`;

export class PostgresGoogleGmailMutationRepository {
  constructor(private readonly pool: SqlPool = defaultPool as unknown as SqlPool) {}


  async withThreadLock<T>(
    input: { connectionId: string; threadId: string },
    work: () => Promise<T>,
  ): Promise<T> {
    if (!this.pool.connect) {
      throw new Error("GOOGLE_WORKSPACE_GMAIL_THREAD_LOCK_UNAVAILABLE");
    }
    const client = await this.pool.connect();
    let locked = false;
    try {
      await client.query(
        "SELECT pg_advisory_lock(hashtext($1), hashtext($2))",
        [input.connectionId, input.threadId],
      );
      locked = true;
      return await work();
    } finally {
      let unlockError: Error | null = null;
      if (locked) {
        try {
          await client.query(
            "SELECT pg_advisory_unlock(hashtext($1), hashtext($2))",
            [input.connectionId, input.threadId],
          );
        } catch (error) {
          unlockError = error instanceof Error
            ? error
            : new Error("GOOGLE_WORKSPACE_GMAIL_THREAD_UNLOCK_FAILED");
        }
      }
      client.release(unlockError ?? undefined);
    }
  }

  async createOrLoad(
    input: GoogleGmailMutationIntent,
  ): Promise<GoogleGmailMutationRecord> {
    const result = await this.pool.query(
      `INSERT INTO google_workspace_gmail_mutations (
         connection_id, message_id, thread_id, organization_id, operation,
         idempotency_key, actor_id, state, intent_generation,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,'pending',
         CASE WHEN $5 = 'label_inbound_message' THEN (
           SELECT intent.generation
             FROM google_workspace_gmail_thread_intents intent
            WHERE intent.connection_id = $1
              AND intent.thread_id = $3
              AND intent.intent_kind = 'assign'
              AND intent.organization_id = $4
         ) ELSE NULL END,
         now(),now()
       )
       ON CONFLICT (idempotency_key) DO UPDATE SET
         idempotency_key = EXCLUDED.idempotency_key,
         intent_generation = CASE
           WHEN google_workspace_gmail_mutations.operation = 'label_inbound_message'
            AND google_workspace_gmail_mutations.state IN ('pending','retryable_error')
            AND EXCLUDED.intent_generation IS NOT NULL
           THEN EXCLUDED.intent_generation
           ELSE google_workspace_gmail_mutations.intent_generation
         END
       ${returning}`,
      [
        input.connectionId,
        input.messageId,
        input.threadId,
        input.organizationId,
        input.operation,
        input.idempotencyKey,
        input.actorId,
      ],
    );
    return record(result.rows[0]);
  }

  async get(id: string): Promise<GoogleGmailMutationRecord | null> {
    const result = await this.pool.query(
      `SELECT id::text, connection_id::text, message_id, thread_id,
              organization_id::text, operation, target_label_id,
              remove_label_ids, idempotency_key, state, attempt_count,
              intent_generation, last_error_code
         FROM google_workspace_gmail_mutations
        WHERE id = $1
        LIMIT 1`,
      [id],
    );
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async listDueIdsForCurrentConnection(
    now: Date,
    limit = 25,
  ): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT mutation.id::text
         FROM google_workspace_gmail_mutations mutation
        WHERE mutation.connection_id = (
          SELECT connection.id
            FROM google_workspace_connections connection
           WHERE connection.status = 'connected'
           ORDER BY connection.updated_at DESC
           LIMIT 1
        )
          AND (
            (
              mutation.operation = 'assign_thread'
              AND EXISTS (
                SELECT 1
                  FROM google_workspace_gmail_thread_intents intent
                 WHERE intent.connection_id = mutation.connection_id
                   AND intent.thread_id = mutation.thread_id
                   AND intent.intent_kind = 'assign'
                   AND intent.organization_id = mutation.organization_id
                   AND intent.generation = mutation.intent_generation
                   AND intent.current_mutation_id = mutation.id
              )
            )
            OR (
              mutation.operation = 'label_inbound_message'
              AND (
                EXISTS (
                  SELECT 1
                    FROM google_workspace_gmail_thread_intents intent
                   WHERE intent.connection_id = mutation.connection_id
                     AND intent.thread_id = mutation.thread_id
                     AND intent.intent_kind = 'assign'
                     AND intent.organization_id = mutation.organization_id
                     AND intent.generation = mutation.intent_generation
                )
                OR (
                  mutation.intent_generation IS NULL
                  AND NOT EXISTS (
                    SELECT 1
                      FROM google_workspace_gmail_thread_intents any_intent
                     WHERE any_intent.connection_id = mutation.connection_id
                       AND any_intent.thread_id = mutation.thread_id
                  )
                )
              )
            )
          )
          AND (
            mutation.state = 'pending'
            OR (
              mutation.state = 'retryable_error'
              AND (
                mutation.next_attempt_at IS NULL
                OR mutation.next_attempt_at <= $1
              )
            )
            OR (
              mutation.state = 'processing'
              AND mutation.processing_lease_expires_at <= $1
            )
          )
        ORDER BY mutation.created_at, mutation.id
        LIMIT $2`,
      [now, limit],
    );
    return result.rows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : [],
    );
  }

  async listDueIds(
    connectionId: string,
    now: Date,
    limit = 25,
  ): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT id::text
         FROM google_workspace_gmail_mutations
        WHERE connection_id = $1
          AND (
            (
              google_workspace_gmail_mutations.operation = 'assign_thread'
              AND EXISTS (
                SELECT 1
                  FROM google_workspace_gmail_thread_intents intent
                 WHERE intent.connection_id = google_workspace_gmail_mutations.connection_id
                   AND intent.thread_id = google_workspace_gmail_mutations.thread_id
                   AND intent.intent_kind = 'assign'
                   AND intent.organization_id = google_workspace_gmail_mutations.organization_id
                   AND intent.generation = google_workspace_gmail_mutations.intent_generation
                   AND intent.current_mutation_id = google_workspace_gmail_mutations.id
              )
            )
            OR (
              google_workspace_gmail_mutations.operation = 'label_inbound_message'
              AND (
                EXISTS (
                  SELECT 1
                    FROM google_workspace_gmail_thread_intents intent
                   WHERE intent.connection_id = google_workspace_gmail_mutations.connection_id
                     AND intent.thread_id = google_workspace_gmail_mutations.thread_id
                     AND intent.intent_kind = 'assign'
                     AND intent.organization_id = google_workspace_gmail_mutations.organization_id
                     AND intent.generation = google_workspace_gmail_mutations.intent_generation
                )
                OR (
                  google_workspace_gmail_mutations.intent_generation IS NULL
                  AND NOT EXISTS (
                    SELECT 1
                      FROM google_workspace_gmail_thread_intents any_intent
                     WHERE any_intent.connection_id = google_workspace_gmail_mutations.connection_id
                       AND any_intent.thread_id = google_workspace_gmail_mutations.thread_id
                  )
                )
              )
            )
          )
          AND (
            state = 'pending'
            OR (
              state = 'retryable_error'
              AND (next_attempt_at IS NULL OR next_attempt_at <= $2)
            )
            OR (
              state = 'processing'
              AND processing_lease_expires_at <= $2
            )
          )
        ORDER BY created_at, id
        LIMIT $3`,
      [connectionId, now, limit],
    );
    return result.rows.flatMap((row) =>
      typeof row.id === "string" ? [row.id] : [],
    );
  }

  async retryNow(
    id: string,
    now: Date,
  ): Promise<GoogleGmailMutationRecord | null> {
    const result = await this.pool.query(
      `UPDATE google_workspace_gmail_mutations
          SET state = 'pending',
              next_attempt_at = NULL,
              processing_lease_expires_at = NULL,
              updated_at = $2
        WHERE id = $1
          AND state = 'retryable_error'
          AND (
            (
              google_workspace_gmail_mutations.operation = 'assign_thread'
              AND EXISTS (
                SELECT 1
                  FROM google_workspace_gmail_thread_intents intent
                 WHERE intent.connection_id = google_workspace_gmail_mutations.connection_id
                   AND intent.thread_id = google_workspace_gmail_mutations.thread_id
                   AND intent.intent_kind = 'assign'
                   AND intent.organization_id = google_workspace_gmail_mutations.organization_id
                   AND intent.generation = google_workspace_gmail_mutations.intent_generation
                   AND intent.current_mutation_id = google_workspace_gmail_mutations.id
              )
            )
            OR (
              google_workspace_gmail_mutations.operation = 'label_inbound_message'
              AND (
                EXISTS (
                  SELECT 1
                    FROM google_workspace_gmail_thread_intents intent
                   WHERE intent.connection_id = google_workspace_gmail_mutations.connection_id
                     AND intent.thread_id = google_workspace_gmail_mutations.thread_id
                     AND intent.intent_kind = 'assign'
                     AND intent.organization_id = google_workspace_gmail_mutations.organization_id
                     AND intent.generation = google_workspace_gmail_mutations.intent_generation
                )
                OR (
                  google_workspace_gmail_mutations.intent_generation IS NULL
                  AND NOT EXISTS (
                    SELECT 1
                      FROM google_workspace_gmail_thread_intents any_intent
                     WHERE any_intent.connection_id = google_workspace_gmail_mutations.connection_id
                       AND any_intent.thread_id = google_workspace_gmail_mutations.thread_id
                  )
                )
              )
            )
          )
        ${returning}`,
      [id, now],
    );
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async claim(id: string, now: Date): Promise<GoogleGmailMutationRecord | null> {
    const result = await this.pool.query(
      `WITH candidate AS (
         SELECT candidate_mutation.id
           FROM google_workspace_gmail_mutations candidate_mutation
          WHERE candidate_mutation.id = $1
            AND (
              candidate_mutation.state IN ('pending','retryable_error')
              OR (
                candidate_mutation.state = 'processing'
                AND candidate_mutation.processing_lease_expires_at <= $2
              )
            )
            AND (
              candidate_mutation.next_attempt_at IS NULL
              OR candidate_mutation.next_attempt_at <= $2
            )
            AND (
              (
                candidate_mutation.operation = 'assign_thread'
                AND EXISTS (
                  SELECT 1
                    FROM google_workspace_gmail_thread_intents intent
                   WHERE intent.connection_id = candidate_mutation.connection_id
                     AND intent.thread_id = candidate_mutation.thread_id
                     AND intent.intent_kind = 'assign'
                     AND intent.organization_id = candidate_mutation.organization_id
                     AND intent.generation = candidate_mutation.intent_generation
                     AND intent.current_mutation_id = candidate_mutation.id
                )
              )
              OR (
                candidate_mutation.operation = 'label_inbound_message'
                AND (
                  EXISTS (
                    SELECT 1
                      FROM google_workspace_gmail_thread_intents intent
                     WHERE intent.connection_id = candidate_mutation.connection_id
                       AND intent.thread_id = candidate_mutation.thread_id
                       AND intent.intent_kind = 'assign'
                       AND intent.organization_id = candidate_mutation.organization_id
                       AND intent.generation = candidate_mutation.intent_generation
                  )
                  OR (
                    candidate_mutation.intent_generation IS NULL
                    AND NOT EXISTS (
                      SELECT 1
                        FROM google_workspace_gmail_thread_intents any_intent
                       WHERE any_intent.connection_id = candidate_mutation.connection_id
                         AND any_intent.thread_id = candidate_mutation.thread_id
                    )
                  )
                )
              )
            )
          FOR UPDATE OF candidate_mutation SKIP LOCKED
       )
       UPDATE google_workspace_gmail_mutations AS mutation
          SET state = 'processing',
              attempt_count = mutation.attempt_count + 1,
              last_error_code = NULL,
              processing_lease_expires_at = $2 + interval '60 seconds',
              updated_at = $2
         FROM candidate
        WHERE mutation.id = candidate.id
        ${claimReturning}`,
      [id, now],
    );
    return result.rows[0] ? record(result.rows[0]) : null;
  }

  async complete(input: {
    id: string;
    expectedAttemptCount: number;
    targetLabelId: string;
    removeLabelIds: string[];
    now: Date;
  }): Promise<GoogleGmailMutationRecord | null> {
    const result = await this.pool.query(
      `UPDATE google_workspace_gmail_mutations
          SET state = 'completed',
              target_label_id = $2,
              remove_label_ids = $3::jsonb,
              last_error_code = NULL,
              next_attempt_at = NULL,
              processing_lease_expires_at = NULL,
              updated_at = $4
        WHERE id = $1
          AND state = 'processing'
          AND attempt_count = $5
        ${returning}`,
      [
        input.id,
        input.targetLabelId,
        JSON.stringify(input.removeLabelIds),
        input.now,
        input.expectedAttemptCount,
      ],
    );
    return result.rows[0] ? record(result.rows[0]) : this.get(input.id);
  }

  async fail(input: {
    id: string;
    expectedAttemptCount?: number;
    state: "retryable_error" | "permanent_error" | "conflict";
    errorCode: string;
    nextAttemptAt: Date | null;
    now: Date;
  }): Promise<GoogleGmailMutationRecord | null> {
    const result = await this.pool.query(
      `UPDATE google_workspace_gmail_mutations
          SET state = $2,
              last_error_code = $3,
              next_attempt_at = $4,
              processing_lease_expires_at = NULL,
              updated_at = $5
        WHERE id = $1
          AND state <> 'completed'
          AND (
            ($6::integer IS NULL AND state IN ('pending','retryable_error'))
            OR (
              $6::integer IS NOT NULL
              AND state = 'processing'
              AND attempt_count = $6
            )
          )
        ${returning}`,
      [
        input.id,
        input.state,
        input.errorCode,
        input.nextAttemptAt,
        input.now,
        input.expectedAttemptCount ?? null,
      ],
    );
    return result.rows[0] ? record(result.rows[0]) : this.get(input.id);
  }
}
