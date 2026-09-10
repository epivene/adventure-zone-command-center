// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
const apiPut = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-token", () => ({ apiGet, apiPut }));
vi.mock("@/components/calendar/event-calendar", () => ({
  EventCalendar: ({ events }: { events: Array<{ id: string; name: string; status: string }> }) => (
    <div data-testid="event-calendar">
      {events.map((event) => (
        <span key={event.id}>{event.name}:{event.status}</span>
      ))}
    </div>
  ),
}));
vi.mock("@/components/calendar/history-suggestions", () => ({ HistorySuggestions: () => null }));
vi.mock("@/components/routes/route-conflict-warning", () => ({
  RouteConflictWarning: ({ conflicts }: { conflicts: unknown[] }) => (
    <div data-testid="route-conflict-count">{conflicts.length}</div>
  ),
}));

import { CalendarContent } from "./CalendarPage";

function booking(overrides: Record<string, unknown>) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Booking",
    city: "Meeteetse",
    region: "WY",
    latitude: null,
    longitude: null,
    status: "possible",
    probability: "possible",
    travelLegId: "20000000-0000-4000-8000-000000000001",
    travelLegName: "Kristy",
    travelLegColor: "#f97316",
    startsAt: "2026-09-05T00:00:00.000Z",
    endsAt: "2026-09-07T00:00:00.000Z",
    source: "booking",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  apiGet.mockReset();
  apiPut.mockReset();
});

describe("Schedule booked-state filtering", () => {
  it("keeps hidden potential overlaps out of warnings until potential shows are selected", async () => {
    apiGet.mockImplementation((path: string) => {
      if (path === "/calendar/display-settings") {
        return Promise.resolve({ eventColor: "#ec4899", travelColor: "#94a3b8" });
      }
      if (path.startsWith("/calendar?")) {
        return Promise.resolve([
          booking({
            id: "10000000-0000-4000-8000-000000000001",
            name: "Meeteetse Annual Labor Day Celebration 2026",
            status: "contract_received",
            probability: "definite",
          }),
          booking({
            id: "10000000-0000-4000-8000-000000000002",
            name: "Ordinary Possible Event",
            status: "possible",
            probability: "possible",
          }),
        ]);
      }
      if (path === "/google-workspace/operational-calendar") {
        return Promise.resolve({ reviewEvents: [] });
      }
      return Promise.reject(new Error(`Unexpected API path: ${path}`));
    });

    render(<CalendarContent season="2026" />);

    await waitFor(() => {
      expect(screen.getByTestId("event-calendar")).toBeInTheDocument();
    });

    expect(screen.getByText("Meeteetse Annual Labor Day Celebration 2026:confirmed")).toBeInTheDocument();
    expect(screen.queryByText(/Ordinary Possible Event/)).not.toBeInTheDocument();
    const showPotential = screen.getByRole("button", { name: "Show potential (1)" });
    expect(screen.getByTestId("route-conflict-count")).toHaveTextContent("0");

    fireEvent.click(showPotential);

    expect(screen.getByTestId("route-conflict-count")).toHaveTextContent("1");
  });
});
