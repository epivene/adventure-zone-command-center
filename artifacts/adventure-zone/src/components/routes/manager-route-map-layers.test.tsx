// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EquipmentHandoffView } from "./equipment-handoffs";
import type { MapEvent } from "@/features/routes/map-data";

const mocks = vi.hoisted(() => {
  const group = { remove: vi.fn() };
  const markerObject = {
    addTo: vi.fn(),
    bindPopup: vi.fn(),
    on: vi.fn(),
  };
  markerObject.addTo.mockReturnValue(markerObject);
  markerObject.bindPopup.mockReturnValue(markerObject);
  markerObject.on.mockReturnValue(markerObject);
  const polylineObject = { addTo: vi.fn() };
  polylineObject.addTo.mockReturnValue(polylineObject);
  return {
    map: {},
    group,
    markerObject,
    polylineObject,
    divIcon: vi.fn((options) => options),
    marker: vi.fn(() => markerObject),
    polyline: vi.fn(() => polylineObject),
    layerGroup: vi.fn(() => ({ ...group, addTo: vi.fn(() => group) })),
  };
});

vi.mock("leaflet", () => ({
  default: {
    divIcon: mocks.divIcon,
    marker: mocks.marker,
    polyline: mocks.polyline,
    layerGroup: mocks.layerGroup,
  },
}));

vi.mock("./manager-route-map-shell", () => ({
  useManagerRouteMap: () => mocks.map,
}));

import { ManagerRouteMapLayers } from "./manager-route-map-layers";

const event: MapEvent & { planningEmphasis: "primary" | "dimmed" } = {
  id: "miles",
  name: "Eastern Montana Fair",
  city: "Miles City",
  region: "MT",
  latitude: 46.4083,
  longitude: -105.8406,
  status: "confirmed",
  probability: "possible",
  travelLegId: "leg-kristy",
  travelLegName: "Kristy",
  travelLegColor: "#ef4444",
  startsAt: new Date("2026-08-18T12:00:00Z"),
  endsAt: new Date("2026-08-21T12:00:00Z"),
  routeBucket: "confirmed",
  locationQuality: "city",
  locationLabel: "Miles City, MT",
  mappingState: "mapped_city",
  seasonYear: 2026,
  planningEmphasis: "primary",
};

const handoff: EquipmentHandoffView = {
  id: "handoff-1",
  status: "suggested",
  fromLegId: "leg-kristy",
  toLegId: "leg-hulk",
  fromTripId: null,
  toTripId: null,
  resourceId: "resource-1",
  resourceCode: null,
  resourceName: "Paintball",
  meetupLabel: "Billings meetup",
  meetupLatitude: 45.7833,
  meetupLongitude: -108.5007,
  windowStartsAt: "2026-08-20T12:00:00Z",
  windowEndsAt: "2026-08-20T14:00:00Z",
  directMiles: 10,
  directMinutes: 15,
  combinedDetourMiles: 3,
  availableBufferMinutes: 60,
  opportunityBand: "strong",
  explanation: "Good overlap",
  approvedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.markerObject.addTo.mockReturnValue(mocks.markerObject);
  mocks.markerObject.bindPopup.mockReturnValue(mocks.markerObject);
  mocks.markerObject.on.mockReturnValue(mocks.markerObject);
  mocks.polylineObject.addTo.mockReturnValue(mocks.polylineObject);
});

describe("ManagerRouteMapLayers", () => {
  it("renders an obvious leg-colored Miles City event pin and a distinct handoff marker", () => {
    render(
      <ManagerRouteMapLayers
        events={[event]}
        handoffs={[handoff]}
        focusedEventId="miles"
        managerMode="planning"
      />,
    );

    expect(mocks.marker).toHaveBeenCalledWith(
      [46.4083, -105.8406],
      expect.objectContaining({ title: "Eastern Montana Fair" }),
    );
    const eventIconCall = mocks.divIcon.mock.calls.find(([options]) => String(options.html).includes("az-route-pin"));
    expect(eventIconCall?.[0].html).toContain("#ef4444");
    expect(eventIconCall?.[0].html).toContain("az-route-pin--focused");
    const handoffIconCall = mocks.divIcon.mock.calls.find(([options]) => String(options.html).includes("az-handoff-marker"));
    expect(handoffIconCall?.[0].html).toContain("az-handoff-marker--suggested");

    const popup = mocks.markerObject.bindPopup.mock.calls.map(([html]) => String(html)).find((html) => html.includes("Eastern Montana Fair"));
    expect(popup).toContain("Directions to event");
    expect(popup).toContain("google.com/maps/dir/");
    expect(popup).not.toContain("key=");
  });

  it("draws focused trip points in their existing order", () => {
    render(
      <ManagerRouteMapLayers
        events={[]}
        handoffs={[]}
        focusedEventId={null}
        managerMode="on-road"
        focusedTrip={{
          id: "trip-1",
          name: "Kristy trip",
          points: [
            { id: "start", label: "Start", latitude: 40.7608, longitude: -111.891 },
            { id: "stop-1", label: "Miles City", latitude: 46.4083, longitude: -105.8406 },
            { id: "end", label: "End", latitude: 45.7833, longitude: -108.5007 },
          ],
        }}
      />,
    );

    expect(mocks.polyline).toHaveBeenCalledWith(
      [[40.7608, -111.891], [46.4083, -105.8406], [45.7833, -108.5007]],
      expect.objectContaining({ weight: 5 }),
    );
  });
});
