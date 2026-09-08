import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { PostgresGoogleThreadIgnoreTransaction } from "./google-thread-ignore-transaction";

const connectionId = "20000000-0000-4000-8000-000000000001";
const organizationId = "10000000-0000-4000-8000-000000000001";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE google_workspace_connections (
      id uuid PRIMARY KEY,
      status text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE google_workspace_validation_review_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      connection_id uuid NOT NULL,
      message_id text NOT NULL,
      thread_id text NOT NULL,
      subject text NOT NULL DEFAULT '',
      from_header text NOT NULL DEFAULT '',
      to_header text NOT NULL DEFAULT '',
      internal_date_ms bigint,
      evidence_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
      candidate_organizations jsonb NOT NULL DEFAULT '[]'::jsonb,
      has_attachments boolean NOT NULL DEFAULT false,
      review_state text NOT NULL DEFAULT 'pending',
      resolved_organization_id uuid,
      reviewed_by text,
      reviewed_at timestamptz,
      gmail_sync_state text NOT NULL DEFAULT 'not_requested',
      gmail_sync_error_code text,
      gmail_sync_mutation_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (connection_id, message_id)
    );
    CREATE TABLE google_workspace_validation_mappings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      connection_id uuid NOT NULL,
      message_id text NOT NULL,
      thread_id text NOT NULL,
      organization_id uuid NOT NULL,
      evidence_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (connection_id, message_id)
    );
    CREATE TABLE google_workspace_gmail_mutations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      connection_id uuid NOT NULL,
      message_id text NOT NULL,
      thread_id text NOT NULL,
      organization_id uuid NOT NULL,
      operation text NOT NULL,
      idempotency_key text NOT NULL UNIQUE,
      state text NOT NULL,
      attempt_count integer NOT NULL DEFAULT 0,
      intent_generation bigint,
      last_error_code text,
      next_attempt_at timestamptz,
      processing_lease_expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE google_workspace_gmail_thread_intents (
      connection_id uuid NOT NULL,
      thread_id text NOT NULL,
      generation bigint NOT NULL,
      intent_kind text NOT NULL,
      organization_id uuid,
      current_mutation_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (connection_id, thread_id)
    );
    CREATE TABLE google_workspace_audit_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_kind text NOT NULL,
      actor_id text,
      action text NOT NULL,
      target_type text NOT NULL,
      target_id text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO google_workspace_connections(id, status)
      VALUES ('20000000-0000-4000-8000-000000000001', 'connected');
    INSERT INTO google_workspace_validation_review_items(
      connection_id, message_id, thread_id, review_state,
      resolved_organization_id, gmail_sync_state, gmail_sync_error_code
    ) VALUES (
      '20000000-0000-4000-8000-000000000001', 'message-1', 'thread-1', 'resolved',
      '10000000-0000-4000-8000-000000000001', 'retryable_error', 'temporary'
    );
    INSERT INTO google_workspace_validation_mappings(
      connection_id, message_id, thread_id, organization_id
    ) VALUES (
      '20000000-0000-4000-8000-000000000001', 'message-1', 'thread-1', '10000000-0000-4000-8000-000000000001'
    );
    INSERT INTO google_workspace_gmail_mutations(
      connection_id, message_id, thread_id, organization_id, operation,
      idempotency_key, state, attempt_count, intent_generation
    ) VALUES
      ('20000000-0000-4000-8000-000000000001', 'message-1', 'thread-1', '10000000-0000-4000-8000-000000000001',
       'assign_thread', 'pending-key', 'pending', 0, 1),
      ('20000000-0000-4000-8000-000000000001', 'message-1', 'thread-1', '10000000-0000-4000-8000-000000000001',
       'assign_thread', 'processing-key', 'processing', 1, 1),
      ('20000000-0000-4000-8000-000000000001', 'message-1', 'thread-1', '10000000-0000-4000-8000-000000000001',
       'assign_thread', 'retry-key', 'retryable_error', 1, 1);
    INSERT INTO google_workspace_gmail_thread_intents(
      connection_id, thread_id, generation, intent_kind,
      organization_id, current_mutation_id
    )
    SELECT '20000000-0000-4000-8000-000000000001', 'thread-1', 1, 'assign', '10000000-0000-4000-8000-000000000001', id
      FROM google_workspace_gmail_mutations
     WHERE idempotency_key = 'processing-key';
  `);

  const client = {
    async query(text: string, values?: unknown[]) {
      if (text.includes("pg_advisory_xact_lock")) {
        return { rows: [{ pg_advisory_xact_lock: null }] };
      }
      const result = values === undefined
        ? await db.query(text)
        : await db.query(text, values as never[]);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
    release() {},
  };
  return {
    db,
    transaction: new PostgresGoogleThreadIgnoreTransaction({
      connect: async () => client,
    }),
  };
}

describe("PostgresGoogleThreadIgnoreTransaction", () => {
  it("atomically makes Ignore current and cancels all unfinished assignments", async () => {
    const { db, transaction } = await fixture();
    try {
      await transaction.ignoreReview({
        messageId: "message-1",
        actorId: "owner-1",
        now: new Date("2026-09-08T14:00:00Z"),
      });

      const review = await db.query<{
        review_state: string;
        resolved_organization_id: string | null;
        gmail_sync_state: string;
        gmail_sync_mutation_id: string | null;
      }>(`
        SELECT review_state, resolved_organization_id::text,
               gmail_sync_state, gmail_sync_mutation_id::text
          FROM google_workspace_validation_review_items
      `);
      expect(review.rows[0]).toEqual({
        review_state: "ignored",
        resolved_organization_id: null,
        gmail_sync_state: "not_requested",
        gmail_sync_mutation_id: null,
      });

      const states = await db.query<{
        state: string;
        last_error_code: string | null;
      }>(`
        SELECT state, last_error_code
          FROM google_workspace_gmail_mutations
         ORDER BY idempotency_key
      `);
      expect(states.rows).toHaveLength(3);
      expect(states.rows.every((row) =>
        row.state === "permanent_error" &&
        row.last_error_code === "GOOGLE_WORKSPACE_THREAD_INTENT_IGNORED"
      )).toBe(true);

      const intent = await db.query<{
        intent_kind: string;
        organization_id: string | null;
        current_mutation_id: string | null;
        generation: string;
      }>(`
        SELECT intent_kind, organization_id::text,
               current_mutation_id::text, generation::text
          FROM google_workspace_gmail_thread_intents
      `);
      expect(intent.rows[0]).toEqual({
        intent_kind: "ignore",
        organization_id: null,
        current_mutation_id: null,
        generation: "2",
      });

      const mappings = await db.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM google_workspace_validation_mappings",
      );
      expect(mappings.rows[0]?.count).toBe("0");
    } finally {
      await db.close();
    }
  });

  it("keeps repeated Ignore idempotent", async () => {
    const { db, transaction } = await fixture();
    try {
      const first = {
        messageId: "message-1",
        actorId: "owner-1",
        now: new Date("2026-09-08T14:00:00Z"),
      };
      await transaction.ignoreReview(first);
      await transaction.ignoreReview({
        ...first,
        now: new Date("2026-09-08T14:01:00Z"),
      });
      const intent = await db.query<{ generation: string }>(
        "SELECT generation::text FROM google_workspace_gmail_thread_intents",
      );
      expect(intent.rows[0]?.generation).toBe("2");
    } finally {
      await db.close();
    }
  });
});
