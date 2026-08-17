import { describe, expect, it } from "vitest";
import { resolveManagerMapEventLocations } from "./manager-map-location";

const event = {
  bookingId: "booking-1",
  bookingName: "Booked event",
  city: "Miles City",
  region: "MT",
  latitude: null,
  longitude: null,
  startsAt: new Date("2026-08-23T12:00:00Z"),
  endsAt: new Date("2026-08-23T20:00:00Z"),
  status: "confirmed",
};

describe("resolveManagerMapEventLocations", () => {
  it("geocodes a booked event from city and state when coordinates are missing", async () => {
    const result = await resolveManagerMapEventLocations([event], {
      async geocode(query: string) {
        expect(query).toBe("Miles City, MT");
        return [{ latitude: 46.4083, longitude: -105.8406, displayName: "Miles City, MT" }];
      },
    });

    expect(result).toEqual([
      expect.objectContaining({
        bookingId: "booking-1",
        latitude: 46.4083,
        longitude: -105.8406,
      }),
    ]);
  });

  it("keeps the event visible when geocoding cannot resolve it", async () => {
    const result = await resolveManagerMapEventLocations([event], {
      async geocode() { return []; },
    });

    expect(result).toEqual([event]);
  });
});
