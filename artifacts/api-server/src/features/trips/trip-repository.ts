import { and, asc, eq, inArray, lte, gte, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookings,
  resources,
  travelLegs,
  tripResourceAssignments,
  tripSegments,
  tripStops,
  trips,
} from "@/db/schema";
import { recordAuditEntry } from "@/features/audit/audit-service";
import type { TripEstimateSource } from "./trip-math";

export type TripRecord = {
  id: string;
  travelLegId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  startLabel: string;
  startLatitude: number | null;
  startLongitude: number | null;
  endLabel: string;
  endLatitude: number | null;
  endLongitude: number | null;
  vehicleName: string | null;
  mpg: number | null;
  fuelPricePerGallon: number | null;
  routeConfirmedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TripListItem = TripRecord & {
  legName: string;
  legColor: string;
  stopCount: number;
};

export type TripStopRecord = {
  id: string;
  tripId: string;
  bookingId: string;
  sortOrder: number;
  bookingName: string;
  city: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string;
  probability: string | null;
};

export type TripSegmentRecord = {
  id: string;
  tripId: string;
  sequence: number;
  fromKey: string;
  toKey: string;
  fromLabel: string;
  toLabel: string;
  miles: number | null;
  minutes: number | null;
  source: TripEstimateSource | null;
  estimatedAt: Date | null;
  overrideMiles: number | null;
  overrideMinutes: number | null;
};

export type NewTripSegment = Omit<TripSegmentRecord, "id" | "tripId">;

export type TripResourceRecord = {
  assignmentId: string;
  resourceId: string;
  code: string;
  name: string;
  category: string;
  movable: boolean;
};

export type TripAuditChange = {
  entityId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export interface TripRepository {
  createTrip(values: Omit<TripRecord, "id" | "createdAt" | "updatedAt" | "routeConfirmedAt">): Promise<TripRecord>;
  getTrip(id: string): Promise<TripRecord | null>;
  listTrips(options?: { travelLegId?: string }): Promise<TripListItem[]>;
  updateTrip(id: string, values: Partial<Omit<TripRecord, "id" | "createdAt" | "updatedAt">>): Promise<TripRecord | null>;
  deleteTrip(id: string): Promise<boolean>;

  listStops(tripId: string): Promise<TripStopRecord[]>;
  addStop(tripId: string, bookingId: string): Promise<TripStopRecord | null>;
  removeStop(tripId: string, stopId: string): Promise<boolean>;
  setStopOrder(tripId: string, orderedStopIds: readonly string[]): Promise<boolean>;

  listSegments(tripId: string): Promise<TripSegmentRecord[]>;
  replaceSegments(tripId: string, segments: readonly NewTripSegment[]): Promise<void>;
  updateSegmentOverride(
    tripId: string,
    segmentId: string,
    override: { overrideMiles: number | null; overrideMinutes: number | null },
  ): Promise<TripSegmentRecord | null>;

  listResources(tripId: string): Promise<TripResourceRecord[]>;
  addResource(tripId: string, resourceId: string): Promise<TripResourceRecord | null>;
  removeResource(tripId: string, resourceId: string): Promise<boolean>;

  audit(change: TripAuditChange): Promise<void>;
}

type DrizzleDatabase = typeof database;

const tripSelection = {
  id: trips.id,
  travelLegId: trips.travelLegId,
  name: trips.name,
  startDate: trips.startDate,
  endDate: trips.endDate,
  startLabel: trips.startLabel,
  startLatitude: trips.startLatitude,
  startLongitude: trips.startLongitude,
  endLabel: trips.endLabel,
  endLatitude: trips.endLatitude,
  endLongitude: trips.endLongitude,
  vehicleName: trips.vehicleName,
  mpg: trips.mpg,
  fuelPricePerGallon: trips.fuelPricePerGallon,
  routeConfirmedAt: trips.routeConfirmedAt,
  notes: trips.notes,
  createdAt: trips.createdAt,
  updatedAt: trips.updatedAt,
} as const;

const stopSelection = {
  id: tripStops.id,
  tripId: tripStops.tripId,
  bookingId: tripStops.bookingId,
  sortOrder: tripStops.sortOrder,
  bookingName: bookings.name,
  city: bookings.city,
  region: bookings.region,
  latitude: bookings.latitude,
  longitude: bookings.longitude,
  startsAt: bookings.startsAt,
  endsAt: bookings.endsAt,
  status: bookings.status,
  probability: bookings.probability,
} as const;

export class DrizzleTripRepository implements TripRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async createTrip(
    values: Omit<TripRecord, "id" | "createdAt" | "updatedAt" | "routeConfirmedAt">,
  ): Promise<TripRecord> {
    const [created] = await this.database
      .insert(trips)
      .values(values)
      .returning(tripSelection);
    if (!created) throw new Error("Trip could not be created.");
    return created;
  }

  async getTrip(id: string): Promise<TripRecord | null> {
    const [trip] = await this.database
      .select(tripSelection)
      .from(trips)
      .where(eq(trips.id, id))
      .limit(1);
    return trip ?? null;
  }

  async listTrips(options?: { travelLegId?: string }): Promise<TripListItem[]> {
    const stopCount = sql<number>`(
      select count(*)::int from ${tripStops} where ${tripStops.tripId} = ${trips.id}
    )`;
    const query = this.database
      .select({
        ...tripSelection,
        legName: travelLegs.name,
        legColor: travelLegs.color,
        stopCount,
      })
      .from(trips)
      .innerJoin(travelLegs, eq(trips.travelLegId, travelLegs.id))
      .orderBy(asc(trips.startDate), asc(trips.name), asc(trips.id));
    if (options?.travelLegId) {
      return query.where(eq(trips.travelLegId, options.travelLegId));
    }
    return query;
  }

  async getTravelLegDefaults(travelLegId: string): Promise<{ mpg: number | null }> {
    const [leg] = await this.database
      .select({ mpg: travelLegs.defaultMpg })
      .from(travelLegs)
      .where(eq(travelLegs.id, travelLegId))
      .limit(1);
    return leg ?? { mpg: null };
  }

  async updateTrip(
    id: string,
    values: Partial<Omit<TripRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<TripRecord | null> {
    const [updated] = await this.database
      .update(trips)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(trips.id, id))
      .returning(tripSelection);
    return updated ?? null;
  }

  async deleteTrip(id: string): Promise<boolean> {
    const deleted = await this.database
      .delete(trips)
      .where(eq(trips.id, id))
      .returning({ id: trips.id });
    return deleted.length > 0;
  }

  async listStops(tripId: string): Promise<TripStopRecord[]> {
    return this.database
      .select(stopSelection)
      .from(tripStops)
      .innerJoin(bookings, eq(tripStops.bookingId, bookings.id))
      .where(eq(tripStops.tripId, tripId))
      .orderBy(asc(tripStops.sortOrder), asc(tripStops.id));
  }

  async addStop(tripId: string, bookingId: string): Promise<TripStopRecord | null> {
    return this.database.transaction(async (transaction) => {
      const [maxRow] = await transaction
        .select({ max: sql<number>`coalesce(max(${tripStops.sortOrder}), 0)` })
        .from(tripStops)
        .where(eq(tripStops.tripId, tripId));
      const [inserted] = await transaction
        .insert(tripStops)
        .values({ tripId, bookingId, sortOrder: (maxRow?.max ?? 0) + 1 })
        .onConflictDoNothing()
        .returning({ id: tripStops.id });
      if (!inserted) return null;
      const [stop] = await transaction
        .select(stopSelection)
        .from(tripStops)
        .innerJoin(bookings, eq(tripStops.bookingId, bookings.id))
        .where(eq(tripStops.id, inserted.id));
      return stop ?? null;
    });
  }

  async removeStop(tripId: string, stopId: string): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const deleted = await transaction
        .delete(tripStops)
        .where(and(eq(tripStops.id, stopId), eq(tripStops.tripId, tripId)))
        .returning({ id: tripStops.id });
      if (deleted.length === 0) return false;
      const remaining = await transaction
        .select({ id: tripStops.id })
        .from(tripStops)
        .where(eq(tripStops.tripId, tripId))
        .orderBy(asc(tripStops.sortOrder), asc(tripStops.id));
      for (const [index, stop] of remaining.entries()) {
        await transaction
          .update(tripStops)
          .set({ sortOrder: index + 1 })
          .where(eq(tripStops.id, stop.id));
      }
      return true;
    });
  }

  async setStopOrder(
    tripId: string,
    orderedStopIds: readonly string[],
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const existing = await transaction
        .select({ id: tripStops.id })
        .from(tripStops)
        .where(eq(tripStops.tripId, tripId));
      const existingIds = new Set(existing.map(({ id }) => id));
      if (
        existingIds.size !== orderedStopIds.length ||
        orderedStopIds.some((id) => !existingIds.has(id))
      ) {
        return false;
      }
      // Two-phase renumber avoids collisions without a deferrable constraint.
      for (const [index, stopId] of orderedStopIds.entries()) {
        await transaction
          .update(tripStops)
          .set({ sortOrder: 10_000 + index })
          .where(eq(tripStops.id, stopId));
      }
      for (const [index, stopId] of orderedStopIds.entries()) {
        await transaction
          .update(tripStops)
          .set({ sortOrder: index + 1 })
          .where(eq(tripStops.id, stopId));
      }
      return true;
    });
  }

  async listSegments(tripId: string): Promise<TripSegmentRecord[]> {
    return this.database
      .select()
      .from(tripSegments)
      .where(eq(tripSegments.tripId, tripId))
      .orderBy(asc(tripSegments.sequence));
  }

  async replaceSegments(
    tripId: string,
    segments: readonly NewTripSegment[],
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.delete(tripSegments).where(eq(tripSegments.tripId, tripId));
      if (segments.length > 0) {
        await transaction
          .insert(tripSegments)
          .values(segments.map((segment) => ({ ...segment, tripId })));
      }
    });
  }

  async updateSegmentOverride(
    tripId: string,
    segmentId: string,
    override: { overrideMiles: number | null; overrideMinutes: number | null },
  ): Promise<TripSegmentRecord | null> {
    const [updated] = await this.database
      .update(tripSegments)
      .set({ ...override, updatedAt: new Date() })
      .where(and(eq(tripSegments.id, segmentId), eq(tripSegments.tripId, tripId)))
      .returning();
    return updated ?? null;
  }

  async listResources(tripId: string): Promise<TripResourceRecord[]> {
    return this.database
      .select({
        assignmentId: tripResourceAssignments.id,
        resourceId: resources.id,
        code: resources.code,
        name: resources.name,
        category: resources.category,
        movable: resources.movable,
      })
      .from(tripResourceAssignments)
      .innerJoin(resources, eq(tripResourceAssignments.resourceId, resources.id))
      .where(eq(tripResourceAssignments.tripId, tripId))
      .orderBy(asc(resources.name), asc(resources.id));
  }

  async addResource(
    tripId: string,
    resourceId: string,
  ): Promise<TripResourceRecord | null> {
    const [inserted] = await this.database
      .insert(tripResourceAssignments)
      .values({ tripId, resourceId })
      .onConflictDoNothing()
      .returning({ id: tripResourceAssignments.id });
    if (!inserted) return null;
    const records = await this.listResources(tripId);
    return records.find((record) => record.assignmentId === inserted.id) ?? null;
  }

  async removeResource(tripId: string, resourceId: string): Promise<boolean> {
    const deleted = await this.database
      .delete(tripResourceAssignments)
      .where(and(
        eq(tripResourceAssignments.tripId, tripId),
        eq(tripResourceAssignments.resourceId, resourceId),
      ))
      .returning({ id: tripResourceAssignments.id });
    return deleted.length > 0;
  }

  audit(change: TripAuditChange): Promise<void> {
    return recordAuditEntry(this.database, {
      entityType: "trip",
      entityId: change.entityId,
      action: change.action,
      before: change.before,
      after: change.after,
    });
  }
}

/** Trips whose date range covers the given window (used by the Today dashboard). */
export async function listTripsInWindow(
  db: DrizzleDatabase,
  windowStart: Date,
  windowEnd: Date,
): Promise<TripListItem[]> {
  const stopCount = sql<number>`(
    select count(*)::int from ${tripStops} where ${tripStops.tripId} = ${trips.id}
  )`;
  return db
    .select({
      ...tripSelection,
      legName: travelLegs.name,
      legColor: travelLegs.color,
      stopCount,
    })
    .from(trips)
    .innerJoin(travelLegs, eq(trips.travelLegId, travelLegs.id))
    .where(and(lte(trips.startDate, windowEnd), gte(trips.endDate, windowStart)))
    .orderBy(asc(trips.startDate), asc(trips.name), asc(trips.id));
}

export async function listTripStopBookingIds(
  db: DrizzleDatabase,
  tripIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (tripIds.length === 0) return new Map();
  const rows = await db
    .select({ tripId: tripStops.tripId, bookingId: tripStops.bookingId })
    .from(tripStops)
    .where(inArray(tripStops.tripId, [...tripIds]))
    .orderBy(asc(tripStops.sortOrder));
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.tripId) ?? [];
    list.push(row.bookingId);
    map.set(row.tripId, list);
  }
  return map;
}
