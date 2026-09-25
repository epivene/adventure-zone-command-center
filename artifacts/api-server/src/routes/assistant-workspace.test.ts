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
it.each([
  ["record_invoice_payment", "payment_received"],
  ["confirm_signed_contract", "signatures_reviewed"],
])(
  "requires human verification before approving %s",
  async (kind, confirmation) => {
    const f = await fixture();
    const action = {
      id: "760b0ae0-76ca-4175-a018-5cbd41cbd156",
      kind,
      status: "prepared",
      targetId: "target",
      expectedRevision: "revision",
      conversationId: f.c.id,
      sourceMessageId: "source",
      connectionId: null,
    };
    f.runtime.actions = { get: async () => action };
    f.runtime.google.getCurrent = async () => {
      throw new Error("Google unavailable");
    };
    f.runtime.executor = { execute: vi.fn(async () => ({ status: "ok" })) };
    const send = (extra = {}) =>
      request(f.app)
        .post(`/actions/${action.id}/execute`)
        .set("Authorization", f.authorization)
        .send({ requestKey: "approval", revision: "revision", ...extra });
    expect((await send()).status).toBe(422);
    expect(f.runtime.executor.execute).not.toHaveBeenCalled();
    expect((await send({ confirmation })).status).toBe(200);
    expect(f.runtime.executor.execute).toHaveBeenCalledTimes(1);
    expect(
      (await f.runtime.conversations.get("owner", f.c.id)).messages.at(-1).text,
    ).toContain(`Human verification: ${confirmation}`);
  },
);

import { CampaignStore } from "../features/assistant-workspace/campaign-store";
import { drizzle } from "drizzle-orm/pglite";
import { randomUUID } from "node:crypto";
it("restores saved campaign membership and selected model without exposing provider checkpoints", async () => {
  const f = await fixture();
  f.runtime.config.models.push("alternate-model");
  const submitted = await request(f.app)
    .post(`/conversations/${f.c.id}/messages`)
    .set("Authorization", f.authorization)
    .send({
      requestKey: "campaign",
      text: "Save a campaign",
      model: "alternate-model",
    });
  const run = (await f.runs.get("owner", submitted.body.runId))!;
  f.runtime.campaigns = new CampaignStore(drizzle(database), database);
  const batch = await f.runtime.campaigns.create(
    { ...run.input, runId: run.id, signal: new AbortController().signal },
    run.input.sourceMessageId,
    {
      title: "Saved fair batch",
      eventYear: 2027,
      criteria: "Selected profiles",
      members: [
        { organizationId: randomUUID(), contactId: null, bookingId: null },
      ],
    },
  );
  f.runtime.actions = { list: async () => [] };
  f.runtime.drafts = { list: async () => [] };
  await database.query(
    "UPDATE assistant_workspace_runs SET checkpoint=jsonb_set(checkpoint,'{turn}',$2::jsonb) WHERE id=$1",
    [
      run.id,
      JSON.stringify({
        providerItems: [{ secret: "private-provider-state" }],
        results: {},
        steps: 1,
        tokens: 5,
      }),
    ],
  );
  const response = await request(f.app)
    .get(`/conversations/${f.c.id}`)
    .set("Authorization", f.authorization);
  expect(response.status).toBe(200);
  expect(response.body.selectedModel).toBe("alternate-model");
  expect(response.body.campaigns[0].id).toBe(batch.id);
  expect(response.body.campaigns[0].members).toHaveLength(1);
  expect(JSON.stringify(response.body)).not.toContain("private-provider-state");
});
