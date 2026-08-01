import { describe, expect, it } from "vitest";

import {
  detectResourceConflicts,
  type TransferTimeLookup,
} from "@/features/resources/resource-conflicts";
import type { ResourceReservation } from "@/features/resources/resource-types";

const ids = {
  resource: "11111111-1111-4111-8111-111111111111",
  assignmentA: "22222222-2222-4222-8222-222222222222",
  assignmentB: "33333333-3333-4333-8333-333333333333",
  assignmentC: "33333333-3333-4333-8333-333333333334",
  bookingA: "44444444-4444-4444-8444-444444444444",
  bookingB: "55555555-5555-4555-8555-555555555555",
  bookingC: "55555555-5555-4555-8555-555555555556",
};

function reservation(
  overrides: Partial<ResourceReservation> = {},
): ResourceReservation {
  return {
    assignmentId: ids.assignmentA,
    bookingId: ids.bookingA,
    bookingName: "Booking A",
    resourceId: ids.resource,
    resourceCode: "paintball_trailer",
    resourceName: "Paintball trailer",
    resourceStatus: "available",
    countsAsAttraction: true,
    movable: true,
    setupMinutes: 0,
    teardownMinutes: 0,
    minimumTransferMinutes: 0,
    startsAt: new Date("2026-08-10T17:00:00.000Z"),
    endsAt: new Date("2026-08-10T17:00:00.000Z"),
    location: { latitude: 45.75, longitude: -108.5 },
    ...overrides,
  };
}

const noRouteNeeded: TransferTimeLookup = {
  estimateMinutes: async () => ({ minutes: 0, source: "manual" }),
};

describe("detectResourceConflicts", () => {
  it("detects setup/event/teardown overlap and excludes nonoverlapping windows", async () => {
    const overlapping = await detectResourceConflicts({
      reservations: [
        reservation({ teardownMinutes: 30 }),
        reservation({
          assignmentId: ids.assignmentB,
          bookingId: ids.bookingB,
          bookingName: "Booking B",
          setupMinutes: 15,
          startsAt: new Date("2026-08-11T17:00:00.000Z"),
          endsAt: new Date("2026-08-11T17:00:00.000Z"),
          movable: false,
        }),
      ],
      physicalAttractionTotal: null,
      assignedAttractionCount: 1,
      transferTimeLookup: noRouteNeeded,
    });
    expect(overlapping.map(({ code }) => code)).toEqual(["RESOURCE_OVERLAP"]);

    const nonoverlapping = await detectResourceConflicts({
      reservations: [
        reservation({ movable: false }),
        reservation({
          assignmentId: ids.assignmentB,
          bookingId: ids.bookingB,
          bookingName: "Booking B",
          startsAt: new Date("2026-08-11T17:00:00.000Z"),
          endsAt: new Date("2026-08-11T17:00:00.000Z"),
          movable: false,
        }),
      ],
      physicalAttractionTotal: null,
      assignedAttractionCount: 1,
      transferTimeLookup: noRouteNeeded,
    });
    expect(nonoverlapping).toEqual([]);
  });

  it("checks a movable paintball transfer asynchronously and warns when the gap is short", async () => {
    const lookup: TransferTimeLookup = {
      estimateMinutes: async () => ({ minutes: 60, source: "cached" }),
    };
    const warnings = await detectResourceConflicts({
      reservations: [
        reservation(),
        reservation({
          assignmentId: ids.assignmentB,
          bookingId: ids.bookingB,
          bookingName: "Booking B",
          startsAt: new Date("2026-08-11T17:00:00.000Z"),
          endsAt: new Date("2026-08-11T17:00:00.000Z"),
          location: { latitude: 46.87, longitude: -113.99 },
        }),
      ],
      physicalAttractionTotal: null,
      assignedAttractionCount: 1,
      transferTimeLookup: lookup,
    });

    expect(warnings).toMatchObject([
      {
        code: "PAINTBALL_TRANSFER_TIME",
        resourceId: ids.resource,
        assignmentIds: [ids.assignmentA, ids.assignmentB],
      },
    ]);
  });

  it("uses the latest completed direct predecessor when an overlapping booking is nested", async () => {
    const lookedUpPairs: string[] = [];
    const warnings = await detectResourceConflicts({
      reservations: [
        reservation({
          startsAt: new Date("2026-08-01T17:00:00.000Z"),
          endsAt: new Date("2026-08-10T17:00:00.000Z"),
        }),
        reservation({
          assignmentId: ids.assignmentB,
          bookingId: ids.bookingB,
          bookingName: "Nested booking",
          startsAt: new Date("2026-08-02T17:00:00.000Z"),
          endsAt: new Date("2026-08-02T17:00:00.000Z"),
          location: { latitude: 46.87, longitude: -113.99 },
        }),
        reservation({
          assignmentId: ids.assignmentC,
          bookingId: ids.bookingC,
          bookingName: "Booking C",
          startsAt: new Date("2026-08-11T17:00:00.000Z"),
          endsAt: new Date("2026-08-11T17:00:00.000Z"),
          location: { latitude: 47.5, longitude: -111.3 },
        }),
      ],
      physicalAttractionTotal: null,
      assignedAttractionCount: 1,
      transferTimeLookup: {
        estimateMinutes: async (from, to) => {
          lookedUpPairs.push(`${from.assignmentId}->${to.assignmentId}`);
          return { minutes: 60, source: "cached" };
        },
      },
    });

    expect(warnings.map(({ code, assignmentIds }) => ({
      code,
      assignmentIds,
    }))).toEqual([
      {
        code: "RESOURCE_OVERLAP",
        assignmentIds: [ids.assignmentA, ids.assignmentB],
      },
      {
        code: "PAINTBALL_TRANSFER_TIME",
        assignmentIds: [ids.assignmentA, ids.assignmentC],
      },
    ]);
    expect(lookedUpPairs).toEqual([
      `${ids.assignmentA}->${ids.assignmentC}`,
    ]);
  });

  it("checks every tied maximum-end exit into the next overlap cluster", async () => {
    const lookedUpPairs: string[] = [];
    const warnings = await detectResourceConflicts({
      reservations: [
        reservation({
          startsAt: new Date("2026-08-01T17:00:00.000Z"),
          endsAt: new Date("2026-08-10T17:00:00.000Z"),
        }),
        reservation({
          assignmentId: ids.assignmentB,
          bookingId: ids.bookingB,
          bookingName: "Same-end booking",
          startsAt: new Date("2026-08-02T17:00:00.000Z"),
          endsAt: new Date("2026-08-10T17:00:00.000Z"),
          location: { latitude: 46.87, longitude: -113.99 },
        }),
        reservation({
          assignmentId: ids.assignmentC,
          bookingId: ids.bookingC,
          bookingName: "Booking C",
          startsAt: new Date("2026-08-11T17:00:00.000Z"),
          endsAt: new Date("2026-08-11T17:00:00.000Z"),
          location: { latitude: 47.5, longitude: -111.3 },
        }),
      ],
      physicalAttractionTotal: null,
      assignedAttractionCount: 1,
      transferTimeLookup: {
        estimateMinutes: async (from, to) => {
          lookedUpPairs.push(`${from.assignmentId}->${to.assignmentId}`);
          return from.assignmentId === ids.assignmentA
            ? { minutes: 0, source: "cached" }
            : null;
        },
      },
    });

    expect(warnings.map(({ code, assignmentIds }) => ({
      code,
      assignmentIds,
    }))).toEqual([
      {
        code: "RESOURCE_OVERLAP",
        assignmentIds: [ids.assignmentA, ids.assignmentB],
      },
      {
        code: "TRANSFER_TRIP_MISSING",
        assignmentIds: [ids.assignmentB, ids.assignmentC],
      },
    ]);
    expect(lookedUpPairs).toEqual([
      `${ids.assignmentA}->${ids.assignmentC}`,
      `${ids.assignmentB}->${ids.assignmentC}`,
    ]);
  });

  it("checks every tied minimum-start entry from the previous overlap cluster", async () => {
    const lookedUpPairs: string[] = [];
    const warnings = await detectResourceConflicts({
      reservations: [
        reservation(),
        reservation({
          assignmentId: ids.assignmentB,
          bookingId: ids.bookingB,
          bookingName: "Lexicographically first entry",
          startsAt: new Date("2026-08-11T17:00:00.000Z"),
          endsAt: new Date("2026-08-11T17:00:00.000Z"),
          location: { latitude: 46.87, longitude: -113.99 },
        }),
        reservation({
          assignmentId: ids.assignmentC,
          bookingId: ids.bookingC,
          bookingName: "Same-start alternate entry",
          startsAt: new Date("2026-08-11T17:00:00.000Z"),
          endsAt: new Date("2026-08-11T17:00:00.000Z"),
          location: { latitude: 47.5, longitude: -111.3 },
        }),
      ],
      physicalAttractionTotal: null,
      assignedAttractionCount: 1,
      transferTimeLookup: {
        estimateMinutes: async (from, to) => {
          lookedUpPairs.push(`${from.assignmentId}->${to.assignmentId}`);
          return {
            minutes: to.assignmentId === ids.assignmentB ? 0 : 60,
            source: "cached",
          };
        },
      },
    });

    expect(warnings.map(({ code, assignmentIds }) => ({
      code,
      assignmentIds,
    }))).toEqual([
      {
        code: "RESOURCE_OVERLAP",
        assignmentIds: [ids.assignmentB, ids.assignmentC],
      },
      {
        code: "PAINTBALL_TRANSFER_TIME",
        assignmentIds: [ids.assignmentA, ids.assignmentC],
      },
    ]);
    expect(lookedUpPairs).toEqual([
      `${ids.assignmentA}->${ids.assignmentB}`,
      `${ids.assignmentA}->${ids.assignmentC}`,
    ]);
  });

  it("checks only consecutive direct transitions, not every nonoverlapping pair", async () => {
    const lookedUpPairs: string[] = [];
    const warnings = await detectResourceConflicts({
      reservations: [
        reservation({
          startsAt: new Date("2026-08-01T17:00:00.000Z"),
          endsAt: new Date("2026-08-01T17:00:00.000Z"),
        }),
        reservation({
          assignmentId: ids.assignmentB,
          bookingId: ids.bookingB,
          startsAt: new Date("2026-08-02T17:00:00.000Z"),
          endsAt: new Date("2026-08-02T17:00:00.000Z"),
        }),
        reservation({
          assignmentId: ids.assignmentC,
          bookingId: ids.bookingC,
          startsAt: new Date("2026-08-03T17:00:00.000Z"),
          endsAt: new Date("2026-08-03T17:00:00.000Z"),
        }),
      ],
      physicalAttractionTotal: null,
      assignedAttractionCount: 1,
      transferTimeLookup: {
        estimateMinutes: async (from, to) => {
          lookedUpPairs.push(`${from.assignmentId}->${to.assignmentId}`);
          return { minutes: 3_000, source: "cached" };
        },
      },
    });

    expect(warnings.filter(
      ({ code }) => code === "PAINTBALL_TRANSFER_TIME",
    ).map(({ assignmentIds }) => assignmentIds)).toEqual([
      [ids.assignmentA, ids.assignmentB],
      [ids.assignmentB, ids.assignmentC],
    ]);
    expect(lookedUpPairs).toEqual([
      `${ids.assignmentA}->${ids.assignmentB}`,
      `${ids.assignmentB}->${ids.assignmentC}`,
    ]);
  });

  it("never assumes zero travel for a missing location or missing route", async () => {
    let lookupCalls = 0;
    const countingLookup: TransferTimeLookup = {
      estimateMinutes: async () => {
        lookupCalls += 1;
        return { minutes: 0, source: "manual" };
      },
    };
    const second = reservation({
      assignmentId: ids.assignmentB,
      bookingId: ids.bookingB,
      bookingName: "Booking B",
      startsAt: new Date("2026-08-11T17:00:00.000Z"),
      endsAt: new Date("2026-08-11T17:00:00.000Z"),
      location: { latitude: 46.87, longitude: -113.99 },
    });
    const unknownLocation = await detectResourceConflicts({
      reservations: [reservation({ location: null }), second],
      physicalAttractionTotal: null,
      assignedAttractionCount: 1,
      transferTimeLookup: countingLookup,
    });
    expect(unknownLocation.map(({ code }) => code)).toEqual([
      "RESOURCE_LOCATION_UNKNOWN",
    ]);
    expect(lookupCalls).toBe(0);

    const missingRoute = await detectResourceConflicts({
      reservations: [reservation(), second],
      physicalAttractionTotal: null,
      assignedAttractionCount: 1,
      transferTimeLookup: { estimateMinutes: async () => null },
    });
    expect(missingRoute.map(({ code }) => code)).toEqual([
      "TRANSFER_TRIP_MISSING",
    ]);
  });

  it.each([
    ["NaN", Number.NaN],
    ["an infinite", Number.POSITIVE_INFINITY],
    ["a negative", -1],
  ])(
    "treats %s transfer estimate as missing trip data",
    async (_label, minutes) => {
      const warnings = await detectResourceConflicts({
        reservations: [
          reservation(),
          reservation({
            assignmentId: ids.assignmentB,
            bookingId: ids.bookingB,
            bookingName: "Booking B",
            startsAt: new Date("2026-08-11T17:00:00.000Z"),
            endsAt: new Date("2026-08-11T17:00:00.000Z"),
            location: { latitude: 46.87, longitude: -113.99 },
          }),
        ],
        physicalAttractionTotal: null,
        assignedAttractionCount: 1,
        transferTimeLookup: {
          estimateMinutes: async () => ({ minutes, source: "cached" }),
        },
      });

      expect(warnings.map(({ code }) => code)).toEqual([
        "TRANSFER_TRIP_MISSING",
      ]);
    },
  );

  it.each([
    { latitude: 91, longitude: -108.5 },
    { latitude: -91, longitude: -108.5 },
    { latitude: 45.75, longitude: 181 },
    { latitude: 45.75, longitude: -181 },
  ])(
    "treats out-of-range coordinates $latitude,$longitude as unknown without route lookup",
    async (location) => {
      let lookupCalls = 0;
      const warnings = await detectResourceConflicts({
        reservations: [
          reservation({ location }),
          reservation({
            assignmentId: ids.assignmentB,
            bookingId: ids.bookingB,
            startsAt: new Date("2026-08-11T17:00:00.000Z"),
            endsAt: new Date("2026-08-11T17:00:00.000Z"),
          }),
        ],
        physicalAttractionTotal: null,
        assignedAttractionCount: 1,
        transferTimeLookup: {
          estimateMinutes: async () => {
            lookupCalls += 1;
            return { minutes: 60, source: "cached" };
          },
        },
      });

      expect(warnings.map(({ code }) => code)).toEqual([
        "RESOURCE_LOCATION_UNKNOWN",
      ]);
      expect(lookupCalls).toBe(0);
    },
  );

  it("reports physical-count mismatch and unavailable status while counting one physical resource once", async () => {
    const unavailable = reservation({
      resourceStatus: "maintenance",
      movable: false,
    });
    const warnings = await detectResourceConflicts({
      reservations: [unavailable],
      physicalAttractionTotal: 2,
      assignedAttractionCount: 1,
      transferTimeLookup: noRouteNeeded,
    });
    expect(warnings.map(({ code }) => code)).toEqual([
      "ATTRACTION_TOTAL_MISMATCH",
      "RESOURCE_UNAVAILABLE",
    ]);

    const attributedTwiceButPhysicalOnce = await detectResourceConflicts({
      reservations: [reservation({ movable: false })],
      physicalAttractionTotal: 1,
      assignedAttractionCount: 1,
      transferTimeLookup: noRouteNeeded,
    });
    expect(attributedTwiceButPhysicalOnce).toEqual([]);
  });

  it("builds deterministic keys from sorted assignments and relevant fingerprints", async () => {
    const first = reservation({ teardownMinutes: 30, movable: false });
    const second = reservation({
      assignmentId: ids.assignmentB,
      bookingId: ids.bookingB,
      bookingName: "Booking B",
      setupMinutes: 15,
      startsAt: new Date("2026-08-11T17:00:00.000Z"),
      endsAt: new Date("2026-08-11T17:00:00.000Z"),
      movable: false,
    });
    const run = (reservations: ResourceReservation[]) =>
      detectResourceConflicts({
        reservations,
        physicalAttractionTotal: null,
        assignedAttractionCount: 1,
        transferTimeLookup: noRouteNeeded,
      });

    const [forward] = await run([first, second]);
    const [reversed] = await run([second, first]);
    const [locationChanged] = await run([
      first,
      { ...second, location: { latitude: 47.5, longitude: -111.3 } },
    ]);
    const [timeChanged] = await run([
      first,
      { ...second, setupMinutes: 16 },
    ]);

    expect(forward?.conflictKey).toBe(reversed?.conflictKey);
    expect(forward?.conflictKey).toContain("RESOURCE_OVERLAP");
    expect(forward?.conflictKey).toContain(ids.resource);
    expect(forward?.conflictKey).toContain(ids.assignmentA);
    expect(forward?.conflictKey).toContain(ids.assignmentB);
    expect(locationChanged?.conflictKey).toBe(forward?.conflictKey);
    expect(timeChanged?.conflictKey).not.toBe(forward?.conflictKey);
  });

  it("keeps a transfer key stable when only estimate provenance changes", async () => {
    const reservations = [
      reservation(),
      reservation({
        assignmentId: ids.assignmentB,
        bookingId: ids.bookingB,
        startsAt: new Date("2026-08-11T17:00:00.000Z"),
        endsAt: new Date("2026-08-11T17:00:00.000Z"),
      }),
    ];
    const run = (source: "live" | "cached") =>
      detectResourceConflicts({
        reservations,
        physicalAttractionTotal: null,
        assignedAttractionCount: 1,
        transferTimeLookup: {
          estimateMinutes: async () => ({ minutes: 60, source }),
        },
      });

    const [cached] = await run("cached");
    const [live] = await run("live");

    expect(cached?.code).toBe("PAINTBALL_TRANSFER_TIME");
    expect(live?.conflictKey).toBe(cached?.conflictKey);
  });
});
