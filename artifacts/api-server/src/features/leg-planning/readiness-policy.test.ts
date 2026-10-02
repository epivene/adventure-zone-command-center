import { expect, it } from "vitest";
import type { ApprovalEvaluation, PlanFacts } from "@workspace/api-zod";
import { evaluatePlanReadiness } from "./readiness-policy";
import {
  completeFacts,
  ids,
  obligation,
  fixtureWindow,
  source,
} from "./planning-fixtures";
const approvals: ApprovalEvaluation = {
  state: "passed",
  reasons: [],
  splitGroupIds: [],
  extraAdventureZone: false,
  extraPirates: false,
};
const read = (facts: PlanFacts, grants = approvals) =>
  evaluatePlanReadiness(facts, grants);
it("rejects one physical pool supplying two requested packages on the same booking", () => {
  const f = completeFacts();
  const pkg = "00000000-0000-4000-8000-000000000030",
    set = "00000000-0000-4000-8000-000000000031";
  f.booking.packageIds.push(pkg);
  f.packages.push({
    ...f.packages[0],
    id: pkg,
    code: "adventure_zone",
    normalCapacity: 5,
  });
  f.packageSets.push({ ...f.packageSets[0], id: set, packageId: pkg });
  f.draft.packageSetIds.push(set);
  expect(read(f).overall).toBe("conflict");
});
it("verifies only a fully evidenced current plan", () => {
  expect(read(completeFacts()).overall).toBe("verified_plan");
});
it("requires actual requested package demand before verification", () => {
  const f = completeFacts();
  f.booking.packageIds = [];
  f.draft.packageSetIds = [];
  expect(read(f).overall).toBe("needs_details");
});
it.each([
  "minimum",
  "roles",
  "season",
  "proposed",
  "inventory",
  "lodging",
  "transport",
] as const)("keeps missing %s evidence visible", (missing) => {
  const f = completeFacts();
  if (missing === "minimum") f.draft.requirements.minimumCrew = null;
  if (missing === "roles") f.draft.requirements.roles = null;
  if (missing === "season") f.season = null;
  if (missing === "proposed") f.draft.crew[0].state = "proposed";
  if (missing === "inventory") f.packageSets[0].state = "unverified";
  if (missing === "lodging") f.draft.requirements.lodging = "unknown";
  if (missing === "transport") f.draft.requirements.transportRequired = null;
  expect(read(f).overall).toBe("needs_details");
});
it("blocks a worker committed to another overlapping event", () => {
  const f = completeFacts({
    obligations: [obligation({ workerIds: [ids.worker] })],
  });
  expect(read(f).dimensions.crew.state).toBe("conflict");
});
it("requires full confirmed availability and lets an unavailable interval win", () => {
  const f = completeFacts();
  f.availability = [
    {
      ...f.availability[0],
      window: { ...fixtureWindow, endsAt: "2027-07-23T12:00:00Z" },
    },
    {
      ...f.availability[0],
      id: ids.otherBooking,
      window: { ...fixtureWindow, startsAt: "2027-07-23T12:00:00Z" },
    },
  ];
  expect(read(f).overall).toBe("verified_plan");
  f.availability.push({
    ...f.availability[0],
    id: ids.split,
    state: "unavailable",
    window: {
      ...fixtureWindow,
      startsAt: "2027-07-22T12:00:00Z",
      endsAt: "2027-07-22T18:00:00Z",
    },
  });
  expect(read(f).dimensions.crew.state).toBe("conflict");
});
it("does not use rehire history to fill an availability gap", () => {
  const f = completeFacts({ availability: [] });
  expect(read(f).overall).toBe("needs_details");
});
it("blocks do-not-rehire workers and insufficient role coverage", () => {
  const f = completeFacts();
  f.workers[0].rehireStatus = "do_not_rehire";
  expect(read(f).overall).toBe("conflict");
  f.workers[0].rehireStatus = "rehirable";
  f.draft.requirements.roles = { driver: 1 };
  expect(read(f).overall).toBe("conflict");
});
it("blocks overlapping physical items even when the bookings use different leg names", () => {
  const f = completeFacts({
    obligations: [obligation({ resourceIds: [ids.resource] })],
  });
  expect(read(f).dimensions.equipment.state).toBe("conflict");
});
it("blocks unavailable physical items and incomplete verified composition", () => {
  const f = completeFacts();
  f.resources[0].status = "maintenance";
  expect(read(f).overall).toBe("conflict");
  f.resources[0].status = "available";
  f.packageSets[0].requirements = { Pool: 2 };
  expect(read(f).overall).toBe("needs_details");
});
it("does not double-count a booking mirrored by a hold", () => {
  const other = obligation({ resourceIds: ["other-pool"] });
  const f = completeFacts({
    obligations: [other],
    holds: [structuredClone(other)],
  });
  f.resources.push({
    id: "other-pool",
    name: "Other pool",
    category: "Pool",
    status: "available",
    minimumTransferMinutes: 0,
  });
  expect(read(f).overall).toBe("verified_plan");
});
it.each([
  ["adventure_zone", 4, false, "verified_plan"],
  ["adventure_zone", 5, false, "needs_review"],
  ["adventure_zone", 5, true, "verified_plan"],
  ["adventure_zone", 6, true, "conflict"],
  ["pirates_rebellion", 2, false, "verified_plan"],
  ["pirates_rebellion", 3, false, "needs_review"],
  ["pirates_rebellion", 3, true, "verified_plan"],
  ["pirates_rebellion", 4, true, "conflict"],
  ["weekend_warriors", 0, true, "verified_plan"],
  ["weekend_warriors", 1, true, "conflict"],
] as const)(
  "checks %s with %i other simultaneous sets and grant %s",
  (code, count, granted, want) => {
    const f = completeFacts();
    f.packages[0].code = code;
    f.packages[0].normalCapacity =
      code === "adventure_zone" ? 5 : code === "pirates_rebellion" ? 3 : 1;
    f.obligations = Array.from({ length: count }, (_, n) =>
      obligation({
        canonicalId: `other-${n}`,
        bookingId: `other-${n}`,
        resourceIds: [`pool-${n}`],
      }),
    );
    f.resources.push(
      ...Array.from({ length: count }, (_, n) => ({
        id: `pool-${n}`,
        name: "Another pool",
        category: "Pool",
        status: "available",
        minimumTransferMinutes: 0,
      })),
    );
    expect(
      read(f, {
        ...approvals,
        extraAdventureZone: granted,
        extraPirates: granted,
      }).overall,
    ).toBe(want);
  },
);
it("checks peak concurrency rather than summing sequential bookings", () => {
  const f = completeFacts({
    obligations: [
      obligation({
        window: {
          startMs: Date.parse("2027-07-21T12:00:00Z"),
          endMs: Date.parse("2027-07-23T12:00:00Z"),
          source: "first",
        },
        packageQuantities: { [ids.package]: 2 },
        resourceIds: ["first-pool"],
      }),
      obligation({
        canonicalId: "second",
        bookingId: "second",
        window: {
          startMs: Date.parse("2027-07-23T12:00:00Z"),
          endMs: Date.parse("2027-07-26T12:00:00Z"),
          source: "second",
        },
        packageQuantities: { [ids.package]: 2 },
        resourceIds: ["second-pool"],
      }),
    ],
  });
  expect(read(f).dimensions.equipment.state).toBe("verified_plan");
});
it("requires review for unknown physical allocations at a competing package event", () => {
  const f = completeFacts({ obligations: [obligation()] });
  expect(read(f).overall).toBe("needs_review");
});
it("requires travel review and rejects phases outside the reserved window", () => {
  const f = completeFacts();
  f.travel.verified = false;
  expect(read(f).overall).toBe("needs_review");
  f.travel.verified = true;
  f.draft.phases.setup = { ...fixtureWindow, startsAt: "2027-07-20T12:00:00Z" };
  expect(read(f).overall).toBe("needs_review");
});
it("requires enough transfer time for a shared physical item", () => {
  const f = completeFacts({
    obligations: [
      obligation({
        resourceIds: [ids.resource],
        window: {
          startMs: Date.parse("2027-07-19T12:00:00Z"),
          endMs: Date.parse("2027-07-21T11:45:00Z"),
          source: "previous",
        },
      }),
    ],
  });
  f.resources[0].minimumTransferMinutes = 30;
  expect(read(f).overall).toBe("conflict");
});
it("keeps source date contradictions and pending decisions separate from customer status", () => {
  const f = completeFacts({ sourceReasons: ["INVALID_BOOKING_WINDOW"] });
  f.booking.status = "confirmed";
  expect(read(f).overall).toBe("needs_review");
  f.sourceReasons = [];
  expect(
    read(f, {
      ...approvals,
      state: "pending",
      reasons: ["DAVE_APPROVAL_PENDING"],
    }).overall,
  ).toBe("needs_review");
});
it("checks required lodging capacity and dated source instead of relying on a completed task", () => {
  const f = completeFacts();
  f.draft.requirements.lodging = "required";
  f.draft.lodging = [];
  expect(read(f).overall).toBe("needs_details");
  f.draft.lodging = [
    {
      id: ids.otherBooking,
      description: "Booked rooms",
      location: "Verified accommodation",
      capacity: 1,
      window: fixtureWindow,
      source,
    },
  ];
  expect(read(f).overall).toBe("verified_plan");
});
it("checks staffing against public operating dates rather than extra reserved travel days", () => {
  const f = completeFacts();
  f.booking.window = {
    ...fixtureWindow,
    startsAt: "2027-07-19T12:00:00Z",
    endsAt: "2027-07-28T12:00:00Z",
  };
  f.draft.window = f.booking.window;
  f.booking.publicWindow = fixtureWindow;
  expect(read(f).overall).toBe("verified_plan");
});
it("accepts sequential lodging reservations with complete crew coverage", () => {
  const f = completeFacts();
  f.draft.requirements.lodging = "required";
  f.draft.lodging = [
    {
      id: ids.otherBooking,
      description: "First hotel",
      location: "First town",
      capacity: 1,
      window: { ...fixtureWindow, endsAt: "2027-07-23T12:00:00Z" },
      source,
    },
    {
      id: ids.split,
      description: "Second hotel",
      location: "Second town",
      capacity: 1,
      window: { ...fixtureWindow, startsAt: "2027-07-23T12:00:00Z" },
      source,
    },
  ];
  expect(read(f).overall).toBe("verified_plan");
});
it("does not treat an available pool as verified required transport", () => {
  const f = completeFacts();
  f.draft.requirements.transportRequired = true;
  f.draft.transportResourceIds = [ids.resource];
  expect(evaluatePlanReadiness(f, approvals).overall).not.toBe("verified_plan");
});
