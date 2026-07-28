// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FollowUpList } from "@/components/today/follow-up-list";
import { NextCallCard } from "@/components/today/next-call-card";
import { SummaryCards } from "@/components/today/summary-cards";
import type { FollowUpSummary } from "@/features/follow-ups/today-query";

afterEach(cleanup);

const now = new Date("2026-08-03T14:00:00Z");
const followUps: (FollowUpSummary & { contactId: string | null })[] = [
  {
    id: "overdue-call",
    contactId: "contact-1",
    bookingId: "booking-1",
    bookingName: "Overdue County Fair",
    kind: "call",
    dueAt: new Date("2026-08-02T16:00:00Z"),
    createdAt: new Date("2026-08-01T16:00:00Z"),
    status: "due",
    probability: "likely",
  },
];

describe("Today dashboard components", () => {
  it("keeps the overdue call list visibly labeled for the command center", () => {
    render(<FollowUpList followUps={followUps} now={now} />);

    expect(screen.getByRole("heading", { name: "Overdue follow-ups" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Overdue County Fair" })).toHaveAttribute(
      "href",
      "/calls/new?contactId=contact-1&bookingId=booking-1&followUpId=overdue-call",
    );
    expect(screen.getByText("1 overdue")).toBeVisible();
  });

  it("opens the next call in the Call Workspace with its complete context", () => {
    render(<NextCallCard followUp={followUps[0]!} />);

    expect(screen.getByRole("link", { name: "Overdue County Fair" })).toHaveAttribute(
      "href",
      "/calls/new?contactId=contact-1&bookingId=booking-1&followUpId=overdue-call",
    );
  });

  it("does not call a same-Chicago-day follow-up overdue after stored noon", () => {
    render(
      <FollowUpList
        followUps={[
          {
            ...followUps[0]!,
            id: "due-today",
            bookingName: "Due Today Fair",
            dueAt: new Date("2026-08-03T17:00:00Z"),
          },
        ]}
        now={new Date("2026-08-03T23:30:00Z")}
      />,
    );

    expect(screen.getByText("0 overdue")).toBeVisible();
    expect(screen.getByText("Due Aug 3, 2026")).toBeVisible();
  });

  it("renders all four command-center summary counts", () => {
    render(
      <SummaryCards
        contractCount={2}
        followUpCount={3}
        newLeadCount={4}
        routeWarningCount={0}
      />,
    );

    expect(screen.getByText("Follow-ups due")).toBeVisible();
    expect(screen.getByText("New leads")).toBeVisible();
    expect(screen.getByText("Contracts")).toBeVisible();
    expect(screen.getByText("Route warnings")).toBeVisible();
  });
});
