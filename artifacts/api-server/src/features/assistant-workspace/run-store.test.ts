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
it("reconciles an existing request without resubmitting and rejects changed text, screenshots or ownership", async () => {
  const c = await conversations.create("owner", "Recover request");
  const input = {
    actor: { id: "owner", role: "owner" as const, connectionId: null },
    conversationId: c.id,
    requestKey: "recover",
    selection: emptySelection(),
    grants: [],
  };
  const saved = await runs.submit(input, "Continue");
  expect(
    (await runs.findSubmitted("owner", c.id, "recover", "Continue"))?.id,
  ).toBe(saved.id);
  expect(
    await runs.findSubmitted("other", c.id, "recover", "Continue"),
  ).toBeNull();
  expect(await runs.findSubmitted("owner", c.id, "new", "Continue")).toBeNull();
  await expect(
    runs.findSubmitted("owner", c.id, "recover", "Different request"),
  ).rejects.toThrow("ASSISTANT_MESSAGE_CONFLICT");
  await expect(
    runs.findSubmitted("owner", c.id, "recover", "Continue", [
      {
        id: "changed",
        filename: "screen.png",
        contentType: "image/png",
        byteSize: 1,
        sha256: "sha",
      },
    ]),
  ).rejects.toThrow("ASSISTANT_MESSAGE_CONFLICT");
  expect(await runs.list("owner", c.id)).toHaveLength(1);
});
it("serializes new runs with archive and preserves completed run retries", async () => {
  const c = await conversations.create("owner", "Run lifecycle");
  const input = {
    actor: { id: "owner", role: "owner" as const, connectionId: null },
    conversationId: c.id,
    requestKey: "first",
    selection: emptySelection(),
    grants: [],
  };
  const run = await runs.submit(input, "First request");
  await expect(
    conversations.setLifecycle("owner", c.id, c.version, "archived"),
  ).rejects.toThrow("ASSISTANT_CONVERSATION_BUSY");
  const claimed = await runs.claim("worker");
  await expect(
    conversations.setLifecycle("owner", c.id, c.version, "trashed"),
  ).rejects.toThrow("ASSISTANT_CONVERSATION_BUSY");
  await runs.finish("owner", run.id, claimed!.leaseToken, "succeeded");
  await conversations.setLifecycle("owner", c.id, c.version, "archived");
  expect((await runs.submit(input, "First request")).id).toBe(run.id);
  await expect(
    runs.submit({ ...input, requestKey: "second" }, "Must not start"),
  ).rejects.toThrow("ASSISTANT_CONVERSATION_INACTIVE");
  expect((await conversations.get("owner", c.id))?.messages).toHaveLength(1);
  await expect(
    runs.enqueue({
      ...input,
      requestKey: "separate-run",
      sourceMessageId: run.input.sourceMessageId,
    }),
  ).rejects.toThrow("ASSISTANT_CONVERSATION_INACTIVE");
});
it("accepts only one side when archive and a run submission arrive together", async () => {
  const c = await conversations.create("owner", "Concurrent operations");
  const input = {
    actor: { id: "owner", role: "owner" as const, connectionId: null },
    conversationId: c.id,
    requestKey: "race",
    selection: emptySelection(),
    grants: [],
  };
  // PGlite serializes SQL statements. Exercise both arrival orders at the store
  // boundary; PostgreSQL's shared parent-row lock supplies cross-session ordering.
  const archiveFirst = await Promise.allSettled([
    conversations.setLifecycle("owner", c.id, c.version, "archived"),
    runs.submit(input, "Race with archive"),
  ]);
  expect(archiveFirst.map((result) => result.status)).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect((await conversations.get("owner", c.id))?.messages).toEqual([]);
  const restored = await conversations.setLifecycle(
    "owner",
    c.id,
    c.version + 1,
    "active",
  );
  const runFirst = await Promise.allSettled([
    runs.submit(input, "Race with archive"),
    conversations.setLifecycle("owner", c.id, restored.version, "archived"),
  ]);
  expect(runFirst.map((result) => result.status)).toEqual([
    "fulfilled",
    "rejected",
  ]);
  expect((await conversations.get("owner", c.id))?.lifecycle).toBe("active");
  expect(await runs.list("owner", c.id)).toHaveLength(1);
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
