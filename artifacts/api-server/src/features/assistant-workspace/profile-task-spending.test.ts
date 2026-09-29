import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { SpendingStore, type SpendingScope } from "./spending-store";

let db: PGlite;
let store: SpendingStore;
let scope: SpendingScope;
let now: Date;
let taskId: string;
const nanos = (usd: number) => Math.round(usd * 1_000_000_000);
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  now = new Date("2026-09-26T12:00:00Z");
  store = new SpendingStore(drizzle(db), db, () => now);
  const conversations = new ConversationStore(db);
  const conversation = await conversations.create("owner", "Budget test");
  const message = await conversations.append(
    "owner",
    conversation.id,
    "source",
    {
      role: "user",
      text: "Help me research",
    },
  );
  const runId = randomUUID();
  await db.query(
    `INSERT INTO assistant_workspace_runs(id,conversation_id,actor_id,request_key,source_message_id,status)
    VALUES($1,$2,'owner','run',$3,'running')`,
    [runId, conversation.id, message.id],
  );
  taskId = randomUUID();
  await db.query(
    `INSERT INTO assistant_profile_tasks(id,actor_id,conversation_id,source_message_id,request_key,scope,authority,state) VALUES($1,'owner',$2,$3,'task',$4::jsonb,'{}','running')`,
    [taskId, conversation.id, message.id, JSON.stringify({ taskCapUsd: 0.5 })],
  );
  await db.query(
    "INSERT INTO assistant_profile_task_runs(task_id,run_id,batch_number,item_ids) VALUES($1,$2,1,$3::jsonb)",
    [taskId, runId, "[]"],
  );
  scope = {
    actorId: "owner",
    conversationId: conversation.id,
    runId,
    callId: `assistant:${runId}:1`,
    source: "assistant",
    model: "gpt-6-luna",
  };
}, 30000);
afterEach(async () => {
  if (db && !db.closed) await db.close();
});

it("shares the task cap across paid paths and keeps uncertain holds across rollover", async () => {
  await store.reserve(scope, nanos(0.3));
  await store.settle("owner", scope.callId, null);
  now = new Date("2026-10-01T00:01:00Z");
  await expect(
    store.reserve(
      { ...scope, callId: "document-next", source: "document" },
      nanos(0.3),
    ),
  ).rejects.toThrow("ASSISTANT_BUDGET_LIMIT");
  await store.reserve(
    { ...scope, callId: "research-next", source: "research" },
    nanos(0.2),
  );
  expect((await store.summary("owner")).reservedUsd).toBe(0.5);
});
it("settles an in-flight call after pause but blocks any next reservation", async () => {
  await store.reserve(scope, nanos(0.3));
  await db.query(
    "UPDATE assistant_profile_tasks SET state='paused' WHERE id=$1",
    [taskId],
  );
  await store.settle("owner", scope.callId, nanos(0.2));
  await expect(
    store.reserve({ ...scope, callId: "next" }, nanos(0.1)),
  ).rejects.toThrow("ASSISTANT_TASK_PAUSED");
  expect((await store.summary("owner")).spentUsd).toBe(0.2);
  now = new Date("2026-10-01T00:01:00Z");
  await expect(
    store.reserve({ ...scope, callId: "rollover" }, nanos(0.1)),
  ).rejects.toThrow("ASSISTANT_TASK_PAUSED");
});
it("serializes competing reservations within the task cap", async () => {
  const r = await Promise.allSettled([
    store.reserve(scope, nanos(0.3)),
    store.reserve({ ...scope, callId: "two" }, nanos(0.3)),
  ]);
  expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
});
