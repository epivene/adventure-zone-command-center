// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MapEvent } from "@/features/routes/map-data";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  layers: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => ({
  apiPost: mocks.post,
}));
vi.mock("./manager-route-map-shell", () => ({
  ManagerRouteMapShell: ({ children }: any) => <div data-testid="route-map-shell">{children}</div>,
}));
vi.mock("./manager-route-map-layers", () => ({
  ManagerRouteMapLayers: (props: any) => { mocks.layers(props); return <div data-testid="route-map-layers" />; },
  ManagerTripNavigationActions: () => null,
}));

import { EventMap } from "./event-map";

const leg: TravelLeg = {
  id: "leg-kristy",
  name: "Kristy",
  color: "#f97316",
  sortOrder: 1,
  archivedAt: null,
  baseAddress: null,
  defaultVehicleName: null,
  defaultMpg: null,
};

const hulkLeg: TravelLeg = {
  ...leg,
  id: "leg-hulk",
  name: "Hulk",
  color: "#22c55e",
  sortOrder: 2,
};

const unresolved: MapEvent = {
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
  locationQuality: "missing",
  locationLabel: "Miles City, MT",
  mappingState: "needs_mapping_provider_unavailable",
  seasonYear: 2026,
};

const confirmedMapped: MapEvent = {
  ...unresolved,
  id: "confirmed-mapped",
  name: "Confirmed Stop",
  latitude: 46.4,
  longitude: -105.8,
  mappingState: "mapped_coordinates",
  locationQuality: "coordinates",
};

const secondConfirmedMapped: MapEvent = {
  ...confirmedMapped,
  id: "confirmed-mapped-2",
  name: "Second Confirmed Stop",
  latitude: 45.0,
  longitude: -106.0,
  startsAt: new Date("2026-08-25T12:00:00Z"),
  endsAt: new Date("2026-08-25T20:00:00Z"),
};

const undatedConfirmedMapped: MapEvent = {
  ...confirmedMapped,
  id: "confirmed-undated",
  name: "Undated Confirmed Stop",
  latitude: 44.5,
  longitude: -107,
  startsAt: null,
  endsAt: null,
};

const potentialMapped: MapEvent = {
  ...confirmedMapped,
  id: "potential-mapped",
  name: "Potential Stop",
  latitude: 44.0,
  longitude: -104.0,
  status: "contacted",
  routeBucket: "potential",
  startsAt: new Date("2026-08-22T12:00:00Z"),
  endsAt: new Date("2026-08-22T20:00:00Z"),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EventMap unresolved locations", () => {
  it("shows Miles City with a clear mapping failure and retry action", () => {
    render(<EventMap events={[unresolved]} travelLegs={[leg]} />);

    expect(screen.getByText("Location needs mapping")).toBeInTheDocument();
    expect(screen.getByText("Eastern Montana Fair")).toBeInTheDocument();
    expect(screen.getAllByText(/Miles City, MT/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Miles City, MT · Kristy/)).toBeInTheDocument();
    expect(screen.getByText(/Map lookup is temporarily unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry location" })).toBeInTheDocument();
  });

  it("moves a booking out of the unresolved state after a successful retry", async () => {
    mocks.post.mockResolvedValue({
      event: {
        ...unresolved,
        latitude: 46.4083,
        longitude: -105.8406,
        locationQuality: "city",
        mappingState: "mapped_city",
        startsAt: "2026-08-18T12:00:00.000Z",
        endsAt: "2026-08-21T12:00:00.000Z",
      },
    });

    render(<EventMap events={[unresolved]} travelLegs={[leg]} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry location" }));

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
      "/routes/events/booking-1/retry-location",
      {},
    ));
    await waitFor(() => {
      expect(screen.queryByText(/Map lookup is temporarily unavailable/)).not.toBeInTheDocument();
      expect(screen.getByText("1 primary event · 1 mapped · 0 needing map location · 0 equipment meetup markers")).toBeInTheDocument();
    });
  });

  it("uses the same dated-first order for stop numbers and route lines", () => {
    render(<EventMap events={[secondConfirmedMapped, undatedConfirmedMapped, confirmedMapped]} travelLegs={[leg]} />);

    const lastLayerProps = mocks.layers.mock.calls.at(-1)?.[0];
    expect(lastLayerProps.events.map((event: MapEvent & { routeStopNumber: number | null }) => [event.id, event.routeStopNumber])).toEqual([
      ["confirmed-mapped-2", 2],
      ["confirmed-undated", 3],
      ["confirmed-mapped", 1],
    ]);
    expect(lastLayerProps.routeLines.map((line: { coordinates: [number, number][] }) => line.coordinates)).toEqual([
      [[-105.8, 46.4], [-106, 45]],
      [[-106, 45], [-107, 44.5]],
    ]);
  });

  it("shows potential events by default while drawing the operating route only through confirmed stops", () => {
    render(<EventMap events={[confirmedMapped, potentialMapped, secondConfirmedMapped]} travelLegs={[leg, hulkLeg]} />);

    expect(screen.getByRole("button", { name: "Full" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Potential Stop")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Hulk" })).toBeInTheDocument();

    const lastLayerProps = mocks.layers.mock.calls.at(-1)?.[0];
    expect(lastLayerProps.events.map((event: MapEvent) => event.id)).toEqual(expect.arrayContaining([
      "confirmed-mapped",
      "potential-mapped",
      "confirmed-mapped-2",
    ]));
    expect(lastLayerProps.events.find((event: MapEvent & { routeStopNumber: number | null }) => event.id === "confirmed-mapped")?.routeStopNumber).toBe(1);
    expect(lastLayerProps.events.find((event: MapEvent & { routeStopNumber: number | null }) => event.id === "confirmed-mapped-2")?.routeStopNumber).toBe(2);
    expect(lastLayerProps.events.find((event: MapEvent & { routeStopNumber: number | null }) => event.id === "potential-mapped")?.routeStopNumber).toBeNull();
    expect(lastLayerProps.routeLines).toHaveLength(1);
    expect(lastLayerProps.routeLines[0].coordinates).toEqual([
      [-105.8, 46.4],
      [-106.0, 45.0],
    ]);
  });

  it("opens the linked Boss event profile from the read-only route list", () => {
    const linkedEvent = { ...confirmedMapped, organizationId: "profile-1" } as MapEvent;
    const props = {
      events: [linkedEvent],
      travelLegs: [leg],
      readOnly: true,
      profileBasePath: "/boss/profiles",
    } as Parameters<typeof EventMap>[0];

    render(<EventMap {...props} />);

    expect(screen.getByRole("link", { name: "Confirmed Stop" })).toHaveAttribute(
      "href",
      "/boss/profiles/profile-1",
    );
  });

});
