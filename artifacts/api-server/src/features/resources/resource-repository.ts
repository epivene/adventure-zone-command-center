import { effectiveResourceDates, type ResolvedDates } from "../booking-date-repair/date-evidence";
import { commitmentTransaction, reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingResourceAssignments,
  bookings,
  bookingOperationalWindows,
  packageTemplates,
  resourceConflictOverrides,
  resourcePackageTags,
  resources,
  travelLegs,
  tripResourceAssignments,
  trips,
} from "@/db/schema";
import {
  recordAuditEntry,
  type AuditChange,
} from "@/features/audit/audit-service";
import type { ResourceInput } from "@/features/resources/resource-input";

import type {
  ResourceAvailabilityStatus,
  ResourceReservation,
} from "./resource-types";

const terminalBookingStatusValues = [
  "declined",
  "cancelled",
  "completed",
] as const;
const terminalBookingStatuses: ReadonlySet<string> = new Set(
  terminalBookingStatusValues,
);

export type AuditEntry = AuditChange;

export type BookingResourceState = {
  dateProvenance?: ResolvedDates;
  id: string;
  name: string;
  startsAt: Date | null;
  endsAt: Date | null;
  latitude: number | null;
  longitude: number | null;
  physicalAttractionTotal: number | null;
};

export type ResourceRecord = {
  id: string;
  code: string;
  name: string;
  category: string;
  countsAsAttraction: boolean;
  movable: boolean;
  setupMinutes: number;
  teardownMinutes: number;
  minimumTransferMinutes: number;
  status: ResourceAvailabilityStatus;
};

export type ResourceAssignmentRecord = {
  id: string;
  bookingId: string;
  resourceId: string;
  attributionSource: "inferred" | "manual";
};

export type ResourceConflictOverride = {
  id: string;
  bookingId: string;
  resourceId: string | null;
  conflictKey: string;
  reason: string;
  acknowledgedBy: string;
  createdAt: Date;
};

export type CreateResourceOverrideInput = Omit<
  ResourceConflictOverride,
  "id" | "createdAt"
>;

export interface ResourceTransaction {
  findBookingForUpdate(
    bookingId: string,
  ): Promise<BookingResourceState | null>;
  findCurrentAssignmentsForUpdate(
    bookingId: string,
  ): Promise<ResourceAssignmentRecord[]>;
  findResourcesForUpdate(
    resourceIds: readonly string[],
  ): Promise<ResourceRecord[]>;
  replaceBookingAssignments(
    bookingId: string,
    resourceIds: readonly string[],
    now: Date,
  ): Promise<ResourceAssignmentRecord[]>;
  listReservationsForResources(
    resourceIds: readonly string[],
  ): Promise<ResourceReservation[]>;
  listOverrides(
    bookingId: string,
    conflictKeys: readonly string[],
  ): Promise<ResourceConflictOverride[]>;
  createOverride(
    input: CreateResourceOverrideInput,
    now: Date,
  ): Promise<ResourceConflictOverride>;
  createAuditEntry(entry: AuditEntry): Promise<void>;
}

export interface ResourceRepository {
  transaction<T>(
    operation: (transaction: ResourceTransaction) => Promise<T>,
  ): Promise<T>;
}

type DrizzleDatabase = typeof database;
type DrizzleResourceWriter = Pick<
  DrizzleDatabase,
  "select" | "insert" | "delete"
>;

function assignmentRecord(
  assignment: typeof bookingResourceAssignments.$inferSelect,
): ResourceAssignmentRecord {
  return {
    id: assignment.id,
    bookingId: assignment.bookingId,
    resourceId: assignment.resourceId,
    attributionSource: assignment.attributionSource,
  };
}

class DrizzleResourceTransaction implements ResourceTransaction {
  constructor(private readonly database: DrizzleResourceWriter) {}

  async findBookingForUpdate(
    bookingId: string,
  ): Promise<BookingResourceState | null> {
    const [booking] = await this.database
      .select({
        dateProvenance:sql<ResolvedDates>`booking_resolved_dates(${bookings.id},${bookings.startsAt},${bookings.endsAt},${bookingOperationalWindows.startsAt},${bookingOperationalWindows.endsAt})`,
        id: bookings.id,
        name: bookings.name,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        latitude: bookings.latitude,
        longitude: bookings.longitude,
        physicalAttractionTotal: bookings.physicalAttractionTotal,
      })
      .from(bookings).leftJoin(bookingOperationalWindows,eq(bookings.id,bookingOperationalWindows.bookingId))
      .where(eq(bookings.id, bookingId))
      .limit(1)
      .for("update",{of:bookings});
    return booking ? {...booking,...effectiveResourceDates(booking.dateProvenance)} : null;
  }

  async findCurrentAssignmentsForUpdate(
    bookingId: string,
  ): Promise<ResourceAssignmentRecord[]> {
    const assignments = await this.database
      .select()
      .from(bookingResourceAssignments)
      .where(eq(bookingResourceAssignments.bookingId, bookingId))
      .for("update");
    return assignments.map(assignmentRecord);
  }

  async findResourcesForUpdate(
    resourceIds: readonly string[],
  ): Promise<ResourceRecord[]> {
    if (resourceIds.length === 0) return [];
    const records = await this.database
      .select()
      .from(resources)
      .where(inArray(resources.id, [...resourceIds]))
      .orderBy(resources.id)
      .for("update");
    return records.map((record) => ({
      id: record.id,
      code: record.code,
      name: record.name,
      category: record.category,
      countsAsAttraction: record.countsAsAttraction,
      movable: record.movable,
      setupMinutes: record.setupMinutes,
      teardownMinutes: record.teardownMinutes,
      minimumTransferMinutes: record.minimumTransferMinutes,
      status: record.status,
    }));
  }

  async replaceBookingAssignments(
    bookingId: string,
    resourceIds: readonly string[],
    now: Date,
  ): Promise<ResourceAssignmentRecord[]> {
    const current = await this.database
      .select()
      .from(bookingResourceAssignments)
      .where(eq(bookingResourceAssignments.bookingId, bookingId));
    const desired = new Set(resourceIds);
    const retainedResourceIds = new Set(
      current
        .filter(({ resourceId }) => desired.has(resourceId))
        .map(({ resourceId }) => resourceId),
    );

    if (resourceIds.length === 0) {
      await this.database
        .delete(bookingResourceAssignments)
        .where(eq(bookingResourceAssignments.bookingId, bookingId));
    } else {
      await this.database
        .delete(bookingResourceAssignments)
        .where(
          and(
            eq(bookingResourceAssignments.bookingId, bookingId),
            notInArray(bookingResourceAssignments.resourceId, [...resourceIds]),
          ),
        );
    }

    const additions = resourceIds.filter(
      (resourceId) => !retainedResourceIds.has(resourceId),
    );
    if (additions.length > 0) {
      await this.database.insert(bookingResourceAssignments).values(
        additions.map((resourceId) => ({
          bookingId,
          resourceId,
          attributionSource: "inferred" as const,
          createdAt: now,
          updatedAt: now,
        })),
      );
    }

    const finalAssignments = await this.database
      .select()
      .from(bookingResourceAssignments)
      .where(eq(bookingResourceAssignments.bookingId, bookingId));
    return finalAssignments.map(assignmentRecord);
  }

  async listReservationsForResources(
    resourceIds: readonly string[],
  ): Promise<ResourceReservation[]> {
    if (resourceIds.length === 0) return [];
    const rows = await this.database
      .select({
        assignment: bookingResourceAssignments,
        booking: bookings,
        dateProvenance:sql<ResolvedDates>`booking_resolved_dates(${bookings.id},${bookings.startsAt},${bookings.endsAt},${bookingOperationalWindows.startsAt},${bookingOperationalWindows.endsAt})`,
        resource: resources,
      })
      .from(bookingResourceAssignments)
      .innerJoin(
        bookings,
        eq(bookings.id, bookingResourceAssignments.bookingId),
      )
      .leftJoin(bookingOperationalWindows,eq(bookings.id,bookingOperationalWindows.bookingId))
      .innerJoin(
        resources,
        eq(resources.id, bookingResourceAssignments.resourceId),
      )
      .where(
        and(
          inArray(bookingResourceAssignments.resourceId, [...resourceIds]),
          notInArray(bookings.status, [...terminalBookingStatusValues]),
        ),
      );
    // Trip assignments reserve the resource for the trip's date window, so
    // configuring a booking against a resource already committed to an
    // overlapping trip surfaces the same overlap/transfer warnings.
    const tripRows = await this.database
      .select({
        assignment: tripResourceAssignments,
        trip: trips,
        resource: resources,
      })
      .from(tripResourceAssignments)
      .innerJoin(trips, eq(trips.id, tripResourceAssignments.tripId))
      .innerJoin(
        resources,
        eq(resources.id, tripResourceAssignments.resourceId),
      )
      .where(inArray(tripResourceAssignments.resourceId, [...resourceIds]));
    const tripReservations: ResourceReservation[] = tripRows.map(
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
    const bookingReservations = rows
      .filter(({ booking }) => !terminalBookingStatuses.has(booking.status))
      .map(({ assignment, booking, resource, dateProvenance }) => ({
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
            : {
                latitude: booking.latitude,
                longitude: booking.longitude,
              },
      }));
    return [...bookingReservations, ...tripReservations];
  }

  async listOverrides(
    bookingId: string,
    conflictKeys: readonly string[],
  ): Promise<ResourceConflictOverride[]> {
    if (conflictKeys.length === 0) return [];
    return this.database
      .select()
      .from(resourceConflictOverrides)
      .where(
        and(
          eq(resourceConflictOverrides.bookingId, bookingId),
          inArray(resourceConflictOverrides.conflictKey, [...conflictKeys]),
        ),
      );
  }

  async createOverride(
    input: CreateResourceOverrideInput,
    now: Date,
  ): Promise<ResourceConflictOverride> {
    const [created] = await this.database
      .insert(resourceConflictOverrides)
      .values({ ...input, createdAt: now })
      .returning();
    if (!created) throw new Error("Could not store the conflict override.");
    return created;
  }

  createAuditEntry(entry: AuditEntry): Promise<void> {
    return recordAuditEntry(this.database, entry);
  }
}

export class DrizzleResourceRepository implements ResourceRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  transaction<T>(
    operation: (transaction: ResourceTransaction) => Promise<T>,
  ): Promise<T> {
    return commitmentTransaction(this.database, (transaction) =>
      operation(new DrizzleResourceTransaction(transaction)),
    );
  }
}

export type ResourceInventoryRecord = ResourceRecord & {
  normalTravelLegId: string | null;
  packageTemplateIds: string[];
};

export type ResourceSettingsErrorCode =
  | "RESOURCE_NOT_FOUND"
  | "DUPLICATE_RESOURCE_CODE"
  | "UNKNOWN_PACKAGE_TAG"
  | "INACTIVE_PACKAGE_TAG"
  | "UNKNOWN_TRAVEL_LEG"
  | "RESOURCE_CODE_IMMUTABLE";

export class ResourceSettingsError extends Error {
  constructor(readonly code: ResourceSettingsErrorCode) {
    super(code);
    this.name = "ResourceSettingsError";
  }
}

export interface ResourceSettingsRepository {
  listResources(): Promise<ResourceInventoryRecord[]>;
  upsertResource(
    input: ResourceInput,
    actorId: string,
  ): Promise<ResourceInventoryRecord>;
}

function isDuplicateResourceCode(error: unknown) {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (
      record.code === "23505" &&
      (
        record.constraint_name === "resources_code_unique" ||
        record.constraint === "resources_code_unique"
      )
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

function resourceSettingsSnapshot(
  resource: ResourceInventoryRecord,
) {
  return {
    code: resource.code,
    name: resource.name,
    category: resource.category,
    countsAsAttraction: resource.countsAsAttraction,
    packageTemplateIds: [...resource.packageTemplateIds].sort(),
    normalTravelLegId: resource.normalTravelLegId,
    movable: resource.movable,
    setupMinutes: resource.setupMinutes,
    teardownMinutes: resource.teardownMinutes,
    minimumTransferMinutes: resource.minimumTransferMinutes,
    status: resource.status,
  };
}

function toInventoryRecord(
  record: typeof resources.$inferSelect,
  packageTemplateIds: string[],
): ResourceInventoryRecord {
  return {
    id: record.id,
    code: record.code,
    name: record.name,
    category: record.category,
    countsAsAttraction: record.countsAsAttraction,
    normalTravelLegId: record.normalTravelLegId,
    movable: record.movable,
    setupMinutes: record.setupMinutes,
    teardownMinutes: record.teardownMinutes,
    minimumTransferMinutes: record.minimumTransferMinutes,
    status: record.status,
    packageTemplateIds,
  };
}

export class DrizzleResourceSettingsRepository
implements ResourceSettingsRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async listResources(): Promise<ResourceInventoryRecord[]> {
    const rows = await this.database
      .select({
        resource: resources,
        packageTemplateId: resourcePackageTags.packageTemplateId,
      })
      .from(resources)
      .leftJoin(
        resourcePackageTags,
        eq(resourcePackageTags.resourceId, resources.id),
      )
      .orderBy(
        asc(resources.name),
        asc(resources.id),
        asc(resourcePackageTags.packageTemplateId),
      );
    const records = new Map<string, ResourceInventoryRecord>();
    for (const row of rows) {
      const record =
        records.get(row.resource.id) ?? toInventoryRecord(row.resource, []);
      if (row.packageTemplateId !== null) {
        record.packageTemplateIds.push(row.packageTemplateId);
      }
      records.set(record.id, record);
    }
    return [...records.values()].map((record) => ({
      ...record,
      packageTemplateIds: record.packageTemplateIds.sort(),
    }));
  }

  async upsertResource(
    input: ResourceInput,
    actorId: string,
  ): Promise<ResourceInventoryRecord> {
    try {
      return await reconcileCapacityFacts(this.database, "resource-inventory", async (transaction) => {
        const [currentRow] = input.id
          ? await transaction
              .select()
              .from(resources)
              .where(eq(resources.id, input.id))
              .limit(1)
              .for("update")
          : [];
        if (input.id && !currentRow) {
          throw new ResourceSettingsError("RESOURCE_NOT_FOUND");
        }
        if (currentRow && currentRow.code !== input.code) {
          throw new ResourceSettingsError("RESOURCE_CODE_IMMUTABLE");
        }

        const currentTags = currentRow
          ? await transaction
              .select({
                id: resourcePackageTags.id,
                packageTemplateId: resourcePackageTags.packageTemplateId,
              })
              .from(resourcePackageTags)
              .where(eq(resourcePackageTags.resourceId, currentRow.id))
          : [];
        const currentTagIds = new Set(
          currentTags.map(({ packageTemplateId }) => packageTemplateId),
        );

        const selectedTemplates =
          input.packageTemplateIds.length === 0
            ? []
            : await transaction
                .select({
                  id: packageTemplates.id,
                  active: packageTemplates.active,
                })
                .from(packageTemplates)
                .where(
                  inArray(packageTemplates.id, [...input.packageTemplateIds]),
                )
                .for("share");
        if (selectedTemplates.length !== input.packageTemplateIds.length) {
          throw new ResourceSettingsError("UNKNOWN_PACKAGE_TAG");
        }
        if (
          selectedTemplates.some(
            (template) =>
              !template.active && !currentTagIds.has(template.id),
          )
        ) {
          throw new ResourceSettingsError("INACTIVE_PACKAGE_TAG");
        }

        if (input.normalTravelLegId) {
          const [leg] = await transaction
            .select({ id: travelLegs.id })
            .from(travelLegs)
            .where(eq(travelLegs.id, input.normalTravelLegId))
            .limit(1);
          if (!leg) {
            throw new ResourceSettingsError("UNKNOWN_TRAVEL_LEG");
          }
        }

        const values = {
          code: input.code,
          name: input.name,
          category: input.category,
          countsAsAttraction: input.countsAsAttraction,
          normalTravelLegId: input.normalTravelLegId,
          movable: input.movable,
          setupMinutes: input.setupMinutes,
          teardownMinutes: input.teardownMinutes,
          minimumTransferMinutes: input.minimumTransferMinutes,
          status: input.status,
          updatedAt: new Date(),
        };
        const [savedRow] = currentRow
          ? await transaction
              .update(resources)
              .set(values)
              .where(eq(resources.id, currentRow.id))
              .returning()
          : await transaction
              .insert(resources)
              .values(values)
              .returning();
        if (!savedRow) {
          throw new ResourceSettingsError("RESOURCE_NOT_FOUND");
        }

        const desiredTagIds = new Set(input.packageTemplateIds);
        const removedTagIds = currentTags
          .filter(({ packageTemplateId }) =>
            !desiredTagIds.has(packageTemplateId)
          )
          .map(({ packageTemplateId }) => packageTemplateId);
        if (removedTagIds.length > 0) {
          await transaction
            .delete(resourcePackageTags)
            .where(
              and(
                eq(resourcePackageTags.resourceId, savedRow.id),
                inArray(resourcePackageTags.packageTemplateId, removedTagIds),
              ),
            );
        }
        const addedTagIds = input.packageTemplateIds.filter(
          (packageTemplateId) => !currentTagIds.has(packageTemplateId),
        );
        if (addedTagIds.length > 0) {
          await transaction.insert(resourcePackageTags).values(
            addedTagIds.map((packageTemplateId) => ({
              resourceId: savedRow.id,
              packageTemplateId,
            })),
          );
        }

        const saved = toInventoryRecord(savedRow, [
          ...input.packageTemplateIds,
        ]);
        await recordAuditEntry(transaction, {
          entityType: "resource",
          entityId: saved.id,
          action: currentRow ? "update" : "create",
          before: currentRow
            ? resourceSettingsSnapshot(
                toInventoryRecord(
                  currentRow,
                  currentTags.map(({ packageTemplateId }) => packageTemplateId),
                ),
              )
            : null,
          after: {
            ...resourceSettingsSnapshot(saved),
            actorId,
          },
        });
        return saved;
      });
    } catch (error) {
      if (error instanceof ResourceSettingsError) throw error;
      if (isDuplicateResourceCode(error)) {
        throw new ResourceSettingsError("DUPLICATE_RESOURCE_CODE");
      }
      throw error;
    }
  }
}
