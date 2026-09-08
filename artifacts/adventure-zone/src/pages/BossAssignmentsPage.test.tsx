import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("@/lib/boss-auth-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/boss-auth-context")>();
  return {
    ...actual,
    bossGet: vi.fn(),
    bossPost: vi.fn(),
    bossPatch: vi.fn(),
    bossDelete: vi.fn(),
  };
});

import { bossGet, bossPost, bossPatch, bossDelete } from "@/lib/boss-auth-context";
import BossAssignmentsPage from "./BossAssignmentsPage";

const mockGet = vi.mocked(bossGet);
const mockPost = vi.mocked(bossPost);

const SAMPLE_ASSIGNMENT = {
  id: "asgn-1",
  title: "Review contracts",
  assigneeKind: "office" as const,
  officeAccountId: null,
  priority: "high" as const,
  status: "todo" as const,
  details: "Check all 2024 Q1 contracts",
  dueAt: null,
  completedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("BossAssignmentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockImplementation(async (path: string) =>
      path === "/boss/assignment-targets"
        ? { officeAccounts: [{ id: "office-1", displayName: "Amy" }] }
        : { assignments: [] },
    );
  });

  it("renders assignment list", async () => {
    mockGet.mockResolvedValueOnce({ assignments: [SAMPLE_ASSIGNMENT] });
    render(<BossAssignmentsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("assignment-item-asgn-1")).toBeTruthy();
      expect(screen.getByText("Review contracts")).toBeTruthy();
    });
  });

  it("shows empty state when no assignments", async () => {
    mockGet.mockResolvedValueOnce({ assignments: [] });
    render(<BossAssignmentsPage />);
    await waitFor(() => {
      expect(screen.getByTestId("assignments-empty")).toBeTruthy();
    });
  });

  it("opens create dialog on New Assignment click", async () => {
    mockGet.mockResolvedValueOnce({ assignments: [] });
    render(<BossAssignmentsPage />);
    await waitFor(() => screen.getByTestId("button-new-assignment"));
    fireEvent.click(screen.getByTestId("button-new-assignment"));
    await waitFor(() => {
      expect(screen.getByTestId("input-assignment-title")).toBeTruthy();
    });
  });

  it("sends Amy's office account when creating an office assignment", async () => {
    mockGet.mockResolvedValueOnce({ assignments: [] });
    mockPost.mockResolvedValueOnce({});
    render(<BossAssignmentsPage />);

    await waitFor(() => expect(screen.getByTestId("button-new-assignment")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("button-new-assignment"));
    fireEvent.change(screen.getByTestId("input-assignment-title"), { target: { value: "Send contract" } });
    fireEvent.click(screen.getByTestId("button-save-assignment"));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/boss/assignments", expect.objectContaining({
        title: "Send contract",
        assigneeKind: "office",
        officeAccountId: "office-1",
      }));
    });
  });

  it("omits the office account when creating an owner assignment", async () => {
    mockGet.mockResolvedValueOnce({ assignments: [] });
    mockPost.mockResolvedValueOnce({});
    render(<BossAssignmentsPage />);

    await waitFor(() => expect(screen.getByTestId("button-new-assignment")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("button-new-assignment"));
    fireEvent.change(screen.getByTestId("input-assignment-title"), { target: { value: "Review budget" } });
    fireEvent.change(screen.getByTestId("select-assignment-assignee"), { target: { value: "owner" } });
    fireEvent.click(screen.getByTestId("button-save-assignment"));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/boss/assignments", expect.objectContaining({
        title: "Review budget",
        assigneeKind: "owner",
        officeAccountId: null,
      }));
    });
  });
});
