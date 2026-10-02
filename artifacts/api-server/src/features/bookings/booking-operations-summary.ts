import { effectiveResourceDates, type ResolvedDates } from "../booking-date-repair/date-evidence";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingPackageSelections,
  bookingResourceAssignments,
  bookingSpecialRequests,
  bookings,
  bookingOperationalWindows,
  packageTemplates,
  resourceConflictOverrides,
  resources,
  travelLegs,
  tripResourceAssignments,
  trips,
} from "@/db/schema";
import {
  summarizeBookingResources,
  type BookingResourceSummary,
} from "@/features/resources/resource-service";
import type {
  BookingResourceState,
  ResourceAssignmentRecord,
  ResourceConflictOverride,
  ResourceRecord,
} from "@/features/resources/resource-repository";
import type {
  ResourceReservation,
  ResourceWarning,
} from "@/features/resources/resource-types";
import type { TransferTimeLookup } from "@/features/resources/resource-conflicts";
import { createTripTransferTimeLookup } from "@/features/trips/transfer-time-lookup";

export type BookingOperationsSummary = {
  dateProvenance?: ResolvedDates;
  packageNames: string[];
  sharedAttractionTotal: number | null;
  pendingRequestCount: number;
  leg: { id: string; name: string; color: string } | null;
  warnings: Array<{
    id: string;
    kind: "package" | "resource" | "route" | "fuel";
    severity: "warning" | "blocking";
    message: string;
    href: string;
  }>;
};

export interface BookingOperationsSummaryProvider {
  getForBooking(bookingId: string): Promise<BookingOperationsSummary>;
}

export interface BatchBookingOperationsSummaryProvider
  extends BookingOperationsSummaryProvider {
  getForBookings(
    bookingIds: readonly string[],
  ): Promise<Map<string, BookingOperationsSummary>>;
}

export type BookingOperationsSummaryRecord = {
  booking: BookingResourceState & {
    leg: { id: string; name: string; color: string } | null;
  };
  packageNames: string[];
  pendingRequestCount: number;
  assignments: ResourceAssignmentRecord[];
  resources: ResourceRecord[];
  reservations: ResourceReservation[];
  overrides: ResourceConflictOverride[];
};

export interface BookingOperationsSummaryRepository {
  loadForBookings(
    bookingIds: readonly string[],
  ): Promise<BookingOperationsSummaryRecord[]>;
}

const emptySummary: BookingOperationsSummary = {
  packageNames: [],
  sharedAttractionTotal: null,
  pendingRequestCount: 0,
  leg: null,
  warnings: [],
};

function warningKind(warning: ResourceWarning) {
  return warning.code === "TRANSFER_TRIP_MISSING" ||
    warning.code === "RESOURCE_DATE_EVIDENCE_UNRESOLVED" ||
    warning.code === "PAINTBALL_TRANSFER_TIME" ||
    warning.code === "RESOURCE_LOCATION_UNKNOWN"
    ? "route" as const
    : "resource" as const;
}

function warningSeverity(warning: ResourceWarning) {
  if (warning.overridden) return "warning" as const;
  return warning.code === "RESOURCE_OVERLAP" ||
    warning.code === "RESOURCE_UNAVAILABLE" ||
    warning.code === "PAINTBALL_TRANSFER_TIME"
    ? "blocking" as const
    : "warning" as const;
}

function operationsWarning(
  bookingId: string,
  warning: ResourceWarning,
): BookingOperationsSummary["warnings"][number] {
  const overrideMessage = warning.override
    ? ` Overridden: ${warning.override.reason} · ` +
      `${warning.override.acknowledgedBy} · ` +
      warning.override.createdAt.toISOString()
    : "";
  return {
    id: warning.conflictKey,
    kind: warningKind(warning),
    severity: warningSeverity(warning),
    message: `${warning.message}${overrideMessage}`,
    href: `/bookings/${bookingId}/edit#resource-warnings`,
  };
}

function deterministicWarnings(
  warnings: BookingOperationsSummary["warnings"],
) {
  const kindOrder = { package: 0, resource: 1, route: 2, fuel: 3 };
  const severityOrder = { blocking: 0, warning: 1 };
  return [...warnings].sort(
    (first, second) =>
      kindOrder[first.kind] - kindOrder[second.kind] ||
      severityOrder[first.severity] - severityOrder[second.severity] ||
      first.id.localeCompare(second.id),
  );
}

export class CachedBookingOperationsSummaryProvider
implements BatchBookingOperationsSummaryProvider {
  private readonly cache = new Map<string, BookingOperationsSummary>();
  private readonly resourceSummaryCache =
    new Map<string, BookingResourceSummary>();

  constructor(
    private readonly repository: BookingOperationsSummaryRepository,
    private readonly transferTimeLookup: TransferTimeLookup,
  ) {}

  async getForBooking(bookingId: string): Promise<BookingOperationsSummary> {
    await this.getForBookings([bookingId]);
    return this.cache.get(bookingId) ?? { ...emptySummary };
  }

  async getResourceSummaryForBooking(
    bookingId: string,
  ): Promise<BookingResourceSummary | null> {
    await this.getForBookings([bookingId]);
    return this.resourceSummaryCache.get(bookingId) ?? null;
  }

  async getForBookings(
    bookingIds: readonly string[],
  ): Promise<Map<string, BookingOperationsSummary>> {
    const uniqueIds = [...new Set(bookingIds)].sort();
    const missingIds = uniqueIds.filter((bookingId) => !this.cache.has(bookingId));
    if (missingIds.length > 0) {
      const records = await this.repository.loadForBookings(missingIds);
      const loadedIds = new Set(records.map(({ booking }) => booking.id));
      for (const bookingId of missingIds) {
        if (!loadedIds.has(bookingId)) {
          this.cache.set(bookingId, { ...emptySummary });
        }
      }
      await Promise.all(records.map(async (record) => {
        const resourceSummary: BookingResourceSummary =
          await summarizeBookingResources({
            booking: record.booking,
            assignments: record.assignments,
            resources: record.resources,
            reservations: record.reservations,
            overrides: record.overrides,
            transferTimeLookup: this.transferTimeLookup,
          });
        this.resourceSummaryCache.set(record.booking.id, resourceSummary);
        const warnings = resourceSummary.warnings.map((warning) =>
          operationsWarning(record.booking.id, warning)
        );
        if (record.pendingRequestCount > 0) {
          warnings.push({
            id: `package-pending:${record.booking.id}`,
            kind: "package",
            severity: "warning",
            message:
              `${record.pendingRequestCount} special ${
                record.pendingRequestCount === 1 ? "request needs" : "requests need"
              } approval.`,
            href: `/bookings/${record.booking.id}/edit#special-requests`,
          });
        }
        this.cache.set(record.booking.id, {
          ...(record.booking.dateProvenance ? {dateProvenance:record.booking.dateProvenance} : {}),
          packageNames: [...record.packageNames].sort((first, second) =>
            first.localeCompare(second)
          ),
          sharedAttractionTotal: record.booking.physicalAttractionTotal,
          pendingRequestCount: record.pendingRequestCount,
          leg: record.booking.leg,
          warnings: deterministicWarnings(warnings),
        });
      }));
    }

    return new Map(
      uniqueIds.map((bookingId) => [
        bookingId,
        this.cache.get(bookingId) ?? { ...emptySummary },
      ]),
    );
  }
}

const terminalBookingStatuses = ["declined", "cancelled", "completed"] as const;
type DrizzleDatabase = typeof database;

export class DrizzleBookingOperationsSummaryRepository
implements BookingOperationsSummaryRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async loadForBookings(
    bookingIds: readonly string[],
  ): Promise<BookingOperationsSummaryRecord[]> {
    if (bookingIds.length === 0) return [];
    const ids = [...new Set(bookingIds)];
    const [bookingRows, packageRows, requestRows, assignmentRows, overrides] =
      await Promise.all([
        this.database
          .select({ booking: bookings, leg: travelLegs, dateProvenance:sql<ResolvedDates>`booking_resolved_dates(${bookings.id},${bookings.startsAt},${bookings.endsAt},${bookingOperationalWindows.startsAt},${bookingOperationalWindows.endsAt})` })
          .from(bookings)
          .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
          .leftJoin(bookingOperationalWindows,eq(bookings.id,bookingOperationalWindows.bookingId))
          .where(inArray(bookings.id, ids)),
        this.database
          .select({
            bookingId: bookingPackageSelections.bookingId,
            name: packageTemplates.name,
          })
          .from(bookingPackageSelections)
          .innerJoin(
            packageTemplates,
            eq(bookingPackageSelections.packageTemplateId, packageTemplates.id),
          )
          .where(inArray(bookingPackageSelections.bookingId, ids))
          .orderBy(asc(packageTemplates.name), asc(packageTemplates.id)),
        this.database
          .select({ bookingId: bookingSpecialRequests.bookingId })
          .from(bookingSpecialRequests)
          .where(and(
            inArray(bookingSpecialRequests.bookingId, ids),
            eq(bookingSpecialRequests.approvalStatus, "needs_approval"),
          )),
        this.database
          .select({ assignment: bookingResourceAssignments, resource: resources })
          .from(bookingResourceAssignments)
          .innerJoin(
            resources,
            eq(bookingResourceAssignments.resourceId, resources.id),
          )
          .where(inArray(bookingResourceAssignments.bookingId, ids))
          .orderBy(asc(bookingResourceAssignments.id)),
        this.database
          .select()
          .from(resourceConflictOverrides)
          .where(inArray(resourceConflictOverrides.bookingId, ids)),
      ]);

    const resourceIds = [
      ...new Set(assignmentRows.map(({ resource }) => resource.id)),
    ];
    const reservationRows = resourceIds.length === 0
      ? []
      : await this.database
          .select({
            assignment: bookingResourceAssignments,
            booking: bookings,
            dateProvenance:sql<ResolvedDates>`booking_resolved_dates(${bookings.id},${bookings.startsAt},${bookings.endsAt},${bookingOperationalWindows.startsAt},${bookingOperationalWindows.endsAt})`,
            resource: resources,
          })
          .from(bookingResourceAssignments)
          .innerJoin(
            bookings,
            eq(bookingResourceAssignments.bookingId, bookings.id),
          )
          .leftJoin(bookingOperationalWindows,eq(bookings.id,bookingOperationalWindows.bookingId))
          .innerJoin(
            resources,
            eq(bookingResourceAssignments.resourceId, resources.id),
          )
          .where(and(
            inArray(bookingResourceAssignments.resourceId, resourceIds),
            notInArray(bookings.status, [...terminalBookingStatuses]),
          ));
    // Trip assignments also reserve the resource for the trip's window, so
    // overlap/transfer checks account for planned trips too.
    const tripReservationRows = resourceIds.length === 0
      ? []
      : await this.database
          .select({
            assignment: tripResourceAssignments,
            trip: trips,
            resource: resources,
          })
          .from(tripResourceAssignments)
          .innerJoin(trips, eq(tripResourceAssignments.tripId, trips.id))
          .innerJoin(
            resources,
            eq(tripResourceAssignments.resourceId, resources.id),
          )
          .where(inArray(tripResourceAssignments.resourceId, resourceIds));
    const tripReservations: ResourceReservation[] = tripReservationRows.map(
      ({ assignment, trip, resource }) => ({
        assignmentId: `trip:${assignment.id}`,
        bookingId: trip.id,
        bookingName: `Trip: ${trip.name}`,
        resourceId: resource.id,
        resourceCode: resource.code,
        resourceName: resource.name,
        resourceStatus: resource.status,
        countsAsAttraction: false,
        movable: resource.movable,
        setupMinutes: 0,
        teardownMinutes: 0,
        minimumTransferMinutes: resource.minimumTransferMinutes,
        startsAt: trip.startDate,
        endsAt: trip.endDate,
        location:
          trip.startLatitude === null || trip.startLongitude === null
            ? null
            : { latitude: trip.startLatitude, longitude: trip.startLongitude },
      }),
    );
    const reservations: ResourceReservation[] = reservationRows.map(
      ({ assignment, booking, resource, dateProvenance }) => ({
        assignmentId: assignment.id,
        bookingId: booking.id,
        bookingName: booking.name,
        resourceId: resource.id,
        resourceCode: resource.code,
        resourceName: resource.name,
        resourceStatus: resource.status,
        countsAsAttraction: resource.countsAsAttraction,
        movable: resource.movable,
        setupMinutes: resource.setupMinutes,
        teardownMinutes: resource.teardownMinutes,
        minimumTransferMinutes: resource.minimumTransferMinutes,
        ...effectiveResourceDates(dateProvenance),
        dateProvenance,
        location:
          booking.latitude === null || booking.longitude === null
            ? null
            : { latitude: booking.latitude, longitude: booking.longitude },
      }),
    );

    return bookingRows.map(({ booking, leg, dateProvenance }) => {
      const bookingAssignments = assignmentRows.filter(
        ({ assignment }) => assignment.bookingId === booking.id,
      );
      return {
        booking: {
          id: booking.id,
          name: booking.name,
          ...effectiveResourceDates(dateProvenance),
          dateProvenance,
          latitude: booking.latitude,
          longitude: booking.longitude,
          physicalAttractionTotal: booking.physicalAttractionTotal,
          leg: leg
            ? { id: leg.id, name: leg.name, color: leg.color }
            : null,
        },
        packageNames: packageRows
          .filter((row) => row.bookingId === booking.id)
          .map(({ name }) => name),
        pendingRequestCount: requestRows.filter(
          (row) => row.bookingId === booking.id,
        ).length,
        assignments: bookingAssignments.map(({ assignment }) => ({
          id: assignment.id,
          bookingId: assignment.bookingId,
          resourceId: assignment.resourceId,
          attributionSource: assignment.attributionSource,
        })),
        resources: bookingAssignments.map(({ resource }) => ({
          id: resource.id,
          code: resource.code,
          name: resource.name,
          category: resource.category,
          countsAsAttraction: resource.countsAsAttraction,
          movable: resource.movable,
          setupMinutes: resource.setupMinutes,
          teardownMinutes: resource.teardownMinutes,
          minimumTransferMinutes: resource.minimumTransferMinutes,
          status: resource.status,
        })),
        reservations: [...reservations, ...tripReservations].filter((reservation) =>
          resourceIds.includes(reservation.resourceId) &&
          bookingAssignments.some(
            ({ resource }) => resource.id === reservation.resourceId,
          )
        ),
        overrides: overrides.filter(
          (override) => override.bookingId === booking.id,
        ),
      };
    });
  }
}

export const unavailableTransferTimeLookup: TransferTimeLookup = {
  estimateMinutes: async () => null,
};

export function createBookingOperationsSummaryProvider(
  db: DrizzleDatabase,
): CachedBookingOperationsSummaryProvider {
  return new CachedBookingOperationsSummaryProvider(
    new DrizzleBookingOperationsSummaryRepository(db),
    createTripTransferTimeLookup(db),
  );
}
