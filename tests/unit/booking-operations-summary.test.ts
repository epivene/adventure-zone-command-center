import { describe, expect, it } from "vitest";

import {
  CachedBookingOperationsSummaryProvider,
  type BookingOperationsSummaryRecord,
  type BookingOperationsSummaryRepository,
} from "@/features/bookings/booking-operations-summary";

const ids = {
  booking: "11111111-1111-4111-8111-111111111111",
  otherBooking: "22222222-2222-4222-8222-222222222222",
  resource: "33333333-3333-4333-8333-333333333333",
  assignment: "44444444-4444-4444-8444-444444444444",
  otherAssignment: "55555555-5555-4555-8555-555555555555",
};

const record: BookingOperationsSummaryRecord = {
  booking: {
    id: ids.booking,
    name: "County Fair",
    startsAt: new Date("2026-08-10T17:00:00.000Z"),
    endsAt: new Date("2026-08-10T17:00:00.000Z"),
    latitude: 45.7,
    longitude: -108.5,
    physicalAttractionTotal: 1,
    leg: { id: "leg-1", name: "North", color: "#123456" },
  },
  packageNames: ["Weekend Warriors", "Adventure Zone"],
  pendingRequestCount: 2,
  assignments: [{
    id: ids.assignment,
    bookingId: ids.booking,
    resourceId: ids.resource,
    attributionSource: "inferred",
  }],
  resources: [{
    id: ids.resource,
    code: "paintball_trailer",
    name: "Paintball",
    category: "attraction",
    countsAsAttraction: true,
    movable: true,
    setupMinutes: 0,
    teardownMinutes: 0,
    minimumTransferMinutes: 90,
    status: "available",
  }],
  reservations: [
    {
      assignmentId: ids.assignment,
      bookingId: ids.booking,
      bookingName: "County Fair",
      resourceId: ids.resource,
      resourceCode: "paintball_trailer",
      resourceName: "Paintball",
      resourceStatus: "available",
      countsAsAttraction: true,
      movable: true,
      setupMinutes: 0,
      teardownMinutes: 0,
      minimumTransferMinutes: 90,
      startsAt: new Date("2026-08-10T17:00:00.000Z"),
      endsAt: new Date("2026-08-10T17:00:00.000Z"),
      location: { latitude: 45.7, longitude: -108.5 },
    },
    {
      assignmentId: ids.otherAssignment,
      bookingId: ids.otherBooking,
      bookingName: "Other Fair",
      resourceId: ids.resource,
      resourceCode: "paintball_trailer",
      resourceName: "Paintball",
      resourceStatus: "available",
      countsAsAttraction: true,
      movable: true,
      setupMinutes: 0,
      teardownMinutes: 0,
      minimumTransferMinutes: 90,
      startsAt: new Date("2026-08-11T17:00:00.000Z"),
      endsAt: new Date("2026-08-11T17:00:00.000Z"),
      location: { latitude: 46.9, longitude: -114 },
    },
  ],
  overrides: [],
};

class RecordingRepository implements BookingOperationsSummaryRepository {
  calls: string[][] = [];

  async loadForBookings(bookingIds: readonly string[]) {
    this.calls.push([...bookingIds]);
    return bookingIds.includes(ids.booking) ? [record] : [];
  }
}

describe("CachedBookingOperationsSummaryProvider", () => {
  it("batches, caches, sorts, and exposes missing transfer data as a warning", async () => {
    const repository = new RecordingRepository();
    const provider = new CachedBookingOperationsSummaryProvider(repository, {
      estimateMinutes: async () => null,
    });

    const summaries = await provider.getForBookings([ids.otherBooking, ids.booking, ids.booking]);
    const summary = summaries.get(ids.booking)!;

    expect(repository.calls).toEqual([[ids.booking, ids.otherBooking]]);
    expect(summary.packageNames).toEqual(["Adventure Zone", "Weekend Warriors"]);
    expect(summary.pendingRequestCount).toBe(2);
    expect(summary.sharedAttractionTotal).toBe(1);
    expect(summary.warnings).toMatchObject([
      { kind: "package", severity: "warning" },
      { kind: "route", severity: "warning" },
    ]);
    expect(summary.warnings[1]?.message).toMatch(/route or trip estimate exists/i);
    await provider.getForBooking(ids.booking);
    expect(repository.calls).toHaveLength(1);
  });

  it("downgrades an exact overridden blocking conflict while retaining metadata in its message", async () => {
    const repository = new RecordingRepository();
    const first = new CachedBookingOperationsSummaryProvider(repository, {
      estimateMinutes: async () => ({ minutes: 20, source: "cached" }),
    });
    const active = await first.getForBooking(ids.booking);
    const conflict = active.warnings.find(({ severity }) => severity === "blocking")!;
    record.overrides = [{
      id: "override-1",
      bookingId: ids.booking,
      resourceId: ids.resource,
      conflictKey: conflict.id,
      reason: "Dispatcher approved alternate route",
      acknowledgedBy: "owner_1",
      createdAt: new Date("2026-07-29T12:00:00.000Z"),
    }];

    const overridden = await new CachedBookingOperationsSummaryProvider(repository, {
      estimateMinutes: async () => ({ minutes: 20, source: "cached" }),
    }).getForBooking(ids.booking);

    expect(overridden.warnings.find(({ id }) => id === conflict.id)).toMatchObject({
      severity: "warning",
      message: expect.stringMatching(
        /Dispatcher approved alternate route.*owner_1.*2026-07-29T12:00:00.000Z/,
      ),
    });
  });
});
