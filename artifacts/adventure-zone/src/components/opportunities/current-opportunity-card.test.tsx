import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiPatch, apiPost } from "@/lib/auth-token";
import { CurrentOpportunityCard } from "./current-opportunity-card";

vi.mock("@/lib/auth-token", () => ({ apiGet: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn() }));

const opportunity = {
  id: "10000000-0000-4000-8000-000000000001", eventYear: 2026,
  status: "follow_up", priority: "normal", nextActionKind: "email",
  nextActionDueAt: "2026-09-01T15:00:00.000Z", holdReason: null,
};

beforeEach(() => {
  vi.mocked(apiGet).mockResolvedValue({ opportunity, suggestedStatus: null });
  vi.mocked(apiPatch).mockResolvedValue({ opportunity, suggestedStatus: "interested" });
  vi.mocked(apiPost).mockResolvedValue({ opportunity: { ...opportunity, status: "interested" } });
});

describe("CurrentOpportunityCard", () => {
  it("shows current status, next action, and existing working actions", async () => {
    render(<CurrentOpportunityCard organizationId="20000000-0000-4000-8000-000000000001" year={2026} />);
    expect(await screen.findByText("Follow Up")).toBeInTheDocument();
    expect(screen.getByText(/Email/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Schedule follow-up" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Call" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add Note" })).toBeInTheDocument();
  });

  it("requires explicit approval before applying suggested interest", async () => {
    render(<CurrentOpportunityCard organizationId="20000000-0000-4000-8000-000000000001" year={2026} />);
    const status = await screen.findByLabelText("Status");
    fireEvent.change(status, { target: { value: "interested" } });
    expect(await screen.findByText("Suggested status: Interested")).toBeInTheDocument();
    expect(apiPatch).toHaveBeenCalledWith(expect.stringContaining("/opportunities/"), { status: "interested" });
    fireEvent.click(screen.getByRole("button", { name: "Apply suggestion" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(expect.stringContaining("apply-suggested-status"), { status: "interested" }));
  });
});
