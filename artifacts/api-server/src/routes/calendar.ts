import { Router, type IRouter } from "express";
import { getMapEvents, type MapFilters } from "@/features/routes/map-query";

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
 *  - kind = "calendar"  — scheduled activities from the reviewed replacement import
 *  - kind = "act_history" with actRecordId "act_activity:…" — activity-stream records
 *    from the older activity-import-service (not notes or history text entries)
 *
 * This mirrors the SQL WHERE clause and acts as a JS-level safety net /
 * unit-testable statement of intent.
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

/**
 * Query Act! activities that belong on the calendar.
 *
 * Criteria (applied in both SQL and JS):
 *  - kind = "calendar"  (replacement-flow reviewed imports)
 *  - kind = "act_history" AND actRecordId LIKE "act_activity:%" (legacy import, activity stream only)
 *
 * Notes and history text entries are intentionally excluded — they have dates but are
 * not scheduled events.
 *
 * @param db - optional injected database (defaults to production client; used in tests)
 */
export async function getActCalendarActivities(
  db?: ActivityDb,
): Promise<ActCalendarActivity[]> {
  const [resolvedDb, schema, orm] = await Promise.all([
    db ? Promise.resolve(db) : import("@/db/client").then((m) => m.db),
    import("@/db/schema"),
    import("drizzle-orm"),
  ]);

  const { activities, contacts, organizations } = schema;
  const { eq, or, and, like } = orm;

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
    .where(
      or(
        eq(activities.kind, "calendar"),
        and(
          eq(activities.kind, "act_history"),
          like(activities.actRecordId, "act_activity:%"),
        ),
      ),
    );

  // JS-level guard mirrors the SQL WHERE — provides defence-in-depth and
  // makes the intent unit-testable independent of the DB.
  return rows.filter(isCalendarEligibleRow).map(mapActivityRow);
}

router.get("/calendar", async (req, res): Promise<void> => {
  try {
    const [bookingEvents, actActivities] = await Promise.all([
      getMapEvents(allEvents),
      getActCalendarActivities(),
    ]);

    const bookingsWithSource = bookingEvents.map((e) => ({
      ...e,
      source: "booking" as const,
    }));

    res.json([...bookingsWithSource, ...actActivities]);
  } catch (err) {
    req.log.error({ err }, "Failed to load calendar");
    res.status(500).json({ error: "Failed to load calendar" });
  }
});

export default router;
