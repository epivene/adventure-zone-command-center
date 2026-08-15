import { describe, expect, it } from "vitest";
import { buildRoutePoints, type TripHandoffPoint } from "./trip-service";

const trip = {
  id: "trip-1",
  travelLegId: "leg-a",
  name: "Leg A week",
  startDate: new Date("2026-08-18T00:00:00Z"),
  endDate: new Date("2026-08-24T00:00:00Z"),
  startLabel: "Leg A base",
  startLatitude: 46,
  startLongitude: -104,
  endLabel: "Leg A base",
  endLatitude: 46,
  endLongitude: -104,
  vehicleName: null,
  mpg: null,
  fuelPricePerGallon: null,
  routeConfirmedAt: null,
  notes: null,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

const stop = {
  id: "stop-1",
  tripId: "trip-1",
  bookingId: "booking-1",
  bookingName: "Eastern Montana Fair",
  city: "Miles City",
  region: "MT",
  latitude: 46.4,
  longitude: -105.8,
  startsAt: new Date("2026-08-20T00:00:00Z"),
  status: "confirmed",
  sortOrder: 1,
};

describe("buildRoutePoints handoffs", () => {
  it("places receiving handoffs before booking stops and releasing handoffs after them", () => {
    const receive: TripHandoffPoint = {
      id: "h1",
      tripId: "trip-1",
      direction: "receive",
      label: "Glendive, MT",
      latitude: 47.1,
      longitude: -104.7,
      windowStartsAt: new Date("2026-08-18T12:00:00Z"),
      windowEndsAt: new Date("2026-08-18T14:00:00Z"),
      resourceName: "Paintball trailer",
    };
    const release: TripHandoffPoint = {
      ...receive,
      id: "h2",
      direction: "release",
      label: "Forsyth, MT",
      latitude: 46.3,
      longitude: -106.7,
      windowStartsAt: new Date("2026-08-22T12:00:00Z"),
      windowEndsAt: new Date("2026-08-22T14:00:00Z"),
    };

    const labels = buildRoutePoints(trip as any, [stop as any], [receive, release]).map((point) => point.label);
    expect(labels).toEqual([
      "Leg A base",
      "Equipment handoff: Paintball trailer — Glendive, MT",
      "Eastern Montana Fair (Miles City, MT)",
      "Equipment handoff: Paintball trailer — Forsyth, MT",
      "Leg A base",
    ]);
  });

  it("does not create a handoff waypoint when no approved handoff is supplied", () => {
    const labels = buildRoutePoints(trip as any, [stop as any]).map((point) => point.label);
    expect(labels.some((label) => label.startsWith("Equipment handoff:"))).toBe(false);
  });
});
