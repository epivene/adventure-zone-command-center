import { beforeEach, describe, expect, it } from "vitest";
import { FakeGeocodingProvider } from "@/features/trips/geocoding";
import type { MapEvent } from "./map-data";
import {
  clearRouteLocationCacheForTests,
  resolveMapLocation,
  resolveRouteMapEvents,
} from "./location-resolver";

const base: MapEvent = {
  id: "booking-1",
  name: "Eastern Montana Fair",
  city: "Miles City",
  region: "MT",
  latitude: null,
  longitude: null,
  status: "confirmed",
  probability: "possible",
  travelLegId: "leg-1",
  travelLegName: "Kristy",
  travelLegColor: "#f97316",
  startsAt: new Date("2026-08-18T12:00:00Z"),
  endsAt: new Date("2026-08-21T12:00:00Z"),
};

beforeEach(() => clearRouteLocationCacheForTests());

describe("resolveMapLocation", () => {
  it("uses saved coordinates without calling the geocoder", async () => {
    const geocoder = new FakeGeocodingProvider();
    const result = await resolveMapLocation(
      { ...base, latitude: 46.4083, longitude: -105.8406 },
      geocoder,
    );
    expect(result).toMatchObject({
      latitude: 46.4083,
      longitude: -105.8406,
      quality: "coordinates",
    });
    expect(geocoder.calls).toBe(0);
  });

  it("falls back to city and state when coordinates are missing", async () => {
    const geocoder = new FakeGeocodingProvider({
      "miles city, mt": [
        {
          latitude: 46.4083,
          longitude: -105.8406,
          displayName: "Miles City, Custer County, Montana",
        },
      ],
    });
    const result = await resolveMapLocation(base, geocoder);
    expect(result).toEqual({
      latitude: 46.4083,
      longitude: -105.8406,
      label: "Miles City, MT",
      quality: "city",
    });
  });

  it("reuses a city lookup for multiple bookings", async () => {
    const geocoder = new FakeGeocodingProvider({
      "miles city, mt": [
        { latitude: 46.4083, longitude: -105.8406, displayName: "Miles City" },
      ],
    });
    const events = await resolveRouteMapEvents(
      [base, { ...base, id: "booking-2" }],
      geocoder,
    );
    expect(events.every((event) => event.latitude === 46.4083)).toBe(true);
    expect(geocoder.calls).toBe(1);
  });
});
