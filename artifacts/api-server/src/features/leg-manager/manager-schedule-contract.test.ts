import { describe, expect, it } from "vitest";
import {
  managerDashboardResponseSchema,
  managerScopedMapResponseSchema,
} from "@workspace/api-zod";
import { loadManagerScopedMapData, loadManagerScopedScheduleData } from "./manager-map-data";

const legId = "00000000-0000-4000-8000-000000000010";
const tripId = "00000000-0000-4000-8000-000000000100";
const now = new Date("2026-08-19T00:00:00Z");

const trip = {
  id: tripId,
  travelLegId: legId,
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
};

function booking(bookingId: string, startsAt: string, status = "confirmed", probability: string | null = null) {
  return {
    bookingId,
    bookingName: bookingId,
    city: "Miles City",
    region: "MT",
    latitude: 46.4083,
    longitude: -105.8406,
    startsAt: new Date(startsAt),
    endsAt: new Date(new Date(startsAt).getTime() + 8 * 60 * 60 * 1000),
    status,
    probability,
    legName: "Kristy",
    legColor: "#f97316",
  };
}

function stop(bookingId: string, startsAt: string, sortOrder: number, status = "confirmed", probability: string | null = null) {
  return {
    id: `stop-${bookingId}`,
    tripId,
    sortOrder,
    ...booking(bookingId, startsAt, status, probability),
  };
}

function dependencies() {
  const stops = [
    stop("trip-middle", "2026-08-20T12:00:00Z", 1),
    stop("trip-potential", "2026-08-21T12:00:00Z", 2, "pending_contract", "likely"),
    stop("trip-completed", "2026-08-22T12:00:00Z", 3, "completed"),
  ];
  const directAssignments = [
    { ...booking("direct-early", "2026-08-19T12:00:00Z"), operationalStartsAt: new Date("2026-08-16T00:00:00Z"), operationalEndsAt: new Date("2026-08-22T00:00:00Z") },
    booking("direct-late", "2026-08-23T12:00:00Z", "pending_contract", "definite"),
    booking("direct-declined", "2026-08-24T12:00:00Z", "declined"),
  ];

  return {
    tripRepository: {
      async listTrips() { return [trip]; },
      async listStops() { return stops; },
      async listSegments() { return []; },
    },
    bookingRepository: {
      async listForLeg() { return directAssignments; },
    },
  };
}

function dashboardExtras() {
  return {
    legId,
    nextEvent: null,
    currentLifecycle: null,
    lifecycle: null,
    incompleteWrapUps: [],
    wrapUps: [],
    reviewsDue: [],
    reviews: [],
    money: {},
    moneySummary: {},
    summary: {
      upcomingBookedEventsCount: 3,
      incompleteWrapUpsCount: 0,
      reviewsDueCount: 0,
    },
    partialErrors: [],
  };
}

describe("manager schedule API contract", () => {
  it("keeps dashboard, map, and route payloads on the same booked, ordered event queue", async () => {
    const schedule = await loadManagerScopedScheduleData(dependencies(), legId, now);
    const expectedIds = ["direct-early", "trip-middle", "direct-late"];
    const dashboard = managerDashboardResponseSchema.parse({ ...schedule, ...dashboardExtras() });
    const map = managerScopedMapResponseSchema.parse({ ...schedule, meetups: [] });
    const route = managerDashboardResponseSchema.parse({ ...schedule, ...dashboardExtras() });

    for (const payload of [dashboard, map, route]) {
      expect(payload.events.map((event) => event.bookingId)).toEqual(expectedIds);
      expect(payload.events.every((event) => event.scheduleState === "booked")).toBe(true);
      expect(payload.events.find((event) => event.bookingId === "direct-early")).toMatchObject({
        operationalStartsAt: "2026-08-16T00:00:00.000Z",
        operationalEndsAt: "2026-08-22T00:00:00.000Z",
      });
    }
    expect(dashboard.route?.stops.map((event) => event.bookingId)).toEqual(["trip-middle"]);
    expect(map.route?.stops.map((event) => event.bookingId)).toEqual(["trip-middle"]);
  });

  it("keeps the checked-in event in the manager map after its scheduled date cutoff", async () => {
    const pastActive = booking("meeteetse-active", "2026-08-15T12:00:00Z");
    const scoped = dependencies();
    scoped.bookingRepository.listForLeg = async () => [pastActive];

    const map = await loadManagerScopedMapData({
      ...scoped,
      handoffRepository: { async listForLeg() { return []; } },
      lifecycleRepository: {
        async getCurrentForLeg() { return { bookingId: "meeteetse-active" }; },
      },
    }, legId, now);

    expect(map.events.map((event) => event.bookingId)).toEqual(["meeteetse-active"]);
  });

  it("rejects a schedule event when a required contract field is missing", async () => {
    const schedule = await loadManagerScopedScheduleData(dependencies(), legId, now);
    const invalid = {
      ...schedule,
      events: schedule.events.map(({ scheduleState: _scheduleState, ...event }) => event),
    };

    expect(() => managerDashboardResponseSchema.parse({ ...invalid, ...dashboardExtras() })).toThrow();
    expect(() => managerScopedMapResponseSchema.parse({ ...invalid, meetups: [] })).toThrow();
  });
});