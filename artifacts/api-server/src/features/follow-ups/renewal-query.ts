import { and, asc, eq, exists, inArray, isNull, or } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { bookings, followUps } from "@/db/schema";
import type { BookingOperationsSummary } from "@/features/bookings/booking-operations-summary";
import type {
  BookingStatus,
  Probability,
} from "@/features/bookings/booking-types";
import { businessDateKey } from "@/lib/business-date";

export type RenewalAttention = "overdue" | "soon" | "later" | "needs_plan";

export type RenewalItem = {
  id: string;
  organizationId: string | null;
  primaryContactId: string | null;
  name: string;
  status: BookingStatus;
  probability: Probability;
  followUpId: string | null;
  dueAt: Date | null;
  attention: RenewalAttention;
  operations?: BookingOperationsSummary | null;
};

type DrizzleDatabase = typeof database;

function addDaysToDateKey(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day! + days));
  return date.toISOString().slice(0, 10);
}

export function classifyRenewalAttention(
  dueAt: Date | null,
  now: Date,
): RenewalAttention {
  if (!dueAt) return "needs_plan";

  const todayKey = businessDateKey(now);
  const dueKey = businessDateKey(dueAt);
  if (dueKey < todayKey) return "overdue";

  return dueKey <= addDaysToDateKey(todayKey, 30) ? "soon" : "later";
}

const attentionRank: Record<RenewalAttention, number> = {
  overdue: 0,
  soon: 1,
  later: 1,
  needs_plan: 2,
};

export function sortRenewalItems(items: RenewalItem[]): RenewalItem[] {
  return [...items].sort((left, right) => {
    const rank = attentionRank[left.attention] - attentionRank[right.attention];
    if (rank !== 0) return rank;

    const leftDue = left.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightDue = right.dueAt?.getTime() ?? Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;

    const followUpTie = (left.followUpId ?? "").localeCompare(
      right.followUpId ?? "",
    );
    return followUpTie || left.id.localeCompare(right.id);
  });
}

export async function listRenewals(
  db: DrizzleDatabase,
  now: Date,
): Promise<RenewalItem[]> {
  const candidateCondition = or(
    eq(bookings.status, "renewal_due"),
    and(
      eq(bookings.status, "completed"),
      exists(
        db
          .select({ id: followUps.id })
          .from(followUps)
          .where(
            and(
              eq(followUps.bookingId, bookings.id),
              isNull(followUps.completedAt),
            ),
          ),
      ),
    ),
  );

  const candidates = await db
    .select({
      id: bookings.id,
      organizationId: bookings.organizationId,
      primaryContactId: bookings.primaryContactId,
      name: bookings.name,
      status: bookings.status,
      probability: bookings.probability,
    })
    .from(bookings)
    .where(candidateCondition)
    .orderBy(asc(bookings.id));

  if (candidates.length === 0) return [];

  const candidateIds = candidates.map(({ id }) => id);
  const openFollowUps = await db
    .select({
      id: followUps.id,
      bookingId: followUps.bookingId,
      dueAt: followUps.dueAt,
    })
    .from(followUps)
    .where(
      and(
        inArray(followUps.bookingId, candidateIds),
        isNull(followUps.completedAt),
      ),
    )
    .orderBy(asc(followUps.dueAt), asc(followUps.id));

  const groupedFollowUps = new Map<
    string,
    Array<{ id: string; bookingId: string | null; dueAt: Date }>
  >();

  for (const followUp of openFollowUps) {
    if (!followUp.bookingId) continue;
    const existing = groupedFollowUps.get(followUp.bookingId) ?? [];
    existing.push(followUp);
    groupedFollowUps.set(followUp.bookingId, existing);
  }

  const items: RenewalItem[] = candidates.map((booking) => {
    const selected = groupedFollowUps.get(booking.id)?.[0] ?? null;
    return {
      id: booking.id,
      organizationId: booking.organizationId,
      primaryContactId: booking.primaryContactId,
      name: booking.name,
      status: booking.status,
      probability: booking.probability,
      followUpId: selected?.id ?? null,
      dueAt: selected?.dueAt ?? null,
      attention: classifyRenewalAttention(selected?.dueAt ?? null, now),
    };
  });

  return sortRenewalItems(items);
}
