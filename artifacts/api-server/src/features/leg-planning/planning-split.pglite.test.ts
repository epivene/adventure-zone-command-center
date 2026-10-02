import { afterEach, beforeEach, expect, it } from "vitest";
import { planningDatabase } from "./planning-test-database";
import { LegPlanningService } from "./planning-service";
import { actors, ids } from "./planning-fixtures";
import {
  readyPlans,
  secondFixtureSql,
  secondResource,
  secondSet,
  secondWorker,
} from "./planning-test-setup";
let fixture: Awaited<ReturnType<typeof planningDatabase>>,
  service: LegPlanningService;
beforeEach(async () => {
  fixture = await planningDatabase();
  service = new LegPlanningService(fixture.db as never);
  await fixture.pg.exec(secondFixtureSql);
  await fixture.pg.query("UPDATE bookings SET travel_leg_id=$1", [ids.leg]);
  await readyPlans(service, [
    {
      bookingId: ids.booking,
      legId: ids.leg,
      workerId: ids.worker,
      resourceId: ids.resource,
      setId: ids.set,
    },
    {
      bookingId: ids.otherBooking,
      legId: ids.leg,
      workerId: secondWorker,
      resourceId: secondResource,
      setId: secondSet,
    },
  ]);
  const split = await service.saveSplit(actors.owner, {
    payload: {
      id: null,
      parentLegId: ids.leg,
      bookingIds: [ids.booking, ids.otherBooking],
    },
    expectedRevision: null,
    requestKey: "split",
  });
  for (const id of [ids.booking, ids.otherBooking]) {
    const p = (await service.get(id, actors.owner))!.plan!;
    await service.saveDraft(actors.owner, {
      payload: { ...p.draft, splitGroupId: split.value.id },
      expectedRevision: p.revision,
      requestKey: `split-${id}`,
    });
  }
});
afterEach(async () => await fixture?.pg.close());
async function approveSplit() {
  const r = await service.requestApproval(actors.owner, {
    payload: {
      type: "split",
      bookingIds: [ids.booking, ids.otherBooking],
      parentLegId: ids.leg,
    },
    expectedRevision: null,
    requestKey: "request",
  });
  return service.decideApproval(actors.manager, {
    payload: {
      requestId: r.value.id,
      decision: {
        decision: "approved",
        reason: "Reviewed both independent crews and pools",
        strategicAcknowledgement: false,
      },
    },
    expectedRevision: r.value.revision,
    requestKey: "decision",
  });
}
async function commit() {
  const a = (await service.get(ids.booking, actors.owner))!.plan!,
    b = (await service.get(ids.otherBooking, actors.owner))!.plan!;
  return service.commitPlans(actors.owner, {
    bookingIds: [ids.booking, ids.otherBooking],
    expectedRevisions: {
      [ids.booking]: a.revision,
      [ids.otherBooking]: b.revision,
    },
    requestKey: "commit",
  });
}
it("binds the same decision to both branches and commits their disjoint allocations together", async () => {
  await approveSplit();
  const result = await commit();
  expect(result.value.every((p) => p.committed)).toBe(true);
  expect(
    (
      await fixture.pg.query(
        "SELECT count(*)::int AS n FROM booking_resource_assignments",
      )
    ).rows,
  ).toEqual([{ n: 2 }]);
  expect(
    (await fixture.pg.query("SELECT status FROM bookings")).rows.every(
      (r: any) => r.status === "new_lead",
    ),
  ).toBe(true);
});
it("rolls back both staged branches after a second-branch physical failure", async () => {
  await approveSplit();
  await fixture.pg.query(
    "UPDATE resources SET status='maintenance' WHERE id=$1",
    [secondResource],
  );
  await expect(commit()).rejects.toMatchObject({ status: 409 });
  expect(
    (
      await fixture.pg.query(
        "SELECT count(*)::int AS n FROM booking_resource_assignments",
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
  expect(
    (
      await fixture.pg.query(
        "SELECT count(*)::int AS n FROM leg_plan_crew_commitments",
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
  expect(
    (
      await fixture.pg.query(
        "SELECT count(*)::int AS n FROM leg_event_plans WHERE committed IS NOT NULL",
      )
    ).rows,
  ).toEqual([{ n: 0 }]);
});
