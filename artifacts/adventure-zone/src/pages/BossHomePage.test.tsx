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
      expect(screen.getByTestId("stat-drafts").textContent).toBe("1");
      expect(screen.getByTestId("assignment-row-a1")).toBeTruthy();
    });
  });

  it("shows error state when fetch fails", async () => {
    mockBossGet.mockRejectedValueOnce(new Error("Network error"));
    render(<BossHomePage />);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });
});
