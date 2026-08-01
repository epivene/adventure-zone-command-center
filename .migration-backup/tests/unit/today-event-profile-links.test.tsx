// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const getTodayDashboard = vi.hoisted(() => vi.fn());

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: vi.fn(async () => ({ userId: "owner-1" })),
}));
vi.mock("@/features/bookings/booking-operations-summary", () => ({
  createBookingOperationsSummaryProvider: () => ({}),
}));
vi.mock("@/features/follow-ups/today-query", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/features/follow-ups/today-query")
  >();
  return { ...actual, getTodayDashboard };
});

import TodayPage from "@/app/(private)/today/page";
import { FollowUpList } from "@/components/today/follow-up-list";
import { NextCallCard } from "@/components/today/next-call-card";
import type { FollowUpSummary } from "@/features/follow-ups/today-query";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const now = new Date("2026-08-03T14:00:00.000Z");
const followUp: FollowUpSummary = {
  id: "follow-up-1",
  organizationId: "organization-1",
  contactId: "contact-1",
  bookingId: "booking-1",
  bookingName: "County Fair",
  kind: "call",
  dueAt: new Date("2026-08-03T16:00:00.000Z"),
  createdAt: new Date("2026-08-01T16:00:00.000Z"),
  status: "due",
  probability: "likely",
};

describe("Today event profile links", () => {
  it("opens the next call in its event profile with the selected call context", () => {
    render(<NextCallCard followUp={followUp} />);

    expect(screen.getByRole("link", { name: "County Fair" })).toHaveAttribute(
      "href",
      "/event-profiles/organization-1?contactId=contact-1&bookingId=booking-1&followUpId=follow-up-1&action=call",
    );
  });

  it("opens due follow-ups in their event profile with the selected follow-up", () => {
    render(<FollowUpList followUps={[followUp]} now={now} />);

    expect(screen.getByRole("link", { name: "County Fair" })).toHaveAttribute(
      "href",
      "/event-profiles/organization-1?contactId=contact-1&bookingId=booking-1&followUpId=follow-up-1&action=follow-up",
    );
  });

  it("opens a new lead in prospect mode and an upcoming event with its booking selected", async () => {
    getTodayDashboard.mockResolvedValue({
      followUpCount: 1,
      newLeadCount: 1,
      contractCount: 0,
      visibleRouteWarningCount: 0,
      nextCall: null,
      followUps: [],
      followUpTotal: 0,
      followUpPage: 1,
      followUpPageCount: 1,
      needsFollowUpPlan: [{
        id: "booking-2",
        organizationId: "organization-2",
        primaryContactId: "contact-2",
        name: "New Lead Festival",
        status: "new_lead",
        probability: "possible",
      }],
      needsFollowUpPlanTotal: 1,
      needsFollowUpPlanPage: 1,
      needsFollowUpPlanPageCount: 1,
      upcomingEvents: [{
        id: "booking-3",
        organizationId: "organization-3",
        primaryContactId: "contact-3",
        name: "Upcoming Expo",
        city: "Helena",
        region: "MT",
        startsAt: new Date("2026-08-09T16:00:00.000Z"),
      }],
    });

    render(await TodayPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("link", { name: "New Lead Festival" })).toHaveAttribute(
      "href",
      "/event-profiles/organization-2?contactId=contact-2&bookingId=booking-2&mode=prospect",
    );
    expect(screen.getByRole("link", { name: "Upcoming Expo" })).toHaveAttribute(
      "href",
      "/event-profiles/organization-3?contactId=contact-3&bookingId=booking-3",
    );
    expect(screen.getByRole("link", { name: "New leads" })).toHaveAttribute(
      "href",
      "/event-profiles/organization-2?contactId=contact-2&bookingId=booking-2&mode=prospect",
    );
  });
});
