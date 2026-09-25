import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { selectionSchema, emptySelection } from "./contracts";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";

let db: PGlite;
let store: ConversationStore;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  store = new ConversationStore(db);
});
afterEach(async () => {
  await db.close();
});

it("rejects client-supplied authority", () => {
  expect(
    selectionSchema.safeParse({ ...emptySelection(), actorId: "other" })
      .success,
  ).toBe(false);
});
it("isolates conversations and writes by actor", async () => {
  const c = await store.create("owner-a", "Reply");
  expect(await store.get("owner-b", c.id)).toBeNull();
  await expect(
    store.append("owner-b", c.id, "r1", { role: "user", text: "overwrite" }),
  ).rejects.toThrow("ASSISTANT_CONVERSATION_NOT_FOUND");
  expect((await store.get("owner-a", c.id))?.messages).toEqual([]);
});
it("persists each request once and rejects conflicting replay", async () => {
  const c = await store.create("owner-a", "Reply");
  const first = await store.append("owner-a", c.id, "r1", {
    role: "user",
    text: "Review this",
  });
  const replay = await store.append("owner-a", c.id, "r1", {
    role: "user",
    text: "Review this",
  });
  expect(replay.id).toBe(first.id);
  await expect(
    store.append("owner-a", c.id, "r1", { role: "user", text: "Different" }),
  ).rejects.toThrow("ASSISTANT_REQUEST_CONFLICT");
  expect((await store.get("owner-a", c.id))?.messages).toHaveLength(1);
});
it("preserves ordered history across identical timestamps", async () => {
  const c = await store.create("a", "Review");
  await store.append("a", c.id, "u1", { role: "user", text: "Original" });
  await store.append("a", c.id, "a1", { role: "assistant", text: "Draft" });
  await store.append("a", c.id, "u2", { role: "user", text: "Make it warmer" });
  await db.query(
    "update assistant_workspace_messages set created_at = '2026-09-24T12:00:00Z'",
  );
  expect((await store.get("a", c.id))?.messages.map((m) => m.text)).toEqual([
    "Original",
    "Draft",
    "Make it warmer",
  ]);
});
it("rejects stale selection updates without retargeting work", async () => {
  const c = await store.create("a", "Review");
  await store.setSelection("a", c.id, c.version, {
    ...emptySelection(),
    eventYear: 2027,
  });
  await expect(
    store.setSelection("a", c.id, c.version, {
      ...emptySelection(),
      eventYear: 2028,
    }),
  ).rejects.toThrow("ASSISTANT_VERSION_CONFLICT");
  expect((await store.get("a", c.id))?.selection.eventYear).toBe(2027);
});
it("upgrades a missing optional column and remains repeatable", async () => {
  const c = await store.create("a", "Keep me");
  await db.query(
    "alter table assistant_workspace_conversations drop column summary",
  );
  await ensureAssistantWorkspaceSchema(db);
  await ensureAssistantWorkspaceSchema(db);
  expect((await store.get("a", c.id))?.title).toBe("Keep me");
});

it("bounds context through its owned source and retains originals across sequence gaps", async () => {
  const c = await store.create("a", "Long chat");
  const other = await store.create("a", "Other");
  let source = "";
  for (let n = 0; n < 34; n++) {
    source = (
      await store.append("a", c.id, `r${n}`, {
        role: "user",
        text: `${n}: ${"quoted ".repeat(220)}`,
      })
    ).id;
    await store.append("a", other.id, `r${n}`, {
      role: "user",
      text: "Unrelated",
    });
  }
  await store.append("a", c.id, "future", {
    role: "user",
    text: "Future correction",
  });
  const older = (await store.get("a", c.id))!.messages[4];
  const run = await new RunStore(db).enqueue({
    actor: { id: "a", role: "owner", connectionId: null },
    conversationId: c.id,
    requestKey: "r4",
    sourceMessageId: older.id,
    selection: { ...emptySelection(), eventYear: 2027 },
    grants: [],
  });
  await db.query(
    "UPDATE assistant_workspace_runs SET checkpoint=jsonb_set(checkpoint,'{turn}',$2::jsonb) WHERE id=$1",
    [
      run.id,
      JSON.stringify({ selection: { ...emptySelection(), eventYear: 2028 } }),
    ],
  );
  const saved = await store.context("a", c.id, source);
  expect(saved.turns).toHaveLength(6);
  expect(saved.turns.at(-1)?.text).toContain("33:");
  expect(saved.memory).toMatchObject({
    totalMessageCount: 34,
    omittedMessageCount: 4,
    recentMessageCount: 6,
  });
  expect(saved.memory.entries).toHaveLength(24);
  expect(saved.memory.entries[0]).toMatchObject({
    truncated: true,
    requestedScope: { eventYear: 2027 },
    resultScope: { eventYear: 2028 },
    runId: run.id,
  });
  expect(saved.memory.entries[1]).toMatchObject({
    requestedScope: null,
    resultScope: null,
  });
  expect(JSON.stringify(saved)).not.toContain("Future correction");
  await expect(store.context("b", c.id, source)).rejects.toThrow(
    "ASSISTANT_SOURCE_MESSAGE_MISSING",
  );
  await expect(store.context("a", other.id, source)).rejects.toThrow(
    "ASSISTANT_SOURCE_MESSAGE_MISSING",
  );
  expect((await store.get("a", c.id))?.messages).toHaveLength(35);
  const newer = await store.context(
    "a",
    c.id,
    (await store.get("a", c.id))!.messages.at(-1)!.id,
  );
  await store.saveSummary("a", c.id, newer.memory);
  await store.saveSummary("a", c.id, saved.memory);
  expect((await store.get("a", c.id))?.summary).toMatchObject({
    throughSequence: newer.sourceSequence,
  });
  const page = await store.history("a", c.id, source, { query: "quoted" });
  expect(page.messages).toHaveLength(3);
  expect(page.messages[0].id).toBe(source);
  const next = await store.history("a", c.id, source, {
    beforeSequence: page.nextBeforeSequence!,
  });
  expect(
    next.messages.some((m) => page.messages.some((p) => p.id === m.id)),
  ).toBe(false);
  expect(
    (await store.history("a", c.id, source, { query: "Future" })).messages,
  ).toEqual([]);
  await expect(store.history("b", c.id, source, {})).rejects.toThrow(
    "ASSISTANT_SOURCE_MESSAGE_MISSING",
  );
});
