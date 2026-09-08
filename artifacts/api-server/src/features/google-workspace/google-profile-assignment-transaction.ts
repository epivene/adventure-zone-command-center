import { pool as defaultPool } from "@workspace/db";

import type { GoogleGmailMutationRecord } from "./google-gmail-mutation-repository";

export type BaseAssignmentInput = {
  messageId: string;
  organizationId: string;
  actorId: string;
  now: Date;
};

export type MatchedAssignmentInput = BaseAssignmentInput & {
  threadId: string;
  subject: string;
  from: string;
  to: string;
  internalDateMs: number | null;
  hasAttachments: boolean;
};

export type CommittedProfileAssignment = {
  connectionId: string;
  messageId: string;
  threadId: string;
  organizationId: string;
  mutation: GoogleGmailMutationRecord;
};

export interface GoogleProfileAssignmentTransactionPort {
  resolveReview(input: BaseAssignmentInput): Promise<CommittedProfileAssignment>;
  assignMatched(input: MatchedAssignmentInput): Promise<CommittedProfileAssignment>;
}

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlClient = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
};
type SqlPool = {
  connect(): Promise<SqlClient>;
};

export type GoogleProfileAssignmentTransactionStage =
  | "connection"
  | "target"
  | "review"
  | "mapping"
  | "audit"
  | "intent_lock"
  | "supersede"
  | "mutation";

export class GoogleProfileAssignmentTransactionError extends Error {
  readonly stage: GoogleProfileAssignmentTransactionStage;
  readonly postgresCode: string | null;

  constructor(input: {
    stage: GoogleProfileAssignmentTransactionStage;
    cause: unknown;
  }) {
    const original =
      input.cause instanceof Error ? input.cause.message : null;
    super(
      original?.startsWith("GOOGLE_WORKSPACE_")
        ? original
        : "GOOGLE_WORKSPACE_PROFILE_ASSIGNMENT_TRANSACTION_FAILED",
      { cause: input.cause },
    );
    this.name = "GoogleProfileAssignmentTransactionError";
    this.stage = input.stage;
    const code =
      input.cause && typeof input.cause === "object" && "code" in input.cause
        ? (input.cause as { code?: unknown }).code
        : null;
    this.postgresCode = typeof code === "string" ? code : null;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function mutationRecord(row: Record<string, unknown> | undefined): GoogleGmailMutationRecord {
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.connection_id !== "string" ||
    typeof row.message_id !== "string" ||
    typeof row.thread_id !== "string" ||
    typeof row.organization_id !== "string" ||
    row.operation !== "assign_thread" ||
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
        : typeof row.intent_generation === "string"
          ? Number(row.intent_generation)
          : null,
    lastErrorCode:
      typeof row.last_error_code === "string" ? row.last_error_code : null,
  };
}

function validate(input: BaseAssignmentInput): void {
  if (
    !input.messageId.trim() ||
    !input.organizationId.trim() ||
    !input.actorId.trim() ||
    !Number.isFinite(input.now.getTime())
  ) throw new Error("GOOGLE_WORKSPACE_REVIEW_DECISION_INVALID");
}

function evidence(value: unknown): string[] {
  return [...new Set([...strings(value), "manual_profile_assignment"])];
}

function projectedState(state: GoogleGmailMutationRecord["state"]): string {
  return state === "pending" || state === "processing" ? "pending" : state;
}

export class PostgresGoogleProfileAssignmentTransaction
implements GoogleProfileAssignmentTransactionPort {
  constructor(
    private readonly pool: SqlPool = defaultPool as unknown as SqlPool,
  ) {}

  async resolveReview(
    input: BaseAssignmentInput,
  ): Promise<CommittedProfileAssignment> {
    validate(input);
    return this.transaction(input, async (client, connectionId, stage) => {
      stage.set("review");
      const locked = await client.query(
        `SELECT thread_id, evidence_codes, review_state,
                resolved_organization_id::text
           FROM google_workspace_validation_review_items
          WHERE connection_id = $1 AND message_id = $2
          FOR UPDATE`,
        [connectionId, input.messageId],
      );
      const previous = locked.rows[0];
      if (!previous || typeof previous.thread_id !== "string") {
        throw new Error("GOOGLE_WORKSPACE_REVIEW_ITEM_NOT_FOUND");
      }
      const threadId = previous.thread_id;
      const manualEvidence = evidence(previous.evidence_codes);

      await client.query(
        `UPDATE google_workspace_validation_review_items
            SET review_state = 'resolved',
                resolved_organization_id = $3,
                evidence_codes = $4::jsonb,
                reviewed_by = $5,
                reviewed_at = $6,
                updated_at = $6
          WHERE connection_id = $1 AND message_id = $2`,
        [
          connectionId,
          input.messageId,
          input.organizationId,
          JSON.stringify(manualEvidence),
          input.actorId,
          input.now,
        ],
      );

      stage.set("mapping");
      await this.upsertMapping(client, {
        connectionId,
        messageId: input.messageId,
        threadId,
        organizationId: input.organizationId,
        evidenceCodes: manualEvidence,
        now: input.now,
      });

      stage.set("audit");
      if (
        previous.review_state !== "resolved" ||
        previous.resolved_organization_id !== input.organizationId
      ) {
        await this.audit(client, {
          actorId: input.actorId,
          action: "validation_review_resolved",
          messageId: input.messageId,
          organizationId: input.organizationId,
          now: input.now,
        });
      }

      return this.enqueue(client, stage, {
        connectionId,
        messageId: input.messageId,
        threadId,
        organizationId: input.organizationId,
        actorId: input.actorId,
        now: input.now,
        newIntent:
          previous.review_state !== "resolved" ||
          previous.resolved_organization_id !== input.organizationId,
      });
    });
  }

  async assignMatched(
    input: MatchedAssignmentInput,
  ): Promise<CommittedProfileAssignment> {
    validate(input);
    if (!input.threadId.trim()) {
      throw new Error("GOOGLE_WORKSPACE_MATCHED_CORRECTION_INVALID");
    }
    return this.transaction(input, async (client, connectionId, stage) => {
      stage.set("review");
      const locked = await client.query(
        `SELECT review_state, resolved_organization_id::text
           FROM google_workspace_validation_review_items
          WHERE connection_id = $1 AND message_id = $2
          FOR UPDATE`,
        [connectionId, input.messageId],
      );
      const previous = locked.rows[0];
      const manualEvidence = ["manual_profile_assignment"];
      await client.query(
        `INSERT INTO google_workspace_validation_review_items (
           connection_id, message_id, thread_id, subject, from_header, to_header,
           internal_date_ms, evidence_codes, candidate_organizations,
           has_attachments, review_state, resolved_organization_id,
           reviewed_by, reviewed_at, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8::jsonb,'[]'::jsonb,$9,
           'resolved',$10,$11,$12,$12,$12
         )
         ON CONFLICT (connection_id, message_id) DO UPDATE SET
           thread_id = EXCLUDED.thread_id,
           subject = EXCLUDED.subject,
           from_header = EXCLUDED.from_header,
           to_header = EXCLUDED.to_header,
           internal_date_ms = EXCLUDED.internal_date_ms,
           evidence_codes = EXCLUDED.evidence_codes,
           has_attachments = EXCLUDED.has_attachments,
           review_state = 'resolved',
           resolved_organization_id = EXCLUDED.resolved_organization_id,
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = EXCLUDED.reviewed_at,
           updated_at = EXCLUDED.updated_at`,
        [
          connectionId,
          input.messageId,
          input.threadId,
          input.subject,
          input.from,
          input.to,
          input.internalDateMs,
          JSON.stringify(manualEvidence),
          input.hasAttachments,
          input.organizationId,
          input.actorId,
          input.now,
        ],
      );

      stage.set("mapping");
      await this.upsertMapping(client, {
        connectionId,
        messageId: input.messageId,
        threadId: input.threadId,
        organizationId: input.organizationId,
        evidenceCodes: manualEvidence,
        now: input.now,
      });

      stage.set("audit");
      if (
        previous?.review_state !== "resolved" ||
        previous?.resolved_organization_id !== input.organizationId
      ) {
        await this.audit(client, {
          actorId: input.actorId,
          action: "validation_matched_profile_corrected",
          messageId: input.messageId,
          organizationId: input.organizationId,
          now: input.now,
        });
      }

      return this.enqueue(client, stage, {
        connectionId,
        messageId: input.messageId,
        threadId: input.threadId,
        organizationId: input.organizationId,
        actorId: input.actorId,
        now: input.now,
        newIntent:
          previous?.review_state !== "resolved" ||
          previous?.resolved_organization_id !== input.organizationId,
      });
    });
  }

  private async transaction(
    input: BaseAssignmentInput,
    operation: (
      client: SqlClient,
      connectionId: string,
      stage: { set(value: GoogleProfileAssignmentTransactionStage): void },
    ) => Promise<CommittedProfileAssignment>,
  ): Promise<CommittedProfileAssignment> {
    let client: SqlClient;
    try {
      client = await this.pool.connect();
    } catch (cause) {
      throw new GoogleProfileAssignmentTransactionError({
        stage: "connection",
        cause,
      });
    }
    let currentStage: GoogleProfileAssignmentTransactionStage = "connection";
    const stage = {
      set(value: GoogleProfileAssignmentTransactionStage) {
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

      stage.set("target");
      const target = await client.query(
        `SELECT id
           FROM organizations
          WHERE id = $1 AND consolidated_into_id IS NULL
          LIMIT 1`,
        [input.organizationId],
      );
      if (!target.rows.length) {
        throw new Error("GOOGLE_WORKSPACE_REVIEW_TARGET_NOT_FOUND");
      }

      const committed = await operation(client, connectionId, stage);
      await client.query("COMMIT");
      return committed;
    } catch (cause) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new GoogleProfileAssignmentTransactionError({
        stage: currentStage,
        cause,
      });
    } finally {
      client.release();
    }
  }

  private async enqueue(
    client: SqlClient,
    stage: { set(value: GoogleProfileAssignmentTransactionStage): void },
    input: {
      connectionId: string;
      messageId: string;
      threadId: string;
      organizationId: string;
      actorId: string;
      now: Date;
      newIntent: boolean;
    },
  ): Promise<CommittedProfileAssignment> {
    stage.set("intent_lock");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [input.connectionId, input.threadId],
    );

    const intentResult = await client.query(
      `INSERT INTO google_workspace_gmail_thread_intents (
         connection_id, thread_id, generation, intent_kind,
         organization_id, current_mutation_id, created_at, updated_at
       ) VALUES ($1,$2,1,'assign',$3,NULL,$4,$4)
       ON CONFLICT (connection_id, thread_id) DO UPDATE SET
         generation = CASE
           WHEN google_workspace_gmail_thread_intents.intent_kind = 'assign'
            AND google_workspace_gmail_thread_intents.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id
           THEN google_workspace_gmail_thread_intents.generation
           ELSE google_workspace_gmail_thread_intents.generation + 1
         END,
         intent_kind = 'assign',
         organization_id = EXCLUDED.organization_id,
         current_mutation_id = CASE
           WHEN google_workspace_gmail_thread_intents.intent_kind = 'assign'
            AND google_workspace_gmail_thread_intents.organization_id IS NOT DISTINCT FROM EXCLUDED.organization_id
           THEN google_workspace_gmail_thread_intents.current_mutation_id
           ELSE NULL
         END,
         updated_at = EXCLUDED.updated_at
       RETURNING generation, current_mutation_id::text`,
      [input.connectionId, input.threadId, input.organizationId, input.now],
    );
    const intent = intentResult.rows[0];
    const generation =
      typeof intent?.generation === "number"
        ? intent.generation
        : typeof intent?.generation === "string"
          ? Number(intent.generation)
          : NaN;
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new Error("GOOGLE_WORKSPACE_GMAIL_THREAD_INTENT_INVALID");
    }

    const currentMutationId =
      typeof intent?.current_mutation_id === "string"
        ? intent.current_mutation_id
        : null;
    let mutation: GoogleGmailMutationRecord;
    if (currentMutationId) {
      const existing = await client.query(
        `SELECT id::text, connection_id::text, message_id, thread_id,
                organization_id::text, operation, target_label_id,
                remove_label_ids, idempotency_key, state, attempt_count,
                intent_generation, last_error_code
           FROM google_workspace_gmail_mutations
          WHERE id = $1
          LIMIT 1`,
        [currentMutationId],
      );
      mutation = mutationRecord(existing.rows[0]);
    } else {
      stage.set("supersede");
      await client.query(
        `UPDATE google_workspace_gmail_mutations
            SET state = 'permanent_error',
                last_error_code = 'GOOGLE_WORKSPACE_ASSIGNMENT_SUPERSEDED',
                next_attempt_at = NULL,
                processing_lease_expires_at = NULL,
                updated_at = $3
          WHERE connection_id = $1
            AND thread_id = $2
            AND operation = 'assign_thread'
            AND state IN ('pending','processing','retryable_error')`,
        [input.connectionId, input.threadId, input.now],
      );

      stage.set("mutation");
      const idempotencyKey =
        `assign-thread:${input.connectionId}:${input.threadId}:${input.organizationId}`;
      await client.query(
        `UPDATE google_workspace_gmail_mutations
            SET idempotency_key = idempotency_key || ':history:' || id::text,
                updated_at = $2
          WHERE idempotency_key = $1`,
        [idempotencyKey, input.now],
      );
      const inserted = await client.query(
        `INSERT INTO google_workspace_gmail_mutations (
           connection_id, message_id, thread_id, organization_id, operation,
           idempotency_key, actor_id, state, intent_generation,
           created_at, updated_at
         ) VALUES ($1,$2,$3,$4,'assign_thread',$5,$6,'pending',$7,$8,$8)
         RETURNING id::text, connection_id::text, message_id, thread_id,
                   organization_id::text, operation, target_label_id,
                   remove_label_ids, idempotency_key, state, attempt_count,
                   intent_generation, last_error_code`,
        [
          input.connectionId,
          input.messageId,
          input.threadId,
          input.organizationId,
          idempotencyKey,
          input.actorId,
          generation,
          input.now,
        ],
      );
      mutation = mutationRecord(inserted.rows[0]);
      await client.query(
        `UPDATE google_workspace_gmail_thread_intents
            SET current_mutation_id = $3,
                updated_at = $4
          WHERE connection_id = $1
            AND thread_id = $2
            AND generation = $5
            AND intent_kind = 'assign'`,
        [
          input.connectionId,
          input.threadId,
          mutation.id,
          input.now,
          generation,
        ],
      );
    }

    await client.query(
      `UPDATE google_workspace_validation_review_items
          SET gmail_sync_state = $3,
              gmail_sync_error_code = $4,
              gmail_sync_mutation_id = $5,
              updated_at = GREATEST(updated_at, $6)
        WHERE connection_id = $1 AND message_id = $2`,
      [
        input.connectionId,
        input.messageId,
        projectedState(mutation.state),
        mutation.lastErrorCode,
        mutation.id,
        input.now,
      ],
    );

    return {
      connectionId: input.connectionId,
      messageId: input.messageId,
      threadId: input.threadId,
      organizationId: input.organizationId,
      mutation,
    };
  }

  private async upsertMapping(
    client: SqlClient,
    input: {
      connectionId: string;
      messageId: string;
      threadId: string;
      organizationId: string;
      evidenceCodes: string[];
      now: Date;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO google_workspace_validation_mappings (
         connection_id, message_id, thread_id, organization_id, contact_id,
         evidence_codes, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,NULL,$5::jsonb,$6,$6)
       ON CONFLICT (connection_id, message_id) DO UPDATE SET
         thread_id = EXCLUDED.thread_id,
         organization_id = EXCLUDED.organization_id,
         contact_id = NULL,
         evidence_codes = EXCLUDED.evidence_codes,
         updated_at = EXCLUDED.updated_at`,
      [
        input.connectionId,
        input.messageId,
        input.threadId,
        input.organizationId,
        JSON.stringify(input.evidenceCodes),
        input.now,
      ],
    );
  }

  private async audit(
    client: SqlClient,
    input: {
      actorId: string;
      action: string;
      messageId: string;
      organizationId: string;
      now: Date;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO google_workspace_audit_events (
         actor_kind, actor_id, action, target_type, target_id, metadata, created_at
       ) VALUES (
         'owner',$1,$2,'gmail_message',$3,
         jsonb_build_object('organizationId',$4::text),$5
       )`,
      [
        input.actorId,
        input.action,
        input.messageId,
        input.organizationId,
        input.now,
      ],
    );
  }
}
