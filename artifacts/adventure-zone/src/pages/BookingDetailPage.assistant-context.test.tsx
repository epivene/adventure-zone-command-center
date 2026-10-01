// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BookingDetailPage from "./BookingDetailPage";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(async (path: string) => {
    if (path.startsWith("/bookings/")) {
      return {
        booking: {
          id: "79bd6cf9-d08e-41c5-be49-7ed597021fb3",
          name: "Current booking",
          city: "Bismarck",
          region: "ND",
          status: "confirmed",
          startsAt: "2026-08-20T12:00:00.000Z",
          endsAt: "2026-08-20T18:00:00.000Z",
          venueName: "Fairgrounds",
          probability: 100,
        },
        organization: null,
        contact: null,
        travelLeg: null,
        timeline: [],
        packageHistoryComparison: null,
        followUps: [],
      };
    }
    if (path.startsWith("/event-wrap-up-admin/")) return { wrapUp: null };
    return {};
  }),
  openAssistant: vi.fn(),
  setPageContext: vi.fn(),
  clearPageContext: vi.fn(),
}));

vi.mock("@/lib/auth-token", () => ({ apiGet: mocks.apiGet, apiFetch: vi.fn(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })) }));
vi.mock("@/features/assistant/assistant-context", () => ({
  useAssistantContext: () => ({
    openAssistant: mocks.openAssistant,
    setPageContext: mocks.setPageContext,
    clearPageContext: mocks.clearPageContext,
  }),
}));
vi.mock("@/features/assistant/assistant-api", () => ({
  getAssistantContext: vi.fn(async () => null),
  getBookingBrief: vi.fn(async () => null),
}));
vi.mock("@/components/activities/activity-timeline", () => ({ ActivityTimeline: () => <div>Timeline</div> }));
vi.mock("@/components/bookings/follow-up-completion-dialog", () => ({ FollowUpCompletionDialog: () => null }));
vi.mock("@/components/bookings/package-history-signals", () => ({ PackageHistorySignals: () => null }));
vi.mock("@/components/assistant/booking-brief-card", () => ({ BookingBriefCard: () => null }));
vi.mock("@/components/bookings/status-badge", () => ({ StatusBadge: () => <span>Confirmed</span> }));
vi.mock("@/components/organizations/last-resort-warning", () => ({ LastResortWarning: () => null }));
vi.mock("@/components/follow-ups/follow-up-controls", () => ({ FollowUpControls: () => null }));
vi.mock("@/actions/activities", () => ({
  createActivityAction: vi.fn(), deleteActivityAction: vi.fn(), editActivityAction: vi.fn(), listActivityRevisionsAction: vi.fn(),
}));
vi.mock("@/actions/bookings", () => ({ completeFollowUpAction: vi.fn() }));
vi.mock("@/actions/follow-ups", () => ({ deleteFollowUpAction: vi.fn(), editFollowUpAction: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("BookingDetailPage assistant context", () => {
  it("renders with the current assistant context API and registers the booking page context", async () => {
    render(<BookingDetailPage bookingId="79bd6cf9-d08e-41c5-be49-7ed597021fb3" />);
    expect(await screen.findByText("Current booking")).toBeInTheDocument();
    expect(mocks.setPageContext).toHaveBeenCalledWith(expect.objectContaining({
      kind: "booking",
      recordId: "79bd6cf9-d08e-41c5-be49-7ed597021fb3",
      label: "Current booking",
    }));
  });
});
