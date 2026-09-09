import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { bookings, travelLegs } from "@/db/schema";
import { eventLegLifecycle } from "./event-lifecycle-schema";

export const eventLocationStatuses = ["captured","unavailable","denied","error","not_requested"] as const;
export type EventLocationStatus = typeof eventLocationStatuses[number];
export type EventLifecycleRecord = typeof eventLegLifecycle.$inferSelect;

type Db = NodePgDatabase<typeof schema>;

type LifecycleActionInput = {
  bookingId: string;
  legId: string;
  at: Date;
  timeZone: string | null;
  latitude: number | null;
  longitude: number | null;
  locationStatus: EventLocationStatus;
};

export class EventLifecycleRepository {
  constructor(private readonly database: Db) {}

  async bookingBelongsToLeg(bookingId: string, legId: string) {
    return Boolean((await this.database.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.travelLegId, legId))).limit(1))[0]);
  }

  async bookingCanCheckIn(bookingId: string, legId: string) {
    return Boolean((await this.database.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.travelLegId, legId), eq(bookings.status, "confirmed"))).limit(1))[0]);
  }

  async get(bookingId: string, legId: string): Promise<EventLifecycleRecord | null> {
    return (await this.database.select().from(eventLegLifecycle).where(and(eq(eventLegLifecycle.bookingId, bookingId), eq(eventLegLifecycle.legId, legId))).limit(1))[0] ?? null;
  }

  async getCurrentForLeg(legId: string) {
    return (await this.database
      .select({
        id: eventLegLifecycle.id,
        bookingId: eventLegLifecycle.bookingId,
        legId: eventLegLifecycle.legId,
        checkedInAt: eventLegLifecycle.checkedInAt,
        checkInTimeZone: eventLegLifecycle.checkInTimeZone,
        checkedOutAt: eventLegLifecycle.checkedOutAt,
        checkOutTimeZone: eventLegLifecycle.checkOutTimeZone,
        bookingName: bookings.name,
        city: bookings.city,
        region: bookings.region,
      })
      .from(eventLegLifecycle)
      .innerJoin(bookings, eq(bookings.id, eventLegLifecycle.bookingId))
      .where(and(
        eq(eventLegLifecycle.legId, legId),
        isNull(eventLegLifecycle.checkedOutAt),
      ))
      .limit(1))[0] ?? null;
  }

  async getLatestCheckedOutForLeg(legId: string) {
    return (await this.database
      .select({
        id: eventLegLifecycle.id,
        bookingId: eventLegLifecycle.bookingId,
        legId: eventLegLifecycle.legId,
        checkedInAt: eventLegLifecycle.checkedInAt,
        checkInTimeZone: eventLegLifecycle.checkInTimeZone,
        checkedOutAt: eventLegLifecycle.checkedOutAt,
        checkOutTimeZone: eventLegLifecycle.checkOutTimeZone,
        bookingName: bookings.name,
        city: bookings.city,
        region: bookings.region,
      })
      .from(eventLegLifecycle)
      .innerJoin(bookings, eq(bookings.id, eventLegLifecycle.bookingId))
      .where(and(
        eq(eventLegLifecycle.legId, legId),
        isNotNull(eventLegLifecycle.checkedOutAt),
      ))
      .orderBy(desc(eventLegLifecycle.checkedOutAt))
      .limit(1))[0] ?? null;
  }

  async checkIn(input: LifecycleActionInput) {
    const current = await this.get(input.bookingId, input.legId);
    if (current?.checkedInAt) return current;
    const rows = await this.database.insert(eventLegLifecycle).values({
      bookingId: input.bookingId,
      legId: input.legId,
      checkedInAt: input.at,
      checkInTimeZone: input.timeZone,
      checkInLatitude: input.latitude,
      checkInLongitude: input.longitude,
      checkInLocationStatus: input.locationStatus,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [eventLegLifecycle.bookingId, eventLegLifecycle.legId],
      set: {
        checkedInAt: input.at,
        checkInTimeZone: input.timeZone,
        checkInLatitude: input.latitude,
        checkInLongitude: input.longitude,
        checkInLocationStatus: input.locationStatus,
        updatedAt: new Date(),
      },
    }).returning();
    return rows[0]!;
  }

  async checkOut(input: LifecycleActionInput) {
    const current = await this.get(input.bookingId, input.legId);
    if (!current?.checkedInAt) return { ok: false as const, code: "NOT_CHECKED_IN" as const };
    if (current.checkedOutAt) return { ok: true as const, lifecycle: current };
    const lifecycle = (await this.database.update(eventLegLifecycle).set({
      checkedOutAt: input.at,
      checkOutTimeZone: input.timeZone,
      checkOutLatitude: input.latitude,
      checkOutLongitude: input.longitude,
      checkOutLocationStatus: input.locationStatus,
      wrapUpStatus: "incomplete",
      updatedAt: new Date(),
    }).where(and(eq(eventLegLifecycle.bookingId, input.bookingId), eq(eventLegLifecycle.legId, input.legId))).returning())[0]!;
    return { ok: true as const, lifecycle };
  }

  async markIncomplete(bookingId: string, legId: string) {
    return (await this.database.update(eventLegLifecycle).set({ wrapUpStatus: "incomplete", updatedAt: new Date() }).where(and(eq(eventLegLifecycle.bookingId, bookingId), eq(eventLegLifecycle.legId, legId))).returning())[0] ?? null;
  }

  async finish(bookingId: string, legId: string) {
    return (await this.database.update(eventLegLifecycle).set({ wrapUpStatus: "finished", wrapUpFinishedAt: new Date(), updatedAt: new Date() }).where(and(eq(eventLegLifecycle.bookingId, bookingId), eq(eventLegLifecycle.legId, legId))).returning())[0] ?? null;
  }

  async listIncompleteForLeg(legId: string) {
    return this.database
      .select({
        id: eventLegLifecycle.id,
        bookingId: eventLegLifecycle.bookingId,
        legId: eventLegLifecycle.legId,
        checkedInAt: eventLegLifecycle.checkedInAt,
        checkInTimeZone: eventLegLifecycle.checkInTimeZone,
        checkedOutAt: eventLegLifecycle.checkedOutAt,
        checkOutTimeZone: eventLegLifecycle.checkOutTimeZone,
        wrapUpStatus: eventLegLifecycle.wrapUpStatus,
        bookingName: bookings.name,
        city: bookings.city,
        region: bookings.region,
      })
      .from(eventLegLifecycle)
      .innerJoin(bookings, eq(bookings.id, eventLegLifecycle.bookingId))
      .where(and(eq(eventLegLifecycle.legId, legId), eq(eventLegLifecycle.wrapUpStatus, "incomplete")));
  }

  async listAll() {
    return this.database
      .select({
        id: eventLegLifecycle.id,
        bookingId: eventLegLifecycle.bookingId,
        bookingName: bookings.name,
        city: bookings.city,
        region: bookings.region,
        legId: eventLegLifecycle.legId,
        legName: travelLegs.name,
        checkedInAt: eventLegLifecycle.checkedInAt,
        checkInTimeZone: eventLegLifecycle.checkInTimeZone,
        checkInLatitude: eventLegLifecycle.checkInLatitude,
        checkInLongitude: eventLegLifecycle.checkInLongitude,
        checkInLocationStatus: eventLegLifecycle.checkInLocationStatus,
        checkedOutAt: eventLegLifecycle.checkedOutAt,
        checkOutTimeZone: eventLegLifecycle.checkOutTimeZone,
        checkOutLatitude: eventLegLifecycle.checkOutLatitude,
        checkOutLongitude: eventLegLifecycle.checkOutLongitude,
        checkOutLocationStatus: eventLegLifecycle.checkOutLocationStatus,
        wrapUpStatus: eventLegLifecycle.wrapUpStatus,
        wrapUpFinishedAt: eventLegLifecycle.wrapUpFinishedAt,
      })
      .from(eventLegLifecycle)
      .innerJoin(bookings, eq(bookings.id, eventLegLifecycle.bookingId))
      .innerJoin(travelLegs, eq(travelLegs.id, eventLegLifecycle.legId));
  }
}
