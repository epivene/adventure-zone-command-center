import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ConversationStore } from "./conversation-store";
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
