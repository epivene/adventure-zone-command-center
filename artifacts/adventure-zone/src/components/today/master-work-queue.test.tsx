import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiPost } from "@/lib/auth-token";
import type { MasterTodayQueue, MasterWorkItem } from "@/features/today/master-work-types";
import { MasterWorkQueue } from "./master-work-queue";

vi.mock("@/lib/auth-token", () => ({ apiPost: vi.fn(async () => ({ ok: true })) }));

const base: MasterWorkItem = {
  id: "work-1", sourceId: "source-1", sourceType: "opportunity",
  opportunityId: "10000000-0000-4000-8000-000000000001",
  organizationId: "20000000-0000-4000-8000-000000000001",
  bookingId: null, contactId: null, eventName: "Sample Fair", city: "Denver", region: "CO",
  kind: "follow_up", reason: "Follow-up is due", dueAt: "2026-08-26T15:00:00.000Z",
  opportunityStatus: "follow_up", priority: "normal", pinned: false,
  manualOrder: null, completedAt: null, outcome: null,
};
const item = (id: string, patch: Partial<MasterWorkItem> = {}): MasterWorkItem => ({ ...base, id, sourceId: id, ...patch });
const queue: MasterTodayQueue = {
  needsAttention: [item("attention", { kind: "reply", reason: "New reply needs attention" })],
  active: [item("active-1"), item("active-2", { eventName: "Second Fair", opportunityId: "10000000-0000-4000-8000-000000000002" })],
  completedToday: [item("done", { completedAt: "2026-08-26T16:00:00.000Z", outcome: "Sent proposal" })],
};

beforeEach(() => { vi.mocked(apiPost).mockClear(); sessionStorage.clear(); });

describe("MasterWorkQueue", () => {
  it("renders sections in approved order and preserves server active order", () => {
    const { container } = render(<MasterWorkQueue queue={queue} onChanged={vi.fn(async () => undefined)} />);
    expect(screen.getAllByRole("heading").slice(0, 2).map((node) => node.textContent)).toEqual(["Needs Attention", "Active Queue"]);
    expect([...container.querySelectorAll("article[data-work-item-id]")].map((node) => node.getAttribute("data-work-item-id"))).toEqual(["active-1", "active-2"]);
  });

  it("calls queue-control endpoints", async () => {
    const { container } = render(<MasterWorkQueue queue={queue} onChanged={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Pin" })[0]!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(expect.stringContaining("/pin"), expect.anything()));
    fireEvent.click(screen.getAllByRole("button", { name: "Urgent" })[0]!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(expect.stringContaining("/urgent"), expect.anything()));
    fireEvent.click(screen.getAllByRole("button", { name: "Snooze 1 day" })[0]!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith(expect.stringContaining("/snooze"), expect.anything()));
    const rows = container.querySelectorAll("article[data-work-item-id]");
    fireEvent.dragStart(rows[0]!); fireEvent.dragOver(rows[1]!); fireEvent.drop(rows[1]!);
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/today/work/reorder", expect.anything()));
    fireEvent.click(screen.getByRole("button", { name: "Reset to smart order" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/today/work/reset-order", expect.anything()));
  });

  it("collapses completed work and links master items to full profiles", () => {
    const { container } = render(<MasterWorkQueue queue={queue} onChanged={vi.fn(async () => undefined)} />);
    const details = screen.getByText(/Completed Today/).closest("details");
    expect(details?.open).toBe(false);
    fireEvent.click(screen.getByText(/Completed Today/));
    expect(screen.getByText("Sent proposal")).toBeInTheDocument();
    expect(container.querySelector('a[data-master-work="true"]')?.getAttribute("href")).toContain("from=today");
  });
});
