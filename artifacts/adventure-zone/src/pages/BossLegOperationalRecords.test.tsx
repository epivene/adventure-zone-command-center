import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

  it("hides maintenance until a leg is chosen, then shows only that leg's events", async () => {
    render(<BossMaintenancePage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Kristy, 1 maintenance record",
      }),
    );

    expect(screen.getByText("Kristy inspection")).toBeInTheDocument();
    expect(screen.queryByText("Hulk inspection")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kristy inspection/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps maintenance records grouped by event after refresh", async () => {
    bossGet.mockResolvedValueOnce({
      ...dashboard,
      checklistAndMaintenance: [
        { id: "maintenance-pre", bookingId: "booking-party", legId: "leg-hulk", legName: "Hulk", title: "Hulk Birthday Party", phase: "pre" },
        { id: "maintenance-post", bookingId: "booking-party", legId: "leg-hulk", legName: "Hulk", title: "Hulk Birthday Party", phase: "post" },
      ],
    });
    render(<BossMaintenancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hulk, 2 maintenance records" }));
    expect(screen.getAllByText("Hulk Birthday Party")).toHaveLength(1);

    bossGet.mockResolvedValueOnce({
      ...dashboard,
      checklistAndMaintenance: [
        { id: "maintenance-post", bookingId: "booking-party", legId: "leg-hulk", legName: "Hulk", title: "Hulk Birthday Party", phase: "post" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findByRole("button", { name: /Hulk Birthday Party/ })).toBeInTheDocument();
  });

  it("opens one event card with its pre-event and post-event records underneath", async () => {
    bossGet.mockImplementation(async (path: string) => {
      if (path === "/boss/dashboard") {
        return {
          ...dashboard,
          checklistAndMaintenance: [
            {
              id: "maintenance-pre",
              bookingId: "booking-party",
              legId: "leg-hulk",
              legName: "Hulk",
              title: "Hulk Birthday Party",
              phase: "pre_event",
              status: "completed",
            },
            {
              id: "maintenance-post",
              bookingId: "booking-party",
              legId: "leg-hulk",
              legName: "Hulk",
              title: "Hulk Birthday Party",
              phase: "post_event",
              status: "in_progress",
            },
          ],
        };
      }
      if (path === "/boss/maintenance/maintenance-pre") {
        return {
          record: {
            id: "maintenance-pre",
            bookingId: "booking-party",
            phase: "pre_event",
            items: [
              { id: "answer-pre", label: "Inspect costume", resourceName: "Hulk suit", result: "safe", note: "Ready" },
            ],
          },
        };
      }
      if (path === "/boss/maintenance/maintenance-post") {
        return {
          record: {
            id: "maintenance-post",
            bookingId: "booking-party",
            phase: "post_event",
            items: [
              { id: "answer-post", label: "Check for damage", resourceName: "Hulk suit", result: "needs_attention", note: "Small tear" },
            ],
          },
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<BossMaintenancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hulk, 2 maintenance records" }));

    expect(screen.getAllByText("Hulk Birthday Party")).toHaveLength(1);
    expect(screen.queryByText("Inspect costume")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hulk Birthday Party/ }));

    const event = await screen.findByTestId("maintenance-event-booking-party");
    expect(within(event).getByRole("heading", { name: "Pre-event" })).toBeInTheDocument();
    expect(within(event).getByText("Inspect costume")).toBeInTheDocument();
    expect(within(event).getByRole("heading", { name: "Post-event" })).toBeInTheDocument();
    expect(within(event).getByText("Check for damage")).toBeInTheDocument();
  });

  it("shows a missing phase under an opened maintenance event", async () => {
    bossGet.mockImplementation(async (path: string) => {
      if (path === "/boss/dashboard") {
        return {
          ...dashboard,
          checklistAndMaintenance: [
            {
              id: "maintenance-pre",
              bookingId: "booking-party",
              legId: "leg-hulk",
              legName: "Hulk",
              title: "Hulk Birthday Party",
              phase: "pre_event",
              status: "completed",
            },
          ],
        };
      }
      return {
        record: {
          id: "maintenance-pre",
          bookingId: "booking-party",
          phase: "pre_event",
          items: [],
        },
      };
    });

    render(<BossMaintenancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hulk, 1 maintenance record" }));
    fireEvent.click(screen.getByRole("button", { name: /Hulk Birthday Party/ }));

    const event = await screen.findByTestId("maintenance-event-booking-party");
    expect(within(event).getByText("No post-event record yet.")).toBeInTheDocument();
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
