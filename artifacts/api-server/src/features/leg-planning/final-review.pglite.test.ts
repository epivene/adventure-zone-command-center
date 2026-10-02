import { afterEach, beforeEach, expect, it } from "vitest";
import { planningDatabase } from "./planning-test-database";
import { LegPlanningService } from "./planning-service";
import { actors, ids, fixtureWindow, source } from "./planning-fixtures";
import {
  readyPlans,
  secondFixtureSql,
  secondWorker,
  secondResource,
  secondSet,
} from "./planning-test-setup";
let f: Awaited<ReturnType<typeof planningDatabase>>,
  service: LegPlanningService;
beforeEach(async () => {
  f = await planningDatabase();
  service = new LegPlanningService(f.db as never);
});
afterEach(async () => {
  await f?.pg.close();
});
async function extraPlan() {
  await readyPlans(service, [
    {
      bookingId: ids.booking,
      legId: ids.leg,
      workerId: ids.worker,
      resourceId: ids.resource,
      setId: ids.set,
    },
  ]);
  await service.savePackageSet(actors.owner, {
    payload: {
      id: ids.set,
      packageId: ids.package,
      name: "Actual extra pool",
      classification: "extra",
      resourceIds: [ids.resource],
      requirements: { Pool: 1 },
      verify: true,
      source,
    },
    expectedRevision: 1,
    requestKey: "extra-set",
  });
  await service.saveDaveAuthority(actors.owner, {
    payload: { accountId: ids.boss },
    expectedRevision: null,
    requestKey: "bind",
  });
}
async function request(
  key = "request",
  type: "split" | "extra_pirates" = "extra_pirates",
) {
  return service.requestApproval(actors.owner, {
    payload: {
      type,
      bookingIds:
        type === "split" ? [ids.booking, ids.otherBooking] : [ids.booking],
      parentLegId: ids.leg,
    },
    expectedRevision: null,
    requestKey: key,
  });
}
async function decide(
  requestId: string,
  key = "decision",
  actor = actors.dave,
  decision: "approved" | "revoked" = "approved",
  revision = 1,
) {
  return service.decideApproval(actor, {
    payload: {
      requestId,
      decision: {
        decision,
        reason: "Reviewed the actual equipment and staffing",
        strategicAcknowledgement: false,
      },
    },
    expectedRevision: revision,
    requestKey: key,
  });
}
it("never restores a historical Dave approval after disabling and reenabling the account", async () => {
  await extraPlan();
  const r = await request();
  await decide(r.value.id);
  expect(
    (await service.get(ids.booking, actors.owner))!.readiness.overall,
  ).toBe("verified_plan");
  await f.pg.query(
    "UPDATE boss_accounts SET enabled=false,session_version=session_version+1 WHERE id=$1",
    [ids.boss],
  );
  expect(
    (await service.get(ids.booking, actors.owner))!.readiness.overall,
  ).not.toBe("verified_plan");
  await f.pg.query("UPDATE boss_accounts SET enabled=true WHERE id=$1", [
    ids.boss,
  ]);
  expect(
    (await service.get(ids.booking, actors.owner))!.readiness.overall,
  ).not.toBe("verified_plan");
  const renewed = await request("after-reenable");
  await decide(renewed.value.id, "current-session", {
    ...actors.dave,
    sessionVersion: 2,
  });
  expect(
    (await service.get(ids.booking, actors.owner))!.readiness.overall,
  ).toBe("verified_plan");
});
it("allows a fresh immutable review after authority rebinding and still rejects a duplicate live request", async () => {
  await extraPlan();
  const first = await request();
  await decide(first.value.id);
  await expect(request("duplicate-current")).rejects.toMatchObject({
    code: "REQUEST_ALREADY_EXISTS",
  });
  await service.saveDaveAuthority(actors.owner, {
    payload: { accountId: null },
    expectedRevision: 1,
    requestKey: "unbind",
  });
  await service.saveDaveAuthority(actors.owner, {
    payload: { accountId: ids.boss },
    expectedRevision: 2,
    requestKey: "rebind",
  });
  const next = await request("fresh");
  expect(next.value.id).not.toBe(first.value.id);
  await expect(request("duplicate-pending")).rejects.toMatchObject({
    code: "REQUEST_ALREADY_EXISTS",
  });
  await decide(next.value.id, "fresh-decision");
  expect(
    (await service.get(ids.booking, actors.owner))!.readiness.overall,
  ).toBe("verified_plan");
  expect(
    (
      await f.pg.query(
        "SELECT count(*)::int AS n FROM leg_plan_approval_decisions",
      )
    ).rows,
  ).toEqual([{ n: 2 }]);
});
it("permits fresh review after revocation without changing the actual plan", async () => {
  await extraPlan();
  const first = await request();
  await decide(first.value.id);
  await decide(first.value.id, "revoke", actors.dave, "revoked", 2);
  const next = await request("after-revoke");
  await decide(next.value.id, "reapproved");
  expect(
    (await service.get(ids.booking, actors.owner))!.readiness.overall,
  ).toBe("verified_plan");
});
it("commits the approved wider working reservation without invalidating its own decision", async () => {
  await extraPlan();
  const p = (await service.get(ids.booking, actors.owner))!.plan!;
  const wider = { ...fixtureWindow, startsAt: "2027-07-20T12:00:00Z" };
  const saved = await service.saveDraft(actors.owner, {
    payload: { ...p.draft, window: wider },
    expectedRevision: p.revision,
    requestKey: "wider",
  });
  const facts = (await service.facts(ids.booking, actors.owner))[0];
  await service.saveDraft(actors.owner, {
    payload: {
      ...saved.value.draft,
      travelReview: {
        endpointFingerprint: facts.travel.endpointFingerprint,
        source,
      },
    },
    expectedRevision: saved.value.revision,
    requestKey: "wider-travel",
  });
  const r = await request();
  await decide(r.value.id);
  const current = (await service.get(ids.booking, actors.owner))!;
  expect(current.readiness.overall).toBe("verified_plan");
  await service.commitPlans(actors.owner, {
    bookingIds: [ids.booking],
    expectedRevisions: { [ids.booking]: current.plan!.revision },
    requestKey: "commit",
  });
  expect(
    (await service.get(ids.booking, actors.owner))!.readiness.overall,
  ).toBe("verified_plan");
  await f.pg.query(
    "UPDATE booking_operational_windows SET starts_at='2027-07-19T12:00Z'",
  );
  expect(
    (await service.get(ids.booking, actors.owner))!.readiness.overall,
  ).not.toBe("verified_plan");
});
it("approves and commits December and January branches in the explicit December season", async () => {
  await f.pg.exec(secondFixtureSql);
  await f.pg.query("UPDATE bookings SET travel_leg_id=$1", [ids.leg]);
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
  const windows = [
    {
      ...fixtureWindow,
      startsAt: "2027-12-31T18:00:00Z",
      endsAt: "2028-01-01T18:00:00Z",
    },
    {
      ...fixtureWindow,
      startsAt: "2028-01-01T18:00:00Z",
      endsAt: "2028-01-02T18:00:00Z",
    },
  ];
  const group = await service.saveSplit(actors.owner, {
    payload: {
      id: null,
      parentLegId: ids.leg,
      bookingIds: [ids.booking, ids.otherBooking],
    },
    expectedRevision: null,
    requestKey: "split",
  });
  for (const [i, bookingId] of [ids.booking, ids.otherBooking].entries()) {
    const window = windows[i];
    await f.pg.query(
      "UPDATE bookings SET starts_at=$2,ends_at=$3 WHERE id=$1",
      [bookingId, window.startsAt, window.endsAt],
    );
    const p = (await service.get(bookingId, actors.owner))!.plan!;
    await service.saveAvailability(actors.owner, {
      payload: {
        id: null,
        workerId: p.draft.crew[0].workerId,
        window,
        state: "confirmed",
        source,
      },
      expectedRevision: null,
      requestKey: `available-${i}`,
    });
    const saved = await service.saveDraft(actors.owner, {
      payload: {
        ...p.draft,
        seasonYear: 2027,
        window,
        crew: p.draft.crew.map((c) => ({ ...c, window })),
        splitGroupId: group.value.id,
      },
      expectedRevision: (await service.get(bookingId, actors.owner))!.plan!
        .revision,
      requestKey: `boundary-${i}`,
    });
    const facts = (await service.facts(bookingId, actors.owner))[0];
    await service.saveDraft(actors.owner, {
      payload: {
        ...saved.value.draft,
        travelReview: {
          endpointFingerprint: facts.travel.endpointFingerprint,
          source,
        },
      },
      expectedRevision: saved.value.revision,
      requestKey: `boundary-review-${i}`,
    });
  }
  const catalog = await service.catalog(actors.owner);
  expect(catalog.bookings.find((b) => b.id === ids.otherBooking)).toMatchObject(
    { seasonYear: 2028, splitSeasonYears: expect.arrayContaining([2027]) },
  );
  const r = await request("boundary-request", "split");
  await service.decideApproval(actors.manager, {
    payload: {
      requestId: r.value.id,
      decision: {
        decision: "approved",
        reason: "Reviewed the New Year handoff",
        strategicAcknowledgement: false,
      },
    },
    expectedRevision: 1,
    requestKey: "boundary-decision",
  });
  const a = (await service.get(ids.booking, actors.owner))!,
    b = (await service.get(ids.otherBooking, actors.owner))!;
  expect(a.readiness.overall).toBe("verified_plan");
  expect(b.readiness.overall).toBe("verified_plan");
  await service.commitPlans(actors.owner, {
    bookingIds: [ids.booking, ids.otherBooking],
    expectedRevisions: {
      [ids.booking]: a.plan!.revision,
      [ids.otherBooking]: b.plan!.revision,
    },
    requestKey: "boundary-commit",
  });
  expect(
    (await service.get(ids.otherBooking, actors.owner))!.plan!.committed!
      .seasonYear,
  ).toBe(2027);
});
