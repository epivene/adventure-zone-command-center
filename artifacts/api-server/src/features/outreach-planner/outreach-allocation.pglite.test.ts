import { installReviewedDateFixtures } from "../booking-date-repair/date-fixtures";
import * as productionAllocation from "./production-outreach-allocation";
import { DrizzleBookingRepository } from "../bookings/booking-repository";
import { sql } from "drizzle-orm";
import {
  commitmentTransaction,
  reconcileCapacityFacts,
  finishCapacityWriteIn,
} from "./outreach-commitments";
import {
  saveRouteAnchor,
  reviewImportedClaimSource,
  revokeRouteAnchor,
  reconcileCommittedDemand,
  changeCommitment,
} from "./outreach-allocation-actions";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadActReviewMigrations } from "@workspace/db/migrations";
import {
  OutreachAllocation,
  withAllocationTransaction,
} from "./outreach-allocation";
import { OutreachRepository } from "./outreach-repository";
import { OutreachService } from "./outreach-service";
import {
  projectReservations,
  verifyTravel,
  capacityDecision,
  bookingDemandFacts,
  fingerprint,
  loadAllocationFacts,
  targetForBooking,
  addDays,
} from "./outreach-capacity-evidence";
import type { GoogleCalendarEvent } from "../google-workspace/google-api-types";
const clients: PGlite[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map((c) => c.close()));
});
const org = "10000000-0000-4000-8000-000000000001",
  op = "20000000-0000-4000-8000-000000000001",
  leg = "30000000-0000-4000-8000-000000000001",
  booking = "40000000-0000-4000-8000-000000000001";
const resource = "50000000-0000-4000-8000-000000000001",
  pkg = "60000000-0000-4000-8000-000000000001",
  leg2 = "30000000-0000-4000-8000-000000000002";
it("participates in planning protection with both feature flags enabled",async()=>{
 const f=await setup();
 await f.client.exec(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS name text DEFAULT 'Fixture', ADD COLUMN IF NOT EXISTS latitude double precision, ADD COLUMN IF NOT EXISTS longitude double precision;
 ALTER TABLE resources ADD name text DEFAULT 'Fixture equipment', ADD category text DEFAULT 'Pool';
 ALTER TABLE google_operational_calendar_links ADD last_app_snapshot jsonb;
 CREATE TABLE crew_workers(id uuid PRIMARY KEY,name text,rehire_status text);
 CREATE TABLE crew_worker_leg_memberships(worker_id uuid,leg_id uuid);
 CREATE TABLE leg_manager_access(leg_id uuid PRIMARY KEY,session_version integer);
 CREATE TABLE boss_accounts(id uuid PRIMARY KEY,enabled boolean);
 CREATE TABLE trips(id uuid PRIMARY KEY,travel_leg_id uuid,start_date timestamptz,end_date timestamptz,route_confirmed_at timestamptz);
 CREATE TABLE trip_stops(id uuid PRIMARY KEY,trip_id uuid,booking_id uuid);
 CREATE TABLE trip_resource_assignments(trip_id uuid,resource_id uuid);`);
 await f.client.exec(await readFile("../../lib/db/migrations/20261001_leg_planning.sql","utf8"));
 vi.stubEnv("LEG_PLANNING_ENABLED","true");
 await commitmentTransaction(f.db,async tx=>{await tx.execute(sql`UPDATE bookings SET name='Reviewed fixture' WHERE id=${booking}::uuid`);},{source:"both-flags",bookingIds:[]},f.allocation);
 expect((await f.client.query<{valid:boolean}>("SELECT bool_and(validated) AS valid FROM outreach_write_receipts")).rows[0].valid).toBe(true);
});
async function setup() {
  vi.stubEnv("OUTREACH_PLANNER_ENABLED", "true");
  const client = new PGlite();
  clients.push(client);
  await client.exec(`
create table travel_legs(id uuid primary key,name text);
create table organizations(id uuid primary key,name text,region text,last_resort boolean default false);
create table bookings(id uuid primary key,starts_at timestamptz,ends_at timestamptz,status text,probability text,travel_leg_id uuid);
create table booking_opportunities(id uuid primary key,organization_id uuid references organizations(id),event_year integer not null,booking_id uuid,contact_id uuid,status text default 'ready_to_contact',priority text default 'normal',next_action_kind text,next_action_due_at timestamptz,hold_reason text,email_automation_protected boolean default false,territory_exception_approved boolean default false,created_at timestamptz default now(),updated_at timestamptz default now(), unique(organization_id,event_year));
create table package_templates(id uuid primary key,code text,normal_capacity integer,temporary_unavailable_quantity integer);
create table follow_ups(id uuid primary key,organization_id uuid,booking_id uuid,contact_id uuid,kind text,due_at timestamptz,completed_at timestamptz);
create table booking_opportunity_email_state(id uuid primary key,opportunity_id uuid,event_year integer,state text,sent_at timestamptz,gmail_message_id text,purpose text);
create table communication_templates(id uuid primary key,code text,category text);
create table office_email_drafts(id uuid primary key,organization_id uuid,contact_id uuid,booking_id uuid,event_year integer,communication_template_id uuid,office_account_id uuid,state text,sent_at timestamptz,sent_message_id text,recipient_email text,subject text,body text,last_send_error text);
create table call_sessions(id uuid primary key,organization_id uuid,booking_id uuid,ended_at timestamptz,direction text,disposition text,contact_id uuid);
create table boss_convention_submissions(id uuid primary key,applied_at timestamptz,applied_organization_id uuid,applied_contact_id uuid);
create table booking_operational_windows(booking_id uuid,starts_at timestamptz,ends_at timestamptz);
create table booking_package_selections(booking_id uuid,package_template_id uuid);
create table google_operational_calendar_links(id uuid,booking_id uuid,calendar_id text,google_event_id text,package_key text,reserved_starts_at timestamptz,reserved_ends_at timestamptz,last_synced_at timestamptz,last_error_code text);
create table google_workspace_validation_mappings(message_id text,organization_id uuid,updated_at timestamptz);
create table activities(id uuid primary key default gen_random_uuid(),organization_id uuid,contact_id uuid,booking_id uuid,kind text,subject text,status text,body text,occurred_at timestamptz,timeline_sort_at timestamptz,date_is_import_fallback boolean default false,ends_at timestamptz,act_record_id text,source_record_id uuid,source_version_id uuid,source_type text,organization_location_id uuid,created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz);
insert into travel_legs values ('${leg}','Leg 1');insert into organizations(id,name,last_resort) values ('${org}','Festival',false);insert into booking_opportunities(id,organization_id,event_year,booking_id) values ('${op}','${org}',2026,'${booking}');
`);
  await client.exec(`
alter table bookings add name text default 'Event', add latitude double precision default 40,add longitude double precision default -80;
alter table travel_legs add archived_at timestamptz;
alter table package_templates add active boolean default true;
alter table booking_operational_windows add source text default 'manual';
create table booking_resource_assignments(booking_id uuid,resource_id uuid);
create table resources(id uuid primary key,status text,movable boolean,normal_travel_leg_id uuid,setup_minutes integer,teardown_minutes integer,minimum_transfer_minutes integer);
create table google_workspace_calendar_scopes(calendar_id text,connection_id uuid,selected boolean,updated_at timestamptz);
create table google_workspace_connections(id uuid primary key,status text);
insert into google_workspace_connections values ('${org}','connected');
insert into google_workspace_calendar_scopes values ('calendar','${org}',true,now());
insert into resources values ('${resource}','available',true,null,60,60,60);
insert into package_templates values ('${pkg}','adventure_zone',1,0,true);
insert into travel_legs values ('${leg2}','Leg 2',null);
insert into bookings(id,starts_at,ends_at,status,travel_leg_id) values ('${booking}','2026-10-10','2026-10-11','new_lead','${leg}');
insert into booking_package_selections values ('${booking}','${pkg}');
`);
  await client.exec(
    `alter table booking_opportunity_email_state add organization_id uuid default '${org}',add contact_id uuid,add recipient_email text default 'owner@example.com',add subject text default 'Availability',add body text default 'Reviewed offer',add gmail_draft_id text default 'draft1',add gmail_thread_id text,add scheduled_for timestamptz,add last_failure_code text,add last_failure_message text;`,
  );
  await client.exec(`alter table package_templates add name text default 'Adventure Zone';
    create table contacts(id uuid primary key,email text);
    create table communication_blocks(id uuid primary key default gen_random_uuid(),active boolean default true,target_type text,organization_id uuid,contact_id uuid,normalized_email text,reason text);
    create table convention_editions(id uuid primary key,year integer);
    create table convention_members(id uuid primary key,edition_id uuid,organization_id uuid);
  `);
  await installReviewedDateFixtures(client);
  for (const name of [
    "20260909_outreach_planner.sql",
    "20260909_outreach_allocation.sql",
    "20260909_outreach_commitments.sql",
    "20260909_outreach_dispatch.sql",
    "20260910_outreach_workspace.sql",
  ]) {
    const migration = await readFile(`../../lib/db/migrations/${name}`, "utf8");
    await client.exec(migration);
    await client.exec(migration);
    const entry = (await loadActReviewMigrations()).find(
      (x) => x.name === name,
    )!;
    expect(
      (await client.query<{ ready: boolean }>(entry.markerSql)).rows[0].ready,
    ).toBe(true);
  }
  let now = new Date("2026-08-01T18:00:00Z");
  const db = drizzle(client) as never;
  let events: GoogleCalendarEvent[] = [];
  const read = vi.fn(async () => events),
    estimate = vi.fn(async () => 60);
  const allocation = new OutreachAllocation(
    db,
    {
      readClient: async () => ({ listCalendarEvents: read }),
      estimator: { estimateMinutes: estimate },
    },
    () => true,
    () => now,
  );
  const repo = new OutreachRepository(db),
    service = new OutreachService(
      repo,
      () => true,
      () => now,
      allocation,
    );
  const opening = await service.createOpening(
    {
      title: "October",
      eventYear: 2026,
      startsOn: "2026-10-01",
      endsOn: "2026-10-31",
      legId: leg,
      quantities: { adventure_zone: 1 },
    },
    "owner",
  );
  const candidate = await service.createCandidate(
    { openingId: opening.id, opportunityId: op, tier: "strong" },
    "owner",
  );
  for (const [route, start, end] of [
    [leg, "2026-06-01", "2026-06-02"],
    [leg2, "2026-06-10", "2026-06-11"],
    [leg, "2026-12-10", "2026-12-11"],
    [leg2, "2026-12-20", "2026-12-21"],
  ]) {
    const id = randomUUID();
    await client.query(
      "insert into bookings(id,starts_at,ends_at,status,travel_leg_id) values ($1,$2,$3,'contract_received',$4)",
      [id, start, end, route],
    );
    await client.query(
      "insert into booking_package_selections values ($1,$2)",
      [id, pkg],
    );
    await client.query(
      "insert into booking_resource_assignments values ($1,$2)",
      [id, resource],
    );
    const facts = await loadAllocationFacts(db),
      b = facts.bookings.find((b) => b.id === id)!;
    await client.query(
      "insert into outreach_booking_demand(booking_id,quantities,resource_ids,facts_fingerprint,actor,reason) values ($1,$2,$3,$4,$5,$6)",
      [
        id,
        JSON.stringify({ adventure_zone: 1 }),
        JSON.stringify([resource]),
        fingerprint(bookingDemandFacts(facts, b, [resource])),
        "owner",
        "Complete physical requirements verified",
      ],
    );
    const t = targetForBooking(await loadAllocationFacts(db), id).target!;
    events.push({
      calendarId: "calendar",
      calendarTimeZone: "UTC",
      id,
      iCalUid: id,
      summary: "1 Adventure Zone",
      description: "1 Adventure Zone",
      start: { date: t.startsOn },
      end: { date: addDays(t.endsOn, 1) },
      updated: null,
      recurringEventId: null,
      originalStartTime: null,
    });
    await client.query(
      "insert into google_operational_calendar_links(id,booking_id,calendar_id,google_event_id,package_key,reserved_starts_at,reserved_ends_at,last_synced_at) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        id,
        "calendar",
        id,
        "adventure_zone",
        t.startsOn,
        addDays(t.endsOn, 1),
        now,
      ],
    );
  }
  await allocation.saveDemand(
    candidate.id,
    {
      quantities: { adventure_zone: 1 },
      resourceIds: [resource],
      completePhysicalDemandReviewed: true,
      reason: "Owner verified all required shared equipment",
    },
    "owner",
  );
  await service.reviewHistory(
    candidate.id,
    { reason: "Reviewed full stored history" },
    "owner",
  );
  return {
    client,
    db,
    service,
    allocation,
    candidate,
    opening,
    read,
    estimate,
    setEvents: (v: GoogleCalendarEvent[]) => {
      events = v;
    },
    events,
    setNow: (v: string) => {
      now = new Date(v);
    },
  };
}
describe("shared allocation evidence and holds", () => {
  it("marks saved evidence stale when a supporting route hold expires without a database write", async () => {
    const {
      client,
      allocation,
      candidate,
      service,
      setNow,
      events,
      setEvents,
      read,
      estimate,
    } = await setup();
    const facts = await loadAllocationFacts(allocation.db);
    const prior = facts.bookings.find(
      (b) => b.travel_leg_id === leg && b.starts_at?.startsWith("2026-06-01"),
    )!;
    const anchor = targetForBooking(facts, prior.id).target!;
    await client.query("update bookings set status='new_lead' where id=$1", [
      prior.id,
    ]);
    await client.query(
      "delete from google_operational_calendar_links where booking_id=$1",
      [prior.id],
    );
    setEvents(events.filter((e) => e.id !== prior.id));
    await client.query(
      `insert into outreach_holds(candidate_id,booking_id,opportunity_id,leg_id,event_starts_on,event_ends_on,starts_on,ends_on,quantities,resource_ids,location,demand_fingerprint,owner,expires_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'owner','2026-08-01T18:00:30Z')`,
      [
        candidate.id,
        prior.id,
        op,
        leg,
        anchor.eventStartsOn,
        anchor.eventEndsOn,
        anchor.startsOn,
        anchor.endsOn,
        JSON.stringify(anchor.quantities),
        JSON.stringify(anchor.resourceIds),
        JSON.stringify(anchor.location),
        anchor.demandFingerprint,
      ],
    );
    await service.check(candidate.id, "owner");
    expect(
      (await service.get()).candidates.find((c) => c.id === candidate.id)
        ?.lastAllocationCheck,
    ).toMatchObject({ freshness: "current", capacity: { status: "fits" } });
    const before = fingerprint(await loadAllocationFacts(allocation.db));
    read.mockClear();
    estimate.mockClear();
    setNow("2026-08-01T18:00:30Z");
    const saved = (await service.get()).candidates.find(
      (c) => c.id === candidate.id,
    )?.lastAllocationCheck;
    expect(saved).toMatchObject({
      freshness: "stale",
      capacity: { status: "needs_review" },
    });
    expect(read).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
    expect(fingerprint(await loadAllocationFacts(allocation.db))).toBe(before);
    const fresh = await allocation.evaluateCandidate(candidate.id);
    expect(fresh.capacity.status).toBe("needs_review");
    expect(fresh.capacity.reasons.join(" ")).toContain("adjacent");
  });
  it("uses actual dates, exact resources, live sources and preserves callbacks", async () => {
    const { allocation, candidate, service, client } = await setup();
    await client.exec(
      `update booking_opportunities set next_action_kind='callback',next_action_due_at='2026-10-01'`,
    );
    const check = await allocation.evaluateCandidate(candidate.id);
    expect(check.capacity).toEqual({ status: "fits", reasons: [] });
    expect(check.target).toMatchObject({
      eventStartsOn: "2026-10-10",
      eventEndsOn: "2026-10-11",
      startsOn: "2026-10-08",
      endsOn: "2026-10-12",
    });
    const hold = await allocation.createHold(
      candidate.id,
      "2026-08-03T18:00:00Z",
      "owner",
    );
    expect(hold.quantities).toEqual({ adventure_zone: 1 });
    expect(hold.resource_ids).toEqual([resource]);
    const source = await service.sources(candidate.id);
    expect(source.capacity.status).toBe("fits");
    expect(source.allocationCheck?.provenance.calendarIds).toEqual([
      "calendar",
    ]);
    expect(source.manualNextActions[0].kind).toBe("callback");
  });
  it("serializes two holds competing globally across different legs; only one succeeds", async () => {
    const { allocation, service, client, candidate, read, events } =
      await setup();
    const booking2 = randomUUID(),
      op2 = randomUUID(),
      org2 = randomUUID();
    await client.query("insert into organizations(id,name) values ($1,$2)", [
      org2,
      "Second contender",
    ]);
    await client.query(
      "insert into bookings(id,starts_at,ends_at,status,travel_leg_id) values ($1,'2026-10-10','2026-10-11','new_lead',$2)",
      [booking2, leg2],
    );
    await client.query(
      "insert into booking_package_selections values ($1,$2)",
      [booking2, pkg],
    );
    await client.query(
      "insert into booking_opportunities(id,organization_id,event_year,booking_id) values ($1,$2,2026,$3)",
      [op2, org2, booking2],
    );
    const opening2 = await service.createOpening(
      {
        title: "Leg 2",
        eventYear: 2026,
        startsOn: "2026-10-01",
        endsOn: "2026-10-31",
        legId: leg2,
        quantities: { adventure_zone: 1 },
      },
      "owner",
    );
    const c2 = await service.createCandidate(
      { openingId: opening2.id, opportunityId: op2, tier: "strong" },
      "owner",
    );
    await allocation.saveDemand(
      c2.id,
      {
        quantities: { adventure_zone: 1 },
        resourceIds: [resource],
        completePhysicalDemandReviewed: true,
        reason: "All physical resources verified",
      },
      "owner",
    );
    await service.reviewHistory(c2.id, { reason: "History reviewed" }, "owner");
    let arrivals = 0,
      release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    read.mockImplementation(async () => {
      arrivals++;
      if (arrivals === 2) release();
      await barrier;
      return events;
    });
    const results = await Promise.allSettled([
      allocation.createHold(candidate.id, "2026-08-03T18:00:00Z", "owner"),
      allocation.createHold(c2.id, "2026-08-03T18:00:00Z", "owner"),
    ]);
    expect(
      results.filter((r) => r.status === "fulfilled"),
      results
        .map((r) => (r.status === "rejected" ? String(r.reason) : "ok"))
        .join(" / "),
    ).toHaveLength(1);
    expect(
      (await client.query("select * from outreach_holds where state='active'"))
        .rows,
    ).toHaveLength(1);
  });
  it("extends with self-exclusion, releases, expires and preserves reviewed history", async () => {
    const { allocation, candidate, client, setNow, service } = await setup();
    const hold = await allocation.createHold(
      candidate.id,
      "2026-08-03T18:00:00Z",
      "owner",
    );
    const extended = await allocation.extendHold(
      hold.id,
      "2026-08-04T18:00:00Z",
      "owner",
    );
    expect(extended.revision).toBe(2);
    expect(
      (await allocation.evaluateCandidate(candidate.id)).capacity.status,
    ).toBe("fits");
    await service.check(candidate.id, "owner");
    const released = await allocation.releaseHold(hold.id, "owner");
    expect(released.state).toBe("released");
    expect(
      (
        await client.query(
          "select checked_at,history_review from outreach_candidates",
        )
      ).rows[0],
    ).toMatchObject({ checked_at: null, history_review: expect.any(Object) });
    await expect(
      allocation.extendHold(hold.id, "2026-08-05T18:00:00Z", "owner"),
    ).rejects.toMatchObject({ status: 409 });
    const second = await allocation.createHold(
      candidate.id,
      "2026-08-03T18:00:00Z",
      "owner",
    );
    setNow("2026-08-03T18:00:00Z");
    expect(
      (await allocation.list()).holds.find((h) => h.id === second.id)?.state,
    ).toBe("expired");
    await expect(
      allocation.extendHold(second.id, "2026-08-05T18:00:00Z", "owner"),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rereads changed database facts and rejects stale evidence under the mutex", async () => {
    const { allocation, candidate, db, client, setNow } = await setup();
    const prepared = await allocation.prepare(booking, {
      candidateId: candidate.id,
    });
    await client.exec(`update resources set status='maintenance'`);
    const changed = await withAllocationTransaction(db, (tx) =>
      allocation.evaluateCommitmentIn(tx, prepared),
    );
    expect(changed.capacity.status).toBe("needs_review");
    expect(changed.capacity.reasons.join(" ")).toContain("review exact demand");
    await client.exec(`update resources set status='available'`);
    const fresh = await allocation.prepare(booking, {
      candidateId: candidate.id,
    });
    setNow("2026-08-01T18:02:01Z");
    expect(
      (
        await withAllocationTransaction(db, (tx) =>
          allocation.evaluateCommitmentIn(tx, fresh),
        )
      ).capacity.reasons.join(" "),
    ).toContain("expired");
  });
  it("reviews missing Calendar, nearby unlinked Calendar travel stops and missing route anchors", async () => {
    const { allocation, candidate, read, setEvents, events, client } =
      await setup();
    read.mockRejectedValueOnce(new Error("Provider unavailable"));
    expect(
      (await allocation.evaluateCandidate(candidate.id)).capacity.status,
    ).toBe("needs_review");
    setEvents([
      ...events,
      {
        ...events[0],
        id: "unlinked",
        iCalUid: "other",
        summary: "Maybe 1 Adventure Zone",
        start: { date: "2026-10-05" },
        end: { date: "2026-10-06" },
      },
    ]);
    expect(
      (await allocation.evaluateCandidate(candidate.id)).capacity.reasons.join(
        " ",
      ),
    ).toContain("canonical booking");
    setEvents(events);
    await client.exec(
      `update bookings set status='cancelled' where starts_at<'2026-09-01'`,
    );
    expect(
      (await allocation.evaluateCandidate(candidate.id)).capacity.reasons.join(
        " ",
      ),
    ).toContain("adjacent");
  });
  it("requires completeness review, ignores unrelated dated history, blocks undated commitments and stale demand", async () => {
    const { allocation, candidate, client } = await setup();
    await expect(
      allocation.saveDemand(
        candidate.id,
        {
          quantities: { adventure_zone: 1 },
          resourceIds: [resource],
          reason: "No attestation",
        },
        "owner",
      ),
    ).rejects.toBeDefined();
    await client.query(
      "insert into bookings(id,starts_at,ends_at,status,travel_leg_id) values ($1,'2020-01-01','2020-01-02','completed',$2)",
      [randomUUID(), leg2],
    );
    expect(
      (await allocation.evaluateCandidate(candidate.id)).capacity.status,
    ).toBe("fits");
    await client.query(
      "insert into bookings(id,status) values ($1,'confirmed')",
      [randomUUID()],
    );
    expect(
      (await allocation.evaluateCandidate(candidate.id)).capacity.status,
    ).toBe("needs_review");
    await client.exec(
      `update bookings set starts_at='2026-10-09' where id='${booking}'`,
    );
    expect(
      (await allocation.evaluateCandidate(candidate.id)).capacity.reasons.join(
        " ",
      ),
    ).toContain("review exact demand");
  });
  it("flag off avoids DB and providers", async () => {
    const db = { transaction: vi.fn(), execute: vi.fn() } as never,
      provider = {
        readClient: vi.fn(),
        estimator: { estimateMinutes: vi.fn() },
      };
    const allocation = new OutreachAllocation(db, provider, () => false);
    await expect(
      allocation.createHold(randomUUID(), "2026-10-01T00:00:00Z", "owner"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(allocation.list()).rejects.toMatchObject({ status: 404 });
    await expect(
      allocation.evaluateCommitment(randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    expect(provider.readClient).not.toHaveBeenCalled();
    expect((db as { transaction: unknown }).transaction).not.toHaveBeenCalled();
  });
  it("fails closed when the mutex seed is absent and repeat migration repairs it", async () => {
    const { allocation, candidate, client } = await setup();
    await client.exec("delete from outreach_allocation_mutex");
    await expect(
      allocation.createHold(candidate.id, "2026-08-03T18:00:00Z", "owner"),
    ).rejects.toThrow("mutex is missing");
    expect(
      (await client.query("select * from outreach_holds")).rows,
    ).toHaveLength(0);
    await client.exec(
      await readFile(
        "../../lib/db/migrations/20260909_outreach_allocation.sql",
        "utf8",
      ),
    );
    expect(
      (await allocation.evaluateCandidate(candidate.id)).capacity.status,
    ).toBe("fits");
  });
  it("uses custom exclusive operational ends, validates opening bounds and retains honest saved checks on GET", async () => {
    const { allocation, candidate, client, service, read, setNow } =
      await setup();
    await client.exec(
      `insert into booking_operational_windows values ('${booking}','2026-10-07','2026-10-14','manual')`,
    );
    await allocation.saveDemand(
      candidate.id,
      {
        quantities: { adventure_zone: 1 },
        resourceIds: [resource],
        completePhysicalDemandReviewed: true,
        reason: "Custom window and complete equipment reviewed",
      },
      "owner",
    );
    expect(
      (await allocation.evaluateCandidate(candidate.id)).target,
    ).toMatchObject({ startsOn: "2026-10-07", endsOn: "2026-10-13" });
    await service.check(candidate.id, "owner");
    read.mockClear();
    expect(
      (await service.get()).candidates[0].lastAllocationCheck,
    ).toMatchObject({ freshness: "current", capacity: { status: "fits" } });
    expect(read).not.toHaveBeenCalled();
    setNow("2026-08-01T18:03:00Z");
    expect(
      (await service.get()).candidates[0].lastAllocationCheck,
    ).toMatchObject({
      freshness: "stale",
      capacity: { status: "needs_review" },
    });
    await client.exec(`update outreach_openings set ends_on='2026-10-09'`);
    expect(
      (await allocation.evaluateCandidate(candidate.id)).capacity.reasons.join(
        " ",
      ),
    ).toContain("fit the opening");
  });
  it("requires mirror agreement and exact multiunit capacity; physical inventory is independent of leg", async () => {
    const { allocation, candidate, client, events, setEvents } = await setup();
    setEvents(
      events.map((event, i) =>
        i === 0
          ? {
              ...event,
              summary: "2 Adventure Zone",
              description: "2 Adventure Zone",
            }
          : event,
      ),
    );
    expect(
      (await allocation.evaluateCandidate(candidate.id)).capacity.reasons.join(
        " ",
      ),
    ).toContain("quantities");
    setEvents(events);
    await client.exec(
      `update outreach_openings set quantities='{"adventure_zone":2}'`,
    );
    await allocation.saveDemand(
      candidate.id,
      {
        quantities: { adventure_zone: 2 },
        resourceIds: [resource],
        completePhysicalDemandReviewed: true,
        reason: "Two package units; all shared equipment explicitly included",
      },
      "owner",
    );
    expect(
      (await allocation.evaluateCandidate(candidate.id)).capacity,
    ).toMatchObject({
      status: "conflict",
      reasons: expect.arrayContaining([
        expect.stringContaining("package:adventure_zone"),
      ]),
    });
  });
  it("persists actionable source failure while preserving callbacks and history", async () => {
    const { service, candidate, client } = await setup();
    await client.exec(
      `update booking_opportunities set next_action_kind='callback',next_action_due_at='2026-10-01';drop table resources cascade`,
    );
    const check = await service.check(candidate.id, "owner");
    expect(check.capacity.status).toBe("needs_review");
    expect(check.capacity.reasons.join(" ")).toContain("source unavailable");
    expect(check.manualNextActions[0].kind).toBe("callback");
    expect(
      (
        await client.query(
          "select checked_at,history_review from outreach_candidates",
        )
      ).rows[0],
    ).toMatchObject({
      checked_at: expect.anything(),
      history_review: expect.any(Object),
    });
  });
});

async function secondContender(
  s: Awaited<ReturnType<typeof setup>>,
  start = "2026-10-10",
  end = "2026-10-11",
) {
  const id = randomUUID();
  await s.client.query(
    "insert into bookings(id,starts_at,ends_at,status,travel_leg_id) values ($1,$2,$3,'new_lead',$4)",
    [id, start, end, leg2],
  );
  await s.client.query(
    "insert into booking_package_selections values ($1,$2)",
    [id, pkg],
  );
  await s.client.query(
    "insert into booking_resource_assignments values ($1,$2)",
    [id, resource],
  );
  const f = await loadAllocationFacts(s.db),
    b = f.bookings.find((b) => b.id === id)!;
  await s.client.query(
    "insert into outreach_booking_demand(booking_id,quantities,resource_ids,facts_fingerprint,actor,reason) values ($1,$2,$3,$4,'owner','Reviewed complete physical demand')",
    [
      id,
      JSON.stringify({ adventure_zone: 1 }),
      JSON.stringify([resource]),
      fingerprint(bookingDemandFacts(f, b, [resource])),
    ],
  );
  return id;
}
const demandReview = {
  quantities: { adventure_zone: 1 },
  resourceIds: [resource],
  completePhysicalDemandReviewed: true as const,
  reason: "Owner reviewed all applicable physical demand",
};
const confirm = (s: Awaited<ReturnType<typeof setup>>, id = booking) =>
  commitmentTransaction(
    s.db,
    async (tx) => {
      await tx.execute(
        sql`update bookings set status='contract_received' where id=${id}::uuid`,
      );
    },
    { source: "test-confirm", bookingIds: [id], actor: "owner" },
    s.allocation,
  );

describe("production commitment enforcement", () => {
  it("converts an exact hold atomically without double counting and prepares only the target", async () => {
    const s = await setup(),
      h = await s.allocation.createHold(
        s.candidate.id,
        "2026-08-03T00:00:00Z",
        "owner",
      );
    s.read.mockClear();
    await s.client.exec("set outreach.enforced='true'");
    await confirm(s);
    expect(s.read).toHaveBeenCalledTimes(1);
    const f = await loadAllocationFacts(s.db);
    expect(f.bookings.find((b) => b.id === booking)?.status).toBe(
      "contract_received",
    );
    expect(f.holds.find((x) => x.id === h.id)).toMatchObject({
      state: "converted",
      revision: 2,
    });
    expect(
      (await s.allocation.evaluateCommitment(booking)).capacity.status,
    ).toBe("fits");
  });
  it("rejects missing, incomplete and subsequently invalidated participation", async () => {
    const s = await setup();
    await s.client.exec("set outreach.enforced='true'");
    await expect(
      s.client.exec(
        `update bookings set status='confirmed' where id='${booking}'`,
      ),
    ).rejects.toThrow("Allocation participation required");
    await expect(
      withAllocationTransaction(
        s.db,
        async (tx) => {
          await tx.execute(
            sql`update bookings set status='confirmed' where id=${booking}::uuid`,
          );
        },
        { mode: "commitment", source: "unfinished" },
      ),
    ).rejects.toThrow("did not complete validation");
    await expect(
      withAllocationTransaction(
        s.db,
        async (tx) => {
          await finishCapacityWriteIn(tx);
          await tx.execute(
            sql`update bookings set status='confirmed' where id=${booking}::uuid`,
          );
        },
        { mode: "commitment", source: "late-write" },
      ),
    ).rejects.toThrow("did not complete validation");
    await expect(
      withAllocationTransaction(s.db, async (tx) => {
        await tx.execute(
          sql`update bookings set status='confirmed' where id=${booking}::uuid`,
        );
      }),
    ).rejects.toThrow();
    expect(
      (await loadAllocationFacts(s.db)).bookings.find((b) => b.id === booking)
        ?.status,
    ).toBe("new_lead");
  });
  it("serializes booking confirmation versus a hold with exactly one winner", async () => {
    const s = await setup(),
      other = await secondContender(s);
    await s.client.exec("set outreach.enforced='true'");
    let arrived = 0;
    let unblock!: () => void;
    const barrier = new Promise<void>((r) => (unblock = r));
    s.read.mockImplementation(async () => {
      if (++arrived === 2) unblock();
      await barrier;
      return s.events;
    });
    const results = await Promise.allSettled([
      s.allocation.createHold(s.candidate.id, "2026-08-03T00:00:00Z", "owner"),
      confirm(s, other),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const f = await loadAllocationFacts(s.db);
    expect(
      f.holds.filter((h) => h.state === "active").length +
        (f.bookings.find((b) => b.id === other)?.status === "contract_received"
          ? 1
          : 0),
    ).toBe(1);
  });
  it("serializes committed edits versus a hold and canonicalizes generated IDs and timezone strings", async () => {
    const s = await setup(),
      other = await secondContender(s, "2026-10-22", "2026-10-23");
    await s.client.query("update bookings set status='confirmed' where id=$1", [
      other,
    ]);
    await s.client.exec(
      "alter table booking_resource_assignments add id uuid default gen_random_uuid(),add updated_at timestamptz default now(); alter table booking_package_selections add id uuid default gen_random_uuid(),add created_at timestamptz default now()",
    );
    await s.client.exec("set outreach.enforced='true'");
    let arrived = 0;
    let unblock!: () => void;
    const barrier = new Promise<void>((r) => (unblock = r));
    s.read.mockImplementation(async () => {
      if (++arrived === 2) unblock();
      await barrier;
      return s.events;
    });
    const edit = () =>
      changeCommitment(
        s.allocation,
        other,
        {
          startsAt: "2026-10-10T02:00:00+02:00",
          endsAt: "2026-10-11T00:00:00Z",
          travelLegId: leg2,
          latitude: 40,
          longitude: -80,
          demand: demandReview,
        },
        "owner",
      );
    const results = await Promise.allSettled([
      s.allocation.createHold(s.candidate.id, "2026-08-03T00:00:00Z", "owner"),
      edit(),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    s.read.mockImplementation(async () => s.events);
    const active = (await loadAllocationFacts(s.db)).holds.find(
      (h) => h.state === "active",
    );
    if (active) {
      await s.allocation.releaseHold(active.id, "owner");
      await edit();
    }
    expect(
      (await loadAllocationFacts(s.db)).bookings.find((b) => b.id === other)
        ?.starts_at,
    ).toBe("2026-10-10T00:00:00.000Z");
  });
  it("preserves conflicting imported promises as durable reviewed facts and blocks further allocation", async () => {
    const s = await setup(),
      other = await secondContender(s),
      h = await s.allocation.createHold(
        s.candidate.id,
        "2026-08-03T00:00:00Z",
        "owner",
      );
    await s.client.exec("set outreach.enforced='true'");
    await reconcileCapacityFacts(
      s.db,
      "operational-calendar-import",
      async (tx) => {
        await tx.execute(
          sql`update bookings set status='confirmed' where id=${other}::uuid`,
        );
      },
    );
    const facts = await loadAllocationFacts(s.db);
    expect(facts.bookings.find((b) => b.id === other)?.status).toBe(
      "confirmed",
    );
    expect(facts.holds.find((x) => x.id === h.id)?.state).toBe("active");
    expect(
      (
        await s.client.query(
          "select state,source,booking_ids from outreach_reconciliation_facts",
        )
      ).rows,
    ).toContainEqual({
      state: "needs_review",
      source: "operational-calendar-import",
      booking_ids: [other],
    });
    expect(
      (await s.allocation.evaluateCandidate(s.candidate.id)).capacity.status,
    ).not.toBe("fits");
  });
  it("records actual resource loss and invalidates checked evidence", async () => {
    const s = await setup();
    await s.service.check(s.candidate.id, "owner");
    await s.client.exec("set outreach.enforced='true'");
    await reconcileCapacityFacts(s.db, "resource-inventory", async (tx) => {
      await tx.execute(
        sql`update resources set status='maintenance' where id=${resource}::uuid`,
      );
    });
    expect(
      (await loadAllocationFacts(s.db)).resources.find((r) => r.id === resource)
        ?.status,
    ).toBe("maintenance");
    expect(
      (await s.allocation.evaluateCandidate(s.candidate.id)).capacity.status,
    ).toBe("needs_review");
    expect(
      (
        await s.client.query<{ checked_at: string | null }>(
          "select checked_at from outreach_candidates",
        )
      ).rows[0].checked_at,
    ).toBeNull();
  });
  it("reconciles exact demand only for existing commitments without changing status", async () => {
    const s = await setup();
    await expect(
      reconcileCommittedDemand(s.allocation, booking, demandReview, "owner"),
    ).rejects.toThrow("existing factual commitment");
    await s.client.query("update bookings set status='confirmed' where id=$1", [
      booking,
    ]);
    await s.client.query(
      "delete from outreach_booking_demand where booking_id=$1",
      [booking],
    );
    await s.client.exec("set outreach.enforced='true'");
    const result = await reconcileCommittedDemand(
      s.allocation,
      booking,
      demandReview,
      "owner",
    );
    expect(result.check.capacity.status).toBe("fits");
    expect(result.demand.actor).toBe("owner");
    expect(
      (await loadAllocationFacts(s.db)).bookings.find((b) => b.id === booking)
        ?.status,
    ).toBe("confirmed");
    expect(
      (
        await s.client.query<{ state: string }>(
          "select state from outreach_reconciliation_facts where source='committed-demand-review'",
        )
      ).rows[0].state,
    ).toBe("resolved");
  });
  it("resolves first and last events with actual leg and physical anchors and rejects revoked evidence", async () => {
    const s = await setup();
    await s.client.exec(
      `delete from google_operational_calendar_links;update bookings set status='new_lead' where id<>'${booking}'`,
    );
    s.setEvents([]);
    expect(
      (await s.allocation.evaluateCandidate(s.candidate.id)).capacity.status,
    ).toBe("needs_review");
    const anchors = [];
    for (const resourceId of [null, resource])
      for (const direction of ["departure", "return"] as const)
        anchors.push(
          await saveRouteAnchor(
            s.allocation,
            {
              legId: resourceId ? null : leg,
              resourceId,
              direction,
              latitude: 40,
              longitude: -80,
              availableAt:
                direction === "departure"
                  ? "2026-10-01T09:00:00Z"
                  : "2026-10-20T15:00:00Z",
              validUntil: "2026-12-31T00:00:00Z",
              source:
                "Owner verified depot schedule and actual equipment location",
              reason: "Availability and required return time reviewed",
            },
            "owner",
          ),
        );
    expect(
      (await s.allocation.evaluateCandidate(s.candidate.id)).capacity.status,
    ).toBe("fits");
    await revokeRouteAnchor(
      s.allocation,
      anchors.find(
        (a) => a.resource_id === resource && a.direction === "departure",
      )!.id,
      { reason: "Equipment moved elsewhere" },
      "owner",
    );
    expect(
      (await s.allocation.evaluateCandidate(s.candidate.id)).capacity.status,
    ).toBe("needs_review");
    await expect(
      saveRouteAnchor(
        s.allocation,
        {
          legId: leg,
          resourceId: resource,
          direction: "departure",
          latitude: 40,
          longitude: -80,
          availableAt: "2026-10-01T00:00:00Z",
          validUntil: "2026-12-31T00:00:00Z",
          source: "depot",
          reason: "test",
        },
        "owner",
      ),
    ).rejects.toThrow("exactly one");
  });
  it("keeps flag-off allocation tables/providers untouched and ordinary transactions free of provider reads", async () => {
    const work = vi.fn(async () => 7),
      db = {
        transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})),
        execute: vi.fn(),
      };
    vi.stubEnv("OUTREACH_PLANNER_ENABLED", "false");
    expect(await commitmentTransaction(db as never, work)).toBe(7);
    expect(db.execute).not.toHaveBeenCalled();
    expect(
      await reconcileCapacityFacts(
        db as never,
        "operational-calendar-import",
        work,
      ),
    ).toBe(7);
    const s = await setup();
    s.read.mockClear();
    s.estimate.mockClear();
    await commitmentTransaction(
      s.db,
      async (tx) => {
        await tx.execute(
          sql`update booking_opportunities set next_action_kind='callback' where id=${op}::uuid`,
        );
      },
      { source: "ordinary-follow-up" },
      s.allocation,
    );
    expect(s.read).not.toHaveBeenCalled();
    expect(s.estimate).not.toHaveBeenCalled();
  });
});

describe("writer and deployment regressions", () => {
  it("the actual booking repository joins the mutex and converts its follow-up commitment hold", async () => {
    const s = await setup(),
      followUpId = randomUUID();
    await s.client.exec(
      `alter table bookings add updated_at timestamptz,add organization_id uuid,add primary_contact_id uuid,add venue_name text,add address_1 text,add city text,add region text,add postal_code text,add act_record_id text,add organization_location_id uuid,add notes text,add physical_attraction_total integer,add attraction_total_approval_reason text,add created_at timestamptz`,
    );
    await s.client.query(
      "insert into follow_ups(id,booking_id) values ($1,$2)",
      [followUpId, booking],
    );
    const hold = await s.allocation.createHold(
      s.candidate.id,
      "2026-08-03T00:00:00Z",
      "owner",
    );
    vi.spyOn(
      productionAllocation,
      "createProductionOutreachAllocation",
    ).mockReturnValue(s.allocation);
    await s.client.exec("set outreach.enforced='true'");
    const repository = new DrizzleBookingRepository(s.db);
    await repository.transaction(
      async (tx) =>
        tx.updateBookingStatus({ bookingId: booking, status: "confirmed" }),
      followUpId,
    );
    expect(
      (await loadAllocationFacts(s.db)).holds.find((h) => h.id === hold.id)
        ?.state,
    ).toBe("converted");
  });
  it("repairs missing columns, named constraints, indexes and guard triggers instead of trusting table existence", async () => {
    const s = await setup();
    const migration = await readFile(
      "../../lib/db/migrations/20260909_outreach_commitments.sql",
      "utf8",
    );
    const entry = (await loadActReviewMigrations()).find(
      (m) => m.name === "20260909_outreach_commitments.sql",
    )!;
    await s.client.exec(
      "alter table outreach_route_anchors drop column reason cascade; alter table outreach_route_anchors drop constraint outreach_route_anchors_direction_check;drop index outreach_anchors_identity_live;drop trigger outreach_capacity_guard on bookings",
    );
    expect(
      (await s.client.query<{ ready: boolean }>(entry.markerSql)).rows[0].ready,
    ).toBe(false);
    await s.client.exec(migration);
    await s.client.exec(migration);
    expect(
      (await s.client.query<{ ready: boolean }>(entry.markerSql)).rows[0].ready,
    ).toBe(true);
    await s.client.exec("set outreach.enforced='true'");
    await expect(
      s.client.exec(
        `update bookings set starts_at='2026-10-12' where id='${booking}'`,
      ),
    ).rejects.toThrow("participation required");
  });
});

describe("anchor chronology", () => {
  it("current actual availability constrains older route stops instead of being ignored", async () => {
    const s = await setup();
    await saveRouteAnchor(
      s.allocation,
      {
        legId: null,
        resourceId: resource,
        direction: "departure",
        latitude: 40,
        longitude: -80,
        availableAt: "2026-10-09T00:00:00Z",
        validUntil: "2026-12-31T00:00:00Z",
        source: "Equipment unavailable until depot return",
        reason: "Actual current equipment availability confirmed",
      },
      "owner",
    );
    const unavailable = await s.allocation.evaluateCandidate(s.candidate.id);
    expect(unavailable.capacity.status).toBe("needs_review");
    expect(unavailable.capacity.reasons.join(" ")).toMatch(/time|transfer/);
    await saveRouteAnchor(
      s.allocation,
      {
        legId: null,
        resourceId: resource,
        direction: "departure",
        latitude: 40,
        longitude: -80,
        availableAt: "2026-10-01T00:00:00Z",
        validUntil: "2026-12-31T00:00:00Z",
        source: "Owner verified updated resource location",
        reason: "Release became available earlier",
      },
      "owner",
    );
    expect(
      (await s.allocation.evaluateCandidate(s.candidate.id)).capacity.status,
    ).toBe("fits");
    expect(
      (await loadAllocationFacts(s.db)).anchors?.filter((a) => !a.revoked_at),
    ).toHaveLength(1);
  });
});

describe("unverified assistant provenance", () => {
  it("persists submitted commitment claims and requires separate source review even after exact-demand review", async () => {
    const s = await setup();
    const submittedFacts = {
      status: "confirmed",
      startsAt: "2026-10-10",
      endsAt: "2026-10-11",
    };
    await s.client.exec("set outreach.enforced='true'");
    await reconcileCapacityFacts(
      s.db,
      "assistant-history-import",
      async (tx) => {
        await tx.execute(
          sql`update bookings set status='confirmed' where id=${booking}::uuid`,
        );
      },
      {
        provenance: {
          integration: "authenticated-assistant-import",
          route: "POST /assistant-import/event-profiles",
          requestId: "import-1",
          receivedAt: s.allocation.clock().toISOString(),
          payloadHash: fingerprint(submittedFacts),
          submittedFacts,
        },
      },
    );
    const claim = (
      await s.client.query<{
        id: string;
        state: string;
        detail: { provenance: unknown };
      }>(
        "select id,state,detail from outreach_reconciliation_facts where source='assistant-history-import'",
      )
    ).rows[0];
    expect(claim.state).toBe("needs_review");
    await expect(
      s.client.query(
        "update outreach_reconciliation_facts set state='resolved' where id=$1",
        [claim.id],
      ),
    ).rejects.toThrow("Allocation participation required");
    expect(claim.detail.provenance).toMatchObject({
      requestId: "import-1",
      submittedFacts,
    });
    const reconciled = await reconcileCommittedDemand(
      s.allocation,
      booking,
      demandReview,
      "owner",
    );
    expect(reconciled.check.capacity.status).toBe("needs_review");
    expect(reconciled.check.capacity.reasons.join(" ")).toContain(
      "independent owner source review",
    );
    expect(
      (
        await s.client.query<{ state: string }>(
          "select state from outreach_reconciliation_facts where id=$1",
          [claim.id],
        )
      ).rows[0].state,
    ).toBe("needs_review");
    await reviewImportedClaimSource(
      s.allocation,
      claim.id,
      {
        existingExternalCommitmentConfirmed: true,
        sourceReference: "Owner reviewed signed agreement DOC-123",
        reason:
          "Verified the submitted dates and existing customer promise against source document",
      },
      "owner",
    );
    expect(
      (await s.allocation.evaluateCommitment(booking)).capacity.status,
    ).toBe("fits");
  });
});

describe("legacy imported physical assignments", () => {
  it.each(["cancel", "move"] as const)(
    "preserves nonoverlapping equipment claims after an unreviewed %s without modern demand",
    async (change) => {
      const s = await setup();
      const legacy = randomUUID();
      await s.client.exec("set outreach.enforced='true'");
      await reconcileCapacityFacts(
        s.db,
        "assistant-history-import",
        async (tx) => {
          await tx.execute(
            sql`insert into bookings(id,starts_at,ends_at,status,travel_leg_id) values (${legacy}::uuid,'2026-09-20','2026-09-21','confirmed',${leg2}::uuid)`,
          );
          await tx.execute(
            sql`insert into booking_resource_assignments(booking_id,resource_id) values (${legacy}::uuid,${resource}::uuid)`,
          );
        },
      );
      await reconcileCapacityFacts(
        s.db,
        "assistant-history-import",
        async (tx) => {
          if (change === "cancel")
            await tx.execute(
              sql`update bookings set status='cancelled' where id=${legacy}::uuid`,
            );
          else {
            await tx.execute(
              sql`update bookings set starts_at='2027-04-20',ends_at='2027-04-21' where id=${legacy}::uuid`,
            );
            await tx.execute(
              sql`delete from booking_resource_assignments where booking_id=${legacy}::uuid`,
            );
          }
        },
      );
      const facts = await loadAllocationFacts(s.db);
      expect(facts.demands.some((d) => d.booking_id === legacy)).toBe(false);
      expect(facts.unverifiedClaims).toHaveLength(2);
      expect(
        facts
          .unverifiedClaims!.flatMap((c) => c.detail.changes ?? [])
          .find((c) => c.before?.id === legacy)?.before,
      ).toMatchObject({
        travel_leg_id: leg2,
        assignments: [{ booking_id: legacy, resource_id: resource }],
      });
      const target = targetForBooking(facts, booking).target!;
      const projection = projectReservations(
        facts,
        target,
        s.allocation.clock(),
      );
      expect(
        projection.reasons.filter((r) =>
          r.includes("independent owner source review"),
        ),
      ).toHaveLength(2);
      expect(
        capacityDecision(
          target,
          projection,
          await verifyTravel(
            facts,
            target,
            projection,
            { estimateMinutes: async () => 60 },
            s.allocation.clock(),
          ),
        ).status,
      ).toBe("needs_review");
      // The current cancelled/moved row is outside this target's equipment route.
      const withoutClaims = projectReservations(
        { ...facts, unverifiedClaims: [] },
        target,
        s.allocation.clock(),
      );
      expect(
        capacityDecision(
          target,
          withoutClaims,
          await verifyTravel(
            facts,
            target,
            withoutClaims,
            { estimateMinutes: async () => 60 },
            s.allocation.clock(),
          ),
        ).status,
      ).toBe("fits");
    },
  );
});

describe("content-bound dispatch ledger", () => {
  async function reviewed(
    kind: "opportunity_email" | "office_email" = "opportunity_email",
    intent: "specific_offer" | "exploratory" = "specific_offer",
  ) {
    const f = await setup();
    const hold =
      intent === "specific_offer"
        ? await f.allocation.createHold(
            f.candidate.id,
            "2026-08-03T18:00:00Z",
            "owner",
          )
        : null;
    const id = randomUUID();
    if (kind === "opportunity_email")
      await f.client.query(
        "insert into booking_opportunity_email_state(id,opportunity_id,event_year,state,purpose) values ($1,$2,2026,'draft','new_outreach')",
        [id, op],
      );
    else
      await f.client.query(
        "insert into office_email_drafts(id,organization_id,event_year,booking_id,state,recipient_email,subject,body) values ($1,$2,2026,$3,'submitted','owner@example.com','Availability','Reviewed offer')",
        [id, org, booking],
      );
    const { OutreachDispatch } = await import("./outreach-dispatch");
    const dispatch = new OutreachDispatch(
      f.db,
      f.allocation,
      undefined,
      () => true,
      f.allocation.clock,
    );
    const preview = await dispatch.review(kind, id);
    await dispatch.approve(
      kind,
      id,
      {
        digest: preview.digest,
        intent,
        holdId: hold?.id ?? null,
        stage: "initial",
        reason: "Reviewed exact recipient and offer",
      },
      "owner",
    );
    return { ...f, id, hold, dispatch, preview, kind };
  }
  it.each(["opportunity_email", "office_email"] as const)(
    "final review %s blocks current protections at review, approval, scheduled claim and final boundary",
    async (kind) => {
      const f = await reviewed(kind, "exploratory");
      const mutations = [
        "update organizations set last_resort=true",
        "update organizations set region='TX'",
        "update booking_opportunities set email_automation_protected=true",
        "update booking_opportunities set status='declined'",
        "update booking_opportunities set status='not_pursuing'",
        "update booking_opportunities set status='territory_hold',territory_exception_approved=false",
      ];
      const reset = async () => {
        await f.client.exec(
          "update organizations set last_resort=false,region=null; update booking_opportunities set email_automation_protected=false,status='ready_to_contact',territory_exception_approved=false",
        );
      };
      if (kind === "opportunity_email")
        await f.client.query(
          "update booking_opportunity_email_state set state='scheduled',scheduled_for='2026-08-01T17:00:00Z' where id=$1",
          [f.id],
        );
      for (const change of mutations) {
        await f.client.exec(change);
        const review = await f.dispatch.review(kind, f.id);
        expect(review.approvalCurrent).toBe(false);
        expect(review.reviewReasons.join(" ")).toMatch(/DO NOT SEND/);
        await expect(
          f.dispatch.approve(
            kind,
            f.id,
            {
              digest: review.digest,
              intent: "administrative",
              holdId: null,
              stage: null,
              reason: "Ordinary content approval is not a protection exception",
            },
            "owner",
          ),
        ).rejects.toThrow(/DO NOT SEND/);
        await expect(
          f.dispatch.claim(kind, f.id, f.preview.draft.content),
        ).rejects.toThrow(/DO NOT SEND/);
        await reset();
      }
      const claim = await f.dispatch.claim(kind, f.id, f.preview.draft.content);
      for (const change of mutations) {
        await f.client.exec(change);
        await expect(f.dispatch.assertCurrent(claim)).rejects.toMatchObject({
          code: "OUTREACH_SEND_RECHECK_FAILED",
        });
        await reset();
      }
      await f.client.exec(
        "update booking_opportunities set status='territory_hold',territory_exception_approved=true",
      );
      await expect(f.dispatch.assertCurrent(claim)).resolves.toBeUndefined();
    },
  );
  it.each(["opportunity_email", "office_email"] as const)(
    "final review %s coordinator stops provider submission when protection changes after claim",
    async (kind) => {
      const f = await reviewed(kind, "exploratory");
      const payload = f.preview.draft;
      const finalSubmit = vi.fn();
      const provider = async (input: any) => {
        await f.client.exec(
          "update booking_opportunities set email_automation_protected=true",
        );
        await input.beforeSend();
        finalSubmit();
        return { messageId: "must-not-send", sentAt: f.allocation.clock() };
      };
      const draft = {
        ...payload,
        recipientEmail: payload.content.to,
        subject: payload.content.subject,
        body: payload.content.body,
        gmailDraftId: "draft1",
        state: "scheduled",
        scheduledFor: new Date("2026-08-01T17:00:00Z"),
      };
      if (kind === "opportunity_email") {
        await f.client.query(
          "update booking_opportunity_email_state set state='scheduled',scheduled_for=$2 where id=$1",
          [f.id, draft.scheduledFor],
        );
        const { OpportunityEmailService } =
          await import("../opportunity-email/opportunity-email-service");
        const { ScheduledEmailDispatcher } =
          await import("../opportunity-email/scheduled-email-dispatcher");
        const delivery = new OpportunityEmailService({
          emailRepository: {
            getById: async () => draft,
            update: vi.fn(async () => draft),
          },
          gmailDraftProvider: { sendDraft: provider },
          dispatchSafety: f.dispatch,
        } as any);
        const releaseLease = vi.fn();
        await new ScheduledEmailDispatcher({
          store: { claimOneDue: async () => draft as any, releaseLease },
          delivery,
        }).runOne({ workerId: "test-worker", now: f.allocation.clock() });
        expect(releaseLease).toHaveBeenCalledWith(
          f.id,
          "test-worker",
          f.allocation.clock(),
        );
      } else {
        const { OfficeEmailSendCoordinator } =
          await import("../office/office-email-send-coordinator");
        const restore = vi.fn(async () => undefined);
        const coordinator = new OfficeEmailSendCoordinator({
          drafts: {
            claimForSend: async () => draft,
            restoreSubmittedAfterFailure: restore,
            markSent: vi.fn(),
          },
          delivery: { send: provider },
          dispatchSafety: f.dispatch,
        } as any);
        await expect(
          coordinator.send({ draftId: f.id, overrides: {} }),
        ).rejects.toMatchObject({ code: "OUTREACH_SEND_RECHECK_FAILED" });
        expect(restore).toHaveBeenCalled();
      }
      expect(finalSubmit).not.toHaveBeenCalled();
      expect((await f.dispatch.list())[0]).toMatchObject({
        state: "not_sent",
        lastError: expect.stringContaining("DO NOT SEND"),
      });
    },
  );
  it.each(["opportunity_email", "office_email"] as const)(
    "%s rechecks exact DO NOT SEND targets and override recipient before submission",
    async (kind) => {
      const f = await reviewed(kind, "exploratory");
      await f.client.exec(
        `insert into communication_blocks(target_type,reason) values ('internal_preview','Preview only'),('lead_import_row','Unrelated import row');`,
      );
      const overrides = { to: "Override@Example.com" };
      const review = await f.dispatch.review(kind, f.id, overrides);
      await f.dispatch.approve(
        kind,
        f.id,
        {
          digest: review.digest,
          intent: "exploratory",
          holdId: null,
          stage: "initial",
          overrides,
          reason: "Reviewed override recipient",
        },
        "owner",
      );
      await f.client.exec(
        `insert into communication_blocks(target_type,normalized_email,reason) values ('recipient_email','override@example.com','Owner suppression');`,
      );
      await expect(
        f.dispatch.claim(kind, f.id, review.draft.content),
      ).rejects.toThrow("DO NOT SEND");
      await f.client.exec(
        `update communication_blocks set active=false where target_type='recipient_email'`,
      );
      const claim = await f.dispatch.claim(kind, f.id, review.draft.content);
      await f.dispatch.assertCurrent(claim);
      expect((await f.dispatch.list())[0]).toMatchObject({
        id: claim.id,
        draftId: f.id,
        draftKind: kind,
        state: "dispatching",
      });
      await f.client.exec(
        `insert into communication_blocks(target_type,organization_id,reason) values ('organization','${org}','Stop all outreach');`,
      );
      await expect(f.dispatch.assertCurrent(claim)).rejects.toMatchObject({
        code: "OUTREACH_SEND_RECHECK_FAILED",
      });
      expect(
        (await f.service.get()).candidates[0].sources.protectedReason,
      ).toContain("DO NOT SEND");
    },
  );
  it.each(["opportunity_email", "office_email"] as const)(
    "%s permits only the final approved content and one contender",
    async (kind) => {
      const f = await reviewed(kind);
      await expect(
        f.dispatch.claim(kind, f.id, {
          ...f.preview.draft.content,
          body: "Unreviewed promise",
        }),
      ).rejects.toThrow(/exact final/);
      const result = await Promise.allSettled([
        f.dispatch.claim(kind, f.id, f.preview.draft.content),
        f.dispatch.claim(kind, f.id, f.preview.draft.content),
      ]);
      expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(
        (await f.client.query("select * from outreach_dispatches")).rows,
      ).toHaveLength(1);
      await expect(
        f.allocation.releaseHold(f.hold!.id, "owner"),
      ).rejects.toThrow(/unresolved delivery/);
      await expect(
        f.allocation.extendHold(f.hold!.id, "2026-08-04T18:00:00Z", "owner"),
      ).rejects.toThrow(/unresolved delivery/);
    },
  );
  it("edits then restores content still invalidate revision; hold revisions and identity cannot reuse approval", async () => {
    const f = await reviewed();
    await f.client.query(
      "update booking_opportunity_email_state set body='Changed' where id=$1",
      [f.id],
    );
    await f.client.query(
      "update booking_opportunity_email_state set body='Reviewed offer' where id=$1",
      [f.id],
    );
    expect((await f.dispatch.review(f.kind, f.id)).approvalCurrent).toBe(false);
    await expect(
      f.dispatch.claim(f.kind, f.id, f.preview.draft.content),
    ).rejects.toThrow(/exact final/);
    const now = await f.dispatch.review(f.kind, f.id);
    await f.dispatch.approve(
      f.kind,
      f.id,
      {
        digest: now.digest,
        intent: "specific_offer",
        holdId: f.hold!.id,
        stage: null,
        reason: "Re-reviewed",
      },
      "owner",
    );
    await f.allocation.extendHold(f.hold!.id, "2026-08-04T18:00:00Z", "owner");
    await expect(
      f.dispatch.claim(f.kind, f.id, now.draft.content),
    ).rejects.toThrow(/Hold changed/);
    await f.client.query(
      "update booking_opportunities set event_year=2027 where id=$1",
      [op],
    );
    await expect(f.dispatch.review(f.kind, f.id)).rejects.toThrow(
      /identity or event year/,
    );
  });
  it("uncertainty survives real expiry and blocks new allocations until owner outcome reconciliation", async () => {
    const f = await reviewed();
    const claim = await f.dispatch.claim(f.kind, f.id, f.preview.draft.content);
    expect(await f.dispatch.fail(claim, new Error("network timeout"))).toBe(
      false,
    );
    f.setNow("2026-08-04T18:00:00Z");
    const catalog = await f.allocation.list();
    expect(catalog.holds.find((h) => h.id === f.hold!.id)?.state).toBe(
      "expired",
    );
    expect(
      (await f.allocation.evaluateCommitment(booking)).capacity.reasons.join(
        " ",
      ),
    ).toMatch(/unresolved specific-offer/);
    await expect(f.dispatch.recover(f.kind, f.id)).rejects.toThrow(
      /outcome requires review/,
    );
    await f.dispatch.reconcile(
      claim.id,
      {
        outcome: "not_sent",
        providerOperationTerminated: true,
        sourceReference: "Provider terminal rejection receipt",
        reason: "Verified no message was delivered",
      },
      "owner",
    );
    expect(await f.dispatch.recover(f.kind, f.id)).toBeNull();
    expect(
      (await f.allocation.evaluateCommitment(booking)).capacity.reasons.join(
        " ",
      ),
    ).not.toMatch(/unresolved specific-offer/);
  });
  it("confirmed success atomically saves the actual source and replays without permitting another send", async () => {
    const f = await reviewed();
    const claim = await f.dispatch.claim(f.kind, f.id, f.preview.draft.content);
    const confirmation = {
      messageId: "actual-message",
      threadId: "actual-thread",
      sentAt: new Date("2026-08-01T18:00:10Z"),
    };
    await expect(confirm(f)).rejects.toThrow();
    await f.dispatch.assertCurrent(claim);
    await f.dispatch.finish(claim, confirmation);
    await f.dispatch.finish(claim, confirmation);
    expect(
      (
        await f.client.query(
          "select state,gmail_message_id,body from booking_opportunity_email_state where id=$1",
          [f.id],
        )
      ).rows[0],
    ).toMatchObject({
      state: "sent",
      gmail_message_id: "actual-message",
      body: f.preview.draft.content.body,
    });
    expect(
      (await f.dispatch.recover(f.kind, f.id))?.confirmation?.messageId,
    ).toBe("actual-message");
    await expect(
      f.dispatch.claim(f.kind, f.id, f.preview.draft.content),
    ).rejects.toThrow(/already been sent/);
    const { replayActualOutreach } = await import("./outreach-events");
    await replayActualOutreach(f.db, op);
    await replayActualOutreach(f.db, op);
    expect(
      (await f.client.query("select source_id,stage from outreach_attempts"))
        .rows,
    ).toEqual([{ source_id: "gmail:actual-message", stage: "initial" }]);
    await confirm(f);
    expect(
      (await f.allocation.list()).holds.find((h) => h.id === f.hold!.id)?.state,
    ).toBe("converted");
  });
  it("definite rejection allows retry; unknown-year specific offers need identity review", async () => {
    const f = await reviewed("office_email", "exploratory");
    const claim = await f.dispatch.claim(f.kind, f.id, f.preview.draft.content);
    expect(
      await f.dispatch.fail(
        claim,
        Object.assign(new Error("Rejected"), { code: "MAIL_SEND_REJECTED" }),
      ),
    ).toBe(true);
    expect(await f.dispatch.recover(f.kind, f.id)).toBeNull();
    await f.client.query(
      "update office_email_drafts set event_year=null,booking_id=null where id=$1",
      [f.id],
    );
    const p = await f.dispatch.review(f.kind, f.id);
    await expect(
      f.dispatch.approve(
        f.kind,
        f.id,
        {
          digest: p.digest,
          intent: "specific_offer",
          holdId: randomUUID(),
          stage: null,
          reason: "Unknown year",
        },
        "owner",
      ),
    ).rejects.toThrow(/exact booking/);
    await f.dispatch.approve(
      f.kind,
      f.id,
      {
        digest: p.digest,
        intent: "administrative",
        holdId: null,
        stage: null,
        reason: "Explicit account administration",
      },
      "owner",
    );
    await f.dispatch.assignOfficeIdentity(
      f.id,
      { opportunityId: op, reason: "Owner selected the correct dated booking" },
      "owner",
    );
    expect((await f.dispatch.review(f.kind, f.id)).draft).toMatchObject({
      opportunityId: op,
      bookingId: booking,
      eventYear: 2026,
    });
  });

  it("records OAuth token rejection as not sent and permits reviewed retry", async () => {
    const f = await reviewed();
    const claim = await f.dispatch.claim(f.kind, f.id, f.preview.draft.content);
    const { createGoogleGmailDeliveryClient } =
      await import("../google-workspace/google-gmail-delivery-client");
    const fetcher = vi.fn(async () =>
      Response.json({ error: "invalid_grant" }, { status: 400 }),
    );
    const client = createGoogleGmailDeliveryClient({
      environment: {
        clientId: "test",
        clientSecret: "test",
        redirectUri: "https://example.com",
        appOrigin: "https://example.com",
        tokenEncryptionKey: new Uint8Array(32),
      },
      refreshToken: "expired",
      fetcher,
    });
    let failure: unknown;
    try {
      await client.sendGmailDraft({ draftId: "draft", raw: "YWJj" });
    } catch (error) {
      failure = error;
    }

    expect(fetcher).toHaveBeenCalledOnce();
    expect(failure).toMatchObject({
      code: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
    });
    expect(await f.dispatch.fail(claim, failure)).toBe(true);
    expect(
      (
        await f.client.query(
          "select state from outreach_dispatches where id=$1",
          [claim.id],
        )
      ).rows[0],
    ).toEqual({ state: "not_sent" });
    expect(await f.dispatch.recover(f.kind, f.id)).toBeNull();
  });
});

describe("actual inbound and call source replay", () => {
  it("persists actual inbound receipt idempotently, pauses even reviewed history, and never mistakes it for interest", async () => {
    const f = await setup();
    const { observeInboundOutreach, reviewInboundObservation } =
      await import("./outreach-inbound");
    await f.client.query(
      "insert into booking_opportunity_email_state(id,opportunity_id,event_year,state,purpose,sent_at,gmail_message_id,gmail_thread_id) values ($1,$2,2026,'sent','new_outreach','2026-07-01','sent','thread')",
      [randomUUID(), op],
    );
    const message = {
      id: "incoming",
      threadId: "thread",
      internalDateMs: Date.parse("2026-07-02T12:00:00Z"),
      labelIds: ["INBOX"],
      resolvedOrganization: { id: org, name: "Event" },
      from: "contact@example.com",
      to: "owner@example.com",
      evidenceCodes: ["existing_thread_association"],
    } as any;
    await observeInboundOutreach(
      f.db,
      [
        message,
        { ...message, id: "sent-copy", labelIds: ["SENT", "INBOX"] },
        { ...message, id: "profile-review", threadId: "unknown-thread" },
      ],
      f.allocation.clock(),
    );
    await observeInboundOutreach(f.db, [message], f.allocation.clock());
    const rows = (
      await f.client.query<{
        id: string;
        message_id: string;
        opportunity_id: string | null;
        event_year: number | null;
        state: string;
      }>("select * from outreach_inbound_observations")
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.message_id === "incoming")).toMatchObject({
      opportunity_id: op,
      event_year: 2026,
      state: "needs_review",
    });
    expect(
      rows.find((row) => row.message_id === "profile-review"),
    ).toMatchObject({
      opportunity_id: null,
      event_year: null,
      state: "needs_review",
    });
    await f.service.reviewHistory(
      f.candidate.id,
      { reason: "Reviewed stored history" },
      "owner",
    );
    const c = (await f.service.get()).candidates[0];
    expect(c.sources.protectedReason).toMatch(/Received email/);
    expect(c.sources.observedInterestAt).toBeUndefined();
    expect(c.outreach.state).toBe("needs_review");
    await reviewInboundObservation(
      f.db,
      (rows.find((row) => row.message_id === "incoming") as { id: string }).id,
      {
        classification: "meaningful_reply",
        opportunityId: op,
        reason: "Actual interested reply reviewed",
        sourceReference: "Gmail incoming",
      },
      "owner",
    );
    await reviewInboundObservation(
      f.db,
      (
        rows.find((row) => row.message_id === "profile-review") as {
          id: string;
        }
      ).id,
      {
        classification: "not_reply",
        opportunityId: null,
        reason: "Owner reviewed unrelated profile mail",
        sourceReference: "Gmail incoming",
      },
      "owner",
    );
    expect((await f.service.get()).candidates[0].outreach.state).toBe("reply");
  });

  it("keeps explicitly administrative sends out of cadence evidence", async () => {
    const f = await setup();
    const opportunityDraftId = randomUUID();
    await f.client.query(
      "insert into booking_opportunity_email_state(id,opportunity_id,event_year,state,purpose,sent_at,gmail_message_id) values ($1,$2,2026,'sent','new_outreach','2026-07-01','admin-message')",
      [opportunityDraftId, op],
    );
    await f.client.query(
      `insert into outreach_dispatches
        (draft_kind,draft_id,digest,intent,payload,state,confirmation,review_after)
       values ('opportunity_email',$1,$2,'administrative',$3,'sent',$4,now())`,
      [
        opportunityDraftId,
        "a".repeat(64),
        JSON.stringify({ opportunityId: op, eventYear: 2026 }),
        JSON.stringify({ messageId: "admin-message", sentAt: "2026-07-01" }),
      ],
    );
    const officeDraftId = randomUUID();
    await f.client.query(
      "insert into office_email_drafts(id,organization_id,event_year,booking_id,state,sent_at,sent_message_id,recipient_email,subject,body) values ($1,$2,null,null,'sent','2026-07-02','office-admin','owner@example.com','Account','Administrative')",
      [officeDraftId, org],
    );
    await f.client.query(
      `insert into outreach_dispatches
        (draft_kind,draft_id,digest,intent,payload,state,confirmation,review_after)
       values ('office_email',$1,$2,'administrative',$3,'sent',$4,now())`,
      [
        officeDraftId,
        "b".repeat(64),
        JSON.stringify({ opportunityId: null, eventYear: null }),
        JSON.stringify({ messageId: "office-admin", sentAt: "2026-07-02" }),
      ],
    );

    const candidate = (await f.service.get()).candidates[0];
    const opportunitySource = candidate.sources.choices.find(
      (source) => source.id === "gmail:admin-message",
    );
    const officeSource = candidate.sources.choices.find((source) =>
      source.id.startsWith(`office-email:${officeDraftId}:`),
    );
    expect(opportunitySource).toMatchObject({ eligible: false });
    expect(officeSource).toMatchObject({
      eligible: false,
      requiresEventYearConfirmation: false,
    });
    expect(candidate.sources.pendingSourceReviewIds).not.toContain(
      opportunitySource?.id,
    );
    expect(candidate.sources.pendingSourceReviewIds).not.toContain(
      officeSource?.id,
    );
  });

  it("persists a read archived message as inbound review evidence", async () => {
    const f = await setup();
    const { observeInboundOutreach } = await import("./outreach-inbound");
    await f.client.query(
      "insert into booking_opportunity_email_state(id,opportunity_id,event_year,state,purpose,sent_at,gmail_message_id,gmail_thread_id) values ($1,$2,2026,'sent','new_outreach','2026-07-01','sent','archived-thread')",
      [randomUUID(), op],
    );
    await observeInboundOutreach(
      f.db,
      [
        {
          id: "archived-reply",
          threadId: "archived-thread",
          internalDateMs: Date.parse("2026-07-02T12:00:00Z"),
          labelIds: [],
          resolvedOrganization: { id: org, name: "Event" },
          from: "contact@example.com",
          to: "owner@example.com",
          evidenceCodes: ["existing_thread_association"],
        } as any,
      ],
      f.allocation.clock(),
    );

    expect(
      (
        await f.client.query(
          "select state from outreach_inbound_observations where message_id='archived-reply'",
        )
      ).rows[0],
    ).toEqual({ state: "needs_review" });
  });

  it("completed outgoing calls expose pending stage review; a later unlinked actual attempt prevents old-chain advancement", async () => {
    const f = await setup();
    for (const [stage, date] of [
      ["initial", "2026-07-01"],
      ["follow_up_1", "2026-07-09"],
      ["follow_up_2", "2026-07-18"],
    ])
      await f.client.query(
        "insert into outreach_attempts(candidate_id,source_id,stage,occurred_at,actor) values ($1,$2,$3,$4,'owner')",
        [f.candidate.id, stage, stage, date],
      );
    const id = randomUUID();
    await f.client.query(
      "insert into call_sessions(id,organization_id,booking_id,ended_at,direction,disposition) values ($1,$2,$3,'2026-07-31','outgoing','no_answer')",
      [id, org, booking],
    );
    await f.service.reviewHistory(
      f.candidate.id,
      { reason: "History reviewed after new call" },
      "owner",
    );
    const c = (await f.service.get()).candidates[0];
    expect(c.sources.pendingSourceReviewIds).toContain(`call:${id}`);
    expect(c.outreach.state).toBe("needs_review");
    await expect(f.service.advance(f.candidate.id, "owner")).rejects.toThrow(
      /Only the leading pursuit/,
    );
    await f.service.reviewActualSource(
      f.candidate.id,
      {
        sourceId: `call:${id}`,
        classification: "additional_attempt",
        reason: "Owner confirms an additional attempt",
      },
      "owner",
    );
    expect((await f.service.get()).candidates[0].outreach.state).toBe(
      "waiting",
    );
  });
});

describe("dispatch migration repair", () => {
  it("restores late dispatch metadata and review indexes without losing the ledger", async () => {
    const f = await setup();
    const dispatchId = randomUUID();
    await f.client.query(
      `insert into outreach_dispatches
        (id,draft_kind,draft_id,digest,intent,payload,state,review_after)
       values ($1,'opportunity_email',$2,$3,'exploratory','{}','not_sent',now())`,
      [dispatchId, randomUUID(), "a".repeat(64)],
    );
    await f.client.exec(`
      drop index outreach_inbound_review;
      alter table outreach_dispatches drop column tracking_state;
      alter table outreach_source_reviews drop constraint outreach_source_review_classification;
      drop function outreach_draft_revision() cascade;
    `);

    const entry = (await loadActReviewMigrations()).find(
      ({ name }) => name === "20260909_outreach_dispatch.sql",
    )!;
    expect(
      (await f.client.query<{ ready: boolean }>(entry.markerSql)).rows[0].ready,
    ).toBe(false);
    await f.client.exec(entry.sql);

    expect(
      (await f.client.query<{ ready: boolean }>(entry.markerSql)).rows[0].ready,
    ).toBe(true);
    expect(
      (
        await f.client.query(
          "select id,tracking_state from outreach_dispatches where id=$1",
          [dispatchId],
        )
      ).rows[0],
    ).toEqual({ id: dispatchId, tracking_state: "pending" });
  });
});

describe("explicit prospect event identity resolution", () => {
  const binding = (bookingId: string) => ({
    bookingId,
    confirmedEventYear: 2026,
    confirmedSameEvent: true as const,
    reason:
      "Organizer confirmed the same annual event and actual booking dates.",
    sourceReference: "https://festival.example/2026/program",
  });
  async function prospect() {
    const f = await setup();
    await f.client.exec(`
      alter table organizations add consolidated_into_id uuid;
      alter table bookings add organization_id uuid, add primary_contact_id uuid;
      alter table booking_opportunities alter column id set default gen_random_uuid();
      update bookings set organization_id='10000000-0000-4000-8000-000000000001';
    `);
    const profile = randomUUID(),
      book = randomUUID();
    await f.client.query(
      "insert into organizations(id,name) values ($1,'Matched Festival')",
      [profile],
    );
    const admitted = await f.service.admitProfile(
      {
        organizationId: profile,
        eventYear: 2026,
        reason: "Saved undated future prospect",
      },
      "owner",
    );
    expect(admitted.bookingId).toBeNull();
    const c = await f.service.createCandidate(
      {
        openingId: f.opening.id,
        opportunityId: admitted.opportunityId,
        tier: "strong",
        manualRank: 7,
      },
      "owner",
    );
    // Actual booking becomes known later; no opportunity/profile/history is recreated.
    await f.client.query(
      "insert into bookings(id,organization_id,name,starts_at,ends_at,status,travel_leg_id) values ($1,$2,'Matched Festival 2026','2026-10-16T15:00:00Z','2026-10-18T23:00:00Z','new_lead',$3)",
      [book, profile, leg],
    );
    await f.client.query(
      "insert into booking_package_selections values ($1,$2)",
      [book, pkg],
    );
    return {
      ...f,
      profile,
      book,
      opportunity: admitted.opportunityId,
      prospectCandidate: c,
    };
  }
  it("admits an undated prospect, resolves the selected booking once, preserves history/manual work, and uses normal demand/fit review", async () => {
    const f = await prospect();
    const {
      client,
      service,
      profile,
      book,
      opportunity,
      prospectCandidate: c,
    } = f;
    const emailState = randomUUID(),
      call = randomUUID(),
      followup = randomUUID(),
      research = randomUUID();
    const researchResults = [
      {
        opportunityId: opportunity,
        sourceUrl: "https://festival.example/source",
        note: "Saved organizer research",
        dateConfidence: "unknown",
      },
    ];
    await client.query(
      "insert into outreach_research_tasks(id,opening_id,criteria,results) values ($1,$2,'Existing event research',$3)",
      [research, f.opening.id, JSON.stringify(researchResults)],
    );
    await client.query(
      "update booking_opportunities set status='needs_review',priority='high',next_action_kind='callback',next_action_due_at='2026-10-01T15:00:00Z' where id=$1",
      [opportunity],
    );
    await client.query(
      "insert into booking_opportunity_email_state(id,opportunity_id,organization_id,event_year,state,subject) values ($1,$2,$3,2026,'draft','Existing convention follow-up')",
      [emailState, opportunity, profile],
    );
    await client.query(
      "insert into call_sessions(id,organization_id,ended_at,direction,disposition) values ($1,$2,'2026-07-01','outbound','completed')",
      [call, profile],
    );
    await client.query(
      "insert into follow_ups(id,organization_id,kind,due_at) values ($1,$2,'callback','2026-10-01T15:00:00Z')",
      [followup, profile],
    );
    await service.reviewHistory(
      c.id,
      { reason: "Reviewed existing calls and source history" },
      "owner",
    );
    await service.patchCandidate(
      c.id,
      {
        decisionDueAt: "2026-10-02T15:00:00Z",
        reason: "Existing decision promise",
      },
      "owner",
    );
    const candidateBefore = (
      await client.query("select * from outreach_candidates where id=$1", [
        c.id,
      ])
    ).rows[0] as any;
    const opportunityBefore = (
      await client.query("select * from booking_opportunities where id=$1", [
        opportunity,
      ])
    ).rows[0] as any;
    const profiles = await service.searchProfiles({
      q: "Matched",
      year: "2026",
    });
    expect(profiles[0]).toMatchObject({
      organizationId: profile,
      bookings: [
        expect.objectContaining({ id: book, name: "Matched Festival 2026" }),
      ],
    });
    const result = await service.bindOpportunity(
      opportunity,
      binding(book),
      "owner",
    );
    expect(result).toMatchObject({
      opportunityId: opportunity,
      bookingId: book,
      eventYear: 2026,
      reused: false,
    });
    const after = (
      await client.query("select * from booking_opportunities where id=$1", [
        opportunity,
      ])
    ).rows[0];
    expect(after).toEqual({
      ...opportunityBefore,
      booking_id: book,
      updated_at: expect.any(Date),
    });
    const candidateAfter = (
      await client.query("select * from outreach_candidates where id=$1", [
        c.id,
      ])
    ).rows[0];
    expect(candidateAfter).toEqual({
      ...candidateBefore,
      checked_at: null,
      source_snapshot: null,
    });
    expect(
      (
        await client.query(
          "select opportunity_id,subject from booking_opportunity_email_state where id=$1",
          [emailState],
        )
      ).rows[0],
    ).toEqual({
      opportunity_id: opportunity,
      subject: "Existing convention follow-up",
    });
    expect(
      (await client.query("select id from call_sessions where id=$1", [call]))
        .rows,
    ).toHaveLength(1);
    expect(
      (await client.query("select id from follow_ups where id=$1", [followup]))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await client.query(
          "select results from outreach_research_tasks where id=$1",
          [research],
        )
      ).rows[0],
    ).toEqual({ results: researchResults });
    const audit = (
      await client.query(
        "select detail from outreach_audit where entity_id=$1 and action='bind_opportunity_booking'",
        [opportunity],
      )
    ).rows[0] as any;
    expect(audit.detail).toMatchObject({
      actor: "owner",
      confirmedSameEvent: true,
      sourceReference: binding(book).sourceReference,
      priorIdentity: { bookingId: null },
      newIdentity: { bookingId: book },
    });
    expect(
      (
        await client.query("select body from activities where id=$1", [
          audit.detail.profileActivityId,
        ])
      ).rows[0],
    ).toMatchObject({ body: expect.stringContaining("Matched Festival 2026") });
    const repeated = await service.bindOpportunity(
      opportunity,
      binding(book),
      "owner",
    );
    expect(repeated.reused).toBe(true);
    expect(
      (
        await client.query(
          "select id from outreach_audit where entity_id=$1 and action='bind_opportunity_booking'",
          [opportunity],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await client.query(
          "select id from booking_opportunities where organization_id=$1 and event_year=2026",
          [profile],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (await service.get()).candidates.find((x) => x.id === c.id)?.capacity
        .status,
    ).toBe("needs_review");
    await service.saveDemand(
      c.id,
      {
        quantities: { adventure_zone: 1 },
        resourceIds: [resource],
        completePhysicalDemandReviewed: true,
        reason: "Separately reviewed complete physical requirements",
      },
      "owner",
    );
    expect(
      (
        await client.query(
          "select booking_id from outreach_booking_demand where booking_id=$1",
          [book],
        )
      ).rows,
    ).toEqual([{ booking_id: book }]);
    const check = await service.check(c.id, "owner");
    expect(check.capacity.status).toBe("fits");
    expect(
      (
        await client.query(
          "select id from outreach_holds where candidate_id=$1",
          [c.id],
        )
      ).rows,
    ).toHaveLength(0);
    await expect(
      service.bindOpportunity(opportunity, binding(booking), "owner"),
    ).rejects.toThrow("already linked");
  });
  it("rejects wrong profile/year, invalid actual dates, retired/protected profiles and protected contacts without binding", async () => {
    const { client, service, opportunity, profile, book } = await prospect();
    await expect(
      service.bindOpportunity(opportunity, binding(booking), "owner"),
    ).rejects.toThrow("on this profile");
    await expect(
      service.bindOpportunity(
        opportunity,
        { ...binding(book), confirmedEventYear: 2027 },
        "owner",
      ),
    ).rejects.toThrow("confirmed event year");
    for (const [starts, ends] of [
      [null, null],
      ["2027-01-01", "2027-01-02"],
      ["2026-10-18", "2026-10-16"],
      ["infinity", "infinity"],
      ["2026-12-31T23:00:00Z", "2027-01-02T00:00:00Z"],
    ]) {
      await client.query(
        "update bookings set starts_at=$2,ends_at=$3 where id=$1",
        [book, starts, ends],
      );
      await expect(
        service.bindOpportunity(opportunity, binding(book), "owner"),
      ).rejects.toThrow("ordered actual dates");
    }
    await client.query(
      "update bookings set starts_at='2026-10-16',ends_at='2026-10-18' where id=$1",
      [book],
    );
    await client.query(
      "update organizations set consolidated_into_id=$2 where id=$1",
      [profile, org],
    );
    await expect(
      service.bindOpportunity(opportunity, binding(book), "owner"),
    ).rejects.toThrow("active profile");
    await client.query(
      "update organizations set consolidated_into_id=null,last_resort=true where id=$1",
      [profile],
    );
    await expect(
      service.bindOpportunity(opportunity, binding(book), "owner"),
    ).rejects.toThrow("Protected profile");
    await client.query(
      "update organizations set last_resort=false where id=$1",
      [profile],
    );
    for (const protection of [
      "email_automation_protected=true",
      "email_automation_protected=false,status='territory_hold'",
    ]) {
      await client.query(
        `update booking_opportunities set ${protection} where id=$1`,
        [opportunity],
      );
      await expect(
        service.bindOpportunity(opportunity, binding(book), "owner"),
      ).rejects.toThrow("Protected contact or territory");
    }
    await client.query(
      "update booking_opportunities set status='needs_review' where id=$1",
      [opportunity],
    );
    const contact = randomUUID(),
      otherContact = randomUUID();
    await client.query(
      "insert into contacts(id,email) values ($1,'blocked@example.com'),($2,'existing@example.com')",
      [contact, otherContact],
    );
    await client.query(
      "update bookings set primary_contact_id=$2 where id=$1",
      [book, contact],
    );
    await client.query(
      "update booking_opportunities set contact_id=$2 where id=$1",
      [opportunity, otherContact],
    );
    await client.query(
      "insert into communication_blocks(target_type,normalized_email,reason) values ('recipient_email','blocked@example.com','Owner protected recipient')",
    );
    await expect(
      service.bindOpportunity(opportunity, binding(book), "owner"),
    ).rejects.toThrow("DO NOT SEND");
    await client.query(
      "update communication_blocks set target_type='contact',contact_id=$1",
      [otherContact],
    );
    await expect(
      service.bindOpportunity(opportunity, binding(book), "owner"),
    ).rejects.toThrow("DO NOT SEND");
    await client.query(
      "update communication_blocks set target_type='organization',organization_id=$1",
      [profile],
    );
    await expect(
      service.bindOpportunity(opportunity, binding(book), "owner"),
    ).rejects.toThrow("DO NOT SEND");
    expect(
      (
        await client.query(
          "select booking_id from booking_opportunities where id=$1",
          [opportunity],
        )
      ).rows,
    ).toEqual([{ booking_id: null }]);
  });
  it.each(["dispatching", "uncertain"])(
    "blocks %s opportunity and unknown-identity Office dispatches under the allocation mutex",
    async (state) => {
      const { client, db, service, opportunity, profile, book } =
        await prospect();
      for (const kind of ["opportunity_email", "office_email"]) {
        const draft = randomUUID();
        if (kind === "opportunity_email")
          await client.query(
            "insert into booking_opportunity_email_state(id,opportunity_id,organization_id,event_year,state) values ($1,$2,$3,2026,'draft')",
            [draft, opportunity, profile],
          );
        else
          await client.query(
            "insert into office_email_drafts(id,organization_id,state) values ($1,$2,'submitted')",
            [draft, profile],
          );
        await withAllocationTransaction(db, async (tx) => {
          await tx.execute(
            sql`insert into outreach_dispatches(draft_kind,draft_id,digest,intent,payload,state,review_after) values (${kind},${draft}::uuid,${"a".repeat(64)},'exploratory',${JSON.stringify({ organizationId: profile, opportunityId: kind === "opportunity_email" ? opportunity : null, eventYear: null })}::jsonb,${state},now())`,
          );
        });
        await expect(
          service.bindOpportunity(opportunity, binding(book), "owner"),
        ).rejects.toThrow("Reconcile the provider outcome");
        expect(
          (
            await client.query(
              "select booking_id from booking_opportunities where id=$1",
              [opportunity],
            )
          ).rows,
        ).toEqual([{ booking_id: null }]);
        await withAllocationTransaction(db, async (tx) => {
          await tx.execute(
            sql`update outreach_dispatches set state='not_sent' where draft_id=${draft}::uuid`,
          );
        });
      }
      expect(
        (await service.bindOpportunity(opportunity, binding(book), "owner"))
          .reused,
      ).toBe(false);
    },
  );
  it.each([2026, null])(
    "retires approvals and rejects pre-binding Office review for year %s; fails closed without the shared mutex",
    async (eventYear) => {
      const { client, db, service, allocation, opportunity, profile, book } =
        await prospect();
      const { OutreachDispatch } = await import("./outreach-dispatch");
      const dispatch = new OutreachDispatch(
        db,
        allocation,
        undefined,
        () => true,
      );
      const office = randomUUID(),
        email = randomUUID();
      await client.query(
        "insert into office_email_drafts(id,organization_id,event_year,state,recipient_email,subject,body) values ($1,$2,$3,'submitted','owner@example.com','Event enquiry','Please confirm event details')",
        [office, profile, eventYear],
      );
      await client.query(
        "insert into booking_opportunity_email_state(id,opportunity_id,organization_id,event_year,state) values ($1,$2,$3,2026,'draft')",
        [email, opportunity, profile],
      );
      await client.query(
        "insert into outreach_offer_approvals(draft_kind,draft_id,digest,intent,actor,reason) values ('office_email',$1,$3,'exploratory','owner','Prior review'),('opportunity_email',$2,$3,'exploratory','owner','Prior review')",
        [office, email, "a".repeat(64)],
      );
      const priorReview = await dispatch.review("office_email", office);
      await client.exec("delete from outreach_allocation_mutex");
      await expect(
        service.bindOpportunity(opportunity, binding(book), "owner"),
      ).rejects.toThrow("Allocation mutex is missing");
      await client.exec("insert into outreach_allocation_mutex(id) values (1)");
      await service.bindOpportunity(opportunity, binding(book), "owner");
      expect(
        (
          await client.query(
            "select * from outreach_offer_approvals where draft_id in ($1,$2)",
            [office, email],
          )
        ).rows,
      ).toHaveLength(0);
      const audit = (
        await client.query(
          "select detail from outreach_audit where entity_id=$1 and action='bind_opportunity_booking'",
          [opportunity],
        )
      ).rows[0] as any;
      expect(audit.detail.invalidatedApprovals).toHaveLength(2);
      const currentReview = await dispatch.review("office_email", office);
      expect(currentReview.digest).not.toBe(priorReview.digest);
      expect(currentReview.draft.opportunityIdentities).toEqual([
        { opportunityId: opportunity, bookingId: book, eventYear: 2026 },
      ]);
      await expect(
        dispatch.approve(
          "office_email",
          office,
          {
            digest: priorReview.digest,
            intent: "exploratory",
            holdId: null,
            stage: null,
            overrides: {},
            reason: "Old preview",
          },
          "owner",
        ),
      ).rejects.toThrow("Final email content changed");
      expect(
        (
          await client.query("select * from office_email_drafts where id=$1", [
            office,
          ])
        ).rows[0],
      ).toMatchObject({ booking_id: null, state: "submitted" });
    },
  );
});

describe("final review base migration and late reply lifecycle", () => {
  it("repairs base allocation columns and constraints with retained demand and hold data", async () => {
    const f = await setup();
    const hold = await f.allocation.createHold(
      f.candidate.id,
      "2026-08-03T18:00:00Z",
      "owner",
    );
    const before = (
      await f.client.query(
        "select booking_id,quantities,resource_ids,actor,reason from outreach_booking_demand order by booking_id",
      )
    ).rows;
    const migration = (await loadActReviewMigrations()).find(
      (m) => m.name === "20260909_outreach_allocation.sql",
    )!;
    await f.client.exec(
      `alter table outreach_booking_demand rename constraint outreach_booking_demand_booking_id_fkey to outreach_booking_demand_booking_id_bookings_id_fk;
       alter table outreach_holds rename constraint outreach_holds_candidate_id_fkey to outreach_holds_candidate_id_outreach_candidates_id_fk;
       alter table outreach_holds rename constraint outreach_holds_booking_id_fkey to outreach_holds_booking_id_bookings_id_fk;
       alter table outreach_holds rename constraint outreach_holds_opportunity_id_fkey to outreach_holds_opportunity_id_booking_opportunities_id_fk;
       alter table outreach_holds rename constraint outreach_holds_leg_id_fkey to outreach_holds_leg_id_travel_legs_id_fk;
       alter table outreach_booking_demand drop column revision;
       alter table outreach_holds drop constraint outreach_holds_lifecycle_valid;
       alter table outreach_holds drop constraint outreach_holds_quantities_check;
       alter table outreach_holds alter column quantities drop not null`,
    );
    expect(
      (await f.client.query<{ ready: boolean }>(migration.markerSql)).rows[0]
        .ready,
    ).toBe(false);
    await f.client.exec(migration.sql);
    await f.client.exec(migration.sql);
    expect(
      (await f.client.query<{ ready: boolean }>(migration.markerSql)).rows[0]
        .ready,
    ).toBe(true);
    expect(
      (
        await f.client.query<{ count: string }>(
          "select count(*) from pg_constraint where contype='f' and conrelid in ('outreach_booking_demand'::regclass,'outreach_holds'::regclass)",
        )
      ).rows[0].count,
    ).toBe(5);
    expect(
      (
        await f.client.query(
          "select booking_id,quantities,resource_ids,actor,reason from outreach_booking_demand order by booking_id",
        )
      ).rows,
    ).toEqual(before);
    expect(
      (
        await f.client.query(
          "select id,state,ended_at from outreach_holds where id=$1",
          [hold.id],
        )
      ).rows[0],
    ).toEqual({ id: hold.id, state: "active", ended_at: null });
    await expect(
      f.client.query("update outreach_holds set state='released' where id=$1", [
        hold.id,
      ]),
    ).rejects.toThrow(/lifecycle/);
    await expect(
      f.client.query("update outreach_holds set quantities='{}' where id=$1", [
        hold.id,
      ]),
    ).rejects.toThrow(/quantities/);
    await expect(
      f.client.query("update outreach_holds set quantities=null where id=$1", [
        hold.id,
      ]),
    ).rejects.toThrow(/null/);
  });
  it("advances, observes a late reply, keeps it released in attention, classifies and explicitly resumes only after fresh availability", async () => {
    const f = await setup();
    for (const [i, stage] of [
      "initial",
      "follow_up_1",
      "follow_up_2",
    ].entries()) {
      const occurredAt = `2026-07-${String(1 + i * 7).padStart(2, "0")}T18:00:00Z`;
      await f.client.query(
        "insert into booking_opportunity_email_state(id,opportunity_id,event_year,state,purpose,sent_at,gmail_message_id,gmail_thread_id) values ($1,$2,2026,'sent','new_outreach',$3,$4,'late-thread')",
        [randomUUID(), op, occurredAt, `actual-${i}`],
      );
      await f.client.query(
        "insert into outreach_attempts(candidate_id,source_id,stage,occurred_at,actor) values ($1,$2,$3,$4,'owner')",
        [f.candidate.id, `gmail:actual-${i}`, stage, occurredAt],
      );
    }
    await f.service.reviewHistory(
      f.candidate.id,
      { reason: "Reviewed the actual sent chain" },
      "owner",
    );
    expect((await f.service.get()).candidates[0].outreach.state).toBe(
      "advance",
    );
    await f.service.advance(f.candidate.id, "owner");
    f.setNow("2026-08-02T18:00:00Z");
    const { observeInboundOutreach, reviewInboundObservation } =
      await import("./outreach-inbound");
    await observeInboundOutreach(
      f.db,
      [
        {
          id: "late-reply",
          threadId: "late-thread",
          internalDateMs: Date.parse("2026-08-02T12:00:00Z"),
          labelIds: ["INBOX"],
          resolvedOrganization: { id: org },
          from: "owner@example.com",
          to: "sales@example.com",
          evidenceCodes: [],
        },
      ] as any,
      f.allocation.clock(),
    );
    const message = (
      await f.client.query<{ id: string }>(
        "select id from outreach_inbound_observations where message_id='late-reply'",
      )
    ).rows[0].id;
    let c = (await f.service.get()).candidates[0];
    expect(c).toMatchObject({
      outreach: { state: "needs_review" },
      portfolio: { state: "attention" },
    });
    expect(c.releasedAt).not.toBeNull();
    expect(c.liveHoldId).toBeNull();
    const input = {
      resumeReleased: true,
      decisionDueAt: "2026-08-03T18:00:00Z",
      reason: "Owner chose to revisit late reply after availability check",
    };
    await expect(
      f.service.patchCandidate(c.id, input, "owner"),
    ).rejects.toThrow(/Classify/);
    await reviewInboundObservation(
      f.db,
      message,
      {
        classification: "meaningful_reply",
        opportunityId: op,
        sourceReference: "Gmail late-reply",
        reason: "Reviewed exact event-year reply",
      },
      "owner",
    );
    await f.service.reviewHistory(
      c.id,
      { reason: "Reviewed late reply and complete stored history" },
      "owner",
    );
    const nextOrg = randomUUID(), nextOpportunity = randomUUID();
    await f.client.query("insert into organizations(id,name) values ($1,'Next event')", [nextOrg]);
    await f.client.query("insert into booking_opportunities(id,organization_id,event_year) values ($1,$2,2026)", [nextOpportunity, nextOrg]);
    const next = await f.service.createCandidate({ openingId: f.opening.id, opportunityId: nextOpportunity, tier: "filler" }, "owner");
    await f.service.patchCandidate(next.id, { decisionDueAt: "2026-08-04T18:00:00Z", reason: "Existing callback to the next candidate" }, "owner");
    await expect(f.service.patchCandidate(c.id, input, "owner")).rejects.toThrow(/Another established pursuit/);
    expect((await f.service.get()).candidates.find((x) => x.id === next.id)?.decisionDueAt).toBe("2026-08-04T18:00:00.000Z");
    await f.service.patchCandidate(next.id, { decisionDueAt: null, reason: "Owner explicitly resolved the next candidate callback before reopening late reply" }, "owner");
    f.read.mockRejectedValueOnce(new Error("Calendar unavailable"));
    await expect(
      f.service.patchCandidate(c.id, input, "owner"),
    ).rejects.toThrow(/Fresh availability/);
    expect((await f.service.get()).candidates[0].releasedAt).not.toBeNull();
    await f.service.patchCandidate(c.id, input, "owner");
    c = (await f.service.get()).candidates[0];
    expect(c.releasedAt).toBeNull();
    expect(c.decisionDueAt).toBe(new Date(input.decisionDueAt).toISOString());
    expect(c.attempts).toHaveLength(3);
    expect(c.liveHoldId).toBeNull();
    expect(f.read).toHaveBeenCalled();
  });
});
