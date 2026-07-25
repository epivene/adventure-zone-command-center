// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FollowUpList } from "@/components/today/follow-up-list";
import { SummaryCards } from "@/components/today/summary-cards";
import type { FollowUpSummary } from "@/features/follow-ups/today-query";

afterEach(cleanup);

const now = new Date("2026-08-03T14:00:00Z");
const followUps: FollowUpSummary[] = [
  {
    id: "overdue-call",
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
    expect(screen.getByRole("link", { name: "Overdue County Fair" })).toBeVisible();
    expect(screen.getByText("1 overdue")).toBeVisible();
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
