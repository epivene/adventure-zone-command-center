import { describe, expect, it } from "vitest";
import { loadManagerScopedMapData } from "./manager-map-data";

const legId = "00000000-0000-4000-8000-000000000010";

const booking = {
  bookingId: "00000000-0000-4000-8000-000000000202",
  bookingName: "Booked event without trip",
  city: "Miles City",
  region: "MT",
  latitude: null,
  longitude: null,
  startsAt: new Date("2026-08-23T12:00:00Z"),
  endsAt: new Date("2026-08-23T20:00:00Z"),
  status: "confirmed",
  legName: "Kristy",
  legColor: "#f97316",
};

describe("manager map booking geocoding", () => {
  it("maps a leg-assigned booked event from city/state even without a Trip", async () => {
    const result = await loadManagerScopedMapData({
      tripRepository: {
        async listTrips() { return []; },
        async listStops() { return []; },
        async listSegments() { return []; },
      },
      bookingRepository: {
        async listForLeg() { return [booking]; },
      },
      handoffRepository: {
        async listForLeg() { return []; },
      },
      geocoder: {
        async geocode(query: string) {
          expect(query).toBe("Miles City, MT");
          return [{ latitude: 46.4083, longitude: -105.8406, displayName: "Miles City, MT" }];
        },
      },
    } as any, legId, new Date("2026-08-19T00:00:00Z"));

    expect(result.route).toBeNull();
    expect(result.events).toEqual([
      expect.objectContaining({
        bookingId: booking.bookingId,
        latitude: 46.4083,
        longitude: -105.8406,
      }),
    ]);
  });
});
