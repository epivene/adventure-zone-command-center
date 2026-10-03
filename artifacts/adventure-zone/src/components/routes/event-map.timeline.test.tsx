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


it("shows a shared timeline with unassigned and unmapped stops while a leg is focused", () => {
  render(<EventMap events={[confirmedMapped, potentialMapped, {...unresolved,id:"free",name:"Unassigned opportunity",travelLegId:null}]} travelLegs={[leg,hulkLeg]} requestedSeasonYear={2026} showTimeline />);
  expect(screen.getByRole("heading",{name:"Leg timeline"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button",{name:/Kristy route/}));
  expect(screen.getByRole("button",{name:/Inspect Unassigned opportunity/})).toBeInTheDocument();
  expect(screen.getByRole("heading",{name:"Needs a leg"})).toBeInTheDocument();
});
it("selects a timeline stop and shows the surrounding stops without changing assignments", () => {
  render(<EventMap events={[confirmedMapped,potentialMapped,secondConfirmedMapped]} travelLegs={[leg]} requestedSeasonYear={2026} showTimeline />);
  fireEvent.click(screen.getByRole("button",{name:/Inspect Potential Stop/}));
  expect(screen.getByRole("region",{name:"Selected stop"})).toHaveTextContent("Before: Confirmed Stop");
  expect(screen.getByRole("region",{name:"Selected stop"})).toHaveTextContent("After: Second Confirmed Stop");
  expect(mocks.layers.mock.calls.at(-1)?.[0].focusedEventId).toBe("potential-mapped");
  expect(mocks.post).not.toHaveBeenCalled();
});
it("keeps incomplete and corrupt dates visible for review without drawing them across the season", () => {
  render(<EventMap events={[{...confirmedMapped,endsAt:new Date("9999-12-31T00:00:00Z")},undatedConfirmedMapped]} travelLegs={[leg]} requestedSeasonYear={2026} showTimeline />);
  expect(screen.getByRole("region",{name:"Dates need review"})).toHaveTextContent("Confirmed Stop");
  expect(screen.getByRole("region",{name:"Dates need review"})).toHaveTextContent("Undated Confirmed Stop");
});
