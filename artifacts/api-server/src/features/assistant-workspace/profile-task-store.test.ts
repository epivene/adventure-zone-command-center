import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { emptySelection } from "./contracts";
import { ProfileTaskStore, countTaskItems } from "./profile-task-store";
let db: PGlite,
  store: ProfileTaskStore,
  conversationId: string,
  sourceMessageId: string;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  conversationId = (
    await new ConversationStore(db).create("owner", "Task test")
  ).id;
  const run = await new RunStore(db).submit(
    {
      actor: { id: "owner", role: "owner", connectionId: null },
      conversationId,
      requestKey: "request",
      selection: emptySelection(),
      grants: [],
    },
    "Research and save notes",
  );
  sourceMessageId = run.input.sourceMessageId;
  store = new ProfileTaskStore(db);
});
afterEach(async () => db.close());
function input() {
  const profileIds = Array.from({ length: 120 }, () => randomUUID());
  return {
    scope: {
      profileIds,
      eventYear: 2027,
      objective: "Research and save sourced notes",
      requestedFields: [],
      taskCapUsd: null,
    },
    authority: {
      sourceMessageId,
      actionKinds: ["add_profile_note"],
      allowedFields: [],
      profileIds,
    },
  };
}
it("freezes 120 members, reconciles duplicate creation, and isolates owners", async () => {
  const { scope, authority } = input();
  const task = await store.create(
    "owner",
    conversationId,
    "job",
    scope,
    authority,
  );
  expect(task.counts).toEqual({
    total: 120,
    completed: 0,
    needsReview: 0,
    failed: 0,
    remaining: 120,
  });
  expect(new Set(task.items.map((i) => i.profileId)).size).toBe(120);
  expect(
    (await store.create("owner", conversationId, "job", scope, authority)).id,
  ).toBe(task.id);
  await expect(
    store.create(
      "owner",
      conversationId,
      "job",
      { ...scope, objective: "different" },
      authority,
    ),
  ).rejects.toThrow("ASSISTANT_TASK_CONFLICT");
  expect(await store.get("other", task.id)).toBeNull();
  await expect(
    store.create("other", conversationId, "foreign", scope, authority),
  ).rejects.toThrow("ASSISTANT_ACCESS_DENIED");
});
it("rejects stale transitions and retains all skipped items in counts", async () => {
  const { scope, authority } = input();
  const task = await store.create(
    "owner",
    conversationId,
    "job",
    scope,
    authority,
  );
  const started = await store.command("owner", task.id, task.version, "resume");
  expect(started.state).toBe("running");
  await expect(
    store.command("owner", task.id, task.version, "cancel"),
  ).rejects.toThrow("ASSISTANT_TASK_CONFLICT");
  const skipped = await store.command(
    "owner",
    task.id,
    started.version,
    "skip",
    [task.items[0].id],
  );
  expect(skipped.counts).toEqual({
    total: 120,
    completed: 0,
    needsReview: 1,
    failed: 0,
    remaining: 119,
  });
  const stopped = await store.command(
    "owner",
    task.id,
    skipped.version,
    "cancel",
  );
  await expect(
    store.command("owner", task.id, stopped.version, "resume"),
  ).rejects.toThrow("ASSISTANT_TASK_TERMINAL");
});
it("counts completed, unresolved, failed and remaining as disjoint sets", () => {
  const items = [
    ...Array(80).fill({ state: "completed" }),
    ...Array(10).fill({ state: "needs_review" }),
    ...Array(5).fill({ state: "failed" }),
    ...Array(25).fill({ state: "awaiting_review" }),
  ];
  expect(countTaskItems(items)).toEqual({
    total: 120,
    completed: 80,
    needsReview: 10,
    failed: 5,
    remaining: 25,
  });
});
it("preserves task and conversation records when migration is repeated", async () => {
  const { scope, authority } = input();
  const task = await store.create(
    "owner",
    conversationId,
    "job",
    scope,
    authority,
  );
  await ensureAssistantWorkspaceSchema(db);
  expect((await store.get("owner", task.id))?.items).toHaveLength(120);
  expect(
    (await new ConversationStore(db).get("owner", conversationId))?.messages,
  ).toHaveLength(1);
});

it("reconciles a duplicate command key but rejects changed payload", async () => {
  const { scope, authority } = input();
  const t = await store.create(
    "owner",
    conversationId,
    "job",
    scope,
    authority,
  );
  const first = await store.command(
    "owner",
    t.id,
    t.version,
    "resume",
    [],
    "resume-once",
  );
  expect(
    (await store.command("owner", t.id, t.version, "resume", [], "resume-once"))
      .version,
  ).toBe(first.version);
  await expect(
    store.command("owner", t.id, t.version, "cancel", [], "resume-once"),
  ).rejects.toThrow("ASSISTANT_TASK_CONFLICT");
});
