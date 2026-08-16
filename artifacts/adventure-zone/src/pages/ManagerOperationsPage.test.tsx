// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerOperationsPage from "./ManagerOperationsPage";

const mocks = vi.hoisted(() => ({
  api: vi.fn(async (path: string) => {
    if (path === "/manager/dashboard") return { trips: [], route: null };
    return {};
  }),
}));

vi.mock("@/lib/manager-auth-context", () => ({
  useManagerAuth: () => ({ manager: { legId: "leg-a" }, managerApi: mocks.api }),
}));
vi.mock("@/lib/manager-sync-queue", () => ({
  queueManagerMutation: vi.fn(async () => {}), flushManagerMutationQueue: vi.fn(async () => {}),
}));
vi.mock("@/features/manager/use-manager-scoped-map", () => ({ useManagerScopedMap: () => ({ loading: false, error: null, reload: vi.fn(), data: { leg: { id: "leg-a", name: "Kristy", color: "#f97316" }, route: null, events: [], meetups: [] } }) }));
vi.mock("@/components/manager/manager-scoped-map", () => ({
  ManagerScopedMap: ({ variant, mode, onModeChange }: any) => <div aria-label="Manager operations map"><p>Travel mode</p><button aria-pressed={mode === "planning"} onClick={() => onModeChange("planning")}>Planning</button><button aria-pressed={mode === "on-road"} onClick={() => onModeChange("on-road")}>On the Road</button><span>{variant}</span></div>,
}));
vi.mock("@/components/manager/manager-travel-planning-panel", () => ({
  ManagerTravelPlanningPanel: ({ compact }: { compact?: boolean }) => <div aria-label="Travel planning panel">{compact ? "quick road updates" : "Update local fuel price · Suggest change"}</div>,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

describe("ManagerOperationsPage", () => {
  it("shows the full manager operations map", async () => {
    render(<ManagerOperationsPage />);
    expect(await screen.findByLabelText("Manager operations map")).toHaveTextContent("operations");
  });

  it("shows collaborative Planning tools without a manager or leg selector", async () => {
    render(<ManagerOperationsPage />);
    expect(await screen.findByText("Travel mode")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Planning" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Travel planning panel")).toHaveTextContent("Update local fuel price");
    expect(screen.getByLabelText("Travel planning panel")).toHaveTextContent("Suggest change");
    expect(screen.queryByLabelText(/choose manager|choose leg|preview manager/i)).not.toBeInTheDocument();
  });

  it("switches to a calmer On the Road update panel while keeping field logging", async () => {
    render(<ManagerOperationsPage />);
    const road = await screen.findByRole("button", { name: "On the Road" });
    fireEvent.click(road);
    expect(road).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Travel planning panel")).toHaveTextContent("quick road updates");
    expect(screen.getByLabelText("Travel planning panel")).not.toHaveTextContent("Suggest change");
    expect(screen.getByRole("heading", { name: "Mileage" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Maintenance" })).toBeInTheDocument();
  });

  it("allows mileage and maintenance entries even when there is no trip", async () => {
    render(<ManagerOperationsPage />);
    expect(await screen.findByRole("heading", { name: "Mileage" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Maintenance" })).toBeInTheDocument();
    expect(screen.getByText(/No current trip/)).toBeInTheDocument();
  });
});