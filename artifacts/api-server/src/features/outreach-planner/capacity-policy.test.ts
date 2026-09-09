import { describe, it, expect } from "vitest";
import {
  evaluateCapacity,
  type CapacityInput,
  type CapacityReservation,
} from "./capacity-policy";
const booking: CapacityReservation = {
  id: "a",
  canonicalId: "a",
  startsOn: "2026-09-01",
  endsOn: "2026-09-05",
  legId: "other",
  quantities: { az: 1 },
  confidence: "verified",
};
const capacity: CapacityInput = {
  window: { startsOn: "2026-09-01", endsOn: "2026-09-30" },
  legId: "leg",
  quantities: { az: 1 },
  capacities: { az: 2 },
  reservations: [],
  evidenceVerified: true,
  travelVerified: true,
};
const check = (patch: Partial<CapacityInput>) =>
  evaluateCapacity({ ...capacity, ...patch }).status;
describe("capacity intervals", () => {
  it("counts peak concurrent inventory", () => {
    expect(
      check({
        reservations: [
          booking,
          {
            ...booking,
            id: "b",
            canonicalId: "b",
            startsOn: "2026-09-06",
            endsOn: "2026-09-09",
          },
        ],
      }),
    ).toBe("fits");
    expect(
      check({
        reservations: [
          booking,
          { ...booking, id: "b", canonicalId: "b", startsOn: "2026-09-05" },
        ],
      }),
    ).toBe("conflict");
  });
  it("keeps leg conflict separate from inventory", () => {
    expect(check({ reservations: [{ ...booking, legId: "leg" }] })).toBe(
      "conflict",
    );
    expect(check({ capacities: { az: 1 }, reservations: [booking] })).toBe(
      "conflict",
    );
    expect(
      check({ quantities: { az: 1, tent: 1 }, capacities: { az: 2, tent: 0 } }),
    ).toBe("conflict");
  });
  it("deduplicates equivalent mirrors and rejects contradictory ones", () => {
    expect(
      check({ reservations: [booking, { ...booking, id: "mirror" }] }),
    ).toBe("fits");
    expect(
      check({
        reservations: [
          booking,
          { ...booking, id: "mirror", quantities: { az: 2 } },
        ],
      }),
    ).toBe("needs_review");
    expect(
      check({
        reservations: [booking],
        excludeCanonicalId: "a",
        capacities: { az: 1 },
      }),
    ).toBe("fits");
  });
  it.each<Partial<CapacityInput>>([
    { window: null },
    { legId: null },
    { capacities: {} },
    { quantities: {} },
    { quantities: { az: 0 } },
    { quantities: { az: 1.5 } },
    { capacities: { az: -1 } },
    { evidenceVerified: false },
    { travelVerified: false },
    { window: { startsOn: "2026-02-30", endsOn: "2026-09-30" } },
  ])("reviews missing or invalid facts %j", (patch) =>
    expect(check(patch)).toBe("needs_review"),
  );
  it("never silently drops malformed reservations", () => {
    for (const patch of [
      { startsOn: "invalid" },
      { quantities: { az: -1 } },
      { quantities: {} },
      { legId: null },
      { confidence: "ambiguous" as const },
    ] as Partial<CapacityReservation>[])
      expect(check({ reservations: [{ ...booking, ...patch }] })).toBe(
        "needs_review",
      );
  });
  it("ignores verified nonoverlaps and irrelevant ambiguous legs", () => {
    expect(
      check({
        reservations: [
          {
            ...booking,
            startsOn: "2026-10-01",
            endsOn: "2026-10-03",
            legId: null,
            confidence: "ambiguous",
          },
        ],
      }),
    ).toBe("fits");
  });
});

it("counts only shared resources and reservations active at request start", () => {
  expect(
    check({
      window: { startsOn: "2026-09-03", endsOn: "2026-09-04" },
      capacities: { az: 1 },
      reservations: [booking],
    }),
  ).toBe("conflict");
  expect(
    check({
      capacities: { az: 1 },
      reservations: [{ ...booking, quantities: { tent: 1 } }],
    }),
  ).toBe("fits");
});
it("rejects reversed windows and nonfinite inventory", () => {
  expect(
    check({ window: { startsOn: "2026-09-30", endsOn: "2026-09-01" } }),
  ).toBe("needs_review");
  expect(check({ capacities: { az: Infinity } })).toBe("needs_review");
  expect(check({ capacities: { az: 0 } })).toBe("conflict");
});
it("does not mutate input or reservation order", () => {
  const input = {
    ...capacity,
    reservations: [booking, { ...booking, id: "mirror" }],
  };
  const before = JSON.stringify(input);
  evaluateCapacity(input);
  expect(JSON.stringify(input)).toBe(before);
});
