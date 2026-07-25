import { describe, expect, it } from "vitest";

import {
  getMapEvents,
  toMapDataset,
  type MapEvent,
} from "@/features/routes/map-query";
import type { TravelLegRepository } from "@/features/routes/travel-leg-repository";

const events: MapEvent[] = [
  {
    id: "pending-leg-2",
    name: "Pending Contract",
    city: "Fargo",
    region: "ND",
    latitude: 46.8772,
    longitude: -96.7898,
    status: "pending_contract",
    probability: "likely",
    travelLegId: "leg-2",
    travelLegName: "Leg 2",
    travelLegColor: "#2F73D9",
    startsAt: new Date("2026-08-10T15:00:00.000Z"),
    endsAt: new Date("2026-08-12T22:00:00.000Z"),
  },
  {
    id: "declined-leg-2",
    name: "Declined",
    city: "Austin",
    region: "TX",
    latitude: 30.2672,
    longitude: -97.7431,
    status: "declined",
    probability: "unlikely",
    travelLegId: "leg-2",
    travelLegName: "Leg 2",
    travelLegColor: "#2F73D9",
    startsAt: new Date("2026-08-20T15:00:00.000Z"),
    endsAt: new Date("2026-08-21T22:00:00.000Z"),
  },
  {
    id: "unmapped-confirmed",
    name: "Confirmed without coordinates",
    city: "Bismarck",
    region: "ND",
    latitude: null,
    longitude: null,
    status: "confirmed",
    probability: "likely",
    travelLegId: "leg-1",
    travelLegName: "Leg 1",
    travelLegColor: "#DC3B3B",
    startsAt: new Date("2026-09-02T15:00:00.000Z"),
    endsAt: null,
  },
];

const repository: TravelLegRepository = {
  listMapEvents: async () => events,
  listTravelLegs: async () => [],
};

describe("getMapEvents", () => {
  it("can show only pending-contract events on Leg 2", async () => {
    const result = await getMapEvents(
      {
        statuses: ["pending_contract"],
        travelLegIds: ["leg-2"],
        dateFrom: null,
        dateTo: null,
        regions: [],
      },
      repository,
    );

    expect(result.map((event) => event.id)).toEqual(["pending-leg-2"]);
  });

  it("applies inclusive date and state filters to dated events", async () => {
    const result = await getMapEvents(
      {
        statuses: [],
        travelLegIds: [],
        dateFrom: "2026-08-10",
        dateTo: "2026-08-10",
        regions: ["ND"],
      },
      repository,
    );

    expect(result.map((event) => event.id)).toEqual(["pending-leg-2"]);
  });
});

describe("toMapDataset", () => {
  it("keeps missing-coordinate events visible outside GeoJSON", () => {
    const result = toMapDataset(events);

    expect(result.geoJson.features.map((feature) => feature.id)).toEqual([
      "pending-leg-2",
      "declined-leg-2",
    ]);
    expect(result.unmappedEvents.map((event) => event.id)).toEqual([
      "unmapped-confirmed",
    ]);
  });

  it("limits GeoJSON properties to the private-map display contract", () => {
    const result = toMapDataset([events[0]!]);

    expect(result.geoJson.features[0]).toEqual({
      type: "Feature",
      id: "pending-leg-2",
      geometry: {
        type: "Point",
        coordinates: [-96.7898, 46.8772],
      },
      properties: {
        id: "pending-leg-2",
        name: "Pending Contract",
        status: "pending_contract",
        probability: "likely",
        travelLegId: "leg-2",
        travelLegColor: "#2F73D9",
        startsAt: "2026-08-10T15:00:00.000Z",
        endsAt: "2026-08-12T22:00:00.000Z",
      },
    });
  });
});
