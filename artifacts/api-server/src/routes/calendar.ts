import { Router, type IRouter } from "express";
import { db } from "@/db/client";
import { getMapEvents, type MapFilters } from "@/features/routes/map-query";
import { eventOverlapsBusinessWindow } from "@/features/routes/map-data";
import { applyOperationalWindowsToCalendarBookings } from "@/features/google-workspace/calendar/calendar-operational-window-projection";
import { OperationalCalendarLinkRepository } from "@/features/google-workspace/calendar/operational-calendar-link-repository";
import { projectOperationalCalendarReview } from "@/features/google-workspace/calendar/operational-calendar-review-projection";
import { DrizzleScheduleDisplaySettingsRepository } from "@/features/calendar/schedule-display-settings";

const router: IRouter = Router();

const allEvents: MapFilters = {
  statuses: [],
  travelLegIds: [],
  dateFrom: null,
  dateTo: null,
  regions: [],
};

export type ActCalendarActivity = {
  source: "act_activity";
  id: string;
  /** First line of body, or explicit subject column when available. */
  displaySubject: string;
  /** Full body text (subject + details concatenated by importer). */
  body: string;
  /** Derived from kind / actRecordId prefix: "Note" | "History" | "Activity" */
  activityType: "Note" | "History" | "Activity";
  startsAt: Date | null;
  endsAt: Date | null;
  actRecordId: string | null;
  contactId: string | null;
  contactName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  bookingId: string | null;
};

/** Raw row shape returned by the activities query. */
export type ActivityQueryRow = {
  id: string;
  body: string;
  subject: string | null;
  kind: string;
  timelineSortAt: Date | null;
  endsAt: Date | null;
  actRecordId: string | null;
  contactId: string | null;
  contactFirstName: string | null;
  contactLastName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  bookingId: string | null;
};

/**
 * Returns true for rows that belong on the calendar:
 *  - kind = "calendar" — scheduled activities from the reviewed replacement import
 *  - kind = "act_history" with actRecordId "act_activity:" — activity-stream records
 *    from the older activity-import-service (not notes or history text entries)
 */
export function isCalendarEligibleRow(
  row: Pick<ActivityQueryRow, "kind" | "actRecordId">,
): boolean {
  if (row.kind === "calendar") return true;
  if (
    row.kind === "act_history" &&
    typeof row.actRecordId === "string" &&
    row.actRecordId.startsWith("act_activity:")
  ) {
    return true;
  }
  return false;
}

export function mapActivityRow(row: ActivityQueryRow): ActCalendarActivity {
  const activityType: ActCalendarActivity["activityType"] =
    row.kind === "calendar"
      ? "Activity"
      : row.actRecordId?.startsWith("act_note:")
        ? "Note"
        : row.actRecordId?.startsWith("act_activity:")
          ? "Activity"
          : "History";

  const bodyText = row.body ?? "";
  const firstLine = bodyText.split(/\n\n|\n/)[0]?.trim() ?? "";
  const displaySubject = row.subject?.trim() || firstLine || "Act! entry";

  const contactName =
    row.contactFirstName && row.contactLastName
      ? `${row.contactFirstName} ${row.contactLastName}`.trim()
      : null;

  return {
    source: "act_activity",
    id: row.id,
    displaySubject,
    body: bodyText,
    activityType,
    startsAt: row.timelineSortAt,
    endsAt: row.endsAt,
    actRecordId: row.actRecordId,
    contactId: row.contactId,
    contactName,
    organizationId: row.organizationId,
    organizationName: row.organizationName,
    bookingId: row.bookingId,
  };
}

/** Minimal structural type accepted by getActCalendarActivities for test injection. */
export type ActivityDb = { select: (...args: unknown[]) => unknown };

export async function getActCalendarActivities(
  db?: ActivityDb,
  from?: Date,
  to?: Date,
): Promise<ActCalendarActivity[]> {
  const [resolvedDb, schema, orm] = await Promise.all([
    db ? Promise.resolve(db) : import("@/db/client").then((m) => m.db),
    import("@/db/schema"),
    import("drizzle-orm"),
  ]);

  const { activities, contacts, organizations } = schema;
  const { eq, or, and, like, gte, lte, isNull } = orm;

  const kindFilter = or(
    eq(activities.kind, "calendar"),
    and(
      eq(activities.kind, "act_history"),
      like(activities.actRecordId, "act_activity:%"),
    ),
  );

  const dateFilter =
    from && to
      ? or(
          isNull(activities.timelineSortAt),
          and(
            gte(activities.timelineSortAt, from),
            lte(activities.timelineSortAt, to),
          ),
        )
      : from
        ? or(isNull(activities.timelineSortAt), gte(activities.timelineSortAt, from))
        : to
          ? or(isNull(activities.timelineSortAt), lte(activities.timelineSortAt, to))
          : undefined;

  const visibleFilter = isNull(activities.deletedAt);
  const whereClause = dateFilter
    ? and(kindFilter, visibleFilter, dateFilter)
    : and(kindFilter, visibleFilter);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: ActivityQueryRow[] = await (resolvedDb as any)
    .select({
      id: activities.id,
      body: activities.body,
      subject: activities.subject,
      kind: activities.kind,
      timelineSortAt: activities.timelineSortAt,
      endsAt: activities.endsAt,
      actRecordId: activities.actRecordId,
      contactId: activities.contactId,
      organizationId: activities.organizationId,
      bookingId: activities.bookingId,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      organizationName: organizations.name,
    })
    .from(activities)
    .leftJoin(contacts, eq(activities.contactId, contacts.id))
    .leftJoin(organizations, eq(activities.organizationId, organizations.id))
    .where(whereClause);

  return rows.filter(isCalendarEligibleRow).map(mapActivityRow);
}

async function getOperationalWindowsForCalendar(bookingIds: string[]) {
  if (!bookingIds.length) return [];
  const [{ db }, { bookingOperationalWindows }, { inArray }] = await Promise.all([
    import("@/db/client"),
    import("@/db/schema"),
    import("drizzle-orm"),
  ]);
  const rows = await db.select({
    bookingId: bookingOperationalWindows.bookingId,
    startsAt: bookingOperationalWindows.startsAt,
    endsAt: bookingOperationalWindows.endsAt,
    source: bookingOperationalWindows.source,
  }).from(bookingOperationalWindows).where(inArray(bookingOperationalWindows.bookingId, bookingIds));

  return rows.filter((row) =>
    typeof row.bookingId === "string" &&
    row.startsAt instanceof Date &&
    row.endsAt instanceof Date,
  );
}

router.get("/calendar/display-settings", async (req, res): Promise<void> => {
  try {
    const { db } = await import("@/db/client");
    const settings = await new DrizzleScheduleDisplaySettingsRepository(db).get();
    res.json(settings);
  } catch (err) {
    req.log.error({ err }, "Failed to load schedule display settings");
    res.status(500).json({ error: "Failed to load schedule display settings" });
  }
});

router.get("/calendar/debug", async (req, res): Promise<void> => {
  try {
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");

    const rows = await db.execute(sql`
      select
        kind,
        case
          when act_record_id like 'act_activity:%' then 'act_activity:*'
          when act_record_id like 'act_note:%'     then 'act_note:*'
          when act_record_id like 'act_history:%'  then 'act_history:*'
          when act_record_id is null               then '(null)'
          else 'other'
        end as act_record_id_pattern,
        source_type,
        count(*)::int as count,
        min(timeline_sort_at) as earliest,
        max(timeline_sort_at) as latest
      from activities
      group by 1, 2, 3
      order by 1, 2, 3
    `);

    const eligible = await db.execute(sql`
      select id, kind, subject, body, timeline_sort_at, ends_at, act_record_id
      from activities
      where kind = 'calendar'
         or (kind = 'act_history' and act_record_id like 'act_activity:%')
      order by timeline_sort_at desc
      limit 20
    `);

    res.json({
      summary: (rows as { rows: unknown[] }).rows,
      calendarEligibleSample: (eligible as { rows: unknown[] }).rows,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load calendar debug");
    res.status(500).json({ error: "Failed to load calendar debug" });
  }
});

router.get("/calendar", async (req, res): Promise<void> => {
  try {
    const fromParam = typeof req.query.from === "string" ? req.query.from : undefined;
    const toParam = typeof req.query.to === "string" ? req.query.to : undefined;

    const fromDate = fromParam ? new Date(fromParam) : undefined;
    const toDate = toParam ? new Date(toParam) : undefined;

    const validFrom = fromDate && !isNaN(fromDate.getTime()) ? fromDate : undefined;
    const validTo = toDate && !isNaN(toDate.getTime()) ? toDate : undefined;

    if (validTo) validTo.setUTCHours(23, 59, 59, 999);

    const calendarFilters: MapFilters = {
      ...allEvents,
      dateFrom: validFrom ? (fromParam as string) : null,
      dateTo: validTo ? (toParam as string) : null,
    };

    const [bookingEvents, actActivities] = await Promise.all([
      getMapEvents(calendarFilters),
      getActCalendarActivities(undefined, validFrom, validTo),
    ]);

    const operationalWindows = await getOperationalWindowsForCalendar(bookingEvents.map((event) => event.id));
    const calendarBookings = applyOperationalWindowsToCalendarBookings(bookingEvents, operationalWindows);
    const pendingReviews = await new OperationalCalendarLinkRepository(db).listPendingReviews();
    const reviewEvents = pendingReviews.flatMap((review) => {
      try {
        return [projectOperationalCalendarReview({
          id: review.id,
          calendarId: review.calendarId,
          googleEventId: review.googleEventId,
          reason: review.reason,
          bookingId: review.bookingId,
          proposedChanges: review.proposedChanges,
        })];
      } catch {
        return [];
      }
    }).filter((event) => eventOverlapsBusinessWindow(
      event,
      calendarFilters.dateFrom,
      calendarFilters.dateTo,
    ));

    const bookingsWithSource = calendarBookings.map((event) => ({
      ...event,
      source: "booking" as const,
    }));

    res.json([...bookingsWithSource, ...reviewEvents, ...actActivities]);
  } catch (err) {
    req.log.error({ err }, "Failed to load calendar");
    res.status(500).json({ error: "Failed to load calendar" });
  }
});

export default router;
