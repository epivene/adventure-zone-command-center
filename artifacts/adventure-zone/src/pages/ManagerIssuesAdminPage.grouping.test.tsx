// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ManagerIssuesAdminPage from "./ManagerIssuesAdminPage";

const mocks = vi.hoisted(() => ({
  get: vi.fn(async (path: string) => {
    if (path === "/manager-admin/reviews") {
      return { reviews: [
        { id: "review-a", bookingId: "event-a", bookingName: "Dickinson Fair", legId: "leg-a", legName: "Hulk", rating: 5, feedback: "Great", crewNotes: null, organizerSiteNotes: null, recommendReturn: "yes", createdAt: "2026-08-01T12:00:00.000Z" },
        { id: "review-b", bookingId: "event-a", bookingName: "Dickinson Fair", legId: "leg-a", legName: "Hulk", rating: 4, feedback: "Busy", crewNotes: null, organizerSiteNotes: null, recommendReturn: "yes", createdAt: "2026-08-02T12:00:00.000Z" },
      ] };
    }
    if (path === "/manager-admin/reviews/due") return { reviewsDue: [] };
    if (path === "/manager-admin/events/checklists") return { checklists: [] };
    if (path === "/manager-admin/resource-condition-issues?state=open") return { issues: [] };
    if (path === "/manager-admin/issues?status=open") return { issues: [] };
    return {};
  }),
}));

vi.mock("@/lib/auth-token", () => ({
  apiGet: mocks.get,
  apiDelete: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
}));

afterEach(cleanup);

describe("ManagerIssuesAdminPage review hierarchy", () => {
  it("shows saved reviews under event groups nested beneath their leg", async () => {
    render(<ManagerIssuesAdminPage />);

    const leg = await screen.findByRole("button", { name: "Hulk, 2 reviews" });
    expect(screen.queryByText("Great")).not.toBeInTheDocument();
    fireEvent.click(leg);
    fireEvent.click(screen.getByRole("button", { name: "Dickinson Fair, 2 reviews" }));
    expect(screen.getByText("Great")).toBeInTheDocument();
    expect(screen.getByText("Busy")).toBeInTheDocument();
  });
});
