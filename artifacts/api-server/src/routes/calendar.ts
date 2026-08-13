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
  /** Derived from actRecordId prefix: "Note" | "History" | "Activity" */
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

async function getActActivities(): Promise<ActCalendarActivity[]> {
  const [{ db }, { activities, contacts, organizations }, { eq, isNotNull }] =
    await Promise.all([
      import("@/db/client"),
      import("@/db/schema"),
      import("drizzle-orm"),
    ]);

  const rows = await db
    .select({
      id: activities.id,
      body: activities.body,
      subject: activities.subject,
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
    .where(eq(activities.kind, "act_history"));

  return rows
    .filter((row) => row.timelineSortAt != null)
    .map((row): ActCalendarActivity => {
      const actRecordId = row.actRecordId;
      const activityType: ActCalendarActivity["activityType"] =
        actRecordId?.startsWith("act_note:") ? "Note"
        : actRecordId?.startsWith("act_activity:") ? "Activity"
        : "History";

      // Use explicit subject if set (newer replacement-flow imports), otherwise
      // take the first non-empty line of body (old activity-import-service format).
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
        actRecordId,
        contactId: row.contactId,
        contactName,
        organizationId: row.organizationId,
        organizationName: row.organizationName,
        bookingId: row.bookingId,
      };
    });
}

router.get("/calendar", async (req, res): Promise<void> => {
  try {
    const [bookingEvents, actActivities] = await Promise.all([
      getMapEvents(allEvents),
      getActActivities(),
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
