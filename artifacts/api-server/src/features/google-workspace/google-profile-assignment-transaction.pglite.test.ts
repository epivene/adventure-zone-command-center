import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { ensureGoogleWorkspaceSchema } from "../../db/google-workspace-startup-migration";
import { PostgresGoogleProfileAssignmentTransaction } from "./google-profile-assignment-transaction";

const connectionId = "20000000-0000-4000-8000-000000000001";
const organizationA = "10000000-0000-4000-8000-000000000001";
const organizationB = "10000000-0000-4000-8000-000000000002";

async function fixture(options?: { failMutation?: boolean }) {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE organizations (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      consolidated_into_id uuid
    );
    CREATE TABLE contacts (id uuid PRIMARY KEY);
  `);
  await ensureGoogleWorkspaceSchema(db as never);
  await db.exec(`
    INSERT INTO organizations(id, name) VALUES
      ('${organizationA}', 'First Profile'),
      ('${organizationB}', 'Second Profile');
    INSERT INTO google_workspace_connections(
      id, account_email, encrypted_refresh_token, granted_scopes
    ) VALUES (
      '${connectionId}', 'theadventurezone12@gmail.com', '{}'::jsonb, '[]'::jsonb
    );
    INSERT INTO google_workspace_validation_review_items(
      connection_id, message_id, thread_id, subject, from_header, to_header
    ) VALUES (
      '${connectionId}', 'message-1', 'thread-1', 'Subject',
      'sender@example.com', 'theadventurezone12@gmail.com'
    );
  `);
  const client = {
    query: async (text: string, values?: unknown[]) => {
      if (
        options?.failMutation &&
        text.includes("INSERT INTO google_workspace_gmail_mutations")
      ) throw Object.assign(new Error("forced mutation failure"), { code: "XX001" });
      return values === undefined
        ? db.query(text)
        : db.query(text, values as never[]);
    },
    release() {},
  };
  return {
    db,
    repository: new PostgresGoogleProfileAssignmentTransaction({
      connect: async () => client,
    }),
  };
}

function assignment(organizationId: string, now: string) {
  return {
    messageId: "message-1",
    organizationId,
    actorId: "owner-1",
    now: new Date(now),
  };
}

describe("PostgresGoogleProfileAssignmentTransaction", () => {
  it("uses one stable Gmail mutation for identical retries", async () => {
    const { db, repository } = await fixture();
    try {
      const first = await repository.resolveReview(
        assignment(organizationA, "2026-09-08T12:00:00Z"),
      );
      const second = await repository.resolveReview(
        assignment(organizationA, "2026-09-08T12:01:00Z"),
      );

      expect(second.mutation.id).toBe(first.mutation.id);
      const mutations = await db.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM google_workspace_gmail_mutations",
      );
      expect(mutations.rows[0]?.count).toBe("1");
      const mutation = await db.query<{ idempotency_key: string }>(
        "SELECT idempotency_key FROM google_workspace_gmail_mutations",
      );
      expect(mutation.rows[0]?.idempotency_key).toBe(
        `assign-thread:${connectionId}:thread-1:${organizationA}`,
      );
    } finally {
      await db.close();
    }
  });

  it("rolls back the CRM decision when mutation insertion fails", async () => {
    const { db, repository } = await fixture({ failMutation: true });
    try {
      await expect(repository.resolveReview(
        assignment(organizationA, "2026-09-08T12:00:00Z"),
      )).rejects.toMatchObject({ stage: "mutation", postgresCode: "XX001" });

      const review = await db.query<{ review_state: string }>(
        "SELECT review_state FROM google_workspace_validation_review_items",
      );
      expect(review.rows[0]?.review_state).toBe("pending");
      for (const table of [
        "google_workspace_validation_mappings",
        "google_workspace_audit_events",
        "google_workspace_gmail_mutations",
      ]) {
        const result = await db.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM ${table}`,
        );
        expect(result.rows[0]?.count).toBe("0");
      }
    } finally {
      await db.close();
    }
  });

  it("supersedes an older unfinished assignment to another profile", async () => {
    const { db, repository } = await fixture();
    try {
      await repository.resolveReview(
        assignment(organizationA, "2026-09-08T12:00:00Z"),
      );
      const current = await repository.resolveReview(
        assignment(organizationB, "2026-09-08T12:01:00Z"),
      );

      expect(current.organizationId).toBe(organizationB);
      const mutations = await db.query<{
        organization_id: string;
        state: string;
        last_error_code: string | null;
      }>(`
        SELECT organization_id::text, state, last_error_code
          FROM google_workspace_gmail_mutations
         ORDER BY created_at, organization_id
      `);
      expect(mutations.rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          organization_id: organizationA,
          state: "permanent_error",
          last_error_code: "GOOGLE_WORKSPACE_ASSIGNMENT_SUPERSEDED",
        }),
        expect.objectContaining({
          organization_id: organizationB,
          state: "pending",
        }),
      ]));
    } finally {
      await db.close();
    }
  });

  it("atomically upserts a corrected matched email", async () => {
    const { db, repository } = await fixture();
    try {
      const committed = await repository.assignMatched({
        ...assignment(organizationA, "2026-09-08T12:00:00Z"),
        messageId: "matched-message",
        threadId: "matched-thread",
        subject: "Fair",
        from: "fair@example.com",
        to: "theadventurezone12@gmail.com",
        internalDateMs: 1,
        hasAttachments: false,
      });

      expect(committed.mutation.idempotencyKey).toBe(
        `assign-thread:${connectionId}:matched-thread:${organizationA}`,
      );
      const review = await db.query<{ review_state: string }>(
        "SELECT review_state FROM google_workspace_validation_review_items WHERE message_id = 'matched-message'",
      );
      expect(review.rows[0]?.review_state).toBe("resolved");
    } finally {
      await db.close();
    }
  });
});
