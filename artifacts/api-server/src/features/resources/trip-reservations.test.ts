import { describe, expect, it } from "vitest";

import { detectResourceConflicts } from "./resource-conflicts";
import type { ResourceReservation } from "./resource-types";

/**
 * Trip resource assignments surface as pseudo-reservations
 * (assignmentId "trip:<id>", the trip's date window, the trip start location)
 * from both DrizzleResourceTransaction.listReservationsForResources (the
 * configure/acknowledge flow) and the booking operations summary. These tests
 * pin the conflict behavior for that reservation shape.
 */

const noTransfer = { estimateMinutes: async () => null };

function bookingReservation(
  overrides: Partial<ResourceReservation>,
): ResourceReservation {
  return {
    assignmentId: "assignment-1",
    bookingId: "booking-1",
    bookingName: "Springs Fair",
    resourceId: "resource-1",
    resourceCode: "paintball_trailer",
    resourceName: "Paintball trailer",
    resourceStatus: "available",
    countsAsAttraction: true,
    movable: true,
    setupMinutes: 30,
    teardownMinutes: 30,
    minimumTransferMinutes: 60,
    startsAt: new Date("2026-08-10T16:00:00Z"),
    endsAt: new Date("2026-08-10T22:00:00Z"),
    location: { latitude: 38.8339, longitude: -104.8214 },
    ...overrides,
  };
}

function tripReservation(
  overrides: Partial<ResourceReservation>,
): ResourceReservation {
  return bookingReservation({
    assignmentId: "trip:trip-assignment-1",
    bookingId: "trip-1",
    bookingName: "Trip: August southern run",
    countsAsAttraction: false,
    setupMinutes: 0,
    teardownMinutes: 0,
    startsAt: new Date("2026-08-09T12:00:00Z"),
    endsAt: new Date("2026-08-12T12:00:00Z"),
    location: { latitude: 39.7392, longitude: -104.9903 },
    ...overrides,
  });
}

describe("trip reservations in resource conflict checks", () => {
  it("flags an overlap when a booking uses a resource reserved by an overlapping trip", async () => {
    const warnings = await detectResourceConflicts({
      reservations: [bookingReservation({}), tripReservation({})],
      physicalAttractionTotal: null,
      assignedAttractionCount: 1,
      transferTimeLookup: noTransfer,
    });
    const overlap = warnings.find((w) => w.code === "RESOURCE_OVERLAP");
    expect(overlap).toBeDefined();
    expect(overlap!.message).toContain("Trip: August southern run");
  });

  it("reports no overlap when the trip window does not intersect the booking", async () => {
    const warnings = await detectResourceConflicts({
      reservations: [
        bookingReservation({}),
        tripReservation({
          startsAt: new Date("2026-08-20T12:00:00Z"),
          endsAt: new Date("2026-08-22T12:00:00Z"),
        }),
      ],
      physicalAttractionTotal: null,
      assignedAttractionCount: 1,
      transferTimeLookup: noTransfer,
    });
    expect(warnings.filter((w) => w.code === "RESOURCE_OVERLAP")).toHaveLength(0);
  });
});
