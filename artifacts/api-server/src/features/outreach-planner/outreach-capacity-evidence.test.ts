import { describe, it, expect, vi } from "vitest";
import {
  canonicalPackageQuantities,
  projectReservations,
  verifyTravel,
  capacityDecision,
  reconcileCalendar,
  type HoldFact,
  type AllocationFacts,
  type AllocationTarget,
} from "./outreach-capacity-evidence";
const estimate = vi.hoisted(() => vi.fn());
vi.mock("../trips/routing", () => ({
  RoutingEstimator: class {
    estimate = estimate;
  },
  OsrmRoutingProvider: class {},
  DrizzleRoutingCacheStore: class {},
}));
import { RouteDriveTimeEstimator } from "../leg-assignment/drive-time-estimator";

function tiedStops(direction: "previous" | "next") {
  const target: AllocationTarget = {
    bookingId: "target",
    eventStartsOn: "2026-10-10",
    eventEndsOn: "2026-10-11",
    startsOn: "2026-10-08",
    endsOn: "2026-10-12",
    legId: "leg",
    quantities: { adventure_zone: 1 },
    resourceIds: ["resource"],
    location: { latitude: 40, longitude: -80 },
    demandFingerprint: "target",
  };
  const previous = {
    ...target,
    bookingId: "previous",
    startsOn: "2026-09-20",
    endsOn: "2026-09-21",
  };
  const next = {
    ...target,
    bookingId: "next",
    startsOn: "2026-11-01",
    endsOn: "2026-11-02",
  };
  const tied = {
    ...(direction === "previous" ? previous : next),
    bookingId: "tied",
    legId: "other",
    location: { latitude: -40, longitude: 120 },
    ...(direction === "previous"
      ? { startsOn: "2026-08-01" }
      : { endsOn: "2026-12-01" }),
  };
  const facts: AllocationFacts = {
    generation: 0,
    bookings: [],
    windows: [],
    selections: [],
    assignments: [],
    legs: [],
    mirrors: [],
    calendars: [],
    demands: [],
    holds: [],
    packages: [
      {
        id: "package",
        code: "adventure_zone",
        normal_capacity: 1,
        temporary_unavailable_quantity: 0,
        active: true,
      },
    ],
    resources: [
      {
        id: "resource",
        name: "Shared",
        code: "shared",
        category: "equipment",
        status: "available",
        movable: true,
        normal_travel_leg_id: null,
        setup_minutes: 60,
        teardown_minutes: 60,
        minimum_transfer_minutes: 60,
      },
    ],
  };
  const stops = [previous, next, tied];
  const projection = {
    stops,
    reservations: stops.map((s) => ({
      id: s.bookingId,
      canonicalId: `booking:${s.bookingId}`,
      startsOn: s.startsOn,
      endsOn: s.endsOn,
      legId: s.legId,
      quantities: { "package:adventure_zone": 1, "resource:resource": 1 },
      confidence: "verified" as const,
    })),
    reasons: [],
    capacities: { "package:adventure_zone": 1, "resource:resource": 1 },
  };
  return { target, facts, projection };
}

describe("allocation package identity and fresh routing", () => {
  it.each(["previous", "next"] as const)(
    "reviews tied %s shared-resource locations regardless of input order",
    async (direction) => {
      const { target, facts, projection } = tiedStops(direction);
      const estimator = {
        estimateMinutes: async (
          from: { latitude: number },
          to: { latitude: number },
        ) => (from.latitude === -40 || to.latitude === -40 ? 100000 : 60),
      };
      const forward = await verifyTravel(facts, target, projection, estimator);
      const reverse = await verifyTravel(
        facts,
        target,
        { ...projection, stops: [...projection.stops].reverse() },
        estimator,
      );
      expect(forward).toEqual(reverse);
      expect(forward.join(" ")).toContain(
        "Resource resource has equally adjacent stops",
      );
      expect(capacityDecision(target, projection, forward).status).toBe(
        "needs_review",
      );
    },
  );
  it.each(["previous", "next"] as const)(
    "includes every tied %s stop in external Calendar corridors",
    (direction) => {
      const { target, facts, projection } = tiedStops(direction);
      facts.holds = projection.stops.map(
        (s) =>
          ({
            id: s.bookingId,
            candidate_id: "candidate",
            booking_id: s.bookingId,
            opportunity_id: "opportunity",
            leg_id: s.legId,
            event_starts_on: s.startsOn,
            event_ends_on: s.endsOn,
            starts_on: s.startsOn,
            ends_on: s.endsOn,
            quantities: s.quantities,
            resource_ids: s.resourceIds,
            location: s.location,
            demand_fingerprint: s.demandFingerprint,
            revision: 1,
            state: "active",
            owner: "owner",
            expires_at: "2026-09-02T00:00:00Z",
            ended_at: null,
          }) satisfies HoldFact,
      );
      const date = direction === "previous" ? "2026-08-15" : "2026-11-15";
      const evidence = {
        checkedAt: "2026-09-01T00:00:00Z",
        expiresAt: "2026-09-01T00:02:00Z",
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
        calendarIds: ["calendar"],
        errors: [],
        events: [
          {
            calendarId: "calendar",
            calendarTimeZone: "UTC",
            id: "unlinked",
            iCalUid: null,
            summary: "Unknown stop",
            description: "",
            start: { date },
            end: {
              date: direction === "previous" ? "2026-08-16" : "2026-11-16",
            },
            updated: null,
            recurringEventId: null,
            originalStartTime: null,
          },
        ],
      };
      const forward = reconcileCalendar(facts, target, evidence);
      const reverse = reconcileCalendar(
        { ...facts, holds: [...facts.holds].reverse() },
        target,
        evidence,
      );
      expect(forward).toEqual(reverse);
      expect(forward).toContain(
        "Equally adjacent Calendar route stops disagree on physical location or leg; reconcile the source facts.",
      );
      expect(forward.join(" ")).toContain(
        "Calendar event calendar/unlinked needs canonical booking",
      );
    },
  );
  it("canonicalizes only documented aliases and prevents duplicate inventory stock", () => {
    expect(
      canonicalPackageQuantities({
        warriors_playground: 1,
        pirate_rebellion: 2,
        adventure_zone: 1,
      }),
    ).toEqual({ weekend_warriors: 1, pirates_rebellion: 2, adventure_zone: 1 });
    const facts = {
      bookings: [],
      holds: [],
      resources: [],
      packages: [
        {
          id: "a",
          code: "warriors_playground",
          normal_capacity: 1,
          temporary_unavailable_quantity: 0,
          active: true,
        },
        {
          id: "b",
          code: "weekend_warriors",
          normal_capacity: 1,
          temporary_unavailable_quantity: 0,
          active: true,
        },
      ],
    } as unknown as AllocationFacts;
    const projection = projectReservations(
      facts,
      {} as AllocationTarget,
      new Date(),
    );
    expect(projection.reasons.join(" ")).toContain(
      "Multiple active inventory definitions",
    );
    expect(projection.capacities["package:weekend_warriors"]).toBe(0);
  });
  it("allocation fresh routing rejects cache fallback; existing callers keep their behavior", async () => {
    const point = { latitude: 40, longitude: -80 };
    estimate.mockResolvedValue({ minutes: 60, source: "cached" });
    expect(
      await new RouteDriveTimeEstimator({} as never, true).estimateMinutes(
        point,
        point,
      ),
    ).toBeNull();
    expect(estimate).toHaveBeenLastCalledWith(point, point, {
      preferLive: true,
    });
    expect(
      await new RouteDriveTimeEstimator({} as never).estimateMinutes(
        point,
        point,
      ),
    ).toBe(60);
    estimate.mockResolvedValue({ minutes: 60, source: "live" });
    expect(
      await new RouteDriveTimeEstimator({} as never, true).estimateMinutes(
        point,
        point,
      ),
    ).toBe(60);
  });
});
