import { describe, expect, it } from "vitest";
import { loadManagerScopedMapData, managerScheduleState } from "./manager-map-data";

const kristyLegId = "00000000-0000-4000-8000-000000000010";
const hulkLegId = "00000000-0000-4000-8000-000000000020";
const kristyTripId = "00000000-0000-4000-8000-000000000100";

const kristyTrip = {
  id: kristyTripId,
  travelLegId: kristyLegId,
  name: "Kristy route",
  startDate: new Date("2026-08-18T00:00:00Z"),
  endDate: new Date("2026-08-28T00:00:00Z"),
  startLabel: "Utah base",
  startLatitude: 40.2,
  startLongitude: -111.9,
  endLabel: "Utah base",
  endLatitude: 40.2,
  endLongitude: -111.9,
  legName: "Kristy",
  legColor: "#f97316",
  stopCount: 1,
};

const kristyStop = {
  id: "00000000-0000-4000-8000-000000000101",
  tripId: kristyTripId,
  bookingId: "00000000-0000-4000-8000-000000000201",
  sortOrder: 1,
  bookingName: "Eastern Montana Fair",
  city: "Miles City",
  region: "MT",
  latitude: 46.4083,
  longitude: -105.8406,
  startsAt: new Date("2026-08-20T12:00:00Z"),
  endsAt: new Date("2026-08-20T20:00:00Z"),
  status: "confirmed",
  probability: null,
};

const assignedBookingWithoutTrip = {
  bookingId: "00000000-0000-4000-8000-000000000202",
  bookingName: "Assigned directly to Kristy",
  city: "Dickinson",
  region: "ND",
  latitude: 46.8792,
  longitude: -102.7896,
  startsAt: new Date("2026-08-23T12:00:00Z"),
  endsAt: new Date("2026-08-23T20:00:00Z"),
  status: "confirmed",
  probability: null,
  legName: "Kristy",
  legColor: "#f97316",
};

function legParticipant(legId: string, legName: string) {
  return { kind: "leg" as const, legId, legName };
}

function meetup(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000301",
    status: "approved" as const,
    fromLegId: kristyLegId,
    toLegId: hulkLegId,
    fromParticipant: legParticipant(kristyLegId, "Kristy"),
    toParticipant: legParticipant(hulkLegId, "Hulk"),
    fromTripId: kristyTripId,
    toTripId: null,
    resourceId: "00000000-0000-4000-8000-000000000401",
    resourceCode: "PB",
    resourceName: "Paintball trailer",
    meetupLabel: "Billings transfer",
    meetupLatitude: 45.7833,
    meetupLongitude: -108.5007,
    windowStartsAt: new Date("2026-08-21T12:00:00Z"),
    windowEndsAt: new Date("2026-08-21T14:00:00Z"),
    directMiles: null,
    directMinutes: null,
    fromDetourMiles: 0,
    fromDetourMinutes: 0,
    toDetourMiles: 0,
    toDetourMinutes: 0,
    combinedDetourMiles: 0,
    availableBufferMinutes: 120,
    opportunityBand: "possible" as const,
    explanation: "Approved meetup",
    dependencyFingerprint: "manual:test",
    approvedAt: new Date("2026-08-15T00:00:00Z"),
    dismissedAt: null,
    ...overrides,
  };
}

function deps(handoffs: any[], assignedBookings: any[] = []) {
  return {
    tripRepository: {
      async listTrips(options?: { travelLegId?: string }) {
        return options?.travelLegId === kristyLegId ? [kristyTrip] : [];
      },
      async listStops(tripId: string) {
        return tripId === kristyTripId ? [kristyStop] : [];
      },
      async listSegments(tripId: string) {
        return tripId === kristyTripId
          ? [{ id: "seg-1", tripId, sequence: 1, fromKey: "a", toKey: "b", fromLabel: "Utah base", toLabel: "Miles City", miles: 610, minutes: 570, source: "fallback" as const, estimatedAt: null, overrideMiles: null, overrideMinutes: null }]
          : [];
      },
    },
    bookingRepository: {
      async listForLeg(legId: string) {
        return legId === kristyLegId ? assignedBookings : [];
      },
    },
    handoffRepository: {
      async listForLeg(legId: string) {
        return legId === kristyLegId ? handoffs : [];
      },
    },
  } as any;
}

describe("loadManagerScopedMapData", () => {
  it("returns only the authenticated leg's events and route geometry", async () => {
    const result = await loadManagerScopedMapData(deps([]), kristyLegId, new Date("2026-08-19T00:00:00Z"));

    expect(result.events.map((event) => event.bookingId)).toEqual([kristyStop.bookingId]);
    expect(result.route?.trip.id).toBe(kristyTripId);
    expect((result as any).trips.map((trip: { id: string }) => trip.id)).toEqual([kristyTripId]);
    expect(JSON.stringify(result)).not.toContain("Hulk private stop");
  });

  it("includes a booking assigned to the manager leg even before it is added to a trip", async () => {
    const result = await loadManagerScopedMapData(
      deps([], [assignedBookingWithoutTrip]),
      kristyLegId,
      new Date("2026-08-19T00:00:00Z"),
    );

    expect(result.events.find((event) => event.bookingId === assignedBookingWithoutTrip.bookingId)).toMatchObject({
      bookingId: assignedBookingWithoutTrip.bookingId,
      status: "confirmed",
      probability: null,
    });
  });

  it("preserves definite probability for an assigned upcoming booking that is not yet confirmed", async () => {
    const definiteBooking = {
      ...assignedBookingWithoutTrip,
      bookingId: "00000000-0000-4000-8000-000000000203",
      bookingName: "Definite county fair",
      status: "pending_contract",
      probability: "definite",
    };
    const result = await loadManagerScopedMapData(
      deps([], [definiteBooking]),
      kristyLegId,
      new Date("2026-08-19T00:00:00Z"),
    );

    expect(result.events.find((event) => event.bookingId === definiteBooking.bookingId)).toMatchObject({
      bookingId: definiteBooking.bookingId,
      status: "pending_contract",
      probability: "definite",
    });
  });

  it("uses the same booked visibility rules and deterministic ordering for direct assignments and trip stops", async () => {
    const earlyDirect = { ...assignedBookingWithoutTrip, bookingId: "direct-early", startsAt: new Date("2026-08-19T12:00:00Z"), endsAt: new Date("2026-08-19T20:00:00Z") };
    const lateDirect = { ...assignedBookingWithoutTrip, bookingId: "direct-late", startsAt: new Date("2026-08-24T12:00:00Z"), endsAt: new Date("2026-08-24T20:00:00Z") };
    const excluded = [
      { ...assignedBookingWithoutTrip, bookingId: "declined", status: "declined" },
      { ...assignedBookingWithoutTrip, bookingId: "completed", status: "completed" },
      { ...assignedBookingWithoutTrip, bookingId: "potential", status: "pending_contract", probability: "likely" },
    ];

    const result = await loadManagerScopedMapData(
      deps([], [earlyDirect, lateDirect, ...excluded]),
      kristyLegId,
      new Date("2026-08-19T00:00:00Z"),
    );

    expect(result.events.map((event) => event.bookingId)).toEqual([earlyDirect.bookingId, kristyStop.bookingId, lateDirect.bookingId]);
    expect(result.events.every((event) => event.scheduleState === "booked")).toBe(true);
    expect(result.route?.stops.map((stop) => stop.bookingId)).toEqual([kristyStop.bookingId]);
    expect(managerScheduleState("pending_contract", "definite")).toBe("booked");
    expect(managerScheduleState("pending_contract", "likely")).toBe("potential");
    expect(managerScheduleState("declined", "definite")).toBe("excluded");
  });

  it("keeps a checked-in booking visible after its scheduled date cutoff", async () => {
    const activePastBooking = {
      ...assignedBookingWithoutTrip,
      bookingId: "00000000-0000-4000-8000-000000000204",
      bookingName: "Meeteetse Annual Labor Day Celebration",
      startsAt: new Date("2026-08-14T12:00:00Z"),
      endsAt: new Date("2026-08-15T20:00:00Z"),
    };
    const dependencies = deps([], [activePastBooking]);
    dependencies.lifecycleRepository = {
      async getCurrentForLeg() { return { bookingId: activePastBooking.bookingId }; },
    };

    const result = await loadManagerScopedMapData(
      dependencies,
      kristyLegId,
      new Date("2026-08-19T00:00:00Z"),
    );

    expect(result.events.map((event) => event.bookingId)).toContain(activePastBooking.bookingId);
  });

  it("keeps the checked-in booking's past trip and travel estimates", async () => {
    const activeBookingId = "00000000-0000-4000-8000-000000000205";
    const pastTrip = {
      ...kristyTrip,
      id: "00000000-0000-4000-8000-000000000105",
      startDate: new Date("2026-08-10T00:00:00Z"),
      endDate: new Date("2026-08-15T23:00:00Z"),
      mpg: 10,
      fuelPricePerGallon: 3.5,
    };
    const pastStop = {
      ...kristyStop,
      id: "00000000-0000-4000-8000-000000000106",
      tripId: pastTrip.id,
      bookingId: activeBookingId,
      bookingName: "Meeteetse Annual Labor Day Celebration",
      startsAt: new Date("2026-08-14T12:00:00Z"),
      endsAt: new Date("2026-08-15T20:00:00Z"),
    };
    const dependencies = deps([], [{
      ...assignedBookingWithoutTrip,
      bookingId: activeBookingId,
      bookingName: pastStop.bookingName,
      startsAt: pastStop.startsAt,
      endsAt: pastStop.endsAt,
      operationalStartsAt: new Date("2026-08-12T00:00:00Z"),
      operationalEndsAt: new Date("2026-08-17T00:00:00Z"),
    }]);
    dependencies.tripRepository = {
      async listTrips() { return [pastTrip]; },
      async listStops(tripId: string) { return tripId === pastTrip.id ? [pastStop] : []; },
      async listSegments(tripId: string) {
        return tripId === pastTrip.id
          ? [{ id: "past-segment", tripId, sequence: 1, fromKey: "a", toKey: "b", fromLabel: "Prior stop", toLabel: "Meeteetse", miles: 120, minutes: 150, source: "fallback" as const, estimatedAt: null, overrideMiles: null, overrideMinutes: null }]
          : [];
      },
    };
    dependencies.lifecycleRepository = {
      async getCurrentForLeg() { return { bookingId: activeBookingId }; },
    };

    const result = await loadManagerScopedMapData(
      dependencies,
      kristyLegId,
      new Date("2026-08-19T00:00:00Z"),
    );

    expect(result.route?.trip).toMatchObject({
      id: pastTrip.id,
      mpg: 10,
      fuelPricePerGallon: 3.5,
    });
    expect(result.route?.stops.map((stop) => stop.bookingId)).toEqual([activeBookingId]);
    expect(result.route?.segments).toEqual([expect.objectContaining({
      effectiveMiles: 120,
      effectiveMinutes: 150,
    })]);
    expect(result.events.find((event) => event.bookingId === activeBookingId)).toMatchObject({
      operationalStartsAt: new Date("2026-08-12T00:00:00Z"),
      operationalEndsAt: new Date("2026-08-17T00:00:00Z"),
    });
  });

  it("keeps the last checked-out event as the route anchor until the next event is checked in", async () => {
    const lastBookingId = "00000000-0000-4000-8000-000000000206";
    const nextBookingId = "00000000-0000-4000-8000-000000000207";
    const pastTrip = {
      ...kristyTrip,
      id: "00000000-0000-4000-8000-000000000107",
      startDate: new Date("2026-08-10T00:00:00Z"),
      endDate: new Date("2026-08-15T23:00:00Z"),
    };
    const futureTrip = {
      ...kristyTrip,
      id: "00000000-0000-4000-8000-000000000108",
      startDate: new Date("2026-08-20T00:00:00Z"),
      endDate: new Date("2026-08-28T00:00:00Z"),
    };
    const lastStop = {
      ...kristyStop,
      id: "00000000-0000-4000-8000-000000000109",
      tripId: pastTrip.id,
      bookingId: lastBookingId,
      bookingName: "Meeteetse Annual Labor Day Celebration",
      startsAt: new Date("2026-08-14T12:00:00Z"),
      endsAt: new Date("2026-08-15T20:00:00Z"),
    };
    const nextStop = {
      ...kristyStop,
      id: "00000000-0000-4000-8000-000000000110",
      tripId: futureTrip.id,
      bookingId: nextBookingId,
      bookingName: "Blanding City Fall Festival",
      startsAt: new Date("2026-08-22T12:00:00Z"),
      endsAt: new Date("2026-08-23T20:00:00Z"),
    };
    const dependencies = deps([], [
      { ...assignedBookingWithoutTrip, bookingId: lastBookingId, bookingName: lastStop.bookingName, startsAt: lastStop.startsAt, endsAt: lastStop.endsAt },
      { ...assignedBookingWithoutTrip, bookingId: nextBookingId, bookingName: nextStop.bookingName, startsAt: nextStop.startsAt, endsAt: nextStop.endsAt },
    ]);
    dependencies.tripRepository = {
      async listTrips() { return [pastTrip, futureTrip]; },
      async listStops(tripId: string) {
        if (tripId === pastTrip.id) return [lastStop];
        if (tripId === futureTrip.id) return [nextStop];
        return [];
      },
      async listSegments(tripId: string) {
        return [{ id: `segment-${tripId}`, tripId, sequence: 1, fromKey: "a", toKey: "b", fromLabel: "Prior stop", toLabel: tripId === pastTrip.id ? "Meeteetse" : "Blanding", miles: 120, minutes: 150, source: "fallback" as const, estimatedAt: null, overrideMiles: null, overrideMinutes: null }];
      },
    };
    let checkedInBookingId: string | null = null;
    dependencies.lifecycleRepository = {
      async getCurrentForLeg() { return checkedInBookingId ? { bookingId: checkedInBookingId } : null; },
      async getLatestCheckedOutForLeg() { return { bookingId: lastBookingId, checkedOutAt: new Date("2026-08-16T01:00:00Z") }; },
    };

    const result = await loadManagerScopedMapData(
      dependencies,
      kristyLegId,
      new Date("2026-08-19T00:00:00Z"),
    );

    expect(result.route?.trip.id).toBe(pastTrip.id);
    expect(result.route?.stops.map((stop) => stop.bookingId)).toEqual([lastBookingId]);
    expect(result.events.map((event) => event.bookingId)).toEqual([lastBookingId, nextBookingId]);

    checkedInBookingId = nextBookingId;
    const afterNextCheckIn = await loadManagerScopedMapData(
      dependencies,
      kristyLegId,
      new Date("2026-08-19T00:00:00Z"),
    );

    expect(afterNextCheckIn.route?.trip.id).toBe(futureTrip.id);
    expect(afterNextCheckIn.route?.stops.map((stop) => stop.bookingId)).toEqual([nextBookingId]);
    expect(afterNextCheckIn.events.map((event) => event.bookingId)).toEqual([nextBookingId]);
  });

  it("drops the last checked-out route anchor when no events remain in the season", async () => {
    const lastBookingId = "00000000-0000-4000-8000-000000000208";
    const pastBooking = {
      ...assignedBookingWithoutTrip,
      bookingId: lastBookingId,
      startsAt: new Date("2026-08-14T12:00:00Z"),
      endsAt: new Date("2026-08-15T20:00:00Z"),
    };
    const pastTrip = {
      ...kristyTrip,
      id: "00000000-0000-4000-8000-000000000111",
      startDate: new Date("2026-08-10T00:00:00Z"),
      endDate: new Date("2026-08-15T23:00:00Z"),
    };
    const pastStop = {
      ...kristyStop,
      id: "00000000-0000-4000-8000-000000000112",
      tripId: pastTrip.id,
      bookingId: lastBookingId,
      startsAt: pastBooking.startsAt,
      endsAt: pastBooking.endsAt,
    };
    const dependencies = deps([], [pastBooking]);
    dependencies.tripRepository = {
      async listTrips() { return [pastTrip]; },
      async listStops(tripId: string) { return tripId === pastTrip.id ? [pastStop] : []; },
      async listSegments() { return []; },
    };
    dependencies.lifecycleRepository = {
      async getCurrentForLeg() { return null; },
      async getLatestCheckedOutForLeg() { return { bookingId: lastBookingId, checkedOutAt: new Date("2026-08-16T01:00:00Z") }; },
    };

    const result = await loadManagerScopedMapData(
      dependencies,
      kristyLegId,
      new Date("2026-08-19T00:00:00Z"),
    );

    expect(result.route).toBeNull();
    expect(result.events).toEqual([]);
  });

  it("includes a shared meetup but only the counterpart leg identity", async () => {
    const result = await loadManagerScopedMapData(deps([meetup()]), kristyLegId, new Date("2026-08-19T00:00:00Z"));

    expect(result.meetups[0]?.counterpart).toEqual(legParticipant(hulkLegId, "Hulk"));
    expect(JSON.stringify(result.meetups[0])).not.toContain("Hulk private stop");
  });

  it("includes an assigned outside runner meetup", async () => {
    const external = {
      kind: "external_contact" as const,
      externalContactId: null,
      displayName: "Jordan Smith",
      phone: "555-0100",
      email: null,
    };
    const result = await loadManagerScopedMapData(
      deps([meetup({ toLegId: null, toParticipant: external })]),
      kristyLegId,
      new Date("2026-08-19T00:00:00Z"),
    );

    expect(result.meetups[0]?.counterpart).toEqual(external);
  });

  it("filters out a meetup unrelated to the authenticated leg even if a repository returns it", async () => {
    const unrelated = meetup({
      id: "00000000-0000-4000-8000-000000000399",
      fromLegId: hulkLegId,
      toLegId: "00000000-0000-4000-8000-000000000099",
      fromParticipant: legParticipant(hulkLegId, "Hulk"),
      toParticipant: legParticipant("00000000-0000-4000-8000-000000000099", "Other"),
    });
    const result = await loadManagerScopedMapData(deps([unrelated]), kristyLegId, new Date("2026-08-19T00:00:00Z"));

    expect(result.meetups).toEqual([]);
  });
});
