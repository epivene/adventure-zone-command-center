import { and, desc, eq, ne } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { eventAttendanceHistory } from "@/db/schema";

type Database = typeof database;

export type AttendanceHistoryProjection = {
  id: string;
  organizationId: string;
  organizationLocationId: string | null;
  year: number;
  month: string;
  status: "attended" | "blacklisted" | "cancelled_last_minute";
  originalEventName: string;
  originalLocation: string;
};

export class AttendanceHistoryRepository {
  constructor(private readonly database: Database) {}

  listForOrganization(
    organizationId: string,
    scope: "owner" | "office",
  ): Promise<AttendanceHistoryProjection[]> {
    return this.database
      .select({
        id: eventAttendanceHistory.id,
        organizationId: eventAttendanceHistory.organizationId,
        organizationLocationId: eventAttendanceHistory.organizationLocationId,
        year: eventAttendanceHistory.year,
        month: eventAttendanceHistory.month,
        status: eventAttendanceHistory.status,
        originalEventName: eventAttendanceHistory.originalEventName,
        originalLocation: eventAttendanceHistory.originalLocation,
      })
      .from(eventAttendanceHistory)
      .where(
        scope === "office"
          ? and(
              eq(eventAttendanceHistory.organizationId, organizationId),
              ne(eventAttendanceHistory.status, "blacklisted"),
            )
          : eq(eventAttendanceHistory.organizationId, organizationId),
      )
      .orderBy(desc(eventAttendanceHistory.year), desc(eventAttendanceHistory.approvedAt));
  }
}
