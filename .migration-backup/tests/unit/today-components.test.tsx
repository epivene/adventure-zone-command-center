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
    organizationId: "organization-1",
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
  it("surfaces package totals, pending requests, and operational warnings in the queue and next call", () => {
    const operations = {
      packageNames: ["Adventure Zone", "Weekend Warriors"],
      sharedAttractionTotal: 11,
      pendingRequestCount: 1,
      leg: null,
      warnings: [{
        id: "overlap",
        kind: "resource" as const,
        severity: "blocking" as const,
        message: "Paintball overlaps another event.",
        href: "/bookings/booking-1/edit#resource-warnings",
      }],
    };
    render(
      <>
        <FollowUpList
          followUps={[{ ...followUps[0]!, operations }]}
          now={now}
        />
        <NextCallCard followUp={{ ...followUps[0]!, operations }} />
      </>,
    );

    expect(screen.getAllByText("2 packages · 11 attractions")).toHaveLength(2);
    expect(screen.getAllByText("1 pending request")).toHaveLength(2);
    expect(screen.getAllByRole("link", {
      name: "Paintball overlaps another event.",
    })).toHaveLength(2);
  });
  it("keeps the overdue call list visibly labeled for the command center", () => {
    render(<FollowUpList followUps={followUps} now={now} />);

    expect(screen.getByRole("heading", { name: "Overdue follow-ups" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Overdue County Fair" })).toHaveAttribute(
      "href",
      "/event-profiles/organization-1?contactId=contact-1&bookingId=booking-1&followUpId=overdue-call&action=follow-up",
    );
    expect(screen.getByText("1 overdue")).toBeVisible();
  });

  it("opens the next call in the event profile with its complete context", () => {
    render(<NextCallCard followUp={followUps[0]!} />);

    expect(screen.getByRole("link", { name: "Overdue County Fair" })).toHaveAttribute(
      "href",
      "/event-profiles/organization-1?contactId=contact-1&bookingId=booking-1&followUpId=overdue-call&action=call",
    );
  });

  it("opens a non-call booking follow-up in its event profile", () => {
    render(
      <FollowUpList
        followUps={[{ ...followUps[0]!, kind: "send_information" }]}
        now={now}
      />,
    );

    expect(screen.getByRole("link", { name: "Overdue County Fair" })).toHaveAttribute(
      "href",
      "/event-profiles/organization-1?contactId=contact-1&bookingId=booking-1&followUpId=overdue-call&action=follow-up",
    );
  });

  it("opens a contact-only follow-up in its profile without inventing a booking", () => {
    render(
      <FollowUpList
        followUps={[
          {
            ...followUps[0]!,
            bookingId: null,
            bookingName: "Jordan Caller",
          },
        ]}
        now={now}
      />,
    );

    expect(screen.getByRole("link", { name: "Jordan Caller" })).toHaveAttribute(
      "href",
      "/event-profiles/organization-1?contactId=contact-1&followUpId=overdue-call&action=follow-up",
    );
  });

  it("opens an organization-only non-call follow-up in its event profile", () => {
    render(
      <FollowUpList
        followUps={[
          {
            ...followUps[0]!,
            contactId: null,
            bookingId: null,
            bookingName: "County Fair Office",
            kind: "send_information",
          },
        ]}
        now={now}
      />,
    );

    expect(screen.getByRole("link", { name: "County Fair Office" })).toHaveAttribute(
      "href",
      "/event-profiles/organization-1?followUpId=overdue-call&action=follow-up",
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
        visibleRouteWarningCount={0}
      />,
    );

    expect(screen.getByText("Follow-ups due")).toBeVisible();
    expect(screen.getByText("New leads")).toBeVisible();
    expect(screen.getByText("Contracts")).toBeVisible();
    expect(screen.getByText("Visible route warnings")).toBeVisible();
  });
});
