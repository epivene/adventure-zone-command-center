import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { PostgresGoogleGmailMutationRepository } from "./google-gmail-mutation-repository";

const connectionId = "20000000-0000-4000-8000-000000000001";
const organizationA = "10000000-0000-4000-8000-000000000001";
const organizationB = "10000000-0000-4000-8000-000000000002";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE google_workspace_gmail_mutations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      connection_id uuid NOT NULL,
      message_id text NOT NULL,
      thread_id text NOT NULL,
      organization_id uuid NOT NULL,
      operation text NOT NULL,
      target_label_id text,
      remove_label_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
      idempotency_key text NOT NULL UNIQUE,
      state text NOT NULL DEFAULT 'pending',
      attempt_count integer NOT NULL DEFAULT 0,
      intent_generation bigint,
      last_error_code text,
      next_attempt_at timestamptz,
      processing_lease_expires_at timestamptz,
      actor_id text,
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
  `);
  const pool = {
    async query(text: string, values?: unknown[]) {
      const result = values === undefined
        ? await db.query(text)
        : await db.query(text, values as never[]);
      return { rows: result.rows as Array<Record<string, unknown>> };
    },
  };
  return {
    db,
    repository: new PostgresGoogleGmailMutationRepository(pool),
  };
}

async function inbound(
  db: PGlite,
  input: {
    messageId: string;
    organizationId: string;
    generation: number | null;
  },
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO google_workspace_gmail_mutations (
       connection_id, message_id, thread_id, organization_id, operation,
       idempotency_key, intent_generation
     ) VALUES ($1,$2,'thread-1',$3,'label_inbound_message',$2,$4)
     RETURNING id::text`,
    [connectionId, input.messageId, input.organizationId, input.generation],
  );
  return result.rows[0]!.id;
}

describe("PostgresGoogleGmailMutationRepository intent fencing", () => {
  it("allows a legacy inbound association only while no thread intent exists", async () => {
    const { db, repository } = await fixture();
    try {
      const id = await inbound(db, {
        messageId: "legacy-message",
        organizationId: organizationA,
        generation: null,
      });
      await expect(repository.claim(
        id,
        new Date("2026-09-08T15:00:00Z"),
      )).resolves.toMatchObject({
        id,
        operation: "label_inbound_message",
        state: "processing",
      });
    } finally {
      await db.close();
    }
  });

  it("blocks a legacy inbound association after Ignore creates an intent", async () => {
    const { db, repository } = await fixture();
    try {
      const id = await inbound(db, {
        messageId: "stale-message",
        organizationId: organizationA,
        generation: null,
      });
      await db.query(
        `INSERT INTO google_workspace_gmail_thread_intents (
           connection_id, thread_id, generation, intent_kind
         ) VALUES ($1,'thread-1',1,'ignore')`,
        [connectionId],
      );

      await expect(repository.claim(
        id,
        new Date("2026-09-08T15:00:00Z"),
      )).resolves.toBeNull();
    } finally {
      await db.close();
    }
  });

  it("adopts the current generation when Check emails reloads a legacy retry", async () => {
    const { db, repository } = await fixture();
    try {
      await db.query(
        `INSERT INTO google_workspace_gmail_thread_intents (
           connection_id, thread_id, generation, intent_kind, organization_id
         ) VALUES ($1,'thread-1',3,'assign',$2)`,
        [connectionId, organizationA],
      );
      await db.query(
        `INSERT INTO google_workspace_gmail_mutations (
           connection_id, message_id, thread_id, organization_id, operation,
           idempotency_key, state, intent_generation
         ) VALUES ($1,'legacy-retry','thread-1',$2,'label_inbound_message',
                   'legacy-retry-key','retryable_error',NULL)`,
        [connectionId, organizationA],
      );

      await expect(repository.createOrLoad({
        connectionId,
        messageId: "legacy-retry",
        threadId: "thread-1",
        organizationId: organizationA,
        operation: "label_inbound_message",
        idempotencyKey: "legacy-retry-key",
        actorId: null,
      })).resolves.toMatchObject({
        state: "retryable_error",
        intentGeneration: 3,
      });
    } finally {
      await db.close();
    }
  });

  it("adopts an expired legacy processing job when Check emails reloads it", async () => {
    const { db, repository } = await fixture();
    try {
      await db.query(
        `INSERT INTO google_workspace_gmail_thread_intents (
           connection_id, thread_id, generation, intent_kind, organization_id
         ) VALUES ($1,'thread-1',4,'assign',$2)`,
        [connectionId, organizationA],
      );
      await db.query(
        `INSERT INTO google_workspace_gmail_mutations (
           connection_id, message_id, thread_id, organization_id, operation,
           idempotency_key, state, intent_generation, processing_lease_expires_at
         ) VALUES ($1,'legacy-processing','thread-1',$2,'label_inbound_message',
                   'legacy-processing-key','processing',NULL,
                   '2026-09-08T14:59:00Z')`,
        [connectionId, organizationA],
      );

      const adopted = await repository.createOrLoad({
        connectionId,
        messageId: "legacy-processing",
        threadId: "thread-1",
        organizationId: organizationA,
        operation: "label_inbound_message",
        idempotencyKey: "legacy-processing-key",
        actorId: null,
      });
      expect(adopted).toMatchObject({
        state: "processing",
        intentGeneration: 4,
      });
      await expect(repository.claim(
        adopted.id,
        new Date("2026-09-08T15:00:00Z"),
      )).resolves.toMatchObject({
        state: "processing",
        intentGeneration: 4,
        attemptCount: 1,
      });
    } finally {
      await db.close();
    }
  });

  it("allows only inbound work matching the current profile generation", async () => {
    const { db, repository } = await fixture();
    try {
      await db.query(
        `INSERT INTO google_workspace_gmail_thread_intents (
           connection_id, thread_id, generation, intent_kind, organization_id
         ) VALUES ($1,'thread-1',2,'assign',$2)`,
        [connectionId, organizationB],
      );
      const stale = await inbound(db, {
        messageId: "stale-message",
        organizationId: organizationA,
        generation: 1,
      });
      const current = await inbound(db, {
        messageId: "current-message",
        organizationId: organizationB,
        generation: 2,
      });

      await expect(repository.claim(
        stale,
        new Date("2026-09-08T15:00:00Z"),
      )).resolves.toBeNull();
      await expect(repository.claim(
        current,
        new Date("2026-09-08T15:00:00Z"),
      )).resolves.toMatchObject({
        id: current,
        organizationId: organizationB,
        state: "processing",
      });
    } finally {
      await db.close();
    }
  });
});
