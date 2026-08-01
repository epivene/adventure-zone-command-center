import { asc, eq, gt } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { bookings, resources, travelLegs } from "@/db/schema";
import type {
  BookingStatus,
  Probability,
} from "@/features/bookings/booking-types";
import { recordAuditEntry } from "@/features/audit/audit-service";
import type {
  TravelLegAuditChange,
  TravelLegEditorTransaction,
} from "@/features/routes/travel-leg-editor";

export type TravelLeg = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
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
  startsAt: Date | null;
  endsAt: Date | null;
};

export interface TravelLegRepository {
  listMapEvents(): Promise<MapEventRecord[]>;
  listTravelLegs(): Promise<TravelLeg[]>;
}

type DrizzleDatabase = typeof database;

export class DrizzleTravelLegRepository implements TravelLegRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async listMapEvents(): Promise<MapEventRecord[]> {
    const records = await this.database
      .select({ booking: bookings, travelLeg: travelLegs })
      .from(bookings)
      .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
      .orderBy(asc(bookings.startsAt), asc(bookings.name), asc(bookings.id));

    return records.map(({ booking, travelLeg }) => ({
      id: booking.id,
      name: booking.name,
      city: booking.city,
      region: booking.region,
      latitude: booking.latitude,
      longitude: booking.longitude,
      status: booking.status,
      probability: booking.probability,
      travelLegId: travelLeg?.id ?? null,
      travelLegName: travelLeg?.name ?? null,
      travelLegColor: travelLeg?.color ?? null,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
    }));
  }

  async listTravelLegs(): Promise<TravelLeg[]> {
    return this.database
      .select({
        id: travelLegs.id,
        name: travelLegs.name,
        color: travelLegs.color,
        sortOrder: travelLegs.sortOrder,
      })
      .from(travelLegs)
      .orderBy(asc(travelLegs.sortOrder));
  }

  transaction<T>(
    operation: (transaction: TravelLegEditorTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction((transaction) =>
      operation({
        listForUpdate: async () =>
          transaction
            .select({
              id: travelLegs.id,
              name: travelLegs.name,
              color: travelLegs.color,
              sortOrder: travelLegs.sortOrder,
            })
            .from(travelLegs)
            .orderBy(asc(travelLegs.sortOrder))
            .for("update"),
        update: async (id, values) => {
          const [updated] = await transaction
            .update(travelLegs)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(travelLegs.id, id))
            .returning({
              id: travelLegs.id,
              name: travelLegs.name,
              color: travelLegs.color,
              sortOrder: travelLegs.sortOrder,
            });
          if (!updated) throw new Error("Travel leg is missing.");
          return updated;
        },
        insert: async (values) => {
          const [inserted] = await transaction
            .insert(travelLegs)
            .values(values)
            .returning({
              id: travelLegs.id,
              name: travelLegs.name,
              color: travelLegs.color,
              sortOrder: travelLegs.sortOrder,
            });
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
            action: "update",
            before: change.before,
            after: change.after,
          }),
      }),
    );
  }
}
