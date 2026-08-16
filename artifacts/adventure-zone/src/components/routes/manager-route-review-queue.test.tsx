// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerRouteReviewQueue } from "./manager-route-review-queue";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.get, apiPost: mocks.post }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const pending = {
  id: "suggestion-1",
  legId: "leg-k",
  targetType: "trip_stop",
  targetId: "stop-1",
  kind: "reorder_stop",
  beforeJson: { sortOrder: 1 },
  proposedJson: { sortOrder: 2 },
  reason: "Construction",
  status: "pending",
  adminResponse: null,
  stale: false,
  createdAt: "2026-08-15T20:00:00Z",
};

describe("ManagerRouteReviewQueue", () => {
  it("shows current/proposed values and approves a pending suggestion", async () => {
    let list = [pending];
    mocks.get.mockImplementation(async () => ({ suggestions: list }));
    mocks.post.mockImplementation(async () => { list = []; return { suggestion: { ...pending, status: "approved" } }; });
    const onApproved = vi.fn(async () => {});
    render(<ManagerRouteReviewQueue onApproved={onApproved} />);

    expect(await screen.findByText("Construction")).toBeInTheDocument();
    expect(screen.getByText(/sortOrder: 1/)).toBeInTheDocument();
    expect(screen.getByText(/sortOrder: 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText("Route change approved.")).toBeInTheDocument();
    await waitFor(() => expect(onApproved).toHaveBeenCalled());
    expect(screen.getByText(/No manager route changes/)).toBeInTheDocument();
  });

  it("shows a clear stale warning instead of applying old assumptions", async () => {
    mocks.get.mockResolvedValue({ suggestions: [pending] });
    mocks.post.mockRejectedValue(new Error("STALE"));
    render(<ManagerRouteReviewQueue />);
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Official route changed; review again before approving.");
  });
});
