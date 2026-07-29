import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  notExists,
  sql,
} from "drizzle-orm";

import type { db as database } from "@/db/client";
import { bookings, contacts, followUps, organizations } from "@/db/schema";
import {
  bookingStatusValues,
  type BookingStatus,
  type Probability,
} from "@/features/bookings/booking-types";
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

export type TodayDashboardFollowUpRow = {
  booking: TodayDashboardBookingRecord | null;
  contact: {
    organizationId: string | null;
    firstName: string;
    lastName: string;
  } | null;
  followUp: TodayDashboardFollowUpRecord;
  organization: { name: string } | null;
};

export type TodayQueueRequest = {
  page: number;
  pageSize: number;
};

export type TodayPriorityQueueRequest = TodayQueueRequest & {
  now: Date;
};

export interface TodayDashboardRepository {
  getCounts(endToday: Date): Promise<{
    followUpCount: number;
    newLeadCount: number;
    contractCount: number;
  }>;
  listOpenFollowUps(
    request: TodayPriorityQueueRequest,
  ): Promise<{ records: TodayDashboardFollowUpRow[]; total: number; page: number }>;
  findNextCall(now: Date): Promise<TodayDashboardFollowUpRow | null>;
  listNeedsFollowUpPlan(
    futureBoundary: Date,
    request: TodayQueueRequest,
  ): Promise<{ records: TodayDashboardBookingRecord[]; total: number; page: number }>;
  listUpcomingEvents(
    startToday: Date,
    limit: number,
  ): Promise<TodayDashboardBookingRecord[]>;
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
  followUpTotal: number;
  followUpPage: number;
  followUpPageCount: number;
  needsFollowUpPlan: FollowUpPlanItem[];
  needsFollowUpPlanTotal: number;
  needsFollowUpPlanPage: number;
  needsFollowUpPlanPageCount: number;
  upcomingEvents: UpcomingEvent[];
};

export const TODAY_FOLLOW_UP_PAGE_SIZE = 50;
export const TODAY_PLAN_PAGE_SIZE = 25;
export const TODAY_UPCOMING_EVENT_LIMIT = 5;

const deadlineStatusValues = [
  "pending_decision",
  "pending_contract",
  "contract_received",
] as const satisfies readonly BookingStatus[];

const deadlineStatuses = new Set<BookingStatus>(deadlineStatusValues);

const contractStatuses = [
  "pending_contract",
  "contract_received",
] as const satisfies readonly BookingStatus[];

const activeStatuses = bookingStatusValues.filter(
  (status) => !["declined", "cancelled", "completed"].includes(status),
);

const followUpSelection = {
  booking: bookings,
  contact: {
    organizationId: contacts.organizationId,
    firstName: contacts.firstName,
    lastName: contacts.lastName,
  },
  followUp: followUps,
  organization: { name: organizations.name },
};

function priorityBucket(item: FollowUpSummary, now: Date) {
  const due = classifyBusinessDueDate(item.dueAt, now);
  if (due === "overdue") return 0;
  if (due === "today") return 1;
  if (item.status === "deadline") return 2;
  if (item.probability === "likely") return 3;
  if (item.status === "quiet_lead") return 4;
  return 5;
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

function toFollowUpSummary(
  { booking, contact, followUp, organization }: TodayDashboardFollowUpRow,
  now: Date,
): FollowUpSummary {
  return {
    id: followUp.id,
    organizationId:
      followUp.organizationId ??
      booking?.organizationId ??
      contact?.organizationId ??
      null,
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
}

export function openFollowUpsCondition() {
  return isNull(followUps.completedAt);
}

export function needsFollowUpPlanCondition(futureBoundary: Date) {
  const serializedFutureBoundary = futureBoundary.toISOString();
  return and(
    inArray(bookings.status, activeStatuses),
    notExists(sql`
      select 1 from ${followUps}
      where ${followUps.bookingId} = ${bookings.id}
        and ${followUps.completedAt} is null
        and ${followUps.dueAt} >= ${serializedFutureBoundary}
    `),
  );
}

export function upcomingEventsCondition(startToday: Date) {
  return gte(bookings.startsAt, startToday);
}

export function todayFollowUpPriorityOrder(now: Date) {
  const { start, end } = businessDayBounds(now);
  const quietLeadCutoff = new Date(
    now.getTime() - 14 * 24 * 60 * 60 * 1000,
  );
  const serializedStart = start.toISOString();
  const serializedEnd = end.toISOString();
  const serializedQuietLeadCutoff = quietLeadCutoff.toISOString();
  const priority = sql<number>`case
    when ${followUps.dueAt} < ${serializedStart} then 0
    when ${followUps.dueAt} < ${serializedEnd} then 1
    when (
      ${inArray(bookings.status, deadlineStatusValues)}
      or ${followUps.kind} like ${"%deadline%"}
    ) then 2
    when ${bookings.probability} = ${"likely"} then 3
    when (
      ${bookings.id} is not null
      and ${bookings.updatedAt} <= ${serializedQuietLeadCutoff}
    ) then 4
    else 5
  end`;

  return [
    asc(priority),
    asc(followUps.dueAt),
    asc(followUps.createdAt),
    asc(followUps.id),
  ] as const;
}

type DrizzleDatabase = typeof database;

export function createDrizzleTodayDashboardRepository(
  db: DrizzleDatabase,
): TodayDashboardRepository {
  function followUpRows(condition: ReturnType<typeof and>, now: Date) {
    return db
      .select(followUpSelection)
      .from(followUps)
      .leftJoin(bookings, eq(followUps.bookingId, bookings.id))
      .leftJoin(contacts, eq(followUps.contactId, contacts.id))
      .leftJoin(organizations, eq(followUps.organizationId, organizations.id))
      .where(condition)
      .orderBy(...todayFollowUpPriorityOrder(now));
  }

  return {
    async getCounts(endToday) {
      const [[followUpTotal], [newLeadTotal], [contractTotal]] = await Promise.all([
        db
          .select({ value: count() })
          .from(followUps)
          .where(and(isNull(followUps.completedAt), lt(followUps.dueAt, endToday))),
        db
          .select({ value: count() })
          .from(bookings)
          .where(eq(bookings.status, "new_lead")),
        db
          .select({ value: count() })
          .from(bookings)
          .where(inArray(bookings.status, contractStatuses)),
      ]);
      return {
        followUpCount: followUpTotal?.value ?? 0,
        newLeadCount: newLeadTotal?.value ?? 0,
        contractCount: contractTotal?.value ?? 0,
      };
    },

    async listOpenFollowUps({ page, pageSize, now }) {
      const condition = openFollowUpsCondition();
      const [totalRecord] = await db
        .select({ value: count() })
        .from(followUps)
        .where(condition);
      const total = totalRecord?.value ?? 0;
      const boundedPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
      const records = await followUpRows(condition, now)
        .limit(pageSize)
        .offset((boundedPage - 1) * pageSize);
      return { records, total, page: boundedPage };
    },

    async findNextCall(now) {
      const [record] = await followUpRows(
        and(openFollowUpsCondition(), eq(followUps.kind, "call")),
        now,
      ).limit(1);
      return record ?? null;
    },

    async listNeedsFollowUpPlan(futureBoundary, { page, pageSize }) {
      const condition = needsFollowUpPlanCondition(futureBoundary);
      const [totalRecord] = await db
        .select({ value: count() })
        .from(bookings)
        .where(condition);
      const total = totalRecord?.value ?? 0;
      const boundedPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
      const records = await db
        .select()
        .from(bookings)
        .where(condition)
        .orderBy(asc(bookings.createdAt), asc(bookings.id))
        .limit(pageSize)
        .offset((boundedPage - 1) * pageSize);
      return { records, total, page: boundedPage };
    },

    listUpcomingEvents(startToday, limit) {
      return db
        .select()
        .from(bookings)
        .where(upcomingEventsCondition(startToday))
        .orderBy(asc(bookings.startsAt), asc(bookings.id))
        .limit(limit);
    },
  };
}

async function getDrizzleTodayDashboardRepository() {
  const { db } = await import("@/db/client");
  return createDrizzleTodayDashboardRepository(db);
}

export async function getTodayDashboard(
  now: Date,
  repository: TodayDashboardRepository | null = null,
  pages: { followUps?: number; needsFollowUpPlan?: number } = {},
): Promise<TodayDashboard> {
  const source = repository ?? await getDrizzleTodayDashboardRepository();
  const { start: startToday, end: endToday } = businessDayBounds(now);
  const followUpPage = Math.max(1, pages.followUps ?? 1);
  const planPage = Math.max(1, pages.needsFollowUpPlan ?? 1);
  const [counts, followUpResult, nextCallRecord, planResult, upcoming] =
    await Promise.all([
      source.getCounts(endToday),
      source.listOpenFollowUps({
        page: followUpPage,
        pageSize: TODAY_FOLLOW_UP_PAGE_SIZE,
        now,
      }),
      source.findNextCall(now),
      source.listNeedsFollowUpPlan(endToday, {
        page: planPage,
        pageSize: TODAY_PLAN_PAGE_SIZE,
      }),
      source.listUpcomingEvents(startToday, TODAY_UPCOMING_EVENT_LIMIT),
    ]);

  const followUpPageCount = Math.max(
    1,
    Math.ceil(followUpResult.total / TODAY_FOLLOW_UP_PAGE_SIZE),
  );
  const needsFollowUpPlanPageCount = Math.max(
    1,
    Math.ceil(planResult.total / TODAY_PLAN_PAGE_SIZE),
  );

  return {
    ...counts,
    routeWarningCount: 0,
    nextCall: nextCallRecord ? toFollowUpSummary(nextCallRecord, now) : null,
    followUps: followUpResult.records.map((record) =>
      toFollowUpSummary(record, now),
    ),
    followUpTotal: followUpResult.total,
    followUpPage: followUpResult.page,
    followUpPageCount,
    needsFollowUpPlan: planResult.records.map((booking) => ({
      id: booking.id,
      name: booking.name,
      status: booking.status,
      probability: booking.probability,
    })),
    needsFollowUpPlanTotal: planResult.total,
    needsFollowUpPlanPage: planResult.page,
    needsFollowUpPlanPageCount,
    upcomingEvents: upcoming
      .filter(
        (booking): booking is TodayDashboardBookingRecord & { startsAt: Date } =>
          booking.startsAt !== null,
      )
      .map((booking) => ({
        id: booking.id,
        name: booking.name,
        city: booking.city,
        region: booking.region,
        startsAt: booking.startsAt,
      })),
  };
}
