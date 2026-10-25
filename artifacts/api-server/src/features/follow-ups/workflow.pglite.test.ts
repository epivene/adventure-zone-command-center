import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import { FollowUpWorkflow } from "./workflow-service";
import { ensureFollowUpWorkflowSchema } from "../../db/follow-up-workflow-schema";
import { ConnectionFollowUpWorkflow } from "../chatgpt-connection/follow-up-workflow";
import { recordSentEmailFollowUp } from "./sent-email-follow-up";

const org = "10000000-0000-4000-8000-000000000001";
const booking = "20000000-0000-4000-8000-000000000001";
const id = "30000000-0000-4000-8000-000000000001";
const now = new Date("2026-10-24T16:00:00Z");
const clients: PGlite[] = [];
async function setup() {
  const db = new PGlite();
  clients.push(db);
  await db.exec(`
    CREATE TABLE organizations(id uuid PRIMARY KEY, name text);
    CREATE TABLE bookings(id uuid PRIMARY KEY, organization_id uuid, primary_contact_id uuid, name text, status text, starts_at timestamptz, ends_at timestamptz, updated_at timestamptz DEFAULT now());
    CREATE TABLE follow_ups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,booking_id uuid,contact_id uuid,organization_location_id uuid,kind text,due_at timestamptz,completed_at timestamptz,outcome text,next_follow_up_id uuid,updated_at timestamptz DEFAULT now(),created_at timestamptz DEFAULT now());
    CREATE TABLE activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,booking_id uuid,contact_id uuid,kind text,subject text,status text,body text,occurred_at timestamptz,timeline_sort_at timestamptz,deleted_at timestamptz);
    CREATE TABLE booking_opportunities(id uuid PRIMARY KEY,organization_id uuid,booking_id uuid,contact_id uuid,event_year int,status text,next_action_kind text,next_action_due_at timestamptz,updated_at timestamptz DEFAULT now());
    CREATE TABLE email_thread_attention(id uuid PRIMARY KEY,profile_id uuid,thread_id text,subject text,state text,followup_id uuid,due_at timestamptz,event_year int,revision uuid,updated_at timestamptz DEFAULT now());
    INSERT INTO organizations VALUES('${org}','County Fair');
    INSERT INTO bookings(id,organization_id,name,status) VALUES('${booking}','${org}','County Fair','contacted');
    INSERT INTO follow_ups(id,organization_id,booking_id,kind,due_at) VALUES('${id}','${org}','${booking}','Ask about quote','2026-10-24T18:00:00Z');
  `);
  await ensureFollowUpWorkflowSchema(db);
  await ensureFollowUpWorkflowSchema(db);
  const service = new FollowUpWorkflow(
    {
      query: (sql, args) => db.query(sql, args),
      transaction: (fn) => db.transaction((tx) => fn(tx)),
    },
    () => now,
  );
  const revision = (
    await db.query<{ revision: string }>(
      "SELECT updated_at::text revision FROM follow_ups WHERE id=$1",
      [id],
    )
  ).rows[0].revision;
  return { db, service, revision };
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

describe("follow-up workflow", () => {
  it("rejects stale snooze and leaves reminder and notes unchanged", async () => {
    const { db, service } = await setup();
    await expect(
      service.snooze({
        id,
        expectedRevision: "stale",
        dueAt: "2026-10-28T16:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
    expect(
      (await db.query("SELECT count(*)::int n FROM activities")).rows,
    ).toEqual([{ n: 0 }]);
    expect(
      (
        await db.query<{ completed_at: Date | null }>(
          "SELECT completed_at FROM follow_ups",
        )
      ).rows[0].completed_at,
    ).toBeNull();
  });
  it("snoozes with a new exact revision and a readable note", async () => {
    const { db, service, revision } = await setup();
    const result = await service.snooze({
      id,
      expectedRevision: revision,
      dueAt: "2026-10-28T16:00:00Z",
    });
    expect(result.revision).not.toBe(revision);
    expect(result.dueAt).toBe("2026-10-28T16:00:00.000Z");
    expect(
      (await db.query<{ body: string }>("SELECT body FROM activities")).rows[0]
        .body,
    ).toContain("Ask about quote");
    await expect(
      service.snooze({
        id,
        expectedRevision: revision,
        dueAt: "2026-10-29T16:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
  });
  it("requires an explicit decision and rejects stale completion", async () => {
    const { service, revision } = await setup();
    await expect(
      service.resolve({
        id,
        expectedRevision: revision,
        outcome: "Called",
        nextAction: null,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      service.resolve({
        id,
        expectedRevision: "stale",
        outcome: "Called",
        nextAction: { kind: "Email", dueAt: "2026-10-28T16:00:00Z" },
      }),
    ).rejects.toMatchObject({ code: "STALE_REVISION" });
  });
  it("completes atomically with a linked successor while preserving unrelated reminders", async () => {
    const { db, service, revision } = await setup();
    await db.exec(
      `INSERT INTO follow_ups(organization_id,booking_id,kind,due_at) VALUES('${org}','${booking}','Deposit check','2026-11-01');`,
    );
    const result = await service.resolve({
      id,
      expectedRevision: revision,
      outcome: "Discussed quote",
      nextAction: { kind: "Send revised quote", dueAt: "2026-10-28T16:00:00Z" },
    });
    expect(result.nextFollowUpId).toBeTruthy();
    const rows = (
      await db.query<{ kind: string }>(
        "SELECT kind FROM follow_ups WHERE completed_at IS NULL ORDER BY kind",
      )
    ).rows;
    expect(rows.map((r) => r.kind)).toEqual([
      "Deposit check",
      "Send revised quote",
    ]);
    expect(
      (await db.query<{ body: string }>("SELECT body FROM activities")).rows[0]
        .body,
    ).toContain("Send revised quote");
  });
  it("rolls back completion and successor when note persistence fails", async () => {
    const { db, service, revision } = await setup();
    await db.exec(
      "ALTER TABLE activities ADD CONSTRAINT reject_note CHECK(body = 'impossible')",
    );
    await expect(
      service.resolve({
        id,
        expectedRevision: revision,
        outcome: "Called",
        nextAction: { kind: "Email", dueAt: "2026-10-28T16:00:00Z" },
      }),
    ).rejects.toThrow();
    expect(
      (await db.query("SELECT completed_at FROM follow_ups")).rows,
    ).toEqual([{ completed_at: null }]);
  });
  it("records a no-further-action reason and excludes it until the booking changes", async () => {
    const { db, service, revision } = await setup();
    await service.resolve({
      id,
      expectedRevision: revision,
      outcome: "Done",
      nextAction: null,
      noFurtherActionReason: "Organizer declined this season",
    });
    expect((await service.list({ bucket: "needsNextStep" })).total).toBe(0);
    await db.exec(
      `UPDATE bookings SET updated_at=clock_timestamp()+interval '1 day' WHERE id='${booking}'`,
    );
    expect((await service.list({ bucket: "needsNextStep" })).total).toBe(1);
  });
  it("uses Mountain calendar boundaries and returns total counts independent of pagination", async () => {
    const { db, service } = await setup();
    await db.exec(
      `UPDATE follow_ups SET due_at='2026-10-24T05:30Z'; INSERT INTO follow_ups(organization_id,kind,due_at) VALUES('${org}','Today','2026-10-25T05:30Z'),('${org}','Later','2026-10-27T16:00Z');`,
    );
    const result = await service.list({ bucket: "overdue", limit: 1 });
    expect(result.total).toBe(1);
    expect(result.counts).toMatchObject({ overdue: 1, today: 1, upcoming: 1 });
    expect(result.timeZone).toBe("America/Denver");
  });
  it("plans a missing booking action with revision checking and a note", async () => {
    const { db, service } = await setup();
    await db.exec("DELETE FROM follow_ups");
    const item = (await service.list({ bucket: "needsNextStep" })).items[0];
    await service.plan({
      id: item.id,
      source: item.source,
      expectedRevision: item.revision,
      nextAction: {
        kind: "Request availability",
        dueAt: "2026-10-28T16:00:00Z",
      },
    });
    expect((await service.list({ bucket: "needsNextStep" })).total).toBe(0);
    expect(
      (await db.query("SELECT count(*)::int n FROM activities")).rows,
    ).toEqual([{ n: 1 }]);
  });
  it("does not let a profile-level reminder hide another event year's opportunity", async () => {
    const { db, service } = await setup();
    await db.exec(
      `INSERT INTO booking_opportunities(id,organization_id,event_year,status) VALUES('40000000-0000-4000-8000-000000000001','${org}',2027,'contacted'); INSERT INTO follow_ups(organization_id,kind,due_at) VALUES('${org}','Other event','2026-11-01');`,
    );
    expect((await service.list({ bucket: "needsNextStep" })).total).toBe(1);
  });
  it("requires a new revision after planning an opportunity", async () => {
    const { db, service } = await setup();
    await db.exec(
      `INSERT INTO booking_opportunities(id,organization_id,event_year,status) VALUES('40000000-0000-4000-8000-000000000001','${org}',2027,'contacted');`,
    );
    const item = (await service.list({ bucket: "needsNextStep" })).items[0];
    const plan = {
      id: item.id,
      source: item.source,
      expectedRevision: item.revision,
      nextAction: { kind: "Email", dueAt: "2026-10-28T16:00:00Z" },
    };
    await service.plan(plan);
    await expect(service.plan(plan)).rejects.toMatchObject({
      code: "STALE_REVISION",
    });
  });
  it("keeps counts complete when only one page is returned", async () => {
    const { db, service } = await setup();
    await db.exec(
      `INSERT INTO follow_ups(organization_id,kind,due_at) SELECT '${org}','Email','2026-10-24T18:00Z' FROM generate_series(1,30);`,
    );
    const result = await service.list({ bucket: "today", limit: 5, offset: 5 });
    expect(result.items).toHaveLength(5);
    expect(result.total).toBe(31);
    expect(result.counts.today).toBe(31);
  });
  it("offers a final decision for unscheduled sources", async () => {
    const { db, service } = await setup();
    await db.exec("DELETE FROM follow_ups");
    const item = (await service.list({ bucket: "needsNextStep" })).items[0];
    await service.decide({
      id: item.id,
      source: item.source,
      expectedRevision: item.revision,
      outcome: "Closed out",
      nextAction: null,
      noFurtherActionReason: "No more contact this season",
    });
    expect((await service.list({ bucket: "needsNextStep" })).total).toBe(0);
  });
  it("replays connector mutations by request key without duplicate notes", async () => {
    const { db, revision } = await setup();
    const connectionId = "50000000-0000-4000-8000-000000000001";
    await db.exec(
      `CREATE TABLE chatgpt_connections(id uuid,owner_id text,client_id text,scopes text[],revoked_at timestamptz,last_used_at timestamptz); CREATE TABLE chatgpt_operations(id uuid,connection_id uuid,operation text,request_key text,input_hash text,receipt jsonb); INSERT INTO chatgpt_connections VALUES('${connectionId}','owner','client',ARRAY['crm:read','followups:write'],NULL,NULL);`,
    );
    const connector = new ConnectionFollowUpWorkflow({
      query: (sql, args) => db.query(sql, args),
      transaction: (fn) => db.transaction((tx) => fn(tx)),
    });
    const principal = {
      ownerId: "owner",
      connectionId,
      clientId: "client",
      scopes: ["crm:read", "followups:write"] as (
        "crm:read" | "followups:write"
      )[],
    };
    const input = {
      id,
      expectedRevision: revision,
      dueAt: "2027-10-28T16:00:00Z",
    };
    const first = await connector.mutate(
      principal,
      { requestKey: "same-snooze" },
      "snooze",
      input,
    );
    expect(
      await connector.mutate(
        principal,
        { requestKey: "same-snooze" },
        "snooze",
        input,
      ),
    ).toEqual(first);
    expect(
      (await db.query("SELECT count(*)::int n FROM activities")).rows,
    ).toEqual([{ n: 1 }]);
    await expect(
      connector.mutate(
        { ...principal, scopes: ["crm:read"] },
        { requestKey: "no-scope" },
        "snooze",
        input,
      ),
    ).rejects.toMatchObject({ code: "CONNECTION_ACCESS_DENIED" });
  });
  it("records a confirmed send once and preserves an explicit follow-up date", async () => {
    const { db } = await setup();
    const opportunityId = "40000000-0000-4000-8000-000000000001",
      draftId = "60000000-0000-4000-8000-000000000001";
    await db.exec(
      `CREATE TABLE booking_opportunity_email_state(id uuid,opportunity_id uuid,state text,subject text,gmail_message_id text,sent_at timestamptz); INSERT INTO booking_opportunities(id,organization_id,booking_id,event_year,status,next_action_kind,next_action_due_at) VALUES('${opportunityId}','${org}','${booking}',2027,'contacted','Organizer requested January','2027-01-05T16:00Z'); INSERT INTO booking_opportunity_email_state VALUES('${draftId}','${opportunityId}','sent','Updated quote','gmail-message','2026-10-24T16:00Z');`,
    );
    const database = {
      query: (sql: string, args?: any[]) => db.query(sql, args),
      transaction: <T>(fn: (tx: any) => Promise<T>) =>
        db.transaction((tx) => fn(tx)),
    };
    const input = {
      opportunityId,
      draftId,
      messageId: "gmail-message",
      sentAt: now,
    };
    await recordSentEmailFollowUp(database, input);
    await recordSentEmailFollowUp(database, input);
    expect(
      (
        await db.query<{ due_at: Date }>(
          "SELECT due_at FROM follow_ups WHERE opportunity_id IS NOT NULL",
        )
      ).rows[0].due_at.toISOString(),
    ).toBe("2027-01-05T16:00:00.000Z");
    expect(
      (await db.query("SELECT count(*)::int n FROM activities")).rows,
    ).toEqual([{ n: 1 }]);
    expect(
      (await db.query("SELECT count(*)::int n FROM follow_ups")).rows,
    ).toEqual([{ n: 2 }]);
  });
  it("keeps event years distinct for the same profile", async () => {
    const { db, service } = await setup();
    await db.exec(
      `INSERT INTO booking_opportunities(id,organization_id,event_year,status) VALUES('40000000-0000-4000-8000-000000000001','${org}',2026,'contacted'),('40000000-0000-4000-8000-000000000002','${org}',2027,'contacted')`,
    );
    const years = (await service.list({ bucket: "needsNextStep" })).items
      .filter((i) => i.source === "opportunity")
      .map((i) => i.eventYear)
      .sort();
    expect(years).toEqual([2026, 2027]);
  });
  it("saves an opportunity's won/lost status and explicit final decision together", async () => {
    const { db, service } = await setup();
    const opportunityId = "40000000-0000-4000-8000-000000000001";
    await db.exec(
      `INSERT INTO booking_opportunities(id,organization_id,event_year,status) VALUES('${opportunityId}','${org}',2027,'contacted')`,
    );
    const item = (await service.list({ bucket: "needsNextStep" })).items[0];
    await service.decide({
      id: item.id,
      source: "opportunity",
      expectedRevision: item.revision,
      finalStatus: "booked",
      outcome: "Confirmed booking",
      nextAction: null,
      noFurtherActionReason: "Planning complete",
    });
    expect(
      (await db.query("SELECT status FROM booking_opportunities")).rows,
    ).toEqual([{ status: "booked" }]);
    expect((await service.list({ bucket: "needsNextStep" })).total).toBe(0);
  });
});
