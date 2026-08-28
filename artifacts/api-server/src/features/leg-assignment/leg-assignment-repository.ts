import { asc, eq, inArray, isNull } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingLegAssignments,
  bookingOperationalWindows,
  bookings,
  eventFamilyMembers,
  travelLegs,
} from "@/db/schema";
import type { LegAssignmentDecision } from "./leg-assignment-domain";

type DrizzleDatabase = typeof database;

export type RouteStop = {
  bookingId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  startsAt: Date;
  endsAt: Date;
};

export type AssignmentTarget = {
  bookingId: string;
  name: string;
  organizationId: string | null;
  status: string;
  travelLegId: string | null;
  latitude: number | null;
  longitude: number | null;
  startsAt: Date;
  endsAt: Date;
};

export type AssignmentCandidateContext = {
  legId: string;
  legName: string;
  priorYearMatch: boolean;
  confirmedEventCount: number;
  previousStop: RouteStop | null;
  nextStop: RouteStop | null;
};

function year(value: Date) {
  return value.getUTCFullYear();
}

function toWindow(input: {
  startsAt: Date | null;
  endsAt: Date | null;
  operationalStartsAt: Date | null;
  operationalEndsAt: Date | null;
}) {
  const startsAt = input.operationalStartsAt ?? input.startsAt;
  const endsAt = input.operationalEndsAt ?? input.endsAt ?? startsAt;
  return startsAt && endsAt ? { startsAt, endsAt } : null;
}

export class LegAssignmentRepository {
  constructor(private readonly db: DrizzleDatabase = database) {}

  async loadTarget(bookingId: string): Promise<AssignmentTarget | null> {
    const [row] = await this.db
      .select({
        booking: bookings,
        operationalStartsAt: bookingOperationalWindows.startsAt,
        operationalEndsAt: bookingOperationalWindows.endsAt,
      })
      .from(bookings)
      .leftJoin(bookingOperationalWindows, eq(bookingOperationalWindows.bookingId, bookings.id))
      .where(eq(bookings.id, bookingId))
      .limit(1);
    if (!row) return null;
    const window = toWindow({
      startsAt: row.booking.startsAt,
      endsAt: row.booking.endsAt,
      operationalStartsAt: row.operationalStartsAt,
      operationalEndsAt: row.operationalEndsAt,
    });
    if (!window) return null;
    return {
      bookingId: row.booking.id,
      name: row.booking.name,
      organizationId: row.booking.organizationId,
      status: row.booking.status,
      travelLegId: row.booking.travelLegId,
      latitude: row.booking.latitude,
      longitude: row.booking.longitude,
      ...window,
    };
  }

  async loadCandidateContexts(bookingId: string): Promise<AssignmentCandidateContext[]> {
    const target = await this.loadTarget(bookingId);
    if (!target) return [];

    const activeLegs = await this.db
      .select()
      .from(travelLegs)
      .where(isNull(travelLegs.archivedAt))
      .orderBy(asc(travelLegs.sortOrder));
    if (!activeLegs.length) return [];

    let familyOrganizationIds: string[] = target.organizationId ? [target.organizationId] : [];
    if (target.organizationId) {
      const [membership] = await this.db
        .select({ familyId: eventFamilyMembers.familyId })
        .from(eventFamilyMembers)
        .where(eq(eventFamilyMembers.organizationId, target.organizationId))
        .limit(1);
      if (membership) {
        const familyMembers = await this.db
          .select({ organizationId: eventFamilyMembers.organizationId })
          .from(eventFamilyMembers)
          .where(eq(eventFamilyMembers.familyId, membership.familyId));
        familyOrganizationIds = familyMembers.map((row) => row.organizationId);
      }
    }

    const routeRows = await this.db
      .select({
        booking: bookings,
        operationalStartsAt: bookingOperationalWindows.startsAt,
        operationalEndsAt: bookingOperationalWindows.endsAt,
      })
      .from(bookings)
      .leftJoin(bookingOperationalWindows, eq(bookingOperationalWindows.bookingId, bookings.id));

    const usable = routeRows
      .filter(({ booking }) => booking.id !== bookingId)
      .filter(({ booking }) => booking.travelLegId && (booking.status === "confirmed" || booking.status === "completed"))
      .map((row) => {
        const window = toWindow({
          startsAt: row.booking.startsAt,
          endsAt: row.booking.endsAt,
          operationalStartsAt: row.operationalStartsAt,
          operationalEndsAt: row.operationalEndsAt,
        });
        return window ? { ...row.booking, ...window } : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const priorYear = year(target.startsAt) - 1;
    return activeLegs.map((leg) => {
      const legRows = usable
        .filter((row) => row.travelLegId === leg.id)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      const priorYearMatch = legRows.some(
        (row) =>
          year(row.startsAt) === priorYear &&
          row.organizationId !== null &&
          familyOrganizationIds.includes(row.organizationId),
      );
      const confirmedEventCount = new Set(
        legRows
          .filter((row) => year(row.startsAt) === year(target.startsAt))
          .map((row) => row.id),
      ).size;
      const previous = [...legRows]
        .filter((row) => row.endsAt.getTime() <= target.startsAt.getTime())
        .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0] ?? null;
      const next = legRows
        .filter((row) => row.startsAt.getTime() >= target.endsAt.getTime())
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ?? null;
      const toStop = (row: typeof previous): RouteStop | null => row ? ({
        bookingId: row.id,
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      }) : null;
      return {
        legId: leg.id,
        legName: leg.name,
        priorYearMatch,
        confirmedEventCount,
        previousStop: toStop(previous),
        nextStop: toStop(next),
      };
    });
  }

  async loadPersistedDecision(bookingId: string): Promise<LegAssignmentDecision | null> {
    const [row] = await this.db
      .select()
      .from(bookingLegAssignments)
      .where(eq(bookingLegAssignments.bookingId, bookingId))
      .limit(1);
    if (!row) return null;
    return {
      bookingId: row.bookingId,
      assignedLegId: row.assignedLegId,
      suggestedLegId: row.suggestedLegId,
      source: row.source as LegAssignmentDecision["source"],
      explanation: row.explanation,
      warning: row.warning as LegAssignmentDecision["warning"],
      previousStopDriveMinutes: row.previousStopDriveMinutes,
      nextStopDriveMinutes: row.nextStopDriveMinutes,
      confidence: row.confidence as LegAssignmentDecision["confidence"],
    };
  }

  async saveDecision(decision: LegAssignmentDecision): Promise<void> {
    await this.db
      .insert(bookingLegAssignments)
      .values({
        bookingId: decision.bookingId,
        assignedLegId: decision.assignedLegId,
        suggestedLegId: decision.suggestedLegId,
        source: decision.source,
        explanation: decision.explanation,
        warning: decision.warning,
        previousStopDriveMinutes: decision.previousStopDriveMinutes,
        nextStopDriveMinutes: decision.nextStopDriveMinutes,
        confidence: decision.confidence,
      })
      .onConflictDoUpdate({
        target: bookingLegAssignments.bookingId,
        set: {
          assignedLegId: decision.assignedLegId,
          suggestedLegId: decision.suggestedLegId,
          source: decision.source,
          explanation: decision.explanation,
          warning: decision.warning,
          previousStopDriveMinutes: decision.previousStopDriveMinutes,
          nextStopDriveMinutes: decision.nextStopDriveMinutes,
          confidence: decision.confidence,
          updatedAt: new Date(),
        },
      });
  }

  async assignLeg(bookingId: string, travelLegId: string): Promise<void> {
    await this.db.update(bookings).set({ travelLegId, updatedAt: new Date() }).where(eq(bookings.id, bookingId));
  }
}
