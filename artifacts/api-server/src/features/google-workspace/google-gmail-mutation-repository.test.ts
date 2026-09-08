import { describe, expect, it } from "vitest";

import { PostgresGoogleGmailMutationRepository } from "./google-gmail-mutation-repository";

const row = {
  id: "mutation-1",
  connection_id: "conn-1",
  message_id: "message-1",
  thread_id: "thread-1",
  organization_id: "org-1",
  operation: "assign_thread",
  target_label_id: null,
  remove_label_ids: [],
  idempotency_key: "assign-thread:key",
  state: "pending",
  attempt_count: 0,
  intent_generation: 1,
  last_error_code: null,
};

describe("PostgresGoogleGmailMutationRepository", () => {
  it("creates or loads one immutable idempotency intent", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const repository = new PostgresGoogleGmailMutationRepository({
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [row] };
      },
    });

    await expect(repository.createOrLoad({
      connectionId: "conn-1",
      messageId: "message-1",
      threadId: "thread-1",
      organizationId: "org-1",
      operation: "assign_thread",
      idempotencyKey: "assign-thread:key",
      actorId: "owner-1",
    })).resolves.toMatchObject({
      id: "mutation-1",
      idempotencyKey: "assign-thread:key",
    });
    expect(queries[0]?.text).toContain("ON CONFLICT (idempotency_key)");
    expect(queries[0]?.text).toContain("intent_generation");
    expect(queries[0]?.text).toContain("intent.organization_id = $4");
  });

  it("never downgrades a completed mutation", async () => {
    const queries: string[] = [];
    const repository = new PostgresGoogleGmailMutationRepository({
      async query(text: string) {
        queries.push(text);
        return text.includes("UPDATE google_workspace_gmail_mutations")
          ? { rows: [] }
          : {
              rows: [{
                ...row,
                state: "completed",
                target_label_id: "Label_10",
              }],
            };
      },
    });

    await expect(repository.fail({
      id: "mutation-1",
      state: "retryable_error",
      errorCode: "GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED",
      nextAttemptAt: null,
      now: new Date("2026-09-08T12:00:00Z"),
    })).resolves.toMatchObject({
      state: "completed",
      targetLabelId: "Label_10",
    });

    expect(queries[0]).toContain("state <> 'completed'");
    expect(queries[0]).toContain("state IN ('pending','retryable_error')");
    expect(queries[0]).toContain("RETURNING");
    expect(queries[1]).toContain("SELECT id::text");
  });

  it("fences worker transitions by the claimed attempt", async () => {
    const queries: string[] = [];
    const repository = new PostgresGoogleGmailMutationRepository({
      async query(text: string) {
        queries.push(text);
        return { rows: [row] };
      },
    });

    await repository.complete({
      id: "mutation-1",
      expectedAttemptCount: 2,
      targetLabelId: "Label_10",
      removeLabelIds: ["INBOX"],
      now: new Date("2026-09-08T12:00:00Z"),
    });
    await repository.fail({
      id: "mutation-1",
      expectedAttemptCount: 2,
      state: "retryable_error",
      errorCode: "GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED",
      nextAttemptAt: null,
      now: new Date("2026-09-08T12:00:00Z"),
    });

    expect(queries[0]).toContain("state = 'processing'");
    expect(queries[0]).toContain("attempt_count = $5");
    expect(queries[1]).toContain("attempt_count = $6");
  });

  it("claims assignment work only when it is the current thread generation", async () => {
    const repository = new PostgresGoogleGmailMutationRepository({
      async query(text: string) {
        expect(text).toContain("FOR UPDATE OF candidate_mutation SKIP LOCKED");
        expect(text).toContain("google_workspace_gmail_thread_intents");
        expect(text).toContain("intent.organization_id = candidate_mutation.organization_id");
        expect(text).toContain("intent.current_mutation_id = candidate_mutation.id");
        expect(text).toContain("intent.generation = candidate_mutation.intent_generation");
        expect(text).toContain("candidate_mutation.operation = 'label_inbound_message'");
        expect(text).toContain("candidate_mutation.intent_generation IS NULL");
        expect(text).toContain("google_workspace_gmail_thread_intents any_intent");
        expect(text).not.toContain("pg_try_advisory_xact_lock");
        return { rows: [] };
      },
    });

    await repository.claim("mutation-1", new Date("2026-09-08T12:00:00Z"));
  });

  it("holds one session thread lock for the complete Gmail operation", async () => {
    const events: string[] = [];
    const repository = new PostgresGoogleGmailMutationRepository({
      async query() {
        return { rows: [] };
      },
      async connect() {
        return {
          async query(text: string) {
            events.push(text.includes("advisory_unlock") ? "unlock" : "lock");
            return { rows: [] };
          },
          release() {
            events.push("release");
          },
        };
      },
    });

    await repository.withThreadLock(
      { connectionId: "conn-1", threadId: "thread-1" },
      async () => {
        events.push("gmail");
      },
    );

    expect(events).toEqual(["lock", "gmail", "unlock", "release"]);
  });
});
