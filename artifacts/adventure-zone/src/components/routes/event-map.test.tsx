// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MapEvent } from "@/features/routes/map-data";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => ({
  apiPost: mocks.post,
}));
vi.mock("./manager-route-map-shell", () => ({
  ManagerRouteMapShell: ({ children }: any) => <div data-testid="route-map-shell">{children}</div>,
}));
vi.mock("./manager-route-map-layers", () => ({
  ManagerRouteMapLayers: () => <div data-testid="route-map-layers" />,
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
});
