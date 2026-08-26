import { and, eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { googleWorkspaceCalendarScopes, googleWorkspaceConnections, leadAvailabilitySnapshots, leadImportRows } from "@/db/schema";
import { LeadAvailabilityServiceError, type LeadAvailabilityPersistence, type LeadAvailabilitySnapshot } from "./lead-availability-service";

type DrizzleDatabase = typeof database;

export class LeadAvailabilityRepository implements LeadAvailabilityPersistence {
  constructor(private readonly database: DrizzleDatabase) {}

  async loadVerifiedLead(rowId: string) {
    const [row] = await this.database.select({
      id: leadImportRows.id, reviewVersion: leadImportRows.reviewVersion, state: leadImportRows.state,
      organizationId: leadImportRows.selectedOrganizationId, recipientEmail: leadImportRows.confirmedRecipientEmail,
      recipientConfirmed: leadImportRows.recipientConfirmed, introductionSuitable: leadImportRows.introductionSuitable,
      startDate: leadImportRows.confirmedStartDate, endDate: leadImportRows.confirmedEndDate,
    }).from(leadImportRows).where(eq(leadImportRows.id, rowId)).limit(1);
    return row ?? null;
  }

  async selectedCalendars() {
    return this.database.select({
      id: googleWorkspaceCalendarScopes.calendarId, summary: googleWorkspaceCalendarScopes.summary,
      primary: googleWorkspaceCalendarScopes.primaryCalendar,
    }).from(googleWorkspaceCalendarScopes)
      .innerJoin(googleWorkspaceConnections, eq(googleWorkspaceConnections.id, googleWorkspaceCalendarScopes.connectionId))
      .where(and(eq(googleWorkspaceCalendarScopes.selected, true), eq(googleWorkspaceConnections.status, "connected")))
      .orderBy(googleWorkspaceCalendarScopes.summary, googleWorkspaceCalendarScopes.calendarId);
  }

  async save(snapshot: LeadAvailabilitySnapshot): Promise<{ reviewVersion: number }> {
    return this.database.transaction(async (tx) => {
      const [row] = await tx.select({
        id: leadImportRows.id, state: leadImportRows.state, reviewVersion: leadImportRows.reviewVersion,
        organizationId: leadImportRows.selectedOrganizationId, recipientEmail: leadImportRows.confirmedRecipientEmail,
        recipientConfirmed: leadImportRows.recipientConfirmed, introductionSuitable: leadImportRows.introductionSuitable,
        startDate: leadImportRows.confirmedStartDate, endDate: leadImportRows.confirmedEndDate,
      }).from(leadImportRows).where(eq(leadImportRows.id, snapshot.rowId)).limit(1).for("update");
      if (!row) throw new LeadAvailabilityServiceError("ROW_NOT_FOUND", "Lead import row was not found.");
      if (row.reviewVersion !== snapshot.expectedVersion || row.organizationId !== snapshot.organizationId
        || row.recipientEmail?.trim().toLowerCase() !== snapshot.recipientEmail.trim().toLowerCase()
        || row.startDate !== snapshot.startDate || row.endDate !== snapshot.endDate) {
        throw new LeadAvailabilityServiceError("VERSION_CONFLICT", "This lead was changed in another review. Reload it before checking availability.");
      }
      if (row.state !== "verified" || !row.recipientConfirmed || !row.introductionSuitable) {
        throw new LeadAvailabilityServiceError("AVAILABILITY_NOT_READY", "Verify the profile, recipient, and dates before checking availability.");
      }
      const nextVersion = row.reviewVersion + 1;
      const [updated] = await tx.update(leadImportRows).set({ reviewVersion: nextVersion, updatedAt: new Date(snapshot.checkedAt) })
        .where(and(eq(leadImportRows.id, snapshot.rowId), eq(leadImportRows.reviewVersion, snapshot.expectedVersion)))
        .returning({ id: leadImportRows.id });
      if (!updated) throw Object.assign(new Error("This lead was changed in another review. Reload it before checking availability."), { code: "VERSION_CONFLICT" });
      await tx.insert(leadAvailabilitySnapshots).values({
        rowId: snapshot.rowId, reviewVersion: nextVersion, proposedStartDate: snapshot.proposedWindow.startDate,
        proposedEndDate: snapshot.proposedWindow.endDate, ready: snapshot.ready, checkedBy: snapshot.checkedBy,
        checkedAt: new Date(snapshot.checkedAt), selectedCalendarIds: snapshot.selectedCalendarIds,
        sourceEvents: snapshot.sourceEvents, reservations: snapshot.reservations,
      });
      return { reviewVersion: nextVersion };
    });
  }
}