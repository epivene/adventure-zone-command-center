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
  useManagerAuth: () => ({ manager: { legId: "leg-a" }, managerApi: mocks.api }),
}));
vi.mock("@/lib/manager-sync-queue", () => ({
  queueManagerMutation: vi.fn(async () => {}), flushManagerMutationQueue: vi.fn(async () => {}),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ManagerOperationsPage", () => {
  it("allows mileage and maintenance entries even when there is no trip", async () => {
    render(<ManagerOperationsPage />);
    expect(await screen.findByRole("heading", { name: "Mileage" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Maintenance" })).toBeInTheDocument();
    expect(screen.queryByText("No current trip.")).not.toBeInTheDocument();
  });
});
