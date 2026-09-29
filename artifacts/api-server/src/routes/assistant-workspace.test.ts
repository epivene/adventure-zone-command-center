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
it("accepts image-only questions but rejects empty or duplicate-image submissions", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  expect(
    messageInput.safeParse({ requestKey: "s", text: "", attachmentIds: [id] })
      .success,
  ).toBe(true);
  expect(
    messageInput.safeParse({ requestKey: "s", text: "", attachmentIds: [] })
      .success,
  ).toBe(false);
  expect(
    messageInput.safeParse({
      requestKey: "s",
      text: "Review",
      attachmentIds: [id, id],
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
  if (database && !database.closed) await database.close();
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
  app.use(
    createAssistantWorkspaceRouter(() => runtime, { startup: () => "ready" }),
  );
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

it("keeps owner setup status available while disabled and never constructs a runtime", async () => {
  process.env.SESSION_SECRET = "setup-status-test-secret";
  process.env.OWNER_PASSWORD = "test";
  process.env.ASSISTANT_WORKSPACE_ENABLED = "false";
  const app = express();
  app.use(
    createAssistantWorkspaceRouter(
      () => {
        throw new Error("must not construct providers");
      },
      {
        readiness: async (actor) => ({
          enabled: false,
          ready: false,
          model: null,
          models: [],
          error: null,
          maxSteps: 12,
          maxRunTokens: 100000,
          providerVerification: "not_checked",
          checks: [
            {
              id: "owner",
              label: "Owner access",
              state: actor === "owner" ? "ready" : "needs_setup",
              required: true,
              message: "Owner check",
            },
          ],
        }),
      },
    ),
  );
  const response = await request(app)
    .get("/status")
    .set("Authorization", `Bearer ${issueToken()!.token}`);
  expect(response.status).toBe(200);
  expect(response.body.ready).toBe(false);
  expect(response.body.checks[0].state).toBe("ready");
});
it("rejects conversation access when initialization failed before constructing runtime", async () => {
  await fixture();
  const app = express();
  app.use(
    createAssistantWorkspaceRouter(
      () => {
        throw new Error("must not construct runtime");
      },
      { startup: () => "failed" },
    ),
  );
  const response = await request(app)
    .get("/conversations")
    .set("Authorization", `Bearer ${issueToken()!.token}`);
  expect(response.status).toBe(503);
  expect(response.body.code).toBe("ASSISTANT_STARTUP_REQUIRED");
});
it("uploads and reads private binary screenshots behind owner gates, then binds canonical metadata to messages", async () => {
  const { ScreenshotStore } =
    await import("../features/assistant-workspace/screenshots");
  const f = await fixture();
  const objects = new Map<string, Uint8Array>();
  f.runtime.screenshots = new ScreenshotStore(database, () => ({
    put: async (key, bytes) => {
      objects.set(key, bytes);
    },
    get: async (key) => objects.get(key)!,
  }));
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const path = `/conversations/${f.c.id}/screenshots/${id}`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
    "base64",
  );
  expect(
    (await request(f.app).put(path).set("Content-Type", "image/png").send(png))
      .status,
  ).toBe(401);
  const upload = await request(f.app)
    .put(path)
    .set("Authorization", f.authorization)
    .set("Content-Type", "image/png")
    .set("X-File-Name", "screenshot.png")
    .send(png);
  expect(upload.status).toBe(201);
  expect(upload.body).not.toHaveProperty("objectKey");
  expect((await request(f.app).get(path)).status).toBe(401);
  const read = await request(f.app)
    .get(path)
    .set("Authorization", f.authorization);
  expect(read.status).toBe(200);
  expect(read.headers["cache-control"]).toBe("private, no-store");
  expect(read.body).toEqual(png);
  const sent = await request(f.app)
    .post(`/conversations/${f.c.id}/messages`)
    .set("Authorization", f.authorization)
    .send({ requestKey: "screenshot", text: "", attachmentIds: [id] });
  expect(sent.status).toBe(202);
  expect(
    (await f.runtime.conversations.get("owner", f.c.id)).messages[0]
      .attachments,
  ).toEqual([upload.body]);
  const other = await f.runtime.conversations.create("owner", "Other");
  const foreign = await request(f.app)
    .post(`/conversations/${other.id}/messages`)
    .set("Authorization", f.authorization)
    .send({ requestKey: "foreign-image", text: "", attachmentIds: [id] });
  expect(foreign.status).toBe(404);
  const oversized = await request(f.app)
    .put(path)
    .set("Authorization", f.authorization)
    .set("Content-Type", "image/png")
    .send(Buffer.alloc(5 * 1024 * 1024 + 1));
  expect(oversized.status).toBe(413);
  expect(oversized.body.code).toBe("ASSISTANT_SCREENSHOT_SIZE_INVALID");
  const invalid = await request(f.app)
    .put(path)
    .set("Authorization", f.authorization)
    .set("Content-Type", "image/svg+xml")
    .send("<svg/>");
  expect(invalid.status).toBe(422);
  process.env.ASSISTANT_WORKSPACE_ENABLED = "false";
  expect(
    (await request(f.app).get(path).set("Authorization", f.authorization))
      .status,
  ).toBe(503);
});

it("saves manual edits without an AI run and invalidates the old Gmail revision", async () => {
  const { DraftStore } =
    await import("../features/assistant-workspace/draft-store");
  const f = await fixture();
  f.runtime.drafts = new DraftStore(database);
  const draft = await f.runtime.drafts.create("owner", f.c.id, {
    to: ["janet@example.test"],
    cc: [],
    subject: "Deposit",
    html: "<p>Original</p>",
    text: "Original",
    threadId: "thread-one",
    attachmentHashes: [],
    attachmentIds: [],
    organizationId: null,
    templateId: null,
    templateVersion: "1",
  });
  await f.runtime.drafts.claimSave(
    "owner",
    draft.id,
    draft.revision,
    "connection",
  );
  await f.runtime.drafts.saved(
    "owner",
    draft.id,
    draft.revision,
    "gmail-existing",
    "original-hash",
  );
  const response = await request(f.app)
    .patch(`/drafts/${draft.id}`)
    .set("Authorization", f.authorization)
    .send({
      revision: draft.revision,
      subject: "Quick check",
      html: "<p>Has the check been sent?</p>",
      text: "Has the check been sent?",
    });
  expect(response.status).toBe(200);
  expect(response.body.status).toBe("local");
  expect(response.body.gmailDraftId).toBe("gmail-existing");
  expect(response.body.content.to).toEqual(["janet@example.test"]);
  expect(response.body.content.threadId).toBe("thread-one");
  expect(response.body.revision).not.toBe(draft.revision);
  expect(f.runtime.worker.tick).not.toHaveBeenCalled();
  await expect(
    f.runtime.drafts.claimSend("owner", draft.id, draft.revision),
  ).rejects.toThrow("ASSISTANT_DRAFT_VERSION_CONFLICT");
  const stale = await request(f.app)
    .patch(`/drafts/${draft.id}`)
    .set("Authorization", f.authorization)
    .send({
      revision: draft.revision,
      subject: "Stale",
      html: "<p>Old</p>",
      text: "Old",
    });
  expect(stale.status).toBe(409);
  const extra = await request(f.app)
    .patch(`/drafts/${draft.id}`)
    .set("Authorization", f.authorization)
    .send({
      revision: response.body.revision,
      subject: "Change recipient",
      html: "<p>Old</p>",
      text: "Old",
      to: ["other@example.test"],
    });
  expect(extra.status).toBe(422);
});

import { meterOpenAiResponse } from "../features/assistant-workspace/usage-cost";
it("exposes persisted estimates and totals every conversation run beyond the recent-run window", async () => {
  const f = await fixture();
  f.runtime.actions = { list: async () => [] };
  f.runtime.drafts = { list: async () => [] };
  const submitted = await request(f.app)
    .post(`/conversations/${f.c.id}/messages`)
    .set("Authorization", f.authorization)
    .send({ requestKey: "cost-0", text: "Review" });
  const costCall = meterOpenAiResponse(
    {
      id: "private-provider-id",
      model: "gpt-6-sol",
      service_tier: "default",
      status: "completed",
      usage: {
        input_tokens: 100,
        output_tokens: 10,
        input_tokens_details: { cached_tokens: 40, cache_write_tokens: 20 },
      },
    },
    "assistant",
  );
  await database.query(
    "UPDATE assistant_workspace_runs SET status='succeeded', checkpoint=jsonb_set(checkpoint,'{turn}',$2::jsonb) WHERE id=$1",
    [
      submitted.body.runId,
      JSON.stringify({
        steps: 1,
        tokens: 110,
        results: {},
        cost: { calls: { one: costCall }, excluded: [] },
        final: { status: "succeeded", text: "Done", receipts: [] },
      }),
    ],
  );
  await database.query(
    "INSERT INTO assistant_workspace_runs(conversation_id,actor_id,request_key,source_message_id,status,checkpoint) SELECT conversation_id,actor_id,'cost-' || n,source_message_id,status,checkpoint FROM assistant_workspace_runs CROSS JOIN generate_series(1,31) n WHERE id=$1",
    [submitted.body.runId],
  );
  const read = await request(f.app)
    .get(`/conversations/${f.c.id}`)
    .set("Authorization", f.authorization);
  expect(read.status).toBe(200);
  expect(read.body.runs).toHaveLength(30);
  expect(read.body.usage.cost).toMatchObject({
    estimatedUsd: 0.007616,
    status: "complete",
    pricedCalls: 32,
  });
  expect(read.body.runs[0].usage.cost).toMatchObject({
    estimatedUsd: 0.000238,
    status: "complete",
  });
  expect(JSON.stringify(read.body)).not.toContain("private-provider-id");
  const single = await request(f.app)
    .get(`/runs/${submitted.body.runId}`)
    .set("Authorization", f.authorization);
  expect(single.body.usage.cost).toMatchObject({
    estimatedUsd: 0.000238,
    status: "complete",
  });
  await database.query(
    "UPDATE assistant_workspace_runs SET checkpoint=checkpoint-'turn' WHERE id=$1",
    [submitted.body.runId],
  );
  const legacy = await request(f.app)
    .get(`/conversations/${f.c.id}`)
    .set("Authorization", f.authorization);
  expect(legacy.body.usage.cost).toMatchObject({
    estimatedUsd: 0.007378,
    status: "partial",
    pricedCalls: 31,
  });
});

it("organizes conversation history with validated filters, version conflicts and restore", async () => {
  const f = await fixture();
  const patch = (body: Record<string, unknown>, id = f.c.id) => request(f.app).patch(`/conversations/${id}/lifecycle`).set("Authorization", f.authorization).send(body);
  const archived = await patch({ version: f.c.version, lifecycle: "archived" });
  expect(archived.status).toBe(200);
  expect(archived.body.lifecycle).toBe("archived");
  expect((await request(f.app).get("/conversations").set("Authorization", f.authorization)).body).toEqual([]);
  const list = await request(f.app).get("/conversations?lifecycle=archived").set("Authorization", f.authorization);
  expect(list.body.map((item: any) => item.id)).toEqual([f.c.id]);
  expect((await request(f.app).get("/conversations?lifecycle=all").set("Authorization", f.authorization)).status).toBe(422);
  expect((await patch({ version: f.c.version, lifecycle: "trashed" })).status).toBe(409);
  expect((await patch({ version: archived.body.version, lifecycle: "trashed", actorId: "other" })).status).toBe(422);
  const other = await f.runtime.conversations.create("other", "Other owner");
  expect((await patch({ version: other.version, lifecycle: "trashed" }, other.id)).status).toBe(404);
  const blocked = await request(f.app).post(`/conversations/${f.c.id}/messages`).set("Authorization", f.authorization).send({ requestKey: "archived-write", text: "Do new work" });
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe("ASSISTANT_CONVERSATION_INACTIVE");
  expect((await patch({ version: archived.body.version, lifecycle: "active" })).status).toBe(200);
  const submitted = await request(f.app).post(`/conversations/${f.c.id}/messages`).set("Authorization", f.authorization).send({ requestKey: "active-write", text: "Do new work" });
  expect(submitted.status).toBe(202);
  const busy = await patch({ version: archived.body.version + 1, lifecycle: "trashed" });
  expect(busy.status).toBe(409);
  expect(busy.body.code).toBe("ASSISTANT_CONVERSATION_BUSY");
});

it("rejects inactive draft edits and returns a completed action receipt without new approval", async () => {
  const f = await fixture();
  const { DraftStore } = await import("../features/assistant-workspace/draft-store");
  const { ActionStore } = await import("../features/assistant-workspace/action-store");
  const { ActionExecutor } = await import("../features/assistant-workspace/action-executor");
  const { randomUUID } = await import("node:crypto");
  f.runtime.drafts = new DraftStore(database);
  f.runtime.actions = new ActionStore(database);
  const draft = await f.runtime.drafts.create("owner", f.c.id, { to: ["a@example.test"], cc: [], subject: "Saved", html: "<p>Saved</p>", text: "Saved", threadId: null, attachmentHashes: [], attachmentIds: [], organizationId: null, templateId: null, templateVersion: null });
  const source = await f.runtime.conversations.append("owner", f.c.id, "original", { role: "user", text: "Create a note" });
  const intent = { id: randomUUID(), actorId: "owner", conversationId: f.c.id, kind: "add_profile_note", targetId: randomUUID(), expectedRevision: null, connectionId: null, arguments: { body: "Saved" }, sourceMessageId: source.id };
  const action = await f.runtime.actions.prepare(intent);
  const claim = await f.runtime.actions.claim("owner", action.id, "worker");
  const receipt = { status: "ok", data: { id: "note" }, receipts: [{ id: "note" }], evidence: [], code: null };
  await f.runtime.actions.checkpoint("owner", action.id, claim.leaseToken, "succeeded", receipt);
  const apply = vi.fn();
  f.runtime.executor = new ActionExecutor("owner", f.runtime.actions, { add_profile_note: { validate: vi.fn(), apply } });
  await f.runtime.conversations.setLifecycle("owner", f.c.id, f.c.version, "trashed");
  const edit = await request(f.app).patch(`/drafts/${draft.id}`).set("Authorization", f.authorization).send({ revision: draft.revision, subject: "Changed", html: "<p>Changed</p>", text: "Changed" });
  expect(edit.status).toBe(409);
  expect(edit.body.code).toBe("ASSISTANT_CONVERSATION_INACTIVE");
  const result = await request(f.app).post(`/actions/${action.id}/execute`).set("Authorization", f.authorization).send({ requestKey: "check-result-after-trash", revision: null });
  expect(result.status).toBe(200);
  expect(result.body).toEqual(receipt);
  expect(apply).not.toHaveBeenCalled();
  expect((await f.runtime.conversations.get("owner", f.c.id)).messages).toHaveLength(1);
});
