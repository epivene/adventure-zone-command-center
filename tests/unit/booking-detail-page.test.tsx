// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  getBookingDetail,
  getForBooking,
  listTimeline,
} = vi.hoisted(() => ({
  getBookingDetail: vi.fn(),
  getForBooking: vi.fn(),
  listTimeline: vi.fn(),
}));

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/lib/auth/require-owner", () => ({
  requireOwner: vi.fn(async () => ({ userId: "owner-1" })),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));
vi.mock("@/features/bookings/booking-repository", () => ({
  DrizzleBookingRepository: class {
    getBookingDetail = getBookingDetail;
  },
}));
vi.mock("@/features/bookings/booking-operations-summary", () => ({
  createBookingOperationsSummaryProvider: () => ({ getForBooking }),
}));
vi.mock("@/features/activities/activity-repository", () => ({
  DrizzleActivityRepository: class {},
}));
vi.mock("@/features/activities/activity-service", () => ({
  ActivityService: class {
    listTimeline = listTimeline;
  },
}));
vi.mock("@/components/activities/activity-timeline", () => ({
  ActivityTimeline: () => <div />,
}));
vi.mock("@/components/bookings/follow-up-completion-dialog", () => ({
  FollowUpCompletionDialog: () => <div />,
}));
vi.mock("@/components/bookings/status-badge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));
vi.mock("@/components/organizations/last-resort-warning", () => ({
  LastResortWarning: () => <div />,
}));

import BookingDetailPage from "@/app/(private)/bookings/[bookingId]/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("booking detail page", () => {
  it("renders zero shared attractions and pending requests as numeric values", async () => {
    getBookingDetail.mockResolvedValue({
      booking: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Zero operations booking",
        status: "lead",
        city: "Shelby",
        region: "MT",
        venueName: null,
        startsAt: null,
        endsAt: null,
        address1: null,
        postalCode: null,
        probability: "possible",
        actRecordId: null,
        updatedAt: new Date("2026-07-29T12:00:00.000Z"),
        latitude: null,
        longitude: null,
        notes: null,
      },
      organization: null,
      contact: null,
      travelLeg: null,
      followUps: [],
      auditEntries: [],
    });
    getForBooking.mockResolvedValue({
      packageNames: [],
      sharedAttractionTotal: 0,
      pendingRequestCount: 0,
      leg: null,
      warnings: [],
    });
    listTimeline.mockResolvedValue([]);

    render(await BookingDetailPage({
      params: Promise.resolve({
        bookingId: "11111111-1111-4111-8111-111111111111",
      }),
    }));

    const section = screen
      .getByRole("heading", { name: "Packages and resources" })
      .closest("section");
    expect(section).not.toBeNull();

    for (const label of [
      "Shared physical attractions",
      "Pending special requests",
    ]) {
      const item = within(section!).getByText(label).parentElement;
      expect(item).not.toBeNull();
      expect(within(item!).getByText("0")).toBeVisible();
      expect(within(item!).queryByText("Not set")).not.toBeInTheDocument();
    }
  });
});
