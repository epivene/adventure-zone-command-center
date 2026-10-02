import { afterEach, it, expect, vi } from "vitest";
import { planningDatabase } from "./planning-test-database";
import { LegPlanningService } from "./planning-service";
import { actors, draft, ids } from "./planning-fixtures";
let fixture: Awaited<ReturnType<typeof planningDatabase>>;
it("keeps off-leg affected booking identities out of manager mutation receipts", async () => {
  fixture = await planningDatabase();
  const s = new LegPlanningService(fixture.db as never);
  await fixture.pg.query(
    "INSERT INTO travel_legs(id,name) VALUES($1,'Other leg')",
    [ids.otherBooking],
  );
  await fixture.pg.query(
    "INSERT INTO bookings(id,name,status,travel_leg_id,starts_at,ends_at) VALUES($1,'Private event','new_lead',$1,'2027-07-21T12:00Z','2027-07-26T12:00Z')",
    [ids.otherBooking],
  );
  await s.saveDraft(actors.owner, {
    payload: draft({ bookingId: ids.otherBooking, legId: ids.otherBooking }),
    expectedRevision: null,
    requestKey: "other-draft",
  });
  const result = await s.saveAvailability(actors.manager, {
    payload: {
      id: null,
      workerId: ids.worker,
      window: draft().crew[0].window,
      state: "unavailable",
      source: { label: "Direct worker confirmation", href: "/manager/crew" },
    },
    expectedRevision: null,
    requestKey: "availability",
  });
  expect(result.affectedBookingIds).not.toContain(ids.otherBooking);
}, 15000);
afterEach(async () => {
  await fixture?.pg.close();
  vi.unstubAllGlobals();
});
it("returns own-leg catalog details without exposing other leg workers, bookings, resources or availability", async () => {
  fixture = await planningDatabase();
  const s = new LegPlanningService(fixture.db as never);
  const network = vi.fn(() => {
    throw new Error("Planning must not call a provider");
  });
  vi.stubGlobal("fetch", network);
  await fixture.pg.query(
    "INSERT INTO crew_workers VALUES($1,'Private other-leg worker','rehirable')",
    [ids.otherBooking],
  );
  await fixture.pg.query(
    "INSERT INTO resources(id,name,category,status) VALUES($1,'Private other-leg vehicle','Vehicle','available')",
    [ids.otherBooking],
  );
  await fixture.pg.query(
    "INSERT INTO bookings(id,name,status) VALUES($1,'Private other-leg booking','new_lead')",
    [ids.otherBooking],
  );
  await s.saveDraft(actors.owner, {
    payload: draft(),
    expectedRevision: null,
    requestKey: "draft",
  });
  const manager = await s.get(ids.booking, actors.manager);
  expect(manager?.catalog?.workers.map((w) => w.id)).toEqual([ids.worker]);
  expect(JSON.stringify(manager)).not.toContain("Private other-leg");
  await expect(
    s.saveDraft(actors.manager, {
      payload: draft({
        crew: [{ ...draft().crew[0], workerId: ids.otherBooking }],
      }),
      expectedRevision: 1,
      requestKey: "foreign-crew",
    }),
  ).rejects.toMatchObject({ status: 403 });
  await expect(s.get(ids.otherBooking, actors.manager)).rejects.toMatchObject({
    status: 403,
  });
  expect(network).not.toHaveBeenCalled();
  await expect(
    s.saveSeason(actors.manager, {
      payload: {
        legId: ids.leg,
        seasonYear: 2027,
        leadership: "unfilled",
        managerWorkerId: null,
        managerName: null,
        workerIds: [],
        baseAddress: null,
        transportResourceIds: [ids.otherBooking],
      },
      expectedRevision: null,
      requestKey: "guessed-season-transport",
    }),
  ).rejects.toMatchObject({ status: 403 });
});
