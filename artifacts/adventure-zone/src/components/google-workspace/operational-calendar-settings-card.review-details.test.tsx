import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OperationalCalendarSettingsCard } from "./operational-calendar-settings-card";

const getStatus = vi.hoisted(() => vi.fn());

vi.mock("@/features/google-workspace/operational-calendar-client", () => ({
  getOperationalCalendarStatus: getStatus,
  startOperationalCalendarOAuth: vi.fn(),
  disconnectOperationalCalendar: vi.fn(),
  importOperationalCalendar: vi.fn(),
  decideOperationalCalendarReview: vi.fn(),
}));

describe("OperationalCalendarSettingsCard review details", () => {
  beforeEach(() => {
    getStatus.mockReset();
  });

  it("shows the actual Google event details instead of only the opaque Google event id", async () => {
    getStatus.mockResolvedValue({
      connection: {
        id: "conn-1",
        email: "theadventurezone12@gmail.com",
        role: "operational_calendar",
        operationalCalendarId: "primary",
        status: "connected",
        lastErrorCode: null,
      },
      pendingReviewCount: 1,
      reviews: [
        {
          id: "review-1",
          bookingId: null,
          calendarId: "primary",
          googleEventId: "opaque-google-id",
          reason: "Calendar row needs manual matching",
          state: "pending",
          createdAt: "2026-08-28T18:00:00.000Z",
          proposedChanges: {
            parsed: {
              managerToken: "MIKEY",
              eventName: "Blanding City Fall Festival",
              city: "Blanding",
              region: "UT",
              packageKey: "zone",
              actualEventDateText: "Saturday, September 12th",
              contactText: "Shauna, (435) 485-1018",
              addressText: "735 S 200 W Ste 1",
            },
            google: {
              summary: "MIKEY Blanding City Fall Festival Blanding UT (Zone)",
              description: "CONTACT: Shauna, (435) 485-1018\nEVENT DATES: Saturday, September 12th",
              startDate: "2026-09-10",
              endDateExclusive: "2026-09-14",
            },
            candidateBookingIds: ["booking-a", "booking-b"],
          },
        },
      ],
    });

    render(<OperationalCalendarSettingsCard />);

    expect(await screen.findByText("MIKEY Blanding City Fall Festival Blanding UT (Zone)")).toBeInTheDocument();
    expect(screen.getByText(/Blanding, UT/)).toBeInTheDocument();
    expect(screen.getByText(/Sep 10.*Sep 13/i)).toBeInTheDocument();
    expect(screen.getByText("Actual event date:").parentElement).toHaveTextContent("Saturday, September 12th");
    expect(screen.getByText(/Shauna/)).toBeInTheDocument();
    expect(screen.getByText(/2 possible app matches/i)).toBeInTheDocument();
    expect(screen.queryByText("Google event: opaque-google-id")).not.toBeInTheDocument();
  });
});
