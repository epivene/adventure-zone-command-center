import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BossMaintenancePage from "./BossMaintenancePage";
import BossReceiptsPage from "./BossReceiptsPage";
import BossReviewsPage from "./BossReviewsPage";

const bossGet = vi.fn();

vi.mock("@/lib/boss-auth-context", () => ({
  bossGet: (...args: unknown[]) => bossGet(...args),
  bossDelete: vi.fn(),
  bossPatch: vi.fn(),
}));

const dashboard = {
  receipts: [
    {
      id: "receipt-hulk",
      legId: "leg-hulk",
      legName: "Hulk",
      vendor: "Hulk Fuel",
      amount: 80,
    },
    {
      id: "receipt-kristy",
      legId: "leg-kristy",
      legName: "Kristy",
      vendor: "Kristy Fuel",
      amount: 60,
    },
  ],
  checklistAndMaintenance: [
    {
      id: "maintenance-hulk",
      legId: "leg-hulk",
      legName: "Hulk",
      title: "Hulk inspection",
      phase: "pre",
    },
    {
      id: "maintenance-kristy",
      legId: "leg-kristy",
      legName: "Kristy",
      title: "Kristy inspection",
      phase: "post",
    },
  ],
  reviewAndWrapUp: [
    {
      id: "review-hulk",
      bookingId: "booking-hulk",
      legId: "leg-hulk",
      legName: "Hulk",
      title: "Hulk event",
      status: "review_completed",
    },
    {
      id: "review-kristy",
      bookingId: "booking-kristy",
      legId: "leg-kristy",
      legName: "Kristy",
      title: "Kristy event",
      status: "review_due",
    },
  ],
};

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  bossGet.mockReset().mockResolvedValue(dashboard);
});

afterEach(cleanup);

describe("Boss operational records by leg", () => {
  it("hides receipts until a leg is chosen, then shows only that leg", async () => {
    render(<BossReceiptsPage />);
    expect(
      await screen.findByRole("button", { name: "Hulk, 1 receipt" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Hulk Fuel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hulk, 1 receipt" }));
    expect(screen.getByText("Hulk Fuel")).toBeInTheDocument();
    expect(screen.queryByText("Kristy Fuel")).not.toBeInTheDocument();
  });

  it("hides maintenance until a leg is chosen, then scopes its phase filters", async () => {
    render(<BossMaintenancePage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Kristy, 1 maintenance record",
      }),
    );

    expect(screen.getByText("Kristy inspection")).toBeInTheDocument();
    expect(screen.queryByText("Hulk inspection")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Post-event" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Pre-event" }),
    ).not.toBeInTheDocument();
  });

  it("falls back to all maintenance records when refresh removes the selected phase", async () => {
    bossGet.mockResolvedValueOnce({
      ...dashboard,
      checklistAndMaintenance: [
        { id: "maintenance-pre", legId: "leg-hulk", legName: "Hulk", title: "Pre inspection", phase: "pre" },
        { id: "maintenance-post", legId: "leg-hulk", legName: "Hulk", title: "Post inspection", phase: "post" },
      ],
    });
    render(<BossMaintenancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hulk, 2 maintenance records" }));
    fireEvent.click(screen.getByRole("tab", { name: "Pre-event" }));
    expect(screen.getByText("Pre inspection")).toBeInTheDocument();

    bossGet.mockResolvedValueOnce({
      ...dashboard,
      checklistAndMaintenance: [
        { id: "maintenance-post", legId: "leg-hulk", legName: "Hulk", title: "Post inspection", phase: "post" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByText("Post inspection")).toBeInTheDocument();
  });

  it("opens a dashboard-linked review inside its matching leg", async () => {
    window.history.replaceState(
      {},
      "",
      "/boss/reviews?bookingId=booking-kristy",
    );
    render(<BossReviewsPage />);

    await waitFor(() =>
      expect(screen.getByText("Kristy reviews")).toBeInTheDocument(),
    );
    expect(screen.getByText("Kristy event")).toBeInTheDocument();
    expect(screen.queryByText("Hulk event")).not.toBeInTheDocument();
  });

  it("offers an Unassigned bucket for any legacy review without a leg", async () => {
    bossGet.mockResolvedValueOnce({
      ...dashboard,
      reviewAndWrapUp: [
        { id: "legacy-review", bookingId: "legacy-booking", legId: null, legName: null, title: "Legacy event", status: "review_completed" },
      ],
    });
    render(<BossReviewsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Unassigned, 1 review" }));

    expect(screen.getByText("Legacy event")).toBeInTheDocument();
  });
});
