import { it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { DraftStore } from "./draft-store";
import { createWorkspaceSendService } from "./gmail-send";
import { ActionStore } from "./action-store";
import { ActionExecutor } from "./action-executor";
import {
  emptySelection,
  type RunContext,
  type ActionIntent,
} from "./contracts";
let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  await db.exec(
    `CREATE TABLE contacts(id uuid,email text);CREATE TABLE organization_contacts(organization_id uuid,contact_id uuid,active boolean);CREATE TABLE outreach_dispatches(id uuid,draft_kind text,draft_id uuid,state text,payload jsonb,confirmation jsonb,created_at timestamptz DEFAULT now());`,
  );
});
afterEach(async () => {
  await db.close();
});
async function setup() {
  const org = randomUUID(),
    contact = randomUUID();
  await db.query(`INSERT INTO contacts VALUES($1,'recipient@example.test')`, [
    contact,
  ]);
  await db.query(`INSERT INTO organization_contacts VALUES($1,$2,true)`, [
    org,
    contact,
  ]);
  const conversations = new ConversationStore(db),
    drafts = new DraftStore(db),
    actions = new ActionStore(db);
  const c = await conversations.create("owner", "Reply");
  const source = await conversations.append("owner", c.id, "request", {
    role: "user",
    text: "Send this approved reply",
  });
  const draft = await drafts.create("owner", c.id, {
    to: ["recipient@example.test"],
    cc: [],
    subject: "Reply",
    html: "<p>Hello</p>",
    text: "Hello",
    threadId: "thread",
    attachmentHashes: [],
    attachmentIds: [],
    organizationId: org,
    templateId: null,
    templateVersion: null,
  });
  const raw = Buffer.from(
    "To: recipient@example.test\r\nSubject: Reply\r\nMessage-ID: " +
      draft.messageId +
      "\r\n\r\nHello",
  ).toString("base64url");
  await drafts.claimSave("owner", draft.id, draft.revision, "connection");
  await drafts.saved(
    "owner",
    draft.id,
    draft.revision,
    "gmail-draft",
    createHash("sha256").update(raw).digest("hex"),
  );
  await db.query(
    `INSERT INTO assistant_workspace_send_reviews(draft_id,actor_id,revision,office_snapshot,raw,connection_id,payment_model,approved_revision,approved_by) VALUES($1,'owner',$2,'{"sources":"source-v1"}',$3,'connection','administrative',$2,'owner')`,
    [draft.id, draft.revision, raw],
  );
  const claim: any = {
    id: randomUUID(),
    draft_kind: "office_email",
    draft_id: draft.id,
    state: "dispatching",
    payload: { organizationId: org, contactId: contact, eventYear: 2027 },
    confirmation: null,
  };
  const safety: any = {
    review: vi.fn().mockResolvedValue({
      approvalCurrent: true,
      draft: { content: { body: draft.content.html } },
    }),
    claim: vi.fn(async () => {
      await db.query(
        `INSERT INTO outreach_dispatches(id,draft_kind,draft_id,state,payload) VALUES($1,'office_email',$2,'dispatching',$3::jsonb)`,
        [claim.id, draft.id, JSON.stringify(claim.payload)],
      );
      return claim;
    }),
    assertCurrent: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn(async (_claim: any, value: any) => {
      await db.query(
        `UPDATE outreach_dispatches SET state='sent',confirmation=$2::jsonb WHERE id=$1`,
        [claim.id, JSON.stringify(value)],
      );
    }),
    fail: vi.fn().mockResolvedValue(false),
    markTracking: vi.fn().mockResolvedValue(undefined),
  };
  const send = vi.fn(async (input: any) => {
    await input.beforeSend();
    return { messageId: "sent-message", threadId: "thread" };
  });
  const read: any = {
    getGmailDraftRaw: vi.fn().mockResolvedValue({ raw }),
    getGmailMessageRaw: vi.fn().mockResolvedValue({
      raw,
      messageId: "sent-message",
      threadId: "thread",
      labelIds: ["SENT"],
    }),
    getMessageMetadata: vi.fn().mockResolvedValue({
      internalDateMs: Date.parse("2026-09-24T12:00:00Z"),
    }),
    listMessagePage: vi.fn().mockResolvedValue({
      messages: [{ id: "sent-message", threadId: "thread" }],
      nextPageToken: null,
    }),
  };
  const google: any = {
    getCurrent: vi.fn().mockResolvedValue({ id: "connection" }),
    createReadClient: vi.fn().mockResolvedValue(read),
    createGmailDeliveryClient: vi.fn().mockResolvedValue({
      connectionId: "connection",
      client: { sendGmailDraft: send },
    }),
  };
  const sync = vi.fn().mockResolvedValue(true);
  const protect = vi.fn().mockResolvedValue(null);
  const captureSources = vi.fn().mockResolvedValue("source-v1");
  const service = createWorkspaceSendService({
    captureSources,
    pool: db as any,
    db: {} as any,
    drafts,
    conversations,
    google,
    dispatchFactory: () => safety,
    protectContact: protect,
    syncSent: sync,
  });
  const executor = new ActionExecutor("owner", actions, {
    send_draft: service.adapter,
  });
  const intent: ActionIntent = {
    id: randomUUID(),
    actorId: "owner",
    conversationId: c.id,
    kind: "send_draft",
    targetId: draft.id,
    expectedRevision: draft.revision,
    connectionId: "connection",
    arguments: { draftId: draft.id },
    sourceMessageId: source.id,
  };
  const context: RunContext = {
    actor: { id: "owner", role: "owner", connectionId: "connection" },
    conversationId: c.id,
    runId: randomUUID(),
    selection: { ...emptySelection(), organizationIds: [org] },
    grants: [
      {
        actorId: "owner",
        sourceMessageId: source.id,
        actionKind: "send_draft",
        targetIds: [draft.id],
        revision: draft.revision,
        connectionId: "connection",
      },
    ],
    signal: new AbortController().signal,
  };
  return {
    executor,
    captureSources,
    context,
    intent,
    send,
    read,
    google,
    safety,
    sync,
    protect,
    drafts,
    draft,
    service,
  };
}
it("sends once, verifies Sent, and preserves delivery when tracking fails", async () => {
  const s = await setup();
  s.sync.mockRejectedValue(new Error("tracking unavailable"));
  const result = await s.executor.execute(s.context, s.intent);
  expect(result).toMatchObject({
    status: "ok",
    data: { delivery: "sent", tracking: "needs_repair" },
  });
  expect((await s.drafts.get("owner", s.draft.id))?.status).toBe("sent");
  s.sync.mockResolvedValue(true);
  const repaired = await s.executor.execute(s.context, s.intent);
  expect(repaired.data).toMatchObject({
    delivery: "sent",
    tracking: "complete",
  });
  expect(s.send).toHaveBeenCalledTimes(1);
  expect(s.protect).toHaveBeenCalled();
  expect(s.safety.assertCurrent).toHaveBeenCalledTimes(1);
});
it("reconciles a send timeout from Gmail without another provider call", async () => {
  const s = await setup();
  s.send.mockRejectedValueOnce(new Error("timeout"));
  expect((await s.executor.execute(s.context, s.intent)).status).toBe(
    "uncertain",
  );
  expect((await s.executor.execute(s.context, s.intent)).status).toBe("ok");
  expect(s.send).toHaveBeenCalledTimes(1);
});
it("blocks a manual Gmail edit before sending", async () => {
  const s = await setup();
  s.read.getGmailDraftRaw.mockResolvedValue({
    raw: Buffer.from("edited").toString("base64url"),
  });
  await expect(s.executor.execute(s.context, s.intent)).rejects.toThrow(
    "ASSISTANT_GMAIL_DRAFT_CHANGED",
  );
  expect(s.send).not.toHaveBeenCalled();
});
it("freezes edits while delivery is underway", async () => {
  const s = await setup();
  s.send.mockImplementation(async (input: any) => {
    await expect(
      s.drafts.edit("owner", s.draft.id, s.draft.revision, {
        subject: "changed",
      }),
    ).rejects.toThrow("ASSISTANT_DRAFT_VERSION_CONFLICT");
    await input.beforeSend();
    return { messageId: "sent-message", threadId: "thread" };
  });
  expect((await s.executor.execute(s.context, s.intent)).status).toBe("ok");
});

it("blocks new customer evidence after approval before delivery", async () => {
  const s = await setup();
  s.captureSources.mockResolvedValue("new-correction");
  await expect(s.executor.execute(s.context, s.intent)).rejects.toThrow(
    "ASSISTANT_SOURCES_CHANGED",
  );
  expect(s.send).not.toHaveBeenCalled();
});

it("restores a reviewable draft when final preflight proves no delivery occurred", async () => {
  const s = await setup();
  s.send.mockRejectedValueOnce(
    Object.assign(new Error("Recheck failed"), {
      code: "OUTREACH_SEND_RECHECK_FAILED",
    }),
  );
  const result = await s.executor.execute(s.context, s.intent);
  expect(result).toMatchObject({
    status: "blocked",
    code: "ASSISTANT_SEND_NOT_DISPATCHED",
    data: { delivery: "not_sent" },
  });
  expect((await s.drafts.get("owner", s.draft.id))?.status).toBe("saved");
  const edited = await s.drafts.edit("owner", s.draft.id, s.draft.revision, {
    subject: "Corrected terms",
  });
  expect(edited.status).toBe("local");
  expect(s.read.listMessagePage).not.toHaveBeenCalled();
});
