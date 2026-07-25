import { asc, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { bookings, travelLegs } from "@/db/schema";
import type {
  BookingStatus,
  Probability,
} from "@/features/bookings/booking-types";

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
}
