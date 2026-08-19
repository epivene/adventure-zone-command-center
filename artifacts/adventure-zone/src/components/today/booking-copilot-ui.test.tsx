import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-token", () => ({ apiGet }));

import { CallQueueWorkspace, type CallQueueItem } from "./call-queue-workspace";

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

const followUp: CallQueueItem = {
  id: "60000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  contactId: "20000000-0000-4000-8000-000000000001",
  bookingId: "30000000-0000-4000-8000-000000000001",
  bookingName: "River Days",
  contactName: "Sarah Miller",
  organizationName: "River Days Committee",
  bookingStatus: "pending_contract",
  routeLeg: null,
  lastContactedAt: "2026-08-01T15:00:00.000Z",
  kind: "call",
  dueAt: "2026-08-15T15:00:00.000Z",
  status: "due",
  copilot: {
    priority: "urgent",
    headline: "Overdue follow-up",
    reasons: [
      "This follow-up is overdue.",
      "Contract paperwork is still in progress.",
    ],
  },
};

describe("Booking Copilot outreach UI", () => {
  it("shows why the caller is next and a deterministic before-contact brief", async () => {
    apiGet.mockResolvedValue({
      brief: {
        headline: "Booking brief — River Days",
        generatedAt: "2026-08-18T18:00:00.000Z",
        items: [
          {
            key: "package_history",
            text: "They usually book Adventure Zone + Paintball.",
            confidence: "high",
            sourceIds: ["booking:prior"],
          },
          {
            key: "contact",
            text: "Sarah Miller is the main contact saved for this profile.",
            confidence: "high",
            sourceIds: ["contact:sarah"],
          },
        ],
      },
    });

    render(
      <CallQueueWorkspace
        followUps={[followUp]}
        loadWorkspace={() => new Promise(() => {})}
        renderWorkspace={() => null}
      />,
    );

    expect(screen.getAllByText("Why this is next").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Overdue follow-up").length).toBeGreaterThan(0);
    expect(screen.getAllByText("This follow-up is overdue.").length).toBeGreaterThan(0);
    expect(screen.getByText("Before you contact them")).toBeVisible();
    expect(await screen.findByText("They usually book Adventure Zone + Paintball.")).toBeVisible();
    expect(screen.getByText(/Ask whether they want to repeat their usual package mix/i)).toBeVisible();
    expect(apiGet).toHaveBeenCalledWith(
      `/assistant/brief?kind=booking&id=${followUp.bookingId}`,
    );
  });

  it("keeps the call workflow usable when the brief cannot load", async () => {
    apiGet.mockRejectedValue(new Error("offline"));

    render(
      <CallQueueWorkspace
        followUps={[followUp]}
        loadWorkspace={() => new Promise(() => {})}
        renderWorkspace={() => null}
      />,
    );

    expect(await screen.findByText(/You can still continue with the call/i)).toBeVisible();
    expect(screen.getByText("Sarah Miller")).toBeVisible();
  });
});
