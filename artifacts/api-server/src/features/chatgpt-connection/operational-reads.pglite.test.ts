import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db/schema";
import { fixture } from "./test-database";
import { ConnectionReadService } from "./read-service";
import { connectionTools } from "./tool-registry";
let f: Awaited<ReturnType<typeof fixture>>, service: ConnectionReadService;
const leg = randomUUID(),
  trip = randomUUID(),
  booking = randomUUID(),
  resource = randomUUID();
const period = { dateFrom: "2027-07-21", dateTo: "2027-08-01" };
async function read(section: string, input: Record<string, unknown> = {}) {
  return (service as any).operational(f.principal, { section, ...input });
}
beforeEach(async () => {
  f = await fixture();
  service = new ConnectionReadService(f.db);
  // Production column definitions catch misspelled/nonexistent query fields.
  // Foreign-key/NOT NULL constraints are not needed for this read-only fixture.
  for (const table of [
    schema.travelLegs,
    schema.bookings,
    schema.packageTemplates,
    schema.bookingPackageSelections,
    schema.resources,
    schema.bookingResourceAssignments,
    schema.tripResourceAssignments,
    schema.trips,
    schema.tripStops,
    schema.tripSegments,
    schema.crewWorkHistory,
    schema.resourcePackageTags,
    schema.bookingResourcePackageAttributions,
  ]) {
    const cfg = getTableConfig(table);
    await f.db.exec(`DROP TABLE IF EXISTS "${cfg.name}" CASCADE`);
    const cols = cfg.columns.map(
      (c) =>
        `"${c.name}" ${"enumValues" in c && c.enumValues ? "text" : c.getSQLType()}${c.name === "id" ? " PRIMARY KEY DEFAULT gen_random_uuid()" : ""}`,
    );
    await f.db.exec(`CREATE TABLE "${cfg.name}" (${cols.join(",")})`);
  }
  await f.db.exec(
    readFileSync(
      new URL(
        "../../../../../lib/db/migrations/20260828_leg_assignment_suggestions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await f.db
    .exec(`CREATE TABLE outreach_holds(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid,leg_id uuid,event_starts_on date,event_ends_on date,starts_on date,ends_on date,quantities jsonb,resource_ids jsonb,state text,expires_at timestamptz,ended_at timestamptz,revision integer);
  CREATE TABLE outreach_route_anchors(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),leg_id uuid,resource_id uuid,direction text,latitude double precision,longitude double precision,available_at timestamptz,valid_until timestamptz,source text,reason text,revision integer,recorded_at timestamptz,revoked_at timestamptz);
  CREATE TABLE outreach_booking_demand(booking_id uuid PRIMARY KEY,quantities jsonb,resource_ids jsonb,revision integer,updated_at timestamptz);`);
  await f.db.query(
    `INSERT INTO travel_legs(id,name,sort_order) VALUES($1,'Leg A',1)`,
    [leg],
  );
  await f.db.query(
    `INSERT INTO bookings(id,organization_id,name,status,probability,travel_leg_id,starts_at,ends_at) VALUES($1,$2,'Fair','contract_received','definite',$3,'2027-07-23','2027-07-25')`,
    [booking, f.profileId, leg],
  );
  await f.db.query(
    `INSERT INTO trips(id,travel_leg_id,name,start_date,end_date) VALUES($1,$2,'Summer','2027-07-19','2027-08-02')`,
    [trip, leg],
  );
  await f.db.query(
    `INSERT INTO resources(id,name,status,movable,normal_travel_leg_id) VALUES($1,'Paintball trailer','maintenance',true,$2)`,
    [resource, leg],
  );
});
afterEach(async () => f.db.close());
it("exposes read-only operational tools through the existing catalog", async () => {
  const tools = connectionTools({ reads: service } as any, f.principal);
  for (const name of [
    "read_leg_schedule",
    "read_route_plan",
    "read_operational_resources",
  ]) {
    const tool = tools.find((t) => t.name === name);
    expect(tool).toMatchObject({ scope: "crm:read", readOnly: true });
    const section = name === 'read_leg_schedule' ? 'legs' : name === 'read_route_plan' ? 'trips' : 'resources';
    const args = tool!.schema.parse({section});
    expect(await tool!.call(args)).toMatchObject({availability:'available',items:[expect.any(Object)]});
    expect(tool!.schema.safeParse({section:'not_a_section'}).success).toBe(false);
  }
});
it("filters by Denver calendar dates, including operational overlap and cross-year windows", async () => {
  await f.db.exec(`INSERT INTO bookings(name,starts_at,ends_at) VALUES
    ('Old','2026-07-23','2026-07-25'),('Cross year','2026-12-31','2027-01-02'),
    ('Denver prior day','2027-07-21T05:59:59Z','2027-07-21T05:59:59Z'),
    ('Denver last day','2027-08-02T05:59:59Z','2027-08-02T05:59:59Z'),
    ('After range','2027-08-02T06:00:00Z','2027-08-02T06:00:00Z'),('Undated',NULL,NULL),
    ('Setup overlap','2027-08-03','2027-08-04');`);
  await f.db.exec(
    `INSERT INTO booking_operational_windows(booking_id,starts_at,ends_at) SELECT id,'2027-08-01','2027-08-05' FROM bookings WHERE name='Setup overlap'`,
  );
  const result = await read("bookings", period);
  expect(result.items.map((x: any) => x.name).sort()).toEqual([
    "Denver last day",
    "Fair",
    "Setup overlap",
  ]);
  expect(result.items.find((x: any) => x.id === booking)).toMatchObject({
    legId: leg,
    assignmentState: "assigned",
    status: "contract_received",
    profileHref: `/profiles/${f.profileId}`,
  });
  const year = await read("bookings", { eventYear: 2027 });
  expect(year.items.map((x: any) => x.name)).toContain("Cross year");
  expect(year.items.map((x: any) => x.name)).not.toContain("Old");
  expect(
    (await read("bookings", { dateMode: "undated" })).items.map(
      (x: any) => x.name,
    ),
  ).toEqual(["Undated"]);
});
it("paginates ordered stops without duplicates and rejects a cursor reused with different filters", async () => {
  await f.db.query(
    `INSERT INTO trip_stops(trip_id,booking_id,sort_order) VALUES($1,$2,3),($1,$2,1),($1,$2,2)`,
    [trip, booking],
  );
  const one = await read("stops", { tripId: trip, limit: 2 });
  expect(one.items.map((x: any) => x.sortOrder)).toEqual([1, 2]);
  expect(one.truncated).toBe(true);
  const two = await read("stops", {
    tripId: trip,
    limit: 2,
    cursor: one.nextCursor,
  });
  expect(two.items.map((x: any) => x.sortOrder)).toEqual([3]);
  expect(two.nextCursor).toBeNull();
  await expect(
    read("stops", { tripId: randomUUID(), cursor: one.nextCursor }),
  ).rejects.toMatchObject({ code: "CONNECTION_INVALID_CURSOR" });
});
it("returns saved resource assignments, holds and estimates without inventing free capacity", async () => {
  await f.db.query(
    `INSERT INTO booking_resource_assignments(booking_id,resource_id,attribution_source) VALUES($1,$2,'manual')`,
    [booking, resource],
  );
  await f.db.query(
    `INSERT INTO outreach_holds(booking_id,leg_id,starts_on,ends_on,state,expires_at,resource_ids,quantities) VALUES($1,$2,'2027-07-20','2027-07-26','active','2026-01-01',$3,'{"pirate":1}')`,
    [booking, leg, JSON.stringify([resource])],
  );
  await f.db.query(
    `INSERT INTO trip_segments(trip_id,sequence,miles,minutes,source,override_minutes) VALUES($1,1,495,464,'cached',600)`,
    [trip],
  );
  const resources = await read("resources", { resourceId: resource });
  expect(resources.items[0]).toMatchObject({
    status: "maintenance",
    movable: true,
  });
  expect(resources).not.toHaveProperty("availableQuantity");
  expect(
    (await read("booking_resources", { bookingId: booking })).items[0],
  ).toMatchObject({ resourceId: resource, attributionSource: "manual" });
  expect((await read("holds", period)).items[0]).toMatchObject({
    state: "active",
    expiredByClock: true,
  });
  expect((await read("segments", { tripId: trip })).items[0]).toMatchObject({
    minutes: 464,
    overrideMinutes: 600,
    source: "cached",
  });
});
it("executes every section against real production columns and labels crew data as history", async () => {
  await f.db.query(
    `INSERT INTO crew_work_history(worker_id,leg_id,role,started_at,note,rating) VALUES($1,$2,'Manager','2027-07-01','PRIVATE REVIEW',1)`,
    [randomUUID(), leg],
  );
  for (const section of [
    "legs",
    "bookings",
    "leg_suggestions",
    "holds",
    "trips",
    "stops",
    "segments",
    "anchors",
    "packages",
    "resources",
    "booking_packages",
    "booking_resources",
    "trip_resources",
    "crew_history",
    "demand",
    "resource_tags",
    "resource_attributions",
  ]) {
    const page = await read(section);
    expect(page.availability).toBe("available");
    expect(page).toHaveProperty("nextCursor");
  }
  const crew = await read("crew_history", { ...period, legId: leg });
  expect(crew.items).toHaveLength(1);
  expect(JSON.stringify(crew)).not.toContain("PRIVATE REVIEW");
  expect(crew.limitations.join(" ")).toMatch(/history.*availability/i);
});
it("denies revoked connections and missing scopes, and distinguishes missing storage from an empty section", async () => {
  await expect(
    (service as any).operational(
      { ...f.principal, scopes: [] },
      { section: "legs" },
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_ACCESS_DENIED" });
  await f.db.exec("DROP TABLE trip_segments");
  expect(await read("segments", { tripId: trip })).toMatchObject({
    availability: "unavailable",
    items: [],
    complete: false,
  });
  await f.db.query(
    "UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1",
    [f.principal.connectionId],
  );
  await expect(read("legs")).rejects.toMatchObject({
    code: "CONNECTION_REVOKED",
  });
});
it("rejects invalid dates, ranges and inapplicable filters instead of silently broadening a query", async () => {
  for (const input of [
    { dateFrom: "2027-02-30", dateTo: "2027-03-02" },
    { dateFrom: "2027-08-01", dateTo: "2027-07-01" },
    { eventYear: 2027, ...period },
    { resourceId: resource },
  ]) {
    await expect(read("bookings", input)).rejects.toMatchObject({
      code: "CONNECTION_INVALID_OPERATIONAL_FILTER",
    });
  }
});

it('bounds large records, marks withheld fields and continues without dropping rows', async () => {
  await f.db.query(`INSERT INTO outreach_holds(booking_id,leg_id,starts_on,ends_on,quantities,resource_ids) SELECT $1,$2,'2027-07-20','2027-07-26',jsonb_build_object('long',repeat('x',15000)),'[]' FROM generate_series(1,3)`,[booking,leg]);
  const result = await read('holds',{...period,limit:2});
  expect(result.items).toHaveLength(2);
  expect(result.items[0].quantities).toBeNull();
  expect(result.items[0].truncatedFields).toContain('quantities');
  expect(result.complete).toBe(false);
  expect(JSON.stringify(result).length).toBeLessThan(25000);
  const rest=await read('holds',{...period,limit:2,cursor:result.nextCursor});
  expect(rest.items).toHaveLength(1);
  expect(rest.items[0].id).not.toBe(result.items[0].id);
});
