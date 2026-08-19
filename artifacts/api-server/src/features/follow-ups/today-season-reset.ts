import { and, count, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { bookings, followUps } from "@/db/schema";
import type { TodayDashboard } from "./today-query";
import { businessDayBounds } from "@/lib/business-date";

// Adventure Zone's 2026-27 booking work starts fresh on September 1, 2026.
// This is intentionally a work-queue boundary only: it never deletes or rewrites history.
export const TODAY_SEASON_RESET_AT = new Date("2026-09-01T05:00:00.000Z");

export type TodaySeasonBookingSignal = {
  id: string;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  status: string;
};

type SeasonCounts = {
  followUpCount: number;
  newLeadCount: number;
  contractCount: number;
};

function atOrAfter(value: Date | null | undefined, boundary: Date) {
  return Boolean(value && Number.isFinite(value.getTime()) && value.getTime() >= boundary.getTime());
}

export function bookingBelongsToFreshSeason(
  booking: TodaySeasonBookingSignal | undefined,
  carriedForwardBookingIds: ReadonlySet<string>,
  boundary = TODAY_SEASON_RESET_AT,
) {
  if (!booking) return false;
  return (
    carriedForwardBookingIds.has(booking.id) ||
    atOrAfter(booking.startsAt, boundary) ||
    atOrAfter(booking.endsAt, boundary) ||
    atOrAfter(booking.createdAt, boundary) ||
    atOrAfter(booking.updatedAt, boundary)
  );
}

export function applyTodaySeasonReset(
  dashboard: TodayDashboard,
  now: Date,
  bookingSignals: ReadonlyMap<string, TodaySeasonBookingSignal> = new Map(),
  counts?: SeasonCounts,
): TodayDashboard {
  if (now.getTime() < TODAY_SEASON_RESET_AT.getTime()) return dashboard;

  const currentFollowUps = dashboard.followUps.filter((followUp) =>
    atOrAfter(followUp.dueAt, TODAY_SEASON_RESET_AT) ||
    atOrAfter(followUp.createdAt, TODAY_SEASON_RESET_AT),
  );
  const carriedForwardBookingIds = new Set(
    currentFollowUps.flatMap((followUp) => followUp.bookingId ? [followUp.bookingId] : []),
  );
  const currentPlans = dashboard.needsFollowUpPlan.filter((item) =>
    bookingBelongsToFreshSeason(bookingSignals.get(item.id), carriedForwardBookingIds),
  );

  const visibleNewLeadIds = new Set<string>();
  const visibleContractIds = new Set<string>();
  for (const item of currentPlans) {
    if (item.status === "new_lead") visibleNewLeadIds.add(item.id);
    if (item.status === "pending_contract" || item.status === "contract_received") visibleContractIds.add(item.id);
  }
  for (const followUp of currentFollowUps) {
    if (!followUp.bookingId) continue;
    if (followUp.bookingStatus === "new_lead") visibleNewLeadIds.add(followUp.bookingId);
    if (followUp.bookingStatus === "pending_contract" || followUp.bookingStatus === "contract_received") visibleContractIds.add(followUp.bookingId);
  }

  const nextCall = currentFollowUps.find((followUp) => followUp.kind === "call") ?? null;
  return {
    ...dashboard,
    followUps: currentFollowUps,
    followUpTotal: currentFollowUps.length,
    followUpPage: 1,
    followUpPageCount: 1,
    nextCall,
    needsFollowUpPlan: currentPlans,
    needsFollowUpPlanTotal: currentPlans.length,
    needsFollowUpPlanPage: 1,
    needsFollowUpPlanPageCount: 1,
    followUpCount: counts?.followUpCount ?? currentFollowUps.length,
    newLeadCount: counts?.newLeadCount ?? visibleNewLeadIds.size,
    contractCount: counts?.contractCount ?? visibleContractIds.size,
  };
}

type DrizzleDatabase = typeof database;

export async function applyTodaySeasonResetFromDb(
  db: DrizzleDatabase,
  dashboard: TodayDashboard,
  now: Date,
): Promise<TodayDashboard> {
  if (now.getTime() < TODAY_SEASON_RESET_AT.getTime()) return dashboard;

  const bookingIds = [...new Set([
    ...dashboard.needsFollowUpPlan.map((item) => item.id),
    ...dashboard.followUps.flatMap((followUp) => followUp.bookingId ? [followUp.bookingId] : []),
  ])];
  const bookingRows = bookingIds.length
    ? await db
        .select({
          id: bookings.id,
          startsAt: bookings.startsAt,
          endsAt: bookings.endsAt,
          createdAt: bookings.createdAt,
          updatedAt: bookings.updatedAt,
          status: bookings.status,
        })
        .from(bookings)
        .where(inArray(bookings.id, bookingIds))
    : [];
  const signals = new Map(bookingRows.map((row) => [row.id, row as TodaySeasonBookingSignal]));

  const currentBookingSql = sql`(
    ${bookings.startsAt} >= ${TODAY_SEASON_RESET_AT.toISOString()}
    or ${bookings.endsAt} >= ${TODAY_SEASON_RESET_AT.toISOString()}
    or ${bookings.createdAt} >= ${TODAY_SEASON_RESET_AT.toISOString()}
    or ${bookings.updatedAt} >= ${TODAY_SEASON_RESET_AT.toISOString()}
    or exists (
      select 1 from ${followUps}
      where ${followUps.bookingId} = ${bookings.id}
        and ${followUps.completedAt} is null
        and ${followUps.dueAt} >= ${TODAY_SEASON_RESET_AT.toISOString()}
    )
  )`;
  const { end } = businessDayBounds(now);
  const [[followUpTotal], [newLeadTotal], [contractTotal]] = await Promise.all([
    db
      .select({ value: count() })
      .from(followUps)
      .where(and(
        isNull(followUps.completedAt),
        lt(followUps.dueAt, end),
        or(
          gte(followUps.dueAt, TODAY_SEASON_RESET_AT),
          gte(followUps.createdAt, TODAY_SEASON_RESET_AT),
        ),
      )),
    db
      .select({ value: count() })
      .from(bookings)
      .where(and(eq(bookings.status, "new_lead"), currentBookingSql)),
    db
      .select({ value: count() })
      .from(bookings)
      .where(and(inArray(bookings.status, ["pending_contract", "contract_received"]), currentBookingSql)),
  ]);

  return applyTodaySeasonReset(dashboard, now, signals, {
    followUpCount: followUpTotal?.value ?? 0,
    newLeadCount: newLeadTotal?.value ?? 0,
    contractCount: contractTotal?.value ?? 0,
  });
}
