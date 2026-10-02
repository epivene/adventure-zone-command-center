import { afterEach, beforeEach, expect, it } from "vitest";
import { loadPlanFacts, planningFingerprint } from "./planning-facts";
import { planningDatabase } from "./planning-test-database";
import { DrizzlePlanningRepository } from "./planning-repository";
import { actors, ids, draft, completeFacts } from "./planning-fixtures";
import { planDraftSchema } from "@workspace/api-zod";
let fixture: Awaited<ReturnType<typeof planningDatabase>>;
beforeEach(async () => {
  fixture = await planningDatabase();
  await new DrizzlePlanningRepository(fixture.db).saveDraftIn(
    fixture.db,
    draft(),
    null,
  );
});
afterEach(async () => {
  await fixture?.pg.close();
});
const read = () =>
  loadPlanFacts(
    fixture.db,
    [ids.booking],
    actors.owner,
    new Date("2026-10-02T00:00:00Z"),
  );
it("leaves an ambiguous historical year unchanged while allowing an explicit new draft season", async () => {
  await fixture.pg.query("DELETE FROM leg_event_plans WHERE booking_id=$1", [
    ids.booking,
  ]);
  await fixture.pg.query(
    "UPDATE bookings SET starts_at='9999-07-01T00:00:00Z',ends_at='9999-07-03T00:00:00Z' WHERE id=$1",
    [ids.booking],
  );
  const [f] = await read();
  expect(planDraftSchema.safeParse(f.draft).success).toBe(true);
  expect(f.sourceReasons).toContain("INVALID_PUBLIC_WINDOW");
  expect(
    (
      await fixture.pg.query(
        "SELECT extract(year from starts_at)::int AS year FROM bookings WHERE id=$1",
        [ids.booking],
      )
    ).rows,
  ).toEqual([{ year: 9999 }]);
});
it("keeps the longer real reserved window and the selected draft season", async () => {
  await fixture.pg.query(
    `INSERT INTO booking_operational_windows VALUES($1,'2027-07-19T12:00:00Z','2027-07-28T12:00:00Z','manual')`,
    [ids.booking],
  );
  const [facts] = await read();
  expect(facts.booking.window?.startsAt).toBe("2027-07-19T12:00:00.000Z");
  expect(facts.draft.seasonYear).toBe(2027);
  expect(facts.sourceReasons).toContain("PLAN_SHORTENS_RESERVED_WINDOW");
});
it("deduplicates explicit booking/trip mirrors while preserving distinct obligations", async () => {
  await fixture.pg.query(
    `INSERT INTO booking_resource_assignments(booking_id,resource_id) VALUES($1,$2)`,
    [ids.booking, ids.resource],
  );
  await fixture.pg.query(
    `INSERT INTO trips VALUES($1,$2,'2027-07-21T12:00:00Z','2027-07-26T12:00:00Z');`,
    [ids.otherBooking, ids.leg],
  );
  await fixture.pg.query(`INSERT INTO trip_stops VALUES($1,$2,$3)`, [
    ids.split,
    ids.otherBooking,
    ids.booking,
  ]);
  await fixture.pg.query(
    `INSERT INTO trip_resource_assignments VALUES($1,$2)`,
    [ids.otherBooking, ids.resource],
  );
  const [facts] = await read();
  expect(facts.obligations).toHaveLength(1);
  expect(facts.obligations[0].resourceIds).toEqual([ids.resource]);
  await fixture.pg.query(
    `INSERT INTO bookings(id,name,status,travel_leg_id,starts_at,ends_at) VALUES($1,'Another Fair','confirmed',$2,'2027-07-21T12:00:00Z','2027-07-26T12:00:00Z')`,
    [ids.otherBooking, ids.leg],
  );
  expect((await read())[0].obligations).toHaveLength(2);
});
it("excludes expired holds and retains live held resource demand", async () => {
  await fixture.pg.query(
    `INSERT INTO outreach_holds VALUES($1,$2,$3,'2027-07-21','2027-07-26',$4,$5,'active','2026-10-01')`,
    [
      ids.split,
      ids.otherBooking,
      ids.leg,
      JSON.stringify([ids.resource]),
      JSON.stringify({ pirates_rebellion: 1 }),
    ],
  );
  expect((await read())[0].holds).toEqual([]);
  await fixture.pg.query(`UPDATE outreach_holds SET expires_at='2026-10-03'`);
  expect((await read())[0].holds[0].resourceIds).toEqual([ids.resource]);
});
it("preserves contradictory and sentinel source dates as review reasons", async () => {
  await fixture.pg.query(`UPDATE bookings SET ends_at='9999-12-31'`);
  expect((await read())[0].sourceReasons).toContain("INVALID_BOOKING_WINDOW");
});
it("counts documented legacy package aliases in active holds", async () => {
  await fixture.pg.query(
    `INSERT INTO outreach_holds VALUES($1,$2,$3,'2027-07-21','2027-07-26',$4,$5,'active','2026-10-03')`,
    [
      ids.split,
      ids.otherBooking,
      ids.leg,
      JSON.stringify([ids.resource]),
      JSON.stringify({ pirate_rebellion: 1 }),
    ],
  );
  expect((await read())[0].holds[0].packageQuantities).toEqual({
    [ids.package]: 1,
  });
});
it("fingerprints material plan facts without clock, notes or unrelated approvals", () => {
  const first = completeFacts(),
    later = completeFacts({ now: "2026-10-03T00:00:00Z" });
  expect(planningFingerprint(first)).toBe(planningFingerprint(later));
  later.draft.crew = [];
  expect(planningFingerprint(first)).not.toBe(planningFingerprint(later));
});
it("accepts sourced route review only for the exact current endpoints", async () => {
  const repo = new DrizzlePlanningRepository(fixture.db);
  await fixture.pg.query(
    `INSERT INTO leg_season_plans(leg_id,season_year,payload) VALUES($1,2027,$2)`,
    [
      ids.leg,
      JSON.stringify({
        ...completeFacts().season,
        baseAddress: "Reviewed home base",
      }),
    ],
  );
  await repo.saveDraftIn(
    fixture.db,
    { ...draft(), loadInAddress: "Verified fair load-in gate" },
    1,
  );
  const [before] = await read();
  expect(before.travel.verified).toBe(false);
  await repo.saveDraftIn(
    fixture.db,
    {
      ...before.draft,
      travelReview: {
        endpointFingerprint: before.travel.endpointFingerprint,
        source: {
          label: "Both transfers reviewed",
          href: "https://example.com/route",
        },
      },
    },
    2,
  );
  expect((await read())[0].travel.verified).toBe(true);
  await fixture.pg.query(
    `INSERT INTO bookings(id,name,status,travel_leg_id,starts_at,ends_at,latitude,longitude) VALUES($1,'Prior stop','confirmed',$2,'2027-07-10T12:00:00Z','2027-07-15T12:00:00Z',41,-111)`,
    [ids.otherBooking, ids.leg],
  );
  expect((await read())[0].travel.verified).toBe(false);
});
