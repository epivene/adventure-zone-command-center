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
const bossDelete = vi.fn();

vi.mock("@/lib/boss-auth-context", () => ({
  bossGet: (...args: unknown[]) => bossGet(...args),
  bossDelete: (...args: unknown[]) => bossDelete(...args),
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
  bossDelete.mockReset().mockResolvedValue({ ok: true });
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
    fireEvent.click(screen.getByRole("button", { name: "Unassigned event, 1 receipt" }));
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
        { id: "maintenance-pre", bookingId: "booking-party", legId: "leg-hulk", legName: "Hulk", title: "Hulk Birthday Party", phase: "pre" },
        { id: "maintenance-post", bookingId: "booking-party", legId: "leg-hulk", legName: "Hulk", title: "Hulk Birthday Party", phase: "post" },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(await screen.findAllByText("Hulk Birthday Party")).toHaveLength(1);
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

    const event = screen.getByTestId("maintenance-event-booking-party");
    expect(within(event).getByRole("heading", { name: "Pre-event" })).toBeInTheDocument();
    expect(await within(event).findByText("Inspect costume")).toBeInTheDocument();
    expect(within(event).getByRole("heading", { name: "Post-event" })).toBeInTheDocument();
    expect(await within(event).findByText("Check for damage")).toBeInTheDocument();
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

  it("keeps a successful phase and retries only a failed phase", async () => {
    let postAttempts = 0;
    bossGet.mockImplementation(async (path: string) => {
      if (path === "/boss/dashboard") {
        return {
          ...dashboard,
          checklistAndMaintenance: [
            { id: "maintenance-pre", bookingId: "booking-party", legId: "leg-hulk", legName: "Hulk", title: "Hulk Birthday Party", phase: "pre_event" },
            { id: "maintenance-post", bookingId: "booking-party", legId: "leg-hulk", legName: "Hulk", title: "Hulk Birthday Party", phase: "post_event" },
          ],
        };
      }
      if (path === "/boss/maintenance/maintenance-pre") {
        return { record: { id: "maintenance-pre", items: [{ id: "answer-pre", label: "Pre answer", resourceName: null, result: "safe", note: null }] } };
      }
      if (path === "/boss/maintenance/maintenance-post") {
        postAttempts += 1;
        if (postAttempts === 1) throw new Error("Post record unavailable");
        return { record: { id: "maintenance-post", items: [{ id: "answer-post", label: "Post answer", resourceName: null, result: "safe", note: null }] } };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<BossMaintenancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hulk, 2 maintenance records" }));
    fireEvent.click(screen.getByRole("button", { name: /Hulk Birthday Party/ }));

    expect(await screen.findByText("Pre answer")).toBeInTheDocument();
    expect(await screen.findByText("Post record unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry post-event record" }));
    expect(await screen.findByText("Post answer")).toBeInTheDocument();
    expect(postAttempts).toBe(2);
  });

  it("refreshes the details for an event that is already open", async () => {
    let detailVersion = 1;
    bossGet.mockImplementation(async (path: string) => {
      if (path === "/boss/dashboard") {
        return {
          ...dashboard,
          checklistAndMaintenance: [
            { id: "maintenance-pre", bookingId: "booking-party", legId: "leg-hulk", legName: "Hulk", title: "Hulk Birthday Party", phase: "pre_event" },
          ],
        };
      }
      return { record: { id: "maintenance-pre", items: [{ id: "answer-pre", label: `Detail version ${detailVersion}`, resourceName: null, result: "safe", note: null }] } };
    });

    render(<BossMaintenancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hulk, 1 maintenance record" }));
    fireEvent.click(screen.getByRole("button", { name: /Hulk Birthday Party/ }));
    expect(await screen.findByText("Detail version 1")).toBeInTheDocument();

    detailVersion = 2;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Detail version 2")).toBeInTheDocument();
    expect(screen.queryByText("Detail version 1")).not.toBeInTheDocument();
  });

  it("groups legacy pre and post records without a booking id into one event card", async () => {
    bossGet.mockResolvedValueOnce({
      ...dashboard,
      checklistAndMaintenance: [
        { id: "legacy-pre", legId: "leg-hulk", legName: "Hulk", title: "Legacy Party", phase: "pre" },
        { id: "legacy-post", legId: "leg-hulk", legName: "Hulk", title: "Legacy Party", phase: "post" },
      ],
    });
    render(<BossMaintenancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hulk, 2 maintenance records" }));

    expect(screen.getAllByText("Legacy Party")).toHaveLength(1);
    const legacyToggle = screen.getByRole("button", { name: /Legacy Party/ });
    expect(legacyToggle).toHaveTextContent("Pre-event available");
    expect(legacyToggle).toHaveTextContent("Post-event available");
    expect(legacyToggle.getAttribute("aria-controls")).not.toMatch(/\s/);
  });

  it("removes a phase record without using the event card as the action", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    let finishDelete!: () => void;
    bossDelete.mockImplementationOnce(() => new Promise<void>((resolve) => { finishDelete = resolve; }));
    bossGet.mockImplementation(async (path: string) => {
      if (path === "/boss/dashboard") {
        return {
          ...dashboard,
          checklistAndMaintenance: [
            { id: "maintenance-pre", bookingId: "booking-party", legId: "leg-hulk", legName: "Hulk", title: "Hulk Birthday Party", phase: "pre_event" },
          ],
        };
      }
      return { record: { id: "maintenance-pre", items: [] } };
    });

    render(<BossMaintenancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hulk, 1 maintenance record" }));
    const toggle = screen.getByRole("button", { name: /Hulk Birthday Party/ });
    fireEvent.click(toggle);
    await screen.findByText("No checklist answers.");
    fireEvent.click(screen.getByRole("button", { name: "Remove pre-event record" }));

    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    finishDelete();
    await waitFor(() => expect(bossDelete).toHaveBeenCalledWith("/boss/maintenance/maintenance-pre"));
    confirm.mockRestore();
  });

  it("opens a dashboard-linked maintenance event inside its matching leg", async () => {
    window.history.replaceState({}, "", "/boss/maintenance?bookingId=booking-kristy");
    bossGet.mockImplementation(async (path: string) => {
      if (path === "/boss/dashboard") {
        return {
          ...dashboard,
          checklistAndMaintenance: [
            { id: "maintenance-hulk", bookingId: "booking-hulk", legId: "leg-hulk", legName: "Hulk", title: "Hulk inspection", phase: "post_event" },
            { id: "maintenance-kristy", bookingId: "booking-kristy", legId: "leg-kristy", legName: "Kristy", title: "Kristy inspection", phase: "post_event" },
          ],
        };
      }
      if (path === "/boss/maintenance/maintenance-kristy") {
        return { record: { id: "maintenance-kristy", items: [{ id: "answer-kristy", label: "Kristy detail", resourceName: null, result: "safe", note: null }] } };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<BossMaintenancePage />);

    expect(await screen.findByText("Kristy maintenance records")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Kristy inspection/ })).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Kristy detail")).toBeInTheDocument();
    expect(screen.queryByText("Hulk inspection")).not.toBeInTheDocument();
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
  it("groups a selected leg's receipts under their event", async () => {
    bossGet.mockResolvedValueOnce({
      ...dashboard,
      receipts: [
        { id: "receipt-a", bookingId: "booking-party", bookingName: "Hulk Birthday Party", legId: "leg-hulk", legName: "Hulk", vendor: "Fuel Stop" },
        { id: "receipt-b", bookingId: "booking-party", bookingName: "Hulk Birthday Party", legId: "leg-hulk", legName: "Hulk", vendor: "Supply Store" },
        { id: "receipt-unassigned", bookingId: null, bookingName: null, legId: "leg-hulk", legName: "Hulk", vendor: "Unknown Event" },
      ],
    });

    render(<BossReceiptsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hulk, 3 receipts" }));

    expect(screen.getByRole("button", { name: "Hulk Birthday Party, 2 receipts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unassigned event, 1 receipt" })).toBeInTheDocument();
    expect(screen.queryByText("Fuel Stop")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hulk Birthday Party, 2 receipts" }));
    expect(screen.getByText("Fuel Stop")).toBeInTheDocument();
    expect(screen.getByText("Supply Store")).toBeInTheDocument();
    expect(screen.queryByText("Unknown Event")).not.toBeInTheDocument();
  });

  it("groups a selected leg's review records under their event", async () => {
    bossGet.mockResolvedValueOnce({
      ...dashboard,
      reviewAndWrapUp: [
        { id: "review-due", bookingId: "booking-party", legId: "leg-hulk", legName: "Hulk", title: "Hulk Birthday Party", status: "review_due" },
        { id: "review-complete", bookingId: "booking-party", legId: "leg-hulk", legName: "Hulk", title: "Hulk Birthday Party", status: "review_completed", feedback: "Great event" },
      ],
    });

    render(<BossReviewsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Hulk, 2 reviews" }));

    expect(screen.getByRole("button", { name: "Hulk Birthday Party, 2 reviews" })).toBeInTheDocument();
    expect(screen.queryByText("Great event")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Hulk Birthday Party, 2 reviews" }));
    expect(screen.getByText("Great event")).toBeInTheDocument();
  });

});
