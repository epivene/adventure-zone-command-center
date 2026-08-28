import { asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { bookingLegAssignments, bookings, resources, travelLegs } from "@/db/schema";
import type {
  BookingStatus,
  Probability,
} from "@/features/bookings/booking-types";
import { recordAuditEntry } from "@/features/audit/audit-service";
import { classifyRouteBucket, type RouteBucket } from "@/features/routes/route-view";
import { businessDateKey } from "@/lib/business-date";
import type {
  TravelLegAuditChange,
  TravelLegEditorTransaction,
} from "@/features/routes/travel-leg-editor";

export type TravelLeg = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  archivedAt: Date | null;
  baseAddress: string | null;
  defaultVehicleName: string | null;
  defaultMpg: number | null;
};

export type LegResource = {
  legId: string;
  id: string;
  code: string;
  name: string;
  category: string;
};

export type MapEventRecord = {
  id: string;
  name: string;
  city: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  status: BookingStatus;
  probability: Probability;
  travelLegId: string | null;
  travelLegName: string | null;
  travelLegColor: string | null;
  travelLegAssignmentKind: "assigned" | "suggested" | null;
  legAssignmentWarning: "long_travel" | "major_travel_concern" | null;
  legAssignmentExplanation: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  routeBucket: RouteBucket;
  locationQuality: "coordinates" | "address" | "city" | "missing";
  locationLabel: string | null;
  seasonYear: number | null;
};

export interface TravelLegRepository {
  listMapEvents(): Promise<MapEventRecord[]>;
  listTravelLegs(options?: { includeArchived?: boolean }): Promise<TravelLeg[]>;
  listLegResources(): Promise<LegResource[]>;
}

type DrizzleDatabase = typeof database;

const travelLegSelection = {
  id: travelLegs.id,
  name: travelLegs.name,
  color: travelLegs.color,
  sortOrder: travelLegs.sortOrder,
  archivedAt: travelLegs.archivedAt,
  baseAddress: travelLegs.baseAddress,
  defaultVehicleName: travelLegs.defaultVehicleName,
  defaultMpg: travelLegs.defaultMpg,
} as const;

export class DrizzleTravelLegRepository implements TravelLegRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async listMapEvents(): Promise<MapEventRecord[]> {
    const [records, assignmentRows, allLegs] = await Promise.all([
      this.database
        .select({ booking: bookings, travelLeg: travelLegs })
        .from(bookings)
        .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
        .orderBy(asc(bookings.startsAt), asc(bookings.name), asc(bookings.id)),
      this.database.select().from(bookingLegAssignments),
      this.database.select(travelLegSelection).from(travelLegs),
    ]);
    const assignmentByBooking = new Map(assignmentRows.map((row) => [row.bookingId, row]));
    const legById = new Map(allLegs.map((leg) => [leg.id, leg]));

    return records.map(({ booking, travelLeg }) => {
      const assignment = assignmentByBooking.get(booking.id) ?? null;
      const canProjectSuggestion = booking.status !== "confirmed" && booking.status !== "completed";
      const suggestedLeg = canProjectSuggestion && assignment?.suggestedLegId
        ? legById.get(assignment.suggestedLegId) ?? null
        : null;
      const planningLeg = travelLeg ?? suggestedLeg;
      const travelLegAssignmentKind = travelLeg
        ? "assigned" as const
        : suggestedLeg
          ? "suggested" as const
          : null;
      const cityRegion = [booking.city?.trim(), booking.region?.trim()].filter(Boolean).join(", ");
      const address = booking.address1?.trim();
      const locationLabel = address
        ? [booking.venueName?.trim(), address, cityRegion].filter(Boolean).join(", ")
        : cityRegion || null;
      const coordinatesValid =
        booking.latitude !== null &&
        booking.longitude !== null &&
        Number.isFinite(booking.latitude) &&
        Number.isFinite(booking.longitude);
      const locationQuality = coordinatesValid
        ? "coordinates" as const
        : address
          ? "address" as const
          : cityRegion
            ? "city" as const
            : "missing" as const;
      return {
        id: booking.id,
        name: booking.name,
        city: booking.city,
        region: booking.region,
        latitude: booking.latitude,
        longitude: booking.longitude,
        status: booking.status,
        probability: booking.probability,
        travelLegId: planningLeg?.id ?? null,
        travelLegName: planningLeg?.name ?? null,
        travelLegColor: planningLeg?.color ?? null,
        travelLegAssignmentKind,
        legAssignmentWarning: assignment?.warning as MapEventRecord["legAssignmentWarning"] ?? null,
        legAssignmentExplanation: assignment?.explanation ?? null,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
        routeBucket: classifyRouteBucket(booking.status),
        locationQuality,
        locationLabel,
        seasonYear: booking.startsAt ? Number(businessDateKey(booking.startsAt).slice(0, 4)) : null,
      };
    });
  }

  async listTravelLegs(options?: {
    includeArchived?: boolean;
  }): Promise<TravelLeg[]> {
    const query = this.database
      .select(travelLegSelection)
      .from(travelLegs)
      .orderBy(asc(travelLegs.sortOrder));
    if (options?.includeArchived) {
      return query;
    }
    return query.where(isNull(travelLegs.archivedAt));
  }

  async listLegResources(): Promise<LegResource[]> {
    const records = await this.database
      .select({
        legId: resources.normalTravelLegId,
        id: resources.id,
        code: resources.code,
        name: resources.name,
        category: resources.category,
      })
      .from(resources)
      .where(isNotNull(resources.normalTravelLegId))
      .orderBy(asc(resources.name), asc(resources.id));
    return records.filter(
      (record): record is LegResource => record.legId !== null,
    );
  }

  transaction<T>(
    operation: (transaction: TravelLegEditorTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction((transaction) =>
      operation({
        listForUpdate: async () =>
          transaction
            .select(travelLegSelection)
            .from(travelLegs)
            .orderBy(asc(travelLegs.sortOrder))
            .for("update"),
        update: async (id, values) => {
          const [updated] = await transaction
            .update(travelLegs)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(travelLegs.id, id))
            .returning(travelLegSelection);
          if (!updated) throw new Error("Travel leg is missing.");
          return updated;
        },
        setArchived: async (id, archivedAt) => {
          const [updated] = await transaction
            .update(travelLegs)
            .set({ archivedAt, updatedAt: new Date() })
            .where(eq(travelLegs.id, id))
            .returning(travelLegSelection);
          if (!updated) throw new Error("Travel leg is missing.");
          return updated;
        },
        reorderLegs: async (orders) => {
          if (orders.length === 0) return;
          await transaction.execute(
            sql`ALTER TABLE travel_legs DROP CONSTRAINT travel_legs_sort_order_unique`,
          );
          const whenClauses = sql.join(
            orders.map(({ id, sortOrder }) =>
              sql`when ${id}::uuid then ${sortOrder}::integer`,
            ),
            sql` `,
          );
          const idList = sql.join(
            orders.map(({ id }) => sql`${id}::uuid`),
            sql`, `,
          );
          await transaction.execute(
            sql`update travel_legs set sort_order = case id ${whenClauses} end, updated_at = now() where id in (${idList})`,
          );
          await transaction.execute(
            sql`ALTER TABLE travel_legs ADD CONSTRAINT travel_legs_sort_order_unique UNIQUE (sort_order) DEFERRABLE INITIALLY IMMEDIATE`,
          );
        },
        insert: async (values) => {
          const [inserted] = await transaction
            .insert(travelLegs)
            .values(values)
            .returning(travelLegSelection);
          if (!inserted) throw new Error("Travel leg could not be inserted.");
          return inserted;
        },
        delete: async (id) => {
          const [target] = await transaction
            .select({ sortOrder: travelLegs.sortOrder })
            .from(travelLegs)
            .where(eq(travelLegs.id, id));

          await transaction
            .update(bookings)
            .set({ travelLegId: null })
            .where(eq(bookings.travelLegId, id));
          await transaction
            .update(resources)
            .set({ normalTravelLegId: null })
            .where(eq(resources.normalTravelLegId, id));

          await transaction
            .delete(travelLegs)
            .where(eq(travelLegs.id, id));

          if (target) {
            const affected = await transaction
              .select({ id: travelLegs.id, sortOrder: travelLegs.sortOrder })
              .from(travelLegs)
              .where(gt(travelLegs.sortOrder, target.sortOrder))
              .orderBy(asc(travelLegs.sortOrder));

            for (const leg of affected) {
              await transaction
                .update(travelLegs)
                .set({ sortOrder: leg.sortOrder - 1, updatedAt: new Date() })
                .where(eq(travelLegs.id, leg.id));
            }
          }
        },
        audit: (change: TravelLegAuditChange) =>
          recordAuditEntry(transaction, {
            entityType: "travel_leg",
            entityId: change.entityId,
            action: change.action ?? "update",
            before: change.before,
            after: change.after,
          }),
      }),
    );
  }
}
