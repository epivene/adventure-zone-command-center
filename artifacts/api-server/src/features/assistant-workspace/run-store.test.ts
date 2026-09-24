import { it, expect, beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { emptySelection } from "./contracts";
let db: PGlite, conversations: ConversationStore, runs: RunStore;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  conversations = new ConversationStore(db);
  runs = new RunStore(db);
});
afterEach(async () => {
  await db.close();
});
it("deduplicates submissions and fences worker claims", async () => {
  const c = await conversations.create("owner", "Test");
  const m = await conversations.append("owner", c.id, "request", {
    role: "user",
    text: "Read history",
  });
  const input = {
    actor: { id: "owner", role: "owner" as const, connectionId: null },
    conversationId: c.id,
    sourceMessageId: m.id,
    requestKey: "request",
    selection: emptySelection(),
    grants: [],
  };
  const a = await runs.enqueue(input);
  expect((await runs.enqueue(input)).id).toBe(a.id);
  expect(await runs.get("other", a.id)).toBeNull();
  const claim = await runs.claim("worker");
  expect(claim?.id).toBe(a.id);
  expect(await runs.claim("another")).toBeNull();
  await expect(runs.save("owner", a.id, 0, {} as any)).rejects.toThrow(
    "ASSISTANT_LEASE_LOST",
  );
});
it("cancellation remains durable and events are actor scoped", async () => {
  const c = await conversations.create("owner", "Test");
  const m = await conversations.append("owner", c.id, "r", {
    role: "user",
    text: "Read",
  });
  const r = await runs.enqueue({
    actor: { id: "owner", role: "owner", connectionId: null },
    conversationId: c.id,
    sourceMessageId: m.id,
    requestKey: "r",
    selection: emptySelection(),
    grants: [],
  });
  const lease = await runs.claim("w");
  await runs.cancel("owner", r.id);
  await expect(runs.check("owner", r.id, lease!.leaseToken)).rejects.toThrow(
    "ASSISTANT_CANCELLED",
  );
  expect(await runs.events("other", r.id, 0)).toEqual([]);
});

it("rolls back a rejected concurrent message with its run and deduplicates retries", async () => {
  const c = await conversations.create("owner", "Atomic");
  const input = {
    actor: { id: "owner", role: "owner" as const, connectionId: null },
    conversationId: c.id,
    requestKey: "first",
    selection: emptySelection(),
    grants: [],
  };
  const first = await runs.submit(input, "First request");
  expect((await runs.submit(input, "First request")).id).toBe(first.id);
  await expect(
    runs.submit({ ...input, requestKey: "second" }, "Rejected request"),
  ).rejects.toThrow();
  expect(
    (await conversations.get("owner", c.id))?.messages.map((m) => m.text),
  ).toEqual(["First request"]);
  await expect(runs.submit(input, "Changed request")).rejects.toThrow(
    "ASSISTANT_MESSAGE_CONFLICT",
  );
});
