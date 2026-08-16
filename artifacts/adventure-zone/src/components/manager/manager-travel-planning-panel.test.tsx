// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerTravelPlanningPanel } from "./manager-travel-planning-panel";

const mapData = {
  leg: { id: "leg-a", name: "Kristy", color: "#f97316" },
  route: {
    trip: { id: "trip-a", name: "Dakotas", startLabel: "Home", startLatitude: 46, startLongitude: -102, endLabel: "Home", endLatitude: 46, endLongitude: -102 },
    stops: [{ id: "00000000-0000-4000-8000-000000000011", bookingId: "booking-a", bookingName: "Fair", city: "Dickinson", region: "ND", latitude: 46.8, longitude: -102.8, sortOrder: 1, startsAt: null, endsAt: null }],
    segments: [],
  },
  events: [],
  meetups: [],
} as any;

afterEach(cleanup);

describe("ManagerTravelPlanningPanel", () => {
  it("saves a local fuel price and keeps it visible in history", async () => {
    const api = vi.fn(async (path: string, options?: RequestInit) => {
      if (path === "/manager/travel/fuel-prices" && options?.method === "POST") {
        const body = JSON.parse(String(options.body));
        expect(body.tripId).toBe("trip-a");
        expect(body.pricePerGallon).toBe(3.49);
        expect(body.locationLabel).toBe("Dickinson, ND");
        return { observation: { id: "fuel-1", ...body } };
      }
      if (path === "/manager/travel/fuel-prices") return { observations: [{ id: "fuel-1", pricePerGallon: 3.49, locationLabel: "Dickinson, ND", observedAt: new Date().toISOString(), note: null }] };
      if (path === "/manager/travel/suggestions") return { suggestions: [] };
      return {};
    });

    render(<ManagerTravelPlanningPanel managerApi={api as any} tripId="trip-a" mapData={mapData} />);
    fireEvent.change(screen.getByLabelText("Price per gallon"), { target: { value: "3.49" } });
    fireEvent.change(screen.getByLabelText("Fuel price location"), { target: { value: "Dickinson, ND" } });
    fireEvent.click(screen.getByRole("button", { name: "Save fuel price" }));

    expect(await screen.findByText("Fuel price saved.")).toBeInTheDocument();
    expect(screen.getByText(/Latest: \$3\.490 · Dickinson, ND/)).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith("/manager/travel/fuel-prices", expect.objectContaining({ method: "POST" }));
  });

  it("shows route suggestion tools in planning but not compact road mode", async () => {
    const api = vi.fn(async (path: string) => path.includes("suggestions") ? { suggestions: [] } : { observations: [] });
    const { rerender } = render(<ManagerTravelPlanningPanel managerApi={api as any} tripId="trip-a" mapData={mapData} />);
    expect(await screen.findByText("Suggest change")).toBeInTheDocument();
    expect(screen.getByText("Suggested route changes")).toBeInTheDocument();

    rerender(<ManagerTravelPlanningPanel managerApi={api as any} tripId="trip-a" mapData={mapData} compact />);
    await waitFor(() => expect(screen.queryByText("Suggest change")).not.toBeInTheDocument());
    expect(screen.getByText("Update local fuel price")).toBeInTheDocument();
  });
});
