import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import {
  attendanceImportRows,
  attendanceImportYearStatuses,
  businessSourceDocuments,
  eventAttendanceHistory,
} from "@/db/schema";
import type { AttendanceImportMatchState } from "@workspace/db/event-attendance-history-schema";
import type { AttendanceSourceRow, AttendanceSourceStatus } from "./attendance-source-fixture";
import type { AttendanceMatchCandidate, AttendanceMatchSuggestion } from "./attendance-matcher";

type Database = typeof database;

type CandidateRow = {
  organization_id: string;
  organization_name: string;
  consolidated_into_id: string | null;
  location_id: string | null;
  city: string | null;
  region: string | null;
};

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows?: T[] }).rows ?? []);
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

export class AttendanceImportRepository {
  constructor(readonly database: Database) {}

  async sourceDocumentId(filename: string) {
    return (
      (
        await this.database
          .select({ id: businessSourceDocuments.id })
          .from(businessSourceDocuments)
          .where(eq(businessSourceDocuments.originalFilename, filename))
          .limit(1)
      )[0]?.id ?? null
    );
  }

  async seedRow(
    sourceDocumentId: string,
    row: AttendanceSourceRow,
    normalizedEventName: string,
    normalizedLocation: string,
  ) {
    await this.database
      .insert(attendanceImportRows)
      .values({
        sourceDocumentId,
        sourceRowNumber: row.sourceRowNumber,
        month: row.month,
        originalEventName: row.eventName,
        originalLocation: row.location,
        normalizedEventName,
        normalizedLocation,
        matchState: "pending",
      })
      .onConflictDoNothing({
        target: [attendanceImportRows.sourceDocumentId, attendanceImportRows.sourceRowNumber],
      });

    return (
      (
        await this.database
          .select()
          .from(attendanceImportRows)
          .where(
            and(
              eq(attendanceImportRows.sourceDocumentId, sourceDocumentId),
              eq(attendanceImportRows.sourceRowNumber, row.sourceRowNumber),
            ),
          )
          .limit(1)
      )[0] ?? null
    );
  }

  async seedYearStatus(importRowId: string, year: number, status: AttendanceSourceStatus) {
    await this.database
      .insert(attendanceImportYearStatuses)
      .values({ importRowId, year, status })
      .onConflictDoNothing({
        target: [attendanceImportYearStatuses.importRowId, attendanceImportYearStatuses.year],
      });
  }

  async listImportRows(sourceDocumentId?: string) {
    const rows = sourceDocumentId
      ? await this.database
          .select()
          .from(attendanceImportRows)
          .where(eq(attendanceImportRows.sourceDocumentId, sourceDocumentId))
          .orderBy(asc(attendanceImportRows.sourceRowNumber))
      : await this.database
          .select()
          .from(attendanceImportRows)
          .orderBy(asc(attendanceImportRows.sourceRowNumber));
    return rows;
  }

  async listYearStatuses(importRowIds: string[]) {
    if (importRowIds.length === 0) return [];
    return this.database
      .select()
      .from(attendanceImportYearStatuses)
      .where(inArray(attendanceImportYearStatuses.importRowId, importRowIds))
      .orderBy(asc(attendanceImportYearStatuses.year));
  }

  async updateMatch(suggestion: AttendanceMatchSuggestion) {
    if (suggestion.state === "confident" || suggestion.state === "pending" || suggestion.state === "new_profile_candidate") {
      await this.database
        .update(attendanceImportRows)
        .set({
          matchedOrganizationId: suggestion.organizationId,
          matchedLocationId: suggestion.organizationLocationId,
          matchState: suggestion.state,
          matchConfidence: String(suggestion.confidence),
          matchReason: suggestion.reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(attendanceImportRows.id, suggestion.importRowId),
            inArray(attendanceImportRows.matchState, ["pending", "confident", "new_profile_candidate"]),
          ),
        );
    }
  }

  async listActiveProfileLocationCandidates(): Promise<AttendanceMatchCandidate[]> {
    const rows = rowsOf<CandidateRow>(
      await this.database.execute(sql`
        select
          o.id as organization_id,
          o.name as organization_name,
          o.consolidated_into_id,
          l.id as location_id,
          coalesce(l.city, o.city) as city,
          coalesce(l.region, o.region) as region
        from organizations o
        left join organization_locations l on l.organization_id = o.id
        where o.consolidated_into_id is null
        order by o.name, o.id, l.id
      `),
    );
    return rows.map((row) => ({
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      consolidatedIntoId: row.consolidated_into_id,
      locationId: row.location_id,
      city: row.city,
      region: row.region,
    }));
  }

  async listForReview(state?: AttendanceImportMatchState) {
    const importRows = state
      ? await this.database
          .select()
          .from(attendanceImportRows)
          .where(eq(attendanceImportRows.matchState, state))
          .orderBy(asc(attendanceImportRows.sourceRowNumber))
      : await this.listImportRows();
    const [statuses, candidates] = await Promise.all([
      this.listYearStatuses(importRows.map((row) => row.id)),
      this.listActiveProfileLocationCandidates(),
    ]);
    const byRow = new Map<string, typeof statuses>();
    for (const status of statuses) {
      const list = byRow.get(status.importRowId) ?? [];
      list.push(status);
      byRow.set(status.importRowId, list);
    }
    return importRows.map((row) => {
      const matchedTarget = row.matchedOrganizationId
        ? candidates.find(
            (candidate) =>
              candidate.organizationId === row.matchedOrganizationId &&
              (row.matchedLocationId === null || candidate.locationId === row.matchedLocationId),
          ) ?? null
        : null;
      return {
        ...row,
        statuses: byRow.get(row.id) ?? [],
        matchedTarget,
      };
    });
  }

  async approve(input: {
    importRowId: string;
    organizationId: string;
    organizationLocationId: string | null;
    actorId: string;
  }) {
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(attendanceImportRows)
        .where(eq(attendanceImportRows.id, input.importRowId))
        .limit(1)
        .for("update");
      if (!row) return { ok: false as const, code: "NOT_FOUND" as const };

      if (
        row.matchState === "approved" &&
        (
          row.matchedOrganizationId !== input.organizationId ||
          (row.matchedLocationId ?? null) !== (input.organizationLocationId ?? null)
        )
      ) {
        return {
          ok: false as const,
          code: "ALREADY_APPROVED_DIFFERENT_TARGET" as const,
        };
      }

      const statuses = await transaction
        .select()
        .from(attendanceImportYearStatuses)
        .where(eq(attendanceImportYearStatuses.importRowId, row.id));
      const now = new Date();
      for (const status of statuses) {
        await transaction
          .insert(eventAttendanceHistory)
          .values({
            organizationId: input.organizationId,
            organizationLocationId: input.organizationLocationId,
            sourceImportRowId: row.id,
            year: status.year,
            month: row.month,
            status: status.status,
            originalEventName: row.originalEventName,
            originalLocation: row.originalLocation,
            approvedBy: input.actorId,
            approvedAt: now,
          })
          .onConflictDoNothing({
            target: [eventAttendanceHistory.sourceImportRowId, eventAttendanceHistory.year],
          });
      }

      const [updated] = await transaction
        .update(attendanceImportRows)
        .set({
          matchedOrganizationId: input.organizationId,
          matchedLocationId: input.organizationLocationId,
          matchState: "approved",
          matchConfidence: "1.000",
          matchReason: "Owner approved this profile/location match.",
          updatedAt: now,
        })
        .where(eq(attendanceImportRows.id, row.id))
        .returning();
      return { ok: true as const, row: updated!, historyCount: statuses.length };
    });
  }

  async reject(importRowId: string, reason: string) {
    const [row] = await this.database
      .update(attendanceImportRows)
      .set({
        matchState: "rejected",
        matchReason: reason.trim(),
        updatedAt: new Date(),
      })
      .where(eq(attendanceImportRows.id, importRowId))
      .returning();
    return row ?? null;
  }
}
