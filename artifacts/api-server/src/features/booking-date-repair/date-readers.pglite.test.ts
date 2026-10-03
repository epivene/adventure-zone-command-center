import { drizzle } from "drizzle-orm/pglite";
import { DrizzleCoverageDataSource } from "../event-date-coverage/coverage-repository";
import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@workspace/db/schema";
import { fixture } from "../chatgpt-connection/test-database";
import { ConnectionReadService } from "../chatgpt-connection/read-service";

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
}, 30_000);

afterEach(async () => { await f.db.close(); });
it("keeps 18 sentinel imports in review and returns only two verified 2027 windows", async () => {
  await f.db.exec(readFileSync(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql",import.meta.url),"utf8"));
  const second = randomUUID();
  await f.db.query("insert into bookings(id,name,status,starts_at,ends_at) values($1,'Second genuine show','new_lead','2027-04-03T12:00:00Z','2027-04-04T12:00:00Z')",[second]);
  for(let i=0;i<18;i++) await f.db.query("insert into bookings(name,status,starts_at,ends_at) values($1,'new_lead','2026-04-01T12:00:00Z','9999-12-31T00:00:00Z')",["Imported lead "+i]);
  await f.db.exec(`insert into booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor)
    select id,'public_start','verified_event',booking_date_iso(starts_at),'instant',1,'saved_note','verified-start','1','owner' from bookings where name in ('Fair','Second genuine show')
    union all select id,'public_end','verified_event',booking_date_iso(ends_at),'instant',1,'saved_note','verified-end','1','owner' from bookings where name in ('Fair','Second genuine show');`);
  const coverageBookings = await new DrizzleCoverageDataSource(drizzle(f.db) as any).loadBookings();
  expect(coverageBookings.filter((x:any)=>x.dateProvenance?.publicWindow).length).toBe(1);
  expect(coverageBookings.find(x=>x.id===booking)?.startsOn).toBe("2027-07-22");
  const overlap = await read("bookings",{eventYear:2027});
  expect(overlap.items.map((x:any)=>x.name).sort()).toEqual(["Fair","Second genuine show"]);
  const names:string[] = [];
  let cursor:string|null = null;
  do {
    const page = await read("bookings",{dateMode:"undated",limit:7,...(cursor?{cursor}:{})});
    names.push(...page.items.map((x:any)=>x.name));
    expect(page.items.every((x:any)=>x.dateProvenance.publicWindow===null)).toBe(true);
    cursor = page.nextCursor;
  } while(cursor);
  expect(names).toHaveLength(18);
  expect(new Set(names).size).toBe(18);
  expect((await f.db.query("select count(*)::int as count from bookings where status='new_lead' and extract(year from ends_at)=9999")).rows).toEqual([{count:18}]);
},30_000);
it("excludes a verified exclusive Google boundary from the following Denver day",async()=>{
  await f.db.exec(readFileSync(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql",import.meta.url),"utf8"));
  await f.db.query("insert into booking_operational_windows(booking_id,starts_at,ends_at,source) values($1,'2027-03-13T00:00:00Z','2027-03-15T00:00:00Z','google_calendar')",[booking]);
  for(const [field,value,semantics] of [["reservation_start","2027-03-13","inclusive_date"],["reservation_end","2027-03-15","exclusive_date"]])
    await f.db.query("insert into booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor) values($1,$2,'verified_reservation',$3,$4,1,'google_calendar','event','etag','owner')",[booking,field,value,semantics]);
  expect((await read("bookings",{dateFrom:"2027-03-14",dateTo:"2027-03-14"})).items.map((x:any)=>x.name)).toEqual(["Fair"]);
  expect((await read("bookings",{dateFrom:"2027-03-15",dateTo:"2027-03-15"})).items).toEqual([]);
},30_000);
