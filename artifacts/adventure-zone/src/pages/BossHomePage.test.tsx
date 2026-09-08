import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BossAuthProvider } from "@/lib/boss-auth-context";

// Mock bossFetch so tests don't hit a real network
vi.mock("@/lib/boss-auth-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/boss-auth-context")>();
  return {
    ...actual,
    bossGet: vi.fn(),
  };
});

import { bossGet } from "@/lib/boss-auth-context";
import BossHomePage from "./BossHomePage";

const mockBossGet = vi.mocked(bossGet);

const EMPTY_DASHBOARD = {
  submittedReceipts: 0,
  submittedDrafts: [],
  businessDocumentsCount: 0,
  assignments: [],
  reviewAndWrapUp: [],
  checklistAndMaintenance: [],
};

describe("BossHomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows all-clear when dashboard has no items", async () => {
    mockBossGet.mockResolvedValueOnce(EMPTY_DASHBOARD);
    render(<BossHomePage />);
    await waitFor(() => {
      expect(screen.getByTestId("boss-home-empty")).toBeTruthy();
    });
  });

  it("shows stats when dashboard has data", async () => {
    mockBossGet.mockResolvedValueOnce({
      submittedReceipts: 3,
      submittedDrafts: [{ id: "d1", name: "Event Flyer", type: "flyer" }],
      businessDocumentsCount: 4,
      assignments: [
        {
          id: "a1",
          title: "Order supplies",
          assigneeKind: "office",
          officeAccountId: null,
          priority: "urgent",
          status: "todo",
          details: null,
          dueAt: null,
          completedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      reviewAndWrapUp: [],
      checklistAndMaintenance: [],
    });
    render(<BossHomePage />);
    await waitFor(() => {
      expect(screen.getByTestId("stat-receipts").textContent).toBe("3");
      expect(screen.getByTestId("stat-documents").textContent).toBe("4");
      expect(screen.getByTestId("assignment-row-a1")).toBeTruthy();
    });
  });

  it("shows only the three latest completed events across all legs", async () => {
    mockBossGet.mockResolvedValueOnce({
      ...EMPTY_DASHBOARD,
      checklistAndMaintenance: [
        { id: "unfinished", bookingId: "booking-unfinished", title: "Unfinished Event", legId: "leg-a", phase: "post_event", status: "in_progress", completedAt: null },
        { id: "a-post", bookingId: "booking-a", title: "Newest Event", legId: "leg-a", phase: "post_event", status: "completed", completedAt: "2026-09-07T12:00:00.000Z" },
        { id: "a-pre", bookingId: "booking-a", title: "Newest Event", legId: "leg-a", phase: "pre_event", status: "completed", completedAt: "2026-09-06T12:00:00.000Z" },
        { id: "b-post", bookingId: "booking-b", title: "Second Event", legId: "leg-b", phase: "post_event", status: "completed", completedAt: "2026-09-05T12:00:00.000Z" },
        { id: "c-post", bookingId: "booking-c", title: "Third Event", legId: "leg-c", phase: "post_event", status: "completed", completedAt: "2026-09-04T12:00:00.000Z" },
        { id: "d-post", bookingId: "booking-d", title: "Older Event", legId: "leg-d", phase: "post_event", status: "completed", completedAt: "2026-09-03T12:00:00.000Z" },
      ],
    });

    render(<BossHomePage />);

    const rows = await screen.findAllByTestId(/maintenance-row-/);
    expect(rows).toHaveLength(3);
    expect(screen.getAllByText("Newest Event")).toHaveLength(1);
    expect(screen.getByText("Second Event")).toBeVisible();
    expect(screen.getByText("Third Event")).toBeVisible();
    expect(screen.queryByText("Older Event")).not.toBeInTheDocument();
    expect(screen.queryByText("Unfinished Event")).not.toBeInTheDocument();
    expect(rows[0]).toHaveAttribute("href", "/boss/maintenance?bookingId=booking-a");
    expect(screen.queryByText("post_event")).not.toBeInTheDocument();
  });

  it("shows error state when fetch fails", async () => {
    mockBossGet.mockRejectedValueOnce(new Error("Network error"));
    render(<BossHomePage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });
});
