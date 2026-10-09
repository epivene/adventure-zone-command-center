// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerOperationsPage from "./ManagerOperationsPage";

const mocks = vi.hoisted(() => ({
  events: [] as Array<{ bookingId: string; bookingName: string }>,
  api: vi.fn(async (path: string) => {
    if (path === "/manager/dashboard") return { trips: [], route: null };
    return {};
  }),
}));

vi.mock("@/lib/manager-auth-context", () => ({
  useOptionalManagerAuth: () => ({ manager: { legId: "leg-a" }, managerApi: mocks.api }),
  useManagerAuth: () => ({ manager: { legId: "leg-a" }, managerApi: mocks.api }),
}));
vi.mock("@/lib/manager-sync-queue", () => ({
  queueManagerMutation: vi.fn(async () => {}), flushManagerMutationQueue: vi.fn(async () => {}),
}));
vi.mock("@/features/manager/use-manager-scoped-map", () => ({ useManagerScopedMap: () => ({ loading: false, error: null, reload: vi.fn(), data: { leg: { id: "leg-a", name: "Kristy", color: "#f97316" }, route: null, events: mocks.events, meetups: [] } }) }));
vi.mock("@/components/manager/manager-crew-travel-card", () => ({
  ManagerCrewTravelCard: ({ bookingId }: { bookingId: string }) => <div aria-label="Saved crew travel">{bookingId}</div>,
}));
vi.mock("@/components/bookings/leg-operations-panel", () => ({ BookingLegOperationsCard: () => null }));
vi.mock("@/components/manager/manager-scoped-map", () => ({
  ManagerScopedMap: ({ variant, mode }: any) => <div aria-label="Manager operations map" data-mode={mode}><span>{variant}</span></div>,
}));
vi.mock("@/components/manager/manager-travel-planning-panel", () => ({
  ManagerTravelPlanningPanel: ({ compact }: { compact?: boolean }) => <div aria-label="Travel planning panel">{compact ? "quick road updates" : "Update local fuel price · Suggest change · Road tools"}</div>,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); mocks.events = []; window.history.replaceState({}, "", "/manager/operations"); });

describe("ManagerOperationsPage", () => {
  it("shows crew travel only for the selected assigned event and clears it when deselected", async () => {
    mocks.events = [{ bookingId: "assigned-a", bookingName: "Assigned fair" }, { bookingId: "assigned-b", bookingName: "Second fair" }];
    window.history.replaceState({}, "", "/manager/operations?bookingId=unassigned");
    render(<ManagerOperationsPage />);
    expect(screen.queryByLabelText("Saved crew travel")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Assigned event" }), { target: { value: "assigned-a" } });
    expect(screen.getByLabelText("Saved crew travel")).toHaveTextContent("assigned-a");
    fireEvent.change(screen.getByRole("combobox", { name: "Assigned event" }), { target: { value: "assigned-b" } });
    expect(screen.getByLabelText("Saved crew travel")).toHaveTextContent("assigned-b");
    fireEvent.change(screen.getByRole("combobox", { name: "Assigned event" }), { target: { value: "" } });
    expect(screen.queryByLabelText("Saved crew travel")).not.toBeInTheDocument();
  });
  it("shows the full manager operations map", async () => {
    render(<ManagerOperationsPage />);
    expect(await screen.findByLabelText("Manager operations map")).toHaveTextContent("operations");
  });

  it("shows one combined travel view with planning and road tools", async () => {
    render(<ManagerOperationsPage />);
    const map = await screen.findByLabelText("Manager operations map");
    expect(map).toHaveAttribute("data-mode", "on-road");
    expect(screen.queryByText("Travel mode")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Planning" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "On the Road" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Travel planning panel")).toHaveTextContent("Update local fuel price");
    expect(screen.getByLabelText("Travel planning panel")).toHaveTextContent("Suggest change");
    expect(screen.getByLabelText("Travel planning panel")).toHaveTextContent("Road tools");
  });

  it("keeps mileage and maintenance logging in the combined view", async () => {
    render(<ManagerOperationsPage />);
    expect(await screen.findByRole("heading", { name: "Mileage" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Maintenance" })).toBeInTheDocument();
  });

  it("allows mileage and maintenance entries even when there is no trip", async () => {
    render(<ManagerOperationsPage />);
    expect(await screen.findByRole("heading", { name: "Mileage" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Maintenance" })).toBeInTheDocument();
    expect(screen.getByText(/No formal trip has been created yet/)).toBeInTheDocument();
  });
});
