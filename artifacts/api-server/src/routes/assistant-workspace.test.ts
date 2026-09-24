import { it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { messageInput } from "../features/assistant-workspace/http-schema";
import { createAssistantWorkspaceRouter } from "./assistant-workspace";
it("rejects actor spoofing", () => {
  expect(
    messageInput.safeParse({
      requestKey: "m",
      text: "Review",
      actorId: "other",
    }).success,
  ).toBe(false);
});
it("denies unauthenticated requests before constructing providers", async () => {
  const runtime = vi.fn();
  const app = express();
  app.use(express.json());
  app.use(createAssistantWorkspaceRouter(runtime));
  expect((await request(app).get("/status")).status).toBe(401);
  expect(runtime).not.toHaveBeenCalled();
});

import { beforeEach, afterEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../db/assistant-workspace-startup-migration";
import { ConversationStore } from "../features/assistant-workspace/conversation-store";
import { RunStore } from "../features/assistant-workspace/run-store";
import { issueToken } from "../lib/auth";
let database: PGlite;
let priorEnv: NodeJS.ProcessEnv;
beforeEach(() => {
  priorEnv = { ...process.env };
});
afterEach(async () => {
  process.env = priorEnv;
  if (database) await database.close();
});
async function fixture() {
  process.env.SESSION_SECRET = "assistant-test-session-secret";
  process.env.OWNER_PASSWORD = "test";
  process.env.ASSISTANT_WORKSPACE_ENABLED = "true";
  process.env.ASSISTANT_WORKSPACE_ACTOR_IDS = "owner";
  process.env.ASSISTANT_OPENAI_MODEL = "configured-model";
  process.env.OPENAI_API_KEY = "fake-key";
  database = new PGlite();
  await ensureAssistantWorkspaceSchema(database);
  const conversations = new ConversationStore(database),
    runs = new RunStore(database);
  const c = await conversations.create("owner", "Saved work");
  const runtime: any = {
    conversations,
    runs,
    config: { models: ["configured-model"], model: "configured-model" },
    google: { getCurrent: async () => null },
    worker: { tick: vi.fn().mockResolvedValue(undefined), cancel: vi.fn() },
  };
  const app = express();
  app.use(express.json());
  app.use(createAssistantWorkspaceRouter(() => runtime));
  const authorization = `Bearer ${issueToken()!.token}`;
  return { app, authorization, c, runs, runtime };
}
it("persists one run for duplicate submissions and rejects extra authority fields", async () => {
  const f = await fixture();
  const body = {
    requestKey: "same-key",
    text: "Review history",
    model: "configured-model",
  };
  const first = await request(f.app)
    .post(`/conversations/${f.c.id}/messages`)
    .set("Authorization", f.authorization)
    .send(body);
  const retry = await request(f.app)
    .post(`/conversations/${f.c.id}/messages`)
    .set("Authorization", f.authorization)
    .send(body);
  expect(first.status).toBe(202);
  expect(retry.body.runId).toBe(first.body.runId);
  expect(
    (
      await request(f.app)
        .post(`/conversations/${f.c.id}/messages`)
        .set("Authorization", f.authorization)
        .send({ ...body, actorId: "other" })
    ).status,
  ).toBe(422);
  const cancel = await request(f.app)
    .post(`/runs/${first.body.runId}/cancel`)
    .set("Authorization", f.authorization)
    .send({});
  expect(cancel.status).toBe(200);
  expect((await f.runs.get("owner", first.body.runId))?.cancelRequested).toBe(
    true,
  );
});
it("replays only progress after the supplied sequence without exposing model reasoning", async () => {
  const f = await fixture();
  const submitted = await request(f.app)
    .post(`/conversations/${f.c.id}/messages`)
    .set("Authorization", f.authorization)
    .send({ requestKey: "events", text: "Read history" });
  const claim = await f.runs.claim("worker");
  await f.runs.event("owner", claim!.id, claim!.leaseToken, "progress", {
    text: "Reading sources",
  });
  await f.runs.event("owner", claim!.id, claim!.leaseToken, "tool", {
    name: "read_email_thread",
    status: "ok",
  });
  const events = await f.runs.events("owner", claim!.id, 0);
  const response = await request(f.app)
    .get(`/runs/${submitted.body.runId}/events?after=${events[0].sequence}`)
    .set("Authorization", f.authorization)
    .set("Accept", "text/event-stream");
  expect(response.status).toBe(200);
  expect(response.text).toContain("read_email_thread");
  expect(response.text).not.toContain("Reading sources");
  expect(response.text).not.toContain("providerItems");
});
it("keeps disabled and unallowlisted access away from runtime data", async () => {
  const f = await fixture();
  process.env.ASSISTANT_WORKSPACE_ENABLED = "false";
  expect(
    (
      await request(f.app)
        .get("/conversations")
        .set("Authorization", f.authorization)
    ).status,
  ).toBe(503);
  process.env.ASSISTANT_WORKSPACE_ENABLED = "true";
  process.env.ASSISTANT_WORKSPACE_ACTOR_IDS = "someone-else";
  expect(
    (
      await request(f.app)
        .get("/conversations")
        .set("Authorization", f.authorization)
    ).status,
  ).toBe(403);
});
