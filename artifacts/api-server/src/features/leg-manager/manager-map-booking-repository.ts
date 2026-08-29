import { asc, eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { bookings, travelLegs } from "@/db/schema";

export type ManagerMapBookingRecord = {
  bookingId: string;
  bookingName: string;
  city: string;
  region: string;
  latitude: number | null;
  longitude: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string;
  probability: string | null;
  legName: string;
  legColor: string | null;
};

type DrizzleDatabase = typeof database;

export class DrizzleManagerMapBookingRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async listForLeg(legId: string): Promise<ManagerMapBookingRecord[]> {
    const records = await this.database
      .select({
        bookingId: bookings.id,
        bookingName: bookings.name,
        city: bookings.city,
        region: bookings.region,
        latitude: bookings.latitude,
        longitude: bookings.longitude,
        startsAt: bookings.startsAt,
        endsAt: bookings.endsAt,
        status: bookings.status,
        probability: bookings.probability,
        legName: travelLegs.name,
        legColor: travelLegs.color,
      })
      .from(bookings)
      .innerJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
      .where(eq(bookings.travelLegId, legId))
      .orderBy(asc(bookings.startsAt), asc(bookings.id));

    return records;
  }
}
