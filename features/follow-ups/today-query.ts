import { asc, eq, isNull } from "drizzle-orm";

import { bookings, contacts, followUps, organizations } from "@/db/schema";
import type { BookingStatus, Probability } from "@/features/bookings/booking-types";
import { needsFollowUpPlan } from "@/features/follow-ups/follow-up-policy";
import {
  businessDayBounds,
  classifyBusinessDueDate,
  isFutureBusinessDate,
} from "@/lib/business-date";

export type FollowUpPriorityStatus = "due" | "deadline" | "quiet_lead" | "other";

export type FollowUpSummary = {
  id: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  bookingName: string;
  kind: string;
  dueAt: Date;
  createdAt: Date;
  status: FollowUpPriorityStatus;
  probability: Probability;
};

export type TodayDashboardBookingRecord = {
  id: string;
  organizationId: string | null;
  primaryContactId: string | null;
  name: string;
  city: string;
  region: string;
  startsAt: Date | null;
  status: BookingStatus;
  probability: Probability;
  createdAt: Date;
  updatedAt: Date;
};

export type TodayDashboardFollowUpRecord = {
  id: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
  createdAt: Date;
};

export interface TodayDashboardRepository {
  listOpenFollowUps(): Promise<{
    booking: TodayDashboardBookingRecord | null;
    contact: { organizationId: string | null; firstName: string; lastName: string } | null;
    followUp: TodayDashboardFollowUpRecord;
    organization: { name: string } | null;
  }[]>;
  listBookings(): Promise<TodayDashboardBookingRecord[]>;
}

export type FollowUpPlanItem = {
  id: string;
  name: string;
  status: BookingStatus;
  probability: Probability;
};

export type UpcomingEvent = {
  id: string;
  name: string;
  city: string;
  region: string;
  startsAt: Date;
};

export type TodayDashboard = {
  followUpCount: number;
  newLeadCount: number;
  contractCount: number;
  routeWarningCount: number;
  nextCall: FollowUpSummary | null;
  followUps: FollowUpSummary[];
  needsFollowUpPlan: FollowUpPlanItem[];
  upcomingEvents: UpcomingEvent[];
};

const deadlineStatuses = new Set<BookingStatus>([
  "pending_decision",
  "pending_contract",
  "contract_received",
]);

const contractStatuses = new Set<BookingStatus>([
  "pending_contract",
  "contract_received",
]);

function priorityBucket(item: FollowUpSummary, now: Date) {
  const due = classifyBusinessDueDate(item.dueAt, now);
  if (due === "overdue") return 0;
  if (due === "today") return 1;
  if (item.status === "deadline") return 2;
  if (item.probability === "likely") return 3;
  if (item.status === "quiet_lead") return 4;
  return 5;
}

export function selectFutureIncompleteFollowUp<
  T extends { dueAt: Date; completedAt: Date | null },
>(items: T[], now: Date): T | null {
  return (
    items
      .filter(
        (item) =>
          item.completedAt === null &&
          Number.isFinite(item.dueAt.getTime()) &&
          isFutureBusinessDate(item.dueAt, now),
      )
      .sort(
        (left, right) =>
          left.dueAt.getTime() - right.dueAt.getTime() ||
          ("id" in left && "id" in right
            ? String(left.id).localeCompare(String(right.id))
            : 0),
      )[0] ?? null
  );
}

export function sortFollowUpsForToday(
  items: FollowUpSummary[],
  now: Date,
): FollowUpSummary[] {
  return [...items].sort((left, right) => {
    const bucketDifference = priorityBucket(left, now) - priorityBucket(right, now);
    if (bucketDifference !== 0) return bucketDifference;

    const dueDifference = left.dueAt.getTime() - right.dueAt.getTime();
    if (dueDifference !== 0) return dueDifference;

    const createdDifference = left.createdAt.getTime() - right.createdAt.getTime();
    if (createdDifference !== 0) return createdDifference;

    return left.id.localeCompare(right.id);
  });
}

function classifyFollowUp(
  booking: { status: BookingStatus; updatedAt: Date } | null,
  followUp: { kind: string },
  now: Date,
): FollowUpPriorityStatus {
  if ((booking && deadlineStatuses.has(booking.status)) || followUp.kind.includes("deadline")) {
    return "deadline";
  }

  const fourteenDays = 14 * 24 * 60 * 60 * 1000;
  if (booking && now.getTime() - booking.updatedAt.getTime() >= fourteenDays) {
    return "quiet_lead";
  }

  return "due";
}

async function getDrizzleTodayDashboardRepository(): Promise<TodayDashboardRepository> {
  const { db } = await import("@/db/client");
  return {
    listOpenFollowUps: () =>
      db
      .select({
        booking: bookings,
        contact: contacts,
        followUp: followUps,
        organization: organizations,
      })
      .from(followUps)
      .leftJoin(bookings, eq(followUps.bookingId, bookings.id))
      .leftJoin(contacts, eq(followUps.contactId, contacts.id))
      .leftJoin(organizations, eq(followUps.organizationId, organizations.id))
      .where(isNull(followUps.completedAt))
      .orderBy(asc(followUps.dueAt), asc(followUps.createdAt)),
    listBookings: () => db.select().from(bookings).orderBy(asc(bookings.createdAt)),
  };
}

export async function getTodayDashboard(
  now: Date,
  repository: TodayDashboardRepository | null = null,
): Promise<TodayDashboard> {
  const source = repository ?? await getDrizzleTodayDashboardRepository();
  const [records, bookingList] = await Promise.all([
    source.listOpenFollowUps(),
    source.listBookings(),
  ]);

  const openFollowUps: FollowUpSummary[] = [];
  const openFollowUpsByBooking = new Map<
    string,
    { dueAt: Date; completedAt: Date | null }[]
  >();
  for (const { booking, contact, followUp, organization } of records) {
    const summary: FollowUpSummary = {
      id: followUp.id,
      organizationId: followUp.organizationId ?? booking?.organizationId ?? contact?.organizationId ?? null,
      contactId: followUp.contactId ?? booking?.primaryContactId ?? null,
      bookingId: booking?.id ?? null,
      bookingName:
        booking?.name ??
        (`${contact?.firstName ?? ""} ${contact?.lastName ?? ""}`.trim() ||
          organization?.name ||
          "Follow-up"),
      kind: followUp.kind,
      dueAt: followUp.dueAt,
      createdAt: followUp.createdAt,
      status: classifyFollowUp(booking, followUp, now),
      probability: booking?.probability ?? "possible",
    };
    openFollowUps.push(summary);

    if (booking) {
      const bookingFollowUps = openFollowUpsByBooking.get(booking.id) ?? [];
      bookingFollowUps.push({
        dueAt: followUp.dueAt,
        completedAt: followUp.completedAt,
      });
      openFollowUpsByBooking.set(booking.id, bookingFollowUps);
    }
  }

  const sortedFollowUps = sortFollowUpsForToday(openFollowUps, now);
  const { start: startToday, end: endToday } = businessDayBounds(now);
  const futureFollowUpByBooking = new Map(
    [...openFollowUpsByBooking].flatMap(([bookingId, bookingFollowUps]) => {
      const futureFollowUp = selectFutureIncompleteFollowUp(bookingFollowUps, now);
      return futureFollowUp ? [[bookingId, futureFollowUp] as const] : [];
    }),
  );

  return {
    followUpCount: sortedFollowUps.filter(
      (followUp) => followUp.dueAt.getTime() < endToday.getTime(),
    ).length,
    newLeadCount: bookingList.filter((booking) => booking.status === "new_lead").length,
    contractCount: bookingList.filter((booking) => contractStatuses.has(booking.status))
      .length,
    // Route optimization arrives after Stage 1. The command center keeps the
    // count boundary visible without inferring a recommendation from bookings.
    routeWarningCount: 0,
    nextCall:
      sortedFollowUps.find((followUp) => followUp.kind === "call") ?? null,
    followUps: sortedFollowUps,
    needsFollowUpPlan: bookingList
      .filter((booking) =>
        needsFollowUpPlan(booking, futureFollowUpByBooking.get(booking.id) ?? null, now),
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
      .map((booking) => ({
        id: booking.id,
        name: booking.name,
        status: booking.status,
        probability: booking.probability,
      })),
    upcomingEvents: bookingList
      .filter(
        (booking) =>
          booking.startsAt &&
          booking.startsAt.getTime() >= startToday.getTime(),
      )
      .sort(
        (left, right) =>
          left.startsAt!.getTime() - right.startsAt!.getTime() ||
          left.id.localeCompare(right.id),
      )
      .slice(0, 5)
      .map((booking) => ({
        id: booking.id,
        name: booking.name,
        city: booking.city,
        region: booking.region,
        startsAt: booking.startsAt!,
      })),
  };
}
