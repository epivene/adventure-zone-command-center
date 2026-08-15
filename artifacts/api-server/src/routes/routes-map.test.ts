import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const milesCityEvent = {
  id: "booking-1",
  name: "Eastern Montana Fair",
  city: "Miles City",
  region: "MT",
  latitude: null,
  longitude: null,
  status: "confirmed",
  probability: "possible",
  travelLegId: "leg-kristy",
  travelLegName: "Kristy",
  travelLegColor: "#f97316",
  startsAt: new Date("2026-08-18T12:00:00Z"),
  endsAt: new Date("2026-08-21T12:00:00Z"),
  routeBucket: "confirmed",
  locationQuality: "city",
  locationLabel: "Miles City, MT",
  seasonYear: 2026,
};

const mocks = vi.hoisted(() => ({
  listTravelLegs: vi.fn(),
  listMapEvents: vi.fn(),
  listLegResources: vi.fn(),
  resolveRouteMapEvents: vi.fn(),
  invalidateRouteLocationCache: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: {} }));

vi.mock("@/features/routes/travel-leg-repository", () => ({
  DrizzleTravelLegRepository: class {
    listTravelLegs = mocks.listTravelLegs;
    listMapEvents = mocks.listMapEvents;
    listLegResources = mocks.listLegResources;
  },
}));

vi.mock("@/features/routes/location-resolver", () => ({
  resolveRouteMapEvents: mocks.resolveRouteMapEvents,
  invalidateRouteLocationCache: mocks.invalidateRouteLocationCache,
}));

vi.mock("@/features/trips/geocoding", () => ({
  NominatimGeocodingProvider: class {},
}));

import router from "./routes-map";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(router);
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTravelLegs.mockResolvedValue([]);
  mocks.listMapEvents.mockResolvedValue([milesCityEvent]);
  mocks.listLegResources.mockResolvedValue([]);
});

describe("route map location retry", () => {
  it("retries one booking location after invalidating its cached lookup", async () => {
    mocks.resolveRouteMapEvents.mockResolvedValue([{
      ...milesCityEvent,
      latitude: 46.4083,
      longitude: -105.8406,
      mappingState: "mapped_city",
    }]);

    const response = await request(app())
      .post("/routes/events/booking-1/retry-location")
      .send({});

    expect(response.status).toBe(200);
    expect(mocks.invalidateRouteLocationCache).toHaveBeenCalledWith("Miles City, MT");
    expect(response.body.event).toMatchObject({
      id: "booking-1",
      latitude: 46.4083,
      longitude: -105.8406,
      mappingState: "mapped_city",
    });
  });

  it("keeps unresolved bookings in a successful routes response", async () => {
    mocks.resolveRouteMapEvents.mockResolvedValue([{
      ...milesCityEvent,
      mappingState: "needs_mapping_provider_unavailable",
    }]);

    const response = await request(app()).get("/routes");

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({
      id: "booking-1",
      mappingState: "needs_mapping_provider_unavailable",
      latitude: null,
      longitude: null,
    });
  });
});
