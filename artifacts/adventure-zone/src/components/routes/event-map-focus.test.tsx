// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MapEvent } from "@/features/routes/map-data";
import type { TravelLeg } from "@/features/routes/travel-leg-repository";

vi.mock("@/lib/auth-token", () => ({ apiPost: vi.fn() }));
vi.mock("./manager-route-map-shell", () => ({
  ManagerRouteMapShell: ({ children }: any) => <div data-testid="route-map-shell">{children}</div>,
}));
vi.mock("./manager-route-map-layers", () => ({
  ManagerRouteMapLayers: () => <div data-testid="route-map-layers" />,
  ManagerTripNavigationActions: () => null,
}));

import { EventMap } from "./event-map";

const legs: TravelLeg[] = [
  { id: "leg-kristy", name: "Kristy", color: "#ef4444", sortOrder: 1, archivedAt: null, baseAddress: null, defaultVehicleName: null, defaultMpg: null },
  { id: "leg-hulk", name: "Hulk", color: "#2563eb", sortOrder: 2, archivedAt: null, baseAddress: null, defaultVehicleName: null, defaultMpg: null },
];

function event(overrides: Partial<MapEvent>): MapEvent {
  return {
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
    ...overrides,
  };
}

const events = [
  event({}),
  event({ id: "billings", name: "Billings Possible", city: "Billings", longitude: -108.5007, latitude: 45.7833, status: "possible", routeBucket: "potential", travelLegId: "leg-hulk", travelLegName: "Hulk", travelLegColor: "#2563eb" }),
  event({ id: "wyoming", name: "Wyoming Event", city: "Sheridan", region: "WY", longitude: -106.9562, latitude: 44.7972 }),
];

afterEach(cleanup);

describe("EventMap planning interactions", () => {
  it("shows the full scope by default and refines it as filters change", () => {
    render(<EventMap events={events} travelLegs={legs} />);
    expect(screen.getByText("Showing 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByLabelText("State"), { target: { value: "MT" } });
    expect(screen.getByText("Showing 2026 · MT")).toBeInTheDocument();
    expect(screen.queryByText("Wyoming Event")).not.toBeInTheDocument();
  });

  it("keeps other legs visible but makes a selected leg the primary scope", () => {
    render(<EventMap events={events} travelLegs={legs} />);
    fireEvent.change(screen.getByLabelText("Leg focus"), { target: { value: "leg-kristy" } });
    expect(screen.getByText("Showing Kristy · 2026")).toBeInTheDocument();
    expect(screen.getByText("Billings Possible").closest("li")).toHaveAttribute("data-emphasis", "dimmed");
    expect(screen.getByText("Eastern Montana Fair").closest("li")).toHaveAttribute("data-emphasis", "primary");
  });

  it("offers one-tap, color-coded leg route controls above the map", () => {
    render(<EventMap events={events} travelLegs={legs} />);

    expect(screen.getByRole("button", { name: "All routes" })).toHaveAttribute("aria-pressed", "true");
    const kristy = screen.getByRole("button", { name: "Kristy route" });
    const hulk = screen.getByRole("button", { name: "Hulk route" });
    expect(kristy).toHaveStyle({ borderColor: "#ef4444" });
    expect(hulk).toHaveStyle({ borderColor: "#2563eb" });

    fireEvent.click(kristy);
    expect(kristy).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Showing Kristy · 2026")).toBeInTheDocument();
    expect(screen.getByText("Billings Possible").closest("li")).toHaveAttribute("data-emphasis", "dimmed");
  });

  it("supports explicit event focus without changing the active filters", () => {
    render(<EventMap events={events} travelLegs={legs} />);
    const buttons = screen.getAllByRole("button", { name: "Focus on map" });
    fireEvent.click(buttons[0]!);
    expect(screen.getByRole("button", { name: "Clear event focus" })).toBeInTheDocument();
    expect(screen.getByText("Showing 2026")).toBeInTheDocument();
  });

  it("shows a clear zero-result state instead of implying the map is still meaningful", () => {
    render(<EventMap events={events} travelLegs={legs} />);
    fireEvent.change(screen.getByLabelText("After"), { target: { value: "2027-01-01" } });
    expect(screen.getByText("No matching route events")).toBeInTheDocument();
  });

  it("reset map scope restores full/all-leg scope", () => {
    render(<EventMap events={events} travelLegs={legs} />);
    fireEvent.click(screen.getByRole("button", { name: "Potential" }));
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "MT" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(screen.getByText("Showing 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Full" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("State")).toHaveValue("");
  });
});
