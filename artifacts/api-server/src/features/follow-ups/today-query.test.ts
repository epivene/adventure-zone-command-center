import { describe, expect, it } from "vitest";

import type { BookingOperationsSummary } from "@/features/bookings/booking-operations-summary";
import type { RenewalItem } from "./renewal-query";
import {
  currentSeasonPlanStatuses,
  getTodayDashboard,
  type TodayDashboardBookingRecord,
  type TodayDashboardFollowUpRow,
  type TodayDashboardRepository,
} from "./today-query";

const now = new Date("2026-08-15T03:00:00.000Z");

const currentBooking: TodayDashboardBookingRecord = {
  id: "30000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000001",
  primaryContactId: "20000000-0000-4000-8000-000000000001",
  name: "Current Fair Lead",
  city: "Bismarck",
  region: "ND",
  startsAt: new Date("2026-09-20T17:00:00.000Z"),
  status: "new_lead",
  probability: "possible",
  createdAt: new Date("2026-08-01T17:00:00.000Z"),
  updatedAt: new Date("2026-08-01T17:00:00.000Z"),
};

const pastConfirmedBooking: TodayDashboardBookingRecord = {
  id: "30000000-0000-4000-8000-000000000004",
  organizationId: "10000000-0000-4000-8000-000000000004",
  primaryContactId: "20000000-0000-4000-8000-000000000004",
  name: "Eastern Montana Fair",
  city: "Sidney",
  region: "MT",
  startsAt: new Date("2026-08-10T17:00:00.000Z"),
  endsAt: new Date("2026-08-12T23:00:00.000Z"),
  status: "confirmed",
  probability: "possible",
  createdAt: new Date("2026-06-01T17:00:00.000Z"),
  updatedAt: new Date("2026-08-12T23:00:00.000Z"),
};

const renewalSoon: RenewalItem = {
  id: "30000000-0000-4000-8000-000000000002",
  organizationId: "10000000-0000-4000-8000-000000000002",
  primaryContactId: "20000000-0000-4000-8000-000000000002",
  name: "County Fair Renewal",
  status: "renewal_due",
  probability: "possible",
  followUpId: "40000000-0000-4000-8000-000000000002",
  dueAt: new Date("2026-08-30T17:00:00.000Z"),
  attention: "soon",
};

const renewalLater: RenewalItem = {
  id: "30000000-0000-4000-8000-000000000003",
  organizationId: "10000000-0000-4000-8000-000000000003",
  primaryContactId: null,
  name: "Spring Festival Renewal",
  status: "completed",
  probability: "possible",
  followUpId: "40000000-0000-4000-8000-000000000003",
  dueAt: new Date("2026-11-01T17:00:00.000Z"),
  attention: "later",
};

function repository(
  overrides: Partial<TodayDashboardRepository> = {},
): TodayDashboardRepository {
  return {
    async getCounts() {
      return { followUpCount: 0, newLeadCount: 1, contractCount: 0 };
    },
    async listOpenFollowUps() {
      return { records: [], total: 0, page: 1 };
    },
    async findNextCall() {
      return null;
    },
    async listNeedsFollowUpPlan() {
      return { records: [currentBooking], total: 1, page: 1 };
    },
    async listUpcomingEvents() {
      return [];
    },
    async listRenewals() {
      return [renewalSoon, renewalLater];
    },
    ...overrides,
  } as TodayDashboardRepository;
}

describe("Today renewal separation", () => {
  it("uses the profile contact when an organization follow-up has no explicit contact", async () => {
    const profileContactId = "20000000-0000-4000-8000-000000000009";
    const followUpRow = {
      booking: null,
      contact: {
        id: profileContactId,
        organizationId: null,
        firstName: "Ada",
        lastName: "Organizer",
      },
      followUp: {
        id: "40000000-0000-4000-8000-000000000009",
        organizationId: "10000000-0000-4000-8000-000000000009",
        contactId: null,
        bookingId: null,
        kind: "call",
        dueAt: new Date("2026-08-14T15:00:00.000Z"),
        completedAt: null,
        createdAt: new Date("2026-08-01T15:00:00.000Z"),
      },
      organization: { name: "Profile-linked Festival" },
      lastContactedAt: null,
    } as unknown as TodayDashboardFollowUpRow;

    const result = await getTodayDashboard(
      now,
      repository({
        async listOpenFollowUps() {
          return { records: [followUpRow], total: 1, page: 1 };
        },
      }),
    );

    expect(result.followUps[0]).toEqual(
      expect.objectContaining({
        organizationId: followUpRow.followUp.organizationId,
        contactId: profileContactId,
        contactName: "Ada Organizer",
        organizationName: "Profile-linked Festival",
      }),
    );
  });

  it("keeps renewal_due out of Needs Follow-up Plan statuses", () => {
    expect(currentSeasonPlanStatuses).not.toContain("renewal_due");
    expect(currentSeasonPlanStatuses).toContain("new_lead");
  });

  it("returns current-season plan work and renewals as separate collections", async () => {
    const result = await getTodayDashboard(now, repository());

    expect(result.needsFollowUpPlan.map((item) => item.id)).toEqual([
      currentBooking.id,
    ]);
    expect(result.needsFollowUpPlan[0]?.planReason).toBe("needs_action");
    expect(result.renewals.map((item) => item.id)).toEqual([
      renewalSoon.id,
      renewalLater.id,
    ]);
    expect(result.renewalTotal).toBe(2);
    expect(result.renewalProminentCount).toBe(1);
    expect(result.renewalError).toBeNull();
  });

  it("labels a past confirmed booking as post-event work", async () => {
    const result = await getTodayDashboard(
      now,
      repository({
        async listNeedsFollowUpPlan() {
          return {
            records: [currentBooking, pastConfirmedBooking],
            total: 2,
            page: 1,
          };
        },
      }),
    );

    expect(result.needsFollowUpPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: currentBooking.id,
          planReason: "needs_action",
        }),
        expect.objectContaining({
          id: pastConfirmedBooking.id,
          status: "confirmed",
          planReason: "post_event",
        }),
      ]),
    );
  });

  it("isolates a renewal-load failure from the primary Today dashboard", async () => {
    const result = await getTodayDashboard(
      now,
      repository({
        async listRenewals() {
          throw new Error("renewal database unavailable");
        },
      }),
    );

    expect(result.needsFollowUpPlan).toHaveLength(1);
    expect(result.renewals).toEqual([]);
    expect(result.renewalTotal).toBe(0);
    expect(result.renewalProminentCount).toBe(0);
    expect(result.renewalError).toBe("Could not load next-season renewals.");
  });

  it("enriches renewal operations and keeps route warnings deduplicated", async () => {
    const sharedRouteWarning = {
      id: "route-warning-shared",
      kind: "route" as const,
      severity: "warning" as const,
      message: "Route needs review",
      href: "/routes",
    };
    const currentSummary: BookingOperationsSummary = {
      packageNames: [],
      sharedAttractionTotal: null,
      pendingRequestCount: 0,
      leg: null,
      warnings: [sharedRouteWarning],
    };
    const renewalSummary: BookingOperationsSummary = {
      packageNames: ["Adventure Zone"],
      sharedAttractionTotal: 10,
      pendingRequestCount: 0,
      leg: null,
      warnings: [sharedRouteWarning],
    };

    const summaries = new Map<string, BookingOperationsSummary>([
      [currentBooking.id, currentSummary],
      [renewalSoon.id, renewalSummary],
      [renewalLater.id, renewalSummary],
    ]);
    const provider = {
      async getForBooking(bookingId: string) {
        return summaries.get(bookingId) ?? currentSummary;
      },
      async getForBookings(bookingIds: readonly string[]) {
        return new Map(
          bookingIds.map((bookingId) => [
            bookingId,
            summaries.get(bookingId) ?? currentSummary,
          ]),
        );
      },
    };

    const result = await getTodayDashboard(now, repository(), {}, provider);

    expect(result.renewals[0]?.operations).toEqual(renewalSummary);
    expect(result.visibleRouteWarningCount).toBe(1);
  });
});
