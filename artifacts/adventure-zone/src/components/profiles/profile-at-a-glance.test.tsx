import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProfileAtAGlance } from "./profile-at-a-glance";

describe("ProfileAtAGlance", () => {
  it("shows decision facts and truthful empty states", () => {
    render(
      <ProfileAtAGlance
        profile={{
          place: {
            name: "Prairie Days",
            applicationDeadline: null,
            recommendedDealModel: null,
          },
          contacts: [],
          bookings: [],
          followUps: [],
          decisionSummary: {
            priority: null,
            pipelineStatus: "researching",
            nextActionKind: null,
            nextActionDueAt: null,
          },
        }}
      />,
    );

    expect(screen.getByText("Date not published")).toBeVisible();
    expect(screen.getByText("No deadline recorded")).toBeVisible();
    expect(screen.getByText("No recommendation recorded")).toBeVisible();
    expect(screen.getByText("No next action recorded")).toBeVisible();
    expect(screen.getByText("No primary contact")).toBeVisible();
  });

  it("uses the primary contact and the earliest future event date", () => {
    render(
      <ProfileAtAGlance
        profile={{
          place: {
            name: "Prairie Days",
            applicationDeadline: "2027-01-15",
            recommendedDealModel: "pay_per_play",
          },
          contacts: [
            {
              id: "c1",
              name: "Jamie Rivers",
              isPrimary: true,
              email: "jamie@example.com",
              phone: "555-0100",
            },
          ],
          bookings: [
            { id: "old", startsAt: "2025-01-01", status: "completed" },
            { id: "next", startsAt: "2027-04-12", status: "possible" },
          ],
          followUps: [],
          decisionSummary: {
            priority: "high",
            pipelineStatus: "follow_up",
            nextActionKind: "Send proposal",
            nextActionDueAt: "2026-10-01T12:00:00Z",
          },
        }}
        now={new Date("2026-09-12T00:00:00Z")}
      />,
    );

    expect(screen.getByText("Pay-per-play")).toBeVisible();
    expect(screen.getByText(/without an appearance fee/)).toBeVisible();
    expect(screen.getByText(/proven high-attendance shows/)).toBeVisible();
    expect(screen.getByText("Jamie Rivers")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "jamie@example.com" }),
    ).toHaveAttribute("href", "mailto:jamie@example.com");
    expect(screen.getByText(/Apr 12, 2027/)).toBeVisible();
  });
});
