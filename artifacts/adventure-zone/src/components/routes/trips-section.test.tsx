// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/lib/auth-token", () => ({ apiGet: get }));
vi.mock("@/actions/trips", () => ({ createTripAction: vi.fn() }));

import { TripsSection } from "./trips-section";

const leg = {
  id: "leg-kristy",
  name: "Kristy",
  color: "#ef4444",
  sortOrder: 1,
  archivedAt: null,
  baseAddress: null,
  defaultVehicleName: null,
  defaultMpg: null,
};

describe("TripsSection map focus", () => {
  it("exposes Focus route separately from the trip detail link", async () => {
    get.mockResolvedValue({ trips: [{
      id: "trip-1",
      name: "August run",
      travelLegId: "leg-kristy",
      legName: "Kristy",
      legColor: "#ef4444",
      startDate: "2026-08-18T12:00:00.000Z",
      endDate: "2026-08-21T12:00:00.000Z",
      stopCount: 2,
      vehicleName: null,
      routeConfirmedAt: null,
    }] });
    const onFocusTrip = vi.fn();
    const { hook } = memoryLocation({ path: "/routes", static: true });
    render(<Router hook={hook}><TripsSection travelLegs={[leg]} onFocusTrip={onFocusTrip} /></Router>);

    expect(await screen.findByRole("link", { name: "August run" })).toHaveAttribute("href", "/trips/trip-1");
    fireEvent.click(screen.getByRole("button", { name: "Focus route" }));
    await waitFor(() => expect(onFocusTrip).toHaveBeenCalledWith("trip-1"));
  });
});
