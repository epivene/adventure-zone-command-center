import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { randomUUID } from "node:crypto";
import { reviewCampaignMember } from "./campaign-eligibility";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
let db: PGlite, org: string, contact: string, batch: any;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  await db.exec(
    `CREATE TABLE organizations(id uuid,name text,consolidated_into_id uuid,last_resort boolean DEFAULT false,region text);CREATE TABLE contacts(id uuid,email text);CREATE TABLE organization_contacts(organization_id uuid,contact_id uuid,active boolean);CREATE TABLE booking_opportunities(id uuid,booking_id uuid,organization_id uuid,event_year integer,status text,email_automation_protected boolean DEFAULT false,territory_exception_approved boolean DEFAULT false);CREATE TABLE bookings(id uuid,organization_id uuid);CREATE TABLE communication_blocks(id uuid,target_type text,organization_id uuid,contact_id uuid,normalized_email text,active boolean,reason text);CREATE TABLE office_email_drafts(id uuid,organization_id uuid,recipient_email text,event_year integer,state text);CREATE TABLE booking_opportunity_email_state(id uuid,organization_id uuid,recipient_email text,event_year integer,state text);CREATE TABLE outreach_dispatches(id uuid,draft_kind text,draft_id uuid,state text);CREATE TABLE follow_ups(id uuid,organization_id uuid,contact_id uuid,booking_id uuid,completed_at timestamptz,due_at timestamptz,kind text);`,
  );
  org = randomUUID();
  contact = randomUUID();
  await db.query(
    "INSERT INTO organizations(id,name,region) VALUES($1,'Fair','CO')",
    [org],
  );
  await db.query("INSERT INTO contacts VALUES($1,' Info@fair.example ')", [
    contact,
  ]);
  await db.query("INSERT INTO organization_contacts VALUES($1,$2,true)", [
    org,
    contact,
  ]);
  batch = {
    id: randomUUID(),
    eventYear: 2027,
    members: [{ organizationId: org, contactId: contact, bookingId: null }],
    draftLinks: {},
  };
}, 30000);
afterEach(async () => {
  await db.close();
});
const review = () =>
  reviewCampaignMember(drizzle(db), db, batch, batch.members[0]);
it("blocks a moved contact and a missing event year", async () => {
  await db.exec("UPDATE organization_contacts SET active=false");
  expect((await review()).reasons).toContain("CONTACT_NOT_ACTIVE");
  batch.eventYear = null;
  expect((await review()).reasons).toContain("EVENT_YEAR_REQUIRED");
});
it("normalizes duplicate batch recipients and preserves source IDs for pending work", async () => {
  const other = randomUUID(),
    c = randomUUID(),
    pending = randomUUID();
  await db.query("INSERT INTO contacts VALUES($1,'info@fair.example')", [c]);
  await db.query("INSERT INTO organization_contacts VALUES($1,$2,true)", [
    other,
    c,
  ]);
  batch.members.push({ organizationId: other, contactId: c, bookingId: null });
  await db.query(
    "INSERT INTO office_email_drafts VALUES($1,$2,'INFO@FAIR.EXAMPLE',2027,'draft')",
    [pending, org],
  );
  const r = await review();
  expect(r.eligible).toBe(false);
  expect(r.reasons).toContain("DUPLICATE_BATCH_RECIPIENT");
  expect(r.blockedRecords).toContainEqual({
    id: pending,
    kind: "office_draft",
    state: "draft",
    eventYear: 2027,
  });
});
it("uses canonical protection for declines and email blocks and does not confuse prior-year sent mail", async () => {
  await db.query(
    "INSERT INTO booking_opportunities(id,organization_id,event_year,status) VALUES($1,$2,2027,'declined')",
    [randomUUID(), org],
  );
  expect(
    (await review()).reasons.some((x: string) => x.includes("decline")),
  ).toBe(true);
  await db.exec("DELETE FROM booking_opportunities");
  await db.query(
    "INSERT INTO booking_opportunity_email_state VALUES($1,$2,'info@fair.example',2026,'sent')",
    [randomUUID(), org],
  );
  expect((await review()).eligible).toBe(true);
  await db.query(
    "INSERT INTO communication_blocks(id,target_type,normalized_email,active,reason) VALUES($1,'recipient_email','info@fair.example',true,'Requested stop')",
    [randomUUID()],
  );
  expect((await review()).reasons).toContain("DO NOT SEND: Requested stop");
});
it("blocks uncertain and unclassified outreach while keeping manually scheduled followups visible", async () => {
  const id = randomUUID(),
    followup = randomUUID();
  await db.query(
    "INSERT INTO office_email_drafts VALUES($1,$2,'info@fair.example',NULL,'sending')",
    [id, org],
  );
  await db.query(
    "INSERT INTO follow_ups VALUES($1,$2,$3,NULL,NULL,'2027-02-01','email')",
    [followup, org, contact],
  );
  const r = await review();
  expect(r.eligible).toBe(false);
  expect(r.blockedRecords[0].eventYear).toBeNull();
  expect(r.openFollowups[0].id).toBe(followup);
});

it("keeps uncertain dispatches blocked even when the local draft says failed", async () => {
  const id = randomUUID();
  await db.query(
    "INSERT INTO office_email_drafts VALUES($1,$2,'info@fair.example',2027,'failed')",
    [id, org],
  );
  await db.query(
    "INSERT INTO outreach_dispatches VALUES($1,'office_email',$2,'uncertain')",
    [randomUUID(), id],
  );
  const r = await review();
  expect(r.blockedRecords).toContainEqual({
    id,
    kind: "office_draft",
    state: "uncertain",
    eventYear: 2027,
  });
  expect(r.eligible).toBe(false);
});

import { CampaignStore } from "./campaign-store";
import { ConversationStore } from "./conversation-store";
import { DraftStore } from "./draft-store";
import { emptySelection } from "./contracts";
it("refreshes eligibility before creating one bound member draft and replays its saved identity", async () => {
  const conversations = new ConversationStore(db),
    c = await conversations.create("owner", "Batch"),
    m = await conversations.append("owner", c.id, "batch", {
      role: "user",
      text: "Prepare these leads",
    }),
    store = new CampaignStore(drizzle(db), db);
  const context: any = {
    actor: { id: "owner", role: "owner", connectionId: null },
    conversationId: c.id,
    runId: randomUUID(),
    selection: { ...emptySelection(), organizationIds: [org], eventYear: 2027 },
    grants: [],
    signal: new AbortController().signal,
  };
  const saved = await store.create(context, m.id, {
    title: "Fair batch",
    eventYear: 2027,
    criteria: "Test",
    members: batch.members,
  });
  context.selection.batchId = saved.id;
  const content: any = {
    to: ["info@fair.example"],
    cc: [],
    subject: "Fair",
    html: "<p>Fair</p>",
    text: "Fair",
    threadId: null,
    attachmentHashes: [],
    attachmentIds: [],
    organizationId: org,
    templateId: null,
    templateVersion: null,
  };
  expect((await review()).eligible).toBe(true);
  await db.exec("UPDATE organization_contacts SET active=false");
  await expect(store.prepareDraft(context, saved.id, content)).rejects.toThrow(
    "ASSISTANT_CAMPAIGN_MEMBER_BLOCKED",
  );
  await db.exec("UPDATE organization_contacts SET active=true");
  const draft = await store.prepareDraft(context, saved.id, content);
  expect(draft.content).toMatchObject({
    batchId: saved.id,
    contactId: contact,
    eventYear: 2027,
    bookingId: null,
  });
  expect(
    (
      await store.prepareDraft(context, saved.id, {
        ...content,
        text: "Regenerated",
      })
    ).id,
  ).toBe(draft.id);
  expect(
    (await db.query("SELECT * FROM assistant_workspace_drafts")).rows,
  ).toHaveLength(1);
  await expect(
    new DraftStore(db).edit("owner", draft.id, draft.revision, {
      contactId: randomUUID(),
    }),
  ).rejects.toThrow("ASSISTANT_BATCH_DRAFT_SCOPE_IMMUTABLE");
});
it("does not hide a linked draft when its delivery is uncertain", async () => {
  const id = randomUUID();
  await db.query(
    "INSERT INTO office_email_drafts VALUES($1,$2,'info@fair.example',2027,'failed')",
    [id, org],
  );
  await db.query(
    "INSERT INTO outreach_dispatches VALUES($1,'office_email',$2,'uncertain')",
    [randomUUID(), id],
  );
  const r = await reviewCampaignMember(
    drizzle(db),
    db,
    batch,
    batch.members[0],
    { ignoreDraftId: id },
  );
  expect(r.eligible).toBe(false);
  expect(r.blockedRecords[0].state).toBe("uncertain");
});

import { createWorkspaceTools } from "./workspace-tools";
it("prepares a normalized recipient through the complete workspace tool and rejects another selected booking", async () => {
  await db.exec(
    "CREATE TABLE communication_templates(id uuid,template_version text,body_template text,state text,reviewed_at timestamptz)",
  );
  const template = randomUUID();
  await db.query(
    "INSERT INTO communication_templates VALUES($1,'v1','<p>Hello</p>','active',now())",
    [template],
  );
  const conversations = new ConversationStore(db),
    c = await conversations.create("owner", "Prepare"),
    m = await conversations.append("owner", c.id, "prepare", {
      role: "user",
      text: "Draft",
    }),
    store = new CampaignStore(drizzle(db), db);
  const context: any = {
    actor: { id: "owner", role: "owner", connectionId: null },
    conversationId: c.id,
    runId: randomUUID(),
    selection: { ...emptySelection(), organizationIds: [org], eventYear: 2027 },
    grants: [],
    signal: new AbortController().signal,
  };
  const saved = await store.create(context, m.id, {
    title: "Fair",
    eventYear: 2027,
    criteria: "Current",
    members: batch.members,
  });
  context.selection.batchId = saved.id;
  const tools = createWorkspaceTools({
    ownerId: "owner",
    db,
    campaigns: store,
    conversations,
    drafts: new DraftStore(db),
  } as any);
  const content = {
    to: ["info@fair.example"],
    cc: [],
    subject: "Hello",
    html: "<p>Hello</p>",
    text: "Hello",
    threadId: null,
    attachmentHashes: [],
    attachmentIds: [],
    organizationId: org,
    templateId: template,
    templateVersion: "v1",
  };
  const out = await tools.execute(context, {
    id: "draft",
    name: "prepare_draft",
    arguments: JSON.stringify(content),
  });
  expect(out.status).toBe("ok");
  context.selection.bookingId = randomUUID();
  await expect(store.prepareDraft(context, saved.id, content)).rejects.toThrow(
    "ASSISTANT_TARGET_NOT_IN_BATCH",
  );
});
