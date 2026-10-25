import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/features/outreach-planner/outreach-allocation", () => ({
  allocationEnabled: () => false,
}));
vi.mock("@/features/outreach-planner/outreach-commitments", () => ({
  commitmentTransaction: (db: any, fn: any) => db.transaction(fn),
  reconcileCapacityFacts: async () => {},
}));
import { DrizzleBookingRepository } from "./booking-repository";
import { BookingService } from "./booking-service";
import { OpportunityRepository } from "../opportunities/opportunity-repository";
import { FollowUpWorkflow } from "../follow-ups/workflow-service";
import { ensureFollowUpWorkflowSchema } from "../../db/follow-up-workflow-schema";
const org = "10000000-0000-4000-8000-000000000001",
  booking = "20000000-0000-4000-8000-000000000001",
  opportunity = "30000000-0000-4000-8000-000000000001";
const clients: PGlite[] = [];
async function setup() {
  const client = new PGlite();
  clients.push(client);
  await client.exec(`
CREATE TABLE organizations(id uuid PRIMARY KEY,name text);
CREATE TABLE bookings(id uuid PRIMARY KEY,organization_id uuid,primary_contact_id uuid,name text,venue_name text,address_1 text,city text,region text,postal_code text,latitude double precision,longitude double precision,starts_at timestamptz,ends_at timestamptz,status text,probability text,travel_leg_id uuid,act_record_id text,organization_location_id uuid,notes text,physical_attraction_total int,attraction_total_approval_reason text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE follow_ups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid,organization_id uuid,contact_id uuid,kind text,due_at timestamptz,completed_at timestamptz,outcome text,next_follow_up_id uuid,organization_location_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,contact_id uuid,booking_id uuid,kind text,subject text,status text,body text,occurred_at timestamptz,timeline_sort_at timestamptz,date_is_import_fallback boolean DEFAULT false,ends_at timestamptz,act_record_id text,source_record_id uuid,source_version_id uuid,source_type text,organization_location_id uuid,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),deleted_at timestamptz);
CREATE TABLE audit_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity_type text,entity_id uuid,action text,before jsonb,after jsonb,reverses_entry_id uuid,created_at timestamptz DEFAULT now());
CREATE TABLE booking_opportunities(id uuid PRIMARY KEY,organization_id uuid,booking_id uuid,contact_id uuid,event_year int,status text,priority text DEFAULT 'normal',next_action_kind text,next_action_due_at timestamptz,hold_reason text,email_automation_protected boolean DEFAULT false,territory_exception_approved boolean DEFAULT false,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE TABLE email_thread_attention(id uuid,profile_id uuid,thread_id text,subject text,state text,followup_id uuid,due_at timestamptz,event_year int,revision uuid,updated_at timestamptz DEFAULT now());
INSERT INTO organizations VALUES('${org}','County Fair');
INSERT INTO bookings(id,organization_id,name,city,region,status,probability) VALUES('${booking}','${org}','County Fair','Fairplay','CO','contacted','possible');
INSERT INTO booking_opportunities(id,organization_id,booking_id,event_year,status) VALUES('${opportunity}','${org}','${booking}',2027,'contacted');
`);
  await ensureFollowUpWorkflowSchema(client);
  return {
    client,
    repo: new DrizzleBookingRepository(drizzle(client) as never),
  };
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});
const input = {
  name: "County Fair",
  city: "Fairplay",
  region: "CO",
  venueName: null,
  address1: null,
  postalCode: null,
  latitude: 39,
  longitude: -106,
  startsAt: null,
  endsAt: null,
  status: "confirmed" as const,
  probability: "definite" as const,
  travelLegId: null,
  notes: null,
  finalNoFurtherActionReason:
    "All details are confirmed; organizer will contact us if needed",
};
it("applies an explicit final decision to the linked opportunity queue item", async () => {
  const { client, repo } = await setup();
  await repo.updateBookingDetails(booking, input);
  const queue = new FollowUpWorkflow({
    query: (sql, args) => client.query(sql, args),
    transaction: (fn) => client.transaction((tx) => fn(tx)),
  });
  expect((await queue.list({ bucket: "needsNextStep" })).total).toBe(0);
  expect((await client.query("SELECT status FROM bookings")).rows).toEqual([
    { status: "confirmed" },
  ]);
});
it("rolls back terminal status if its profile note cannot be saved", async () => {
  const { client, repo } = await setup();
  await client.exec("ALTER TABLE activities ADD CHECK(body='impossible')");
  await expect(repo.updateBookingDetails(booking, input)).rejects.toThrow();
  expect((await client.query("SELECT status FROM bookings")).rows).toEqual([
    { status: "contacted" },
  ]);
});
it("rejects a legacy completion changing to lost without a final reason", async () => {
  const { client, repo } = await setup();
  await client.exec(
    `INSERT INTO follow_ups(id,booking_id,organization_id,kind,due_at) VALUES('40000000-0000-4000-8000-000000000001','${booking}','${org}','Email','2026-10-24')`,
  );
  const result = await new BookingService(repo).completeFollowUp({
    followUpId: "40000000-0000-4000-8000-000000000001",
    status: "declined",
    outcome: "",
    nextAction: null,
  });
  expect(result).toMatchObject({
    ok: false,
    error: { code: "NEXT_ACTION_REQUIRED" },
  });
});
it("automatically notes ordinary opportunity status changes", async () => {
  const { client } = await setup();
  await new OpportunityRepository(drizzle(client) as never).update(
    opportunity,
    { status: "researching" },
  );
  const notes = (
    await client.query<{ body: string }>("SELECT body FROM activities")
  ).rows;
  expect(notes[0]?.body).toContain("contacted to researching");
});
