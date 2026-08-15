import { beforeEach, describe, expect, it } from "vitest";
import { FakeGeocodingProvider } from "@/features/trips/geocoding";
import type { MapEvent } from "./map-data";
import {
  clearRouteLocationCacheForTests,
  invalidateRouteLocationCache,
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
  locationQuality: "city",
  locationLabel: "Miles City, MT",
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
      mappingState: "mapped_coordinates",
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
      mappingState: "mapped_city",
    });
  });

  it("reports a full-address mapping distinctly", async () => {
    const geocoder = new FakeGeocodingProvider({
      "eastern montana fairgrounds, 42 garryowen rd, miles city, mt": [
        { latitude: 46.401, longitude: -105.821, displayName: "Eastern Montana Fairgrounds" },
      ],
    });
    const result = await resolveMapLocation({
      ...base,
      locationLabel: "Eastern Montana Fairgrounds, 42 Garryowen Rd, Miles City, MT",
      locationQuality: "address",
    }, geocoder);
    expect(result.mappingState).toBe("mapped_address");
    expect(result.quality).toBe("address");
  });

  it("returns an explicit no-results state", async () => {
    const geocoder = new FakeGeocodingProvider({});
    const result = await resolveMapLocation(base, geocoder);
    expect(result).toMatchObject({
      latitude: null,
      longitude: null,
      label: "Miles City, MT",
      mappingState: "needs_mapping_no_results",
    });
  });

  it("returns an explicit missing-location state", async () => {
    const geocoder = new FakeGeocodingProvider({});
    const result = await resolveMapLocation({
      ...base,
      city: "",
      region: "",
      locationLabel: null,
      locationQuality: "missing",
    }, geocoder);
    expect(result).toMatchObject({
      latitude: null,
      longitude: null,
      label: null,
      mappingState: "needs_mapping_missing_location",
    });
    expect(geocoder.calls).toBe(0);
  });

  it("does not cache provider outages permanently", async () => {
    const unavailable = new FakeGeocodingProvider({}, false);
    expect((await resolveMapLocation(base, unavailable)).mappingState)
      .toBe("needs_mapping_provider_unavailable");

    const available = new FakeGeocodingProvider({
      "miles city, mt": [
        { latitude: 46.4083, longitude: -105.8406, displayName: "Miles City" },
      ],
    });
    expect((await resolveMapLocation(base, available)).mappingState).toBe("mapped_city");
  });

  it("reuses a successful city lookup for multiple bookings", async () => {
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

  it("allows retry to bypass a cached no-results lookup", async () => {
    const unavailable = new FakeGeocodingProvider({});
    expect((await resolveMapLocation(base, unavailable)).mappingState)
      .toBe("needs_mapping_no_results");

    invalidateRouteLocationCache("Miles City, MT");
    const available = new FakeGeocodingProvider({
      "miles city, mt": [
        { latitude: 46.4083, longitude: -105.8406, displayName: "Miles City" },
      ],
    });
    expect((await resolveMapLocation(base, available)).mappingState).toBe("mapped_city");
  });

  it("performs a fresh lookup when location text changes", async () => {
    const geocoder = new FakeGeocodingProvider({
      "miles city, mt": [
        { latitude: 46.4, longitude: -105.8, displayName: "Miles City" },
      ],
      "billings, mt": [
        { latitude: 45.78, longitude: -108.5, displayName: "Billings" },
      ],
    });
    await resolveMapLocation(base, geocoder);
    await resolveMapLocation({
      ...base,
      city: "Billings",
      locationLabel: "Billings, MT",
    }, geocoder);
    expect(geocoder.calls).toBe(2);
  });
});
