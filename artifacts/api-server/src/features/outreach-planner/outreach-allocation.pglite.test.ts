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
async function setup() {
  vi.stubEnv("OUTREACH_PLANNER_ENABLED", "true");
  const client = new PGlite();
  clients.push(client);
  await client.exec(`
create table travel_legs(id uuid primary key,name text);
create table organizations(id uuid primary key,name text,last_resort boolean default false);
create table bookings(id uuid primary key,starts_at timestamptz,ends_at timestamptz,status text,probability text,travel_leg_id uuid);
create table booking_opportunities(id uuid primary key,organization_id uuid references organizations(id),event_year integer not null,booking_id uuid,contact_id uuid,status text default 'ready_to_contact',priority text default 'normal',next_action_kind text,next_action_due_at timestamptz,hold_reason text,email_automation_protected boolean default false,territory_exception_approved boolean default false,created_at timestamptz default now(),updated_at timestamptz default now(), unique(organization_id,event_year));
create table package_templates(id uuid primary key,code text,normal_capacity integer,temporary_unavailable_quantity integer);
create table follow_ups(id uuid primary key,organization_id uuid,booking_id uuid,contact_id uuid,kind text,due_at timestamptz,completed_at timestamptz);
create table booking_opportunity_email_state(id uuid primary key,opportunity_id uuid,event_year integer,state text,sent_at timestamptz,gmail_message_id text,purpose text);
create table call_sessions(id uuid primary key,organization_id uuid,booking_id uuid,ended_at timestamptz,direction text,disposition text,contact_id uuid);
create table boss_convention_submissions(id uuid primary key,applied_at timestamptz,applied_organization_id uuid,applied_contact_id uuid);
create table booking_operational_windows(booking_id uuid,starts_at timestamptz,ends_at timestamptz);
create table booking_package_selections(booking_id uuid,package_template_id uuid);
create table google_operational_calendar_links(id uuid,booking_id uuid,calendar_id text,google_event_id text,package_key text,reserved_starts_at timestamptz,reserved_ends_at timestamptz,last_synced_at timestamptz,last_error_code text);
create table google_workspace_validation_mappings(message_id text,organization_id uuid,updated_at timestamptz);
create table activities(id uuid primary key default gen_random_uuid(),organization_id uuid,contact_id uuid,booking_id uuid,kind text,subject text,status text,body text,occurred_at timestamptz,timeline_sort_at timestamptz,date_is_import_fallback boolean default false,ends_at timestamptz,act_record_id text,source_record_id uuid,source_version_id uuid,source_type text,organization_location_id uuid,created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz);
insert into travel_legs values ('${leg}','Leg 1');insert into organizations values ('${org}','Festival',false);insert into booking_opportunities(id,organization_id,event_year,booking_id) values ('${op}','${org}',2026,'${booking}');
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
  for (const name of [
    "20260909_outreach_planner.sql",
    "20260909_outreach_allocation.sql",
    "20260909_outreach_commitments.sql",
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
