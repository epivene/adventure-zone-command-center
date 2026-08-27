import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet, apiPost } from "@/lib/auth-token";
import { ReadyToSendSection } from "./ready-to-send-section";

vi.mock("@/lib/auth-token", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));

const summary = {
  total: 3,
  newOutreach: 1,
  followUps: 1,
  replies: 1,
  items: [
    {
      draftId: "30000000-0000-4000-8000-000000000001",
      opportunityId: "10000000-0000-4000-8000-000000000001",
      organizationId: "20000000-0000-4000-8000-000000000001",
      eventName: "Sample Fair",
      recipientEmail: "fair@example.com",
      recipientName: "Casey",
      purpose: "new_outreach",
      opportunityStatus: "ready_to_contact",
      state: "draft",
      scheduledFor: null,
      warning: null,
    },
    {
      draftId: "30000000-0000-4000-8000-000000000002",
      opportunityId: "10000000-0000-4000-8000-000000000002",
      organizationId: "20000000-0000-4000-8000-000000000002",
      eventName: "Second Festival",
      recipientEmail: "festival@example.com",
      recipientName: null,
      purpose: "follow_up",
      opportunityStatus: "follow_up",
      state: "draft",
      scheduledFor: null,
      warning: null,
    },
    {
      draftId: "30000000-0000-4000-8000-000000000003",
      opportunityId: "10000000-0000-4000-8000-000000000003",
      organizationId: "20000000-0000-4000-8000-000000000003",
      eventName: "Reply Event",
      recipientEmail: "reply@example.com",
      recipientName: "Morgan",
      purpose: "reply",
      opportunityStatus: "contacted",
      state: "failed",
      scheduledFor: null,
      warning: "Previous send failed",
    },
  ],
};

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiGet).mockResolvedValue({ ok: true, summary });
  vi.mocked(apiPost).mockResolvedValue({ ok: true, results: [] });
});

async function openOutbox() {
  const button = await screen.findByRole("button", { name: /Ready to Send/ });
  fireEvent.click(button);
  return button;
}

describe("ReadyToSendSection", () => {
  it("loads collapsed with total and purpose counts, then expands rows", async () => {
    render(<ReadyToSendSection now={() => new Date("2026-08-27T15:00:00.000Z")} />);

    const summaryButton = await screen.findByRole("button", { name: /Ready to Send/ });
    expect(summaryButton).toHaveTextContent("3");
    expect(screen.getByText(/1 new outreach/i)).toBeInTheDocument();
    expect(screen.getByText(/1 follow-up/i)).toBeInTheDocument();
    expect(screen.getByText(/1 reply/i)).toBeInTheDocument();
    expect(screen.queryByText("Sample Fair")).not.toBeInTheDocument();

    fireEvent.click(summaryButton);
    expect(await screen.findByText("Sample Fair")).toBeInTheDocument();
    expect(screen.getByText("Second Festival")).toBeInTheDocument();
    expect(screen.getByText("Reply Event")).toBeInTheDocument();
  });

  it("sends only selected rows and refreshes after per-item outcomes", async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ ok: true, summary })
      .mockResolvedValueOnce({ ok: true, summary: { ...summary, total: 2, items: summary.items.slice(1) } });
    vi.mocked(apiPost).mockResolvedValue({
      ok: true,
      results: [{ draftId: summary.items[0].draftId, ok: true }],
    });

    render(<ReadyToSendSection now={() => new Date("2026-08-27T15:00:00.000Z")} />);
    await openOutbox();
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Sample Fair/ }));
    fireEvent.click(screen.getByRole("button", { name: "Send now" }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/today/ready-to-send/send", {
      items: [{
        draftId: summary.items[0].draftId,
        opportunityId: summary.items[0].opportunityId,
        requestKey: expect.stringMatching(/^send:/),
      }],
    }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /Ready to Send/ })).toHaveTextContent("2");
  });

  it("previews Tomorrow morning before confirming schedule", async () => {
    render(<ReadyToSendSection now={() => new Date("2026-08-27T15:00:00.000Z")} />);
    await openOutbox();
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Sample Fair/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow morning" }));

    expect(screen.getByText(/Schedule preview/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Sample Fair/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Confirm schedule" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm schedule" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/today/ready-to-send/schedule", {
      items: [{
        draftId: summary.items[0].draftId,
        opportunityId: summary.items[0].opportunityId,
        requestKey: expect.stringMatching(/^schedule:/),
        scheduledFor: expect.any(String),
      }],
    }));
  });

  it("spreads Morning stagger across selected rows and previews each send time", async () => {
    render(<ReadyToSendSection now={() => new Date("2026-08-27T15:00:00.000Z")} />);
    await openOutbox();
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Sample Fair/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Second Festival/ }));
    fireEvent.click(screen.getByRole("button", { name: "Morning stagger" }));

    expect(screen.getByText(/Schedule preview/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Sample Fair|Second Festival/)).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Confirm schedule" }));

    await waitFor(() => {
      const call = vi.mocked(apiPost).mock.calls.find(([path]) => path === "/today/ready-to-send/schedule");
      expect(call).toBeTruthy();
      const payload = call?.[1] as { items: Array<{ scheduledFor: string }> };
      expect(payload.items).toHaveLength(2);
      expect(payload.items[0].scheduledFor).not.toBe(payload.items[1].scheduledFor);
    });
  });

  it("supports Pick date & time with preview before scheduling", async () => {
    render(<ReadyToSendSection now={() => new Date("2026-08-27T15:00:00.000Z")} />);
    await openOutbox();
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Reply Event/ }));
    fireEvent.change(screen.getByLabelText("Outbox schedule date and time"), {
      target: { value: "2026-09-03T10:15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pick date & time" }));

    expect(screen.getByText(/Schedule preview/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm schedule" }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith("/today/ready-to-send/schedule", {
      items: [{
        draftId: summary.items[2].draftId,
        opportunityId: summary.items[2].opportunityId,
        requestKey: expect.stringMatching(/^schedule:/),
        scheduledFor: new Date("2026-09-03T10:15").toISOString(),
      }],
    }));
  });
});
