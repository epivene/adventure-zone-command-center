// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Today page", () => {
  it("renders operational warnings for bookings that need a follow-up plan", async () => {
    getTodayDashboard.mockResolvedValue({
      followUpCount: 0,
      newLeadCount: 1,
      contractCount: 0,
      visibleRouteWarningCount: 1,
      nextCall: null,
      followUps: [],
      followUpTotal: 0,
      followUpPage: 1,
      followUpPageCount: 1,
      needsFollowUpPlan: [{
        id: "booking-2",
        name: "Needs Plan Fair",
        status: "new_lead",
        probability: "possible",
        operations: {
          packageNames: ["Weekend Warriors"],
          sharedAttractionTotal: 5,
          pendingRequestCount: 1,
          leg: null,
          warnings: [{
            id: "route-warning",
            kind: "route",
            severity: "warning",
            message: "Transfer trip is missing.",
            href: "/bookings/booking-2/edit#resource-warnings",
          }],
        },
      }],
      needsFollowUpPlanTotal: 1,
      needsFollowUpPlanPage: 1,
      needsFollowUpPlanPageCount: 1,
      upcomingEvents: [],
    });

    render(await TodayPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("region", { name: "Follow-up queue" }),
    ).toBeVisible();
    const section = screen
      .getByRole("heading", { name: "Needs Follow-up Plan" })
      .closest("section");
    expect(section).not.toBeNull();
    expect(
      within(section!).getByText("1 package · 5 attractions"),
    ).toBeVisible();
    expect(
      within(section!).getByRole("link", {
        name: "Transfer trip is missing.",
      }),
    ).toHaveAttribute(
      "href",
      "/bookings/booking-2/edit#resource-warnings",
    );
  });
});
