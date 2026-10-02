import { afterEach, beforeEach, expect, it } from "vitest";
import { planningDatabase } from "./planning-test-database";
import { LegPlanningService } from "./planning-service";
import {
  actors,
  completeFacts,
  draft,
  fixtureWindow,
  ids,
  source,
} from "./planning-fixtures";
let fixture: Awaited<ReturnType<typeof planningDatabase>>,
  service: LegPlanningService;
beforeEach(async () => {
  fixture = await planningDatabase();
  service = new LegPlanningService(fixture.db as never);
});
afterEach(async () => {
  await fixture?.pg.close();
});
export async function readyFixture(service: LegPlanningService) {
  const { revision: _rev, ...season } = completeFacts().season!;
  season.baseAddress = "Office base";
  await service.saveSeason(actors.owner, {
    payload: season,
    requestKey: "season",
    expectedRevision: null,
  });
  await service.saveAvailability(actors.owner, {
    payload: {
      id: null,
      workerId: ids.worker,
      window: fixtureWindow,
      state: "confirmed",
      source,
    },
    requestKey: "availability",
    expectedRevision: null,
  });
  const set = await service.savePackageSet(actors.owner, {
    payload: {
      id: null,
      packageId: ids.package,
      name: "Actual pool set",
      classification: "normal",
      resourceIds: [ids.resource],
      requirements: { Pool: 1 },
      verify: true,
      source,
    },
    requestKey: "set",
    expectedRevision: null,
  });
  const d = draft({
    packageSetIds: [set.value.id],
    loadInAddress: "Fair gate",
  });
  const first = await service.saveDraft(actors.owner, {
    payload: d,
    requestKey: "draft",
    expectedRevision: null,
  });
  const [f] = await service.facts(ids.booking, actors.owner);
  return service.saveDraft(actors.owner, {
    payload: {
      ...d,
      travelReview: {
        endpointFingerprint: f.travel.endpointFingerprint,
        source,
      },
    },
    requestKey: "review",
    expectedRevision: first.value.revision,
  });
}
it("commits canonical leg, resources, crew and accepted snapshot without changing customer status", async () => {
  const saved = await readyFixture(service);
  expect(
    (await service.get(ids.booking, actors.owner))?.readiness.overall,
  ).toBe("verified_plan");
  const input = {
    bookingIds: [ids.booking],
    expectedRevisions: { [ids.booking]: saved.value.revision },
    requestKey: "commit",
  };
  const result = await service.commitPlans(actors.owner, input);
  expect(result.value[0].committed).not.toBeNull();
  expect(result.affectedBookingIds).toContain(ids.booking);
  expect((await fixture.pg.query("SELECT status FROM bookings")).rows).toEqual([
    { status: "confirmed" },
  ]);
  expect(
    (
      await fixture.pg.query(
        "SELECT resource_id FROM booking_resource_assignments",
      )
    ).rows,
  ).toEqual([{ resource_id: ids.resource }]);
  expect(
    (await fixture.pg.query("SELECT worker_id FROM leg_plan_crew_commitments"))
      .rows,
  ).toEqual([{ worker_id: ids.worker }]);
  expect((await service.commitPlans(actors.owner, input)).receiptId).toBe(
    result.receiptId,
  );
});
it("rolls back the first branch when the second has missing facts", async () => {
  const saved = await readyFixture(service);
  await fixture.pg.query(
    `INSERT INTO bookings(id,name,status,travel_leg_id,starts_at,ends_at) VALUES($1,'Other','confirmed',$2,'2027-07-21T12:00Z','2027-07-26T12:00Z')`,
    [ids.otherBooking, ids.leg],
  );
  await service.saveDraft(actors.owner, {
    payload: draft({
      bookingId: ids.otherBooking,
      crew: [],
      packageSetIds: [],
    }),
    expectedRevision: null,
    requestKey: "other",
  });
  await expect(
    service.commitPlans(actors.owner, {
      bookingIds: [ids.booking, ids.otherBooking],
      expectedRevisions: {
        [ids.booking]: saved.value.revision,
        [ids.otherBooking]: 1,
      },
      requestKey: "failed-group",
    }),
  ).rejects.toMatchObject({ status: 422 });
  expect(
    (
      await fixture.pg.query(
        "SELECT count(*)::int AS n FROM booking_resource_assignments",
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
  expect(
    (await service.get(ids.booking, actors.owner))?.plan?.committed,
  ).toBeNull();
});
it("refuses commitment after a resource becomes unavailable", async () => {
  const saved = await readyFixture(service);
  await fixture.pg.query("UPDATE resources SET status='maintenance'");
  await expect(
    service.commitPlans(actors.owner, {
      bookingIds: [ids.booking],
      expectedRevisions: { [ids.booking]: saved.value.revision },
      requestKey: "blocked",
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (
      await fixture.pg.query(
        "SELECT count(*)::int AS n FROM leg_plan_crew_commitments",
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
});
