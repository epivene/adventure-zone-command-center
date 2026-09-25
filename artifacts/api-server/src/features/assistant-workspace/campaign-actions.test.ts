import { it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { campaignAdapters } from "./campaign-actions";
import { ActionStore } from "./action-store";
import { ActionExecutor } from "./action-executor";
import { ConversationStore } from "./conversation-store";
import { DraftStore } from "./draft-store";
import { emptySelection } from "./contracts";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
let db: PGlite, s: any;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  await db.exec(
    `CREATE TABLE organizations(id uuid PRIMARY KEY,consolidated_into_id uuid);CREATE TABLE organization_contacts(organization_id uuid,contact_id uuid,active boolean);CREATE TABLE bookings(id uuid,organization_id uuid);CREATE TABLE follow_ups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,contact_id uuid,booking_id uuid,kind text,due_at timestamptz,completed_at timestamptz,outcome text,next_follow_up_id uuid,organization_location_id uuid,created_at timestamptz,updated_at timestamptz);`,
  );
  const org = randomUUID(),
    contact = randomUUID();
  await db.query("INSERT INTO organizations VALUES($1,NULL)", [org]);
  await db.query("INSERT INTO organization_contacts VALUES($1,$2,true)", [
    org,
    contact,
  ]);
  const c = await new ConversationStore(db).create("owner", "Followup"),
    m = await new ConversationStore(db).append("owner", c.id, "follow", {
      role: "user",
      text: "Follow up 30 days after send",
    }),
    draft = await new DraftStore(db).create("owner", c.id, {
      to: ["test@example.com"],
      cc: [],
      subject: "Hello",
      html: "<p>Hello</p>",
      text: "Hello",
      threadId: null,
      attachmentHashes: [],
      attachmentIds: [],
      organizationId: org,
      contactId: contact,
      templateId: null,
      templateVersion: null,
      eventYear: 2027,
      bookingId: null,
    });
  await db.query(
    "UPDATE assistant_workspace_drafts SET status='sent' WHERE id=$1",
    [draft.id],
  );
  const actions = new ActionStore(db),
    send = {
      id: randomUUID(),
      actorId: "owner",
      conversationId: c.id,
      sourceMessageId: m.id,
      kind: "send_draft",
      targetId: draft.id,
      expectedRevision: draft.revision,
      connectionId: "google",
      arguments: {},
    };
  await actions.prepare(send);
  await db.query(
    "UPDATE assistant_workspace_actions SET status='succeeded',result=$2::jsonb WHERE id=$1",
    [
      send.id,
      JSON.stringify({
        status: "ok",
        data: {
          delivery: "sent",
          tracking: "needs_repair",
          messageId: "gmail-message",
          sentAt: "2026-09-24T12:00:00Z",
        },
        receipts: [
          {
            kind: "sent_email",
            id: "gmail-message",
            verifiedAt: "2026-09-25T12:00:00Z",
            href: "/profiles/" + org,
          },
        ],
        evidence: [],
        code: null,
      }),
    ],
  );
  const intent = {
      ...send,
      id: randomUUID(),
      kind: "create_send_followup",
      connectionId: null,
      arguments: { daysAfter: 30, kind: "Email follow-up" },
    },
    context = {
      actor: { id: "owner", role: "owner", connectionId: null },
      conversationId: c.id,
      runId: randomUUID(),
      selection: {
        ...emptySelection(),
        organizationIds: [org],
        eventYear: 2027,
      },
      signal: new AbortController().signal,
      grants: [
        {
          actorId: "owner",
          sourceMessageId: m.id,
          actionKind: intent.kind,
          targetIds: [draft.id],
          revision: draft.revision,
          connectionId: null,
        },
      ],
    };
  s = {
    context,
    intent,
    org,
    contact,
    send,
    executor: new ActionExecutor(
      "owner",
      actions,
      campaignAdapters(drizzle(db), db),
    ),
  };
}, 30000);
afterEach(async () => {
  await db.close();
});
it("uses actual send time, preserves manual reminders and deduplicates different approved actions", async () => {
  await db.query(
    "INSERT INTO follow_ups(id,organization_id,kind,due_at) VALUES($1,$2,'Manual reminder','2026-10-02')",
    [randomUUID(), s.org],
  );
  const first = await s.executor.execute(s.context, s.intent);
  expect(first.status).toBe("ok");
  const second = await s.executor.execute(s.context, {
    ...s.intent,
    id: randomUUID(),
  });
  expect(second.receipts).toEqual(first.receipts);
  const rows = (await db.query<any>("SELECT * FROM follow_ups ORDER BY due_at"))
    .rows;
  expect(rows).toHaveLength(2);
  expect(rows[0].completed_at).toBeNull();
  expect(new Date(rows[1].due_at).toISOString()).toBe(
    "2026-10-24T12:00:00.000Z",
  );
});
it("rejects uncertain delivery and contact changes without creating a reminder", async () => {
  await db.query(
    "UPDATE assistant_workspace_actions SET status='uncertain' WHERE id=$1",
    [s.send.id],
  );
  await expect(s.executor.execute(s.context, s.intent)).rejects.toThrow(
    "ASSISTANT_CONFIRMED_SEND_REQUIRED",
  );
  expect((await db.query("SELECT * FROM follow_ups")).rows).toHaveLength(0);
  await db.query(
    "UPDATE assistant_workspace_actions SET status='succeeded' WHERE id=$1",
    [s.send.id],
  );
  await db.exec("UPDATE organization_contacts SET active=false");
  await expect(
    s.executor.execute(s.context, { ...s.intent, id: randomUUID() }),
  ).rejects.toThrow("ASSISTANT_CONTACT_MISMATCH");
});
it("rejects a missing send timestamp even when a message receipt exists", async () => {
  await db.query(
    "UPDATE assistant_workspace_actions SET result=jsonb_set(result,'{data,sentAt}','null'::jsonb) WHERE id=$1",
    [s.send.id],
  );
  await expect(s.executor.execute(s.context, s.intent)).rejects.toThrow(
    "ASSISTANT_CONFIRMED_SEND_REQUIRED",
  );
});
