// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerOperationsPage from "./ManagerOperationsPage";

const mocks = vi.hoisted(() => ({
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
vi.mock("@/features/manager/use-manager-scoped-map", () => ({
  useManagerScopedMap: () => ({ loading: false, error: null, reload: vi.fn(), data: { leg: { id: "leg-a", name: "Kristy", color: "#f97316" }, route: null, events: [], meetups: [] } }),
}));
vi.mock("@/components/manager/manager-scoped-map", () => ({
  ManagerScopedMap: ({ mode }: any) => <div aria-label="Manager operations map" data-mode={mode}>combined route map</div>,
}));
vi.mock("@/components/manager/manager-travel-planning-panel", () => ({
  ManagerTravelPlanningPanel: ({ compact }: { compact?: boolean }) => <div aria-label="Travel planning panel" data-compact={String(Boolean(compact))}>planning and road tools</div>,
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

describe("ManagerOperationsPage combined travel view", () => {
  it("uses one combined road-and-planning view instead of switching modes", async () => {
    render(<ManagerOperationsPage />);
    expect(await screen.findByLabelText("Manager operations map")).toHaveAttribute("data-mode", "on-road");
    expect(screen.getByLabelText("Travel planning panel")).toHaveAttribute("data-compact", "false");
  });
});
