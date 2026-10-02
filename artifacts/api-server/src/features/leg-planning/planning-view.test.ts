import { expect, it } from "vitest";
import { completeFacts, actors, ids, obligation } from "./planning-fixtures";
import { toPlanningView } from "./planning-view";
it("returns the same readiness to owner and Dave with scoped actions", () => {
  const f = completeFacts();
  expect(toPlanningView(f, actors.owner).readiness).toEqual(
    toPlanningView(f, actors.dave).readiness,
  );
  expect(toPlanningView(f, actors.owner).draft?.bookingId).toBe(ids.booking);
});
it("never serializes unrelated workers, obligations, branches or lodging to a manager", () => {
  const f = completeFacts();
  f.workers.push({
    id: ids.otherBooking,
    name: "Private unrelated worker",
    rehireStatus: "rehirable",
  });
  f.obligations = [obligation({ resourceIds: [ids.resource] })];
  const serialized = JSON.stringify(toPlanningView(f, actors.manager));
  expect(serialized).not.toContain("Private unrelated worker");
  expect(serialized).not.toContain(ids.otherBooking);
  expect(serialized).not.toContain('"obligations"');
  expect(toPlanningView(f, actors.manager).readiness.overall).toBe("conflict");
});
it("rejects an out-of-leg projection and preserves unknown facts as nonverified", () => {
  const f = completeFacts();
  expect(() =>
    toPlanningView(f, { ...actors.manager, legId: ids.otherBooking }),
  ).toThrow();
  f.season = null;
  f.availability = [];
  expect(toPlanningView(f, actors.owner).readiness.overall).not.toBe(
    "verified_plan",
  );
});
it("hides split references when a related booking has moved outside manager scope", () => {
  const f = completeFacts();
  f.bookingLegIds = {
    [ids.booking]: ids.leg,
    [ids.otherBooking]: ids.otherBooking,
  };
  f.split = {
    id: ids.resource,
    parentLegId: ids.leg,
    bookingIds: [ids.booking, ids.otherBooking],
    revision: 1,
  };
  f.requests = [
    {
      id: ids.resource,
      type: "split",
      bookingIds: [ids.booking, ids.otherBooking],
      parentLegId: ids.leg,
      revision: 1,
      planFingerprint: "a".repeat(64),
      state: "pending",
      createdAt: f.now,
    },
  ];
  expect(toPlanningView(f, actors.manager).requests).toEqual([]);
  expect(toPlanningView(f, actors.manager).split).toBeNull();
});
