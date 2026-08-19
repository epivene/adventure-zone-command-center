import { asc, sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { bookings } from "@/db/schema";

const ACT_OPEN_ENDED_SENTINEL = "2100-01-01T00:00:00.000Z";

type DrizzleDatabase = typeof applicationDatabase;

export type TodayUpcomingEventRecord = {
  id: string;
  organizationId: string | null;
  primaryContactId: string | null;
  name: string;
  city: string;
  region: string;
  startsAt: Date;
  endsAt: Date;
};

/**
 * ACT imports can carry a far-future end date to mean "no real end date".
 * Treat those rows as single-date events, otherwise old January prospects can
 * incorrectly remain in Today's current/upcoming event list for the rest of the year.
 */
export async function listTodayUpcomingEvents(
  database: DrizzleDatabase,
  startToday: Date,
  limit: number,
): Promise<TodayUpcomingEventRecord[]> {
  const effectiveEnd = sql<Date | null>`case
    when ${bookings.endsAt} is not null
      and ${bookings.endsAt} < ${ACT_OPEN_ENDED_SENTINEL}
      then ${bookings.endsAt}
    else ${bookings.startsAt}
  end`;

  const rows = await database
    .select({
      id: bookings.id,
      organizationId: bookings.organizationId,
      primaryContactId: bookings.primaryContactId,
      name: bookings.name,
      city: bookings.city,
      region: bookings.region,
      startsAt: bookings.startsAt,
      endsAt: effectiveEnd,
    })
    .from(bookings)
    .where(sql`${bookings.startsAt} is not null and ${effectiveEnd} >= ${startToday.toISOString()}`)
    .orderBy(asc(bookings.startsAt), asc(bookings.id))
    .limit(Math.max(1, limit));

  return rows.flatMap((row) => row.startsAt && row.endsAt ? [{ ...row, startsAt: row.startsAt, endsAt: row.endsAt }] : []);
}
