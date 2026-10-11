// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const apiGet = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth-token", () => ({ apiGet }));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import { DailyWorkspace } from "./daily-workspace";

afterEach(() => {
  cleanup();
  apiGet.mockReset();
});

describe("lead review workspace", () => {
  it("shows the leg recommendation and correction choices before follow-up actions", async () => {
    const assignment = {
      assignedLegId: null,
      suggestedLegId: "leg-north",
      source: "route_score" as const,
      explanation: "North route has the best fit.",
      warning: null,
      confidence: "medium" as const,
    };
    apiGet.mockResolvedValue({
      legAssignment: assignment,
      legAlternatives: [{
        legId: "leg-north",
        legName: "North route",
        confirmedEventCount: 3,
        priorYearMatch: false,
        eligible: true,
        previousStopDriveMinutes: 60,
        nextStopDriveMinutes: null,
        routeDriveMinutes: 60,
        warning: null,
        reason: "The confirmed route leaves enough travel and setup time.",
      }],
      allTravelLegs: [{ id: "leg-north", name: "North route" }, { id: "leg-south", name: "South route" }],
    });
    render(<DailyWorkspace
      queue={{ active: [], completedToday: [], needsAttention: [] } as any}
      followUps={[]}
      decisions={[{
        id: "booking-1",
        name: "Mountain Film Festival",
        organizationId: "profile-1",
        primaryContactId: null,
        city: "Aspen",
        region: "CO",
        status: "researching",
        startsAt: "2027-06-10",
        legAssignment: assignment,
      }]}
      travelLegs={[{ id: "leg-north", name: "North route" }, { id: "leg-south", name: "South route" }]}
      callingEnabled={false}
      onChanged={vi.fn().mockResolvedValue(undefined)}
      onClear={vi.fn().mockResolvedValue(undefined)}
      onSnooze={vi.fn().mockResolvedValue(undefined)}
      busy={false}
      leadsOnly
    />);

    const legSection = screen.getByRole("region", { name: "Leg assignment" });
    const followUp = screen.getByText("Follow-up path");
    await waitFor(() => expect(legSection).toHaveTextContent("North route"));
    const comparisons = await screen.findByRole("region", { name: "Active leg comparisons" });
    expect(comparisons).toHaveTextContent("3 confirmed events this season");
    expect(comparisons).toHaveTextContent("North route");
    expect(legSection.compareDocumentPosition(followUp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use suggested leg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule follow-up" })).toBeInTheDocument();
  });
});
