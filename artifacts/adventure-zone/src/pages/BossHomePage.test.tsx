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
    mockBossGet.mockImplementation(async (path) => path === "/boss/work-requests"
      ? { active: [], recentlyCompleted: [] } as never
      : EMPTY_DASHBOARD as never);
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
      checklistAndMaintenance: [],
      recentCompletedMaintenanceEvents: [
        { id: "unable", bookingId: "booking-unable", title: "Unable Event", status: "unable_to_complete", completedAt: "2026-09-08T12:00:00.000Z" },
        { id: "a-post", bookingId: "booking-a", title: "Newest Event", status: "completed", completedAt: "2026-09-07T12:00:00.000Z" },
        { id: "b-post", bookingId: "booking-b", title: "Second Event", status: "completed", completedAt: "2026-09-05T12:00:00.000Z" },
        { id: "c-post", bookingId: "booking-c", title: "Third Event", status: "completed", completedAt: "2026-09-04T12:00:00.000Z" },
      ],
    });

    render(<BossHomePage />);

    const rows = await screen.findAllByTestId(/maintenance-row-/);
    expect(rows).toHaveLength(3);
    expect(screen.getAllByText("Newest Event")).toHaveLength(1);
    expect(screen.getByText("Second Event")).toBeVisible();
    expect(screen.getByText("Third Event")).toBeVisible();
    expect(screen.queryByText("Older Event")).not.toBeInTheDocument();
    expect(screen.queryByText("Unable Event")).not.toBeInTheDocument();
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
  it("shows both permanent convention inputs in Needs Your Attention", async () => {
    mockBossGet.mockImplementation(async (path) => path === "/boss/work-requests"
      ? {
          active: [
            {
              id: "notes-request",
              type: "rapid_convention_notes",
              state: "waiting_on_dave",
              priority: "high",
              title: "Quick Convention Notes",
              instructions: "Capture each conversation.",
              dueAt: null,
              completedAt: null,
              createdAt: "2026-09-09T00:00:00.000Z",
              updatedAt: "2026-09-09T00:00:00.000Z",
            },
            {
              id: "planning-request",
              type: "convention_planning_questionnaire",
              state: "waiting_on_dave",
              priority: "high",
              title: "Convention Planning Decisions",
              instructions: "Fill in the registration, hotel, and advertising choices.",
              dueAt: null,
              completedAt: null,
              createdAt: "2026-09-09T00:00:00.000Z",
              updatedAt: "2026-09-09T00:00:00.000Z",
            },
          ],
          recentlyCompleted: [],
        } as never
      : EMPTY_DASHBOARD as never);

    render(<BossHomePage />);

    expect(await screen.findByText("Quick Convention Notes")).toBeVisible();
    expect(screen.getByText("Convention Planning Decisions")).toBeVisible();
    expect(screen.getByText(/Planning questionnaire/)).toBeVisible();
  });

});
