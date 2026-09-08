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
  });

  it("claims retryable work with a bounded lease", async () => {
    const repository = new PostgresGoogleGmailMutationRepository({
      async query(text: string) {
        expect(text).toContain("FOR UPDATE SKIP LOCKED");
        return { rows: [] };
      },
    });

    await repository.claim("mutation-1", new Date("2026-09-08T12:00:00Z"));
  });
});
