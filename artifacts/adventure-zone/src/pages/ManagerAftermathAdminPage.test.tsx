// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerAftermathAdminPage from "./ManagerAftermathAdminPage";

const mocks = vi.hoisted(() => ({
  get: vi.fn(async (path: string) => {
    if (path === "/manager-admin/reviews") {
      return { reviews: [
        { id: "r1", bookingId: "event-a", bookingName: "Dickinson Fair", legId: "leg-a", legName: "Hulk", rating: 5, recommendReturn: "yes", feedback: "Great" },
        { id: "r2", bookingId: "event-a", bookingName: "Dickinson Fair", legId: "leg-a", legName: "Hulk", rating: 4, recommendReturn: "yes", feedback: "Busy" },
      ] };
    }
    if (path === "/manager-admin/incidents") {
      return { incidents: [
        { id: "i1", type: "injury", description: "Minor injury", followUpNeeded: true },
        { id: "i2", type: "damage", description: "Small damage", followUpNeeded: false },
      ] };
    }
    if (path === "/event-wrap-up-admin") return { wrapUps: [] };
    if (path === "/manager-admin/events/lifecycle") return { lifecycles: [] };
    return {};
  }),
}));

vi.mock("@/lib/auth-token", () => ({
  apiGet: mocks.get,
  apiDelete: vi.fn(),
  apiPatch: vi.fn(),
}));

afterEach(() => cleanup());

describe("ManagerAftermathAdminPage", () => {
  it("shows reviews under event groups nested beneath their leg", async () => {
    render(<ManagerAftermathAdminPage />);

    const leg = await screen.findByRole("button", { name: "Hulk, 2 reviews" });
    expect(screen.queryByText("Great")).not.toBeInTheDocument();
    fireEvent.click(leg);
    const event = screen.getByRole("button", { name: "Dickinson Fair, 2 reviews" });
    fireEvent.click(event);
    expect(screen.getByText("Great")).toBeInTheDocument();
    expect(screen.getByText("Busy")).toBeInTheDocument();
  });

  it("can filter incidents needing follow-up", async () => {
    render(<ManagerAftermathAdminPage />);
    expect(await screen.findByText("Small damage")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Follow-up only"));
    expect(screen.queryByText("Small damage")).not.toBeInTheDocument();
    expect(screen.getByText("Minor injury")).toBeInTheDocument();
  });
});
