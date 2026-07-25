import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { db as database } from "@/db/client";
import {
  auditEntries,
  bookings,
  contacts,
  followUps,
  organizations,
  travelLegs,
} from "@/db/schema";
import type {
  BookingStatus,
  Probability,
} from "@/features/bookings/booking-types";
import type { BookingEditInput } from "@/features/bookings/booking-input";
import { recordAuditEntry } from "@/features/audit/audit-service";

export type Booking = {
  id: string;
  name: string;
  city: string;
  region: string;
  status: BookingStatus;
  probability: Probability;
};

export type FollowUp = {
  id: string;
  bookingId: string;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
  outcome: string | null;
  nextFollowUpId: string | null;
};

export type AuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

export type CreateFollowUpInput = {
  bookingId: string;
  kind: string;
  dueAt: Date;
};

export type UpdateBookingStatusInput = {
  bookingId: string;
  status: BookingStatus;
};

export type BookingListRecord = {
  id: string;
  name: string;
  city: string;
  region: string;
  startsAt: Date | null;
  endsAt: Date | null;
  status: BookingStatus;
  probability: Probability;
  travelLeg: { id: string; name: string; color: string } | null;
  nextAction: { id: string; kind: string; dueAt: Date } | null;
};

export type BookingDetail = {
  booking: typeof bookings.$inferSelect;
  organization: typeof organizations.$inferSelect | null;
  contact: typeof contacts.$inferSelect | null;
  travelLeg: typeof travelLegs.$inferSelect | null;
  followUps: (typeof followUps.$inferSelect)[];
  auditEntries: (typeof auditEntries.$inferSelect)[];
};

export interface BookingTransaction {
  findFollowUpWithBookingForUpdate(
    followUpId: string,
  ): Promise<{ followUp: FollowUp; booking: Booking } | null>;
  createBooking(input: Omit<Booking, "id">): Promise<Booking>;
  completeFollowUp(
    followUpId: string,
    input: { outcome: string; completedAt: Date },
  ): Promise<FollowUp>;
  createFollowUp(input: CreateFollowUpInput): Promise<FollowUp>;
  linkNextFollowUp(followUpId: string, nextFollowUpId: string): Promise<void>;
  updateBookingStatus(input: UpdateBookingStatusInput): Promise<Booking>;
  createAuditEntry(input: AuditEntry): Promise<void>;
}

export interface BookingRepository {
  createBooking(input: Omit<Booking, "id">): Promise<Booking>;
  transaction<T>(operation: (transaction: BookingTransaction) => Promise<T>): Promise<T>;
}

type DrizzleDatabase = typeof database;
type DrizzleWriter = Pick<DrizzleDatabase, "select" | "insert" | "update">;

function toBooking(record: typeof bookings.$inferSelect): Booking {
  return {
    id: record.id,
    name: record.name,
    city: record.city,
    region: record.region,
    status: record.status,
    probability: record.probability,
  };
}

function toFollowUp(record: typeof followUps.$inferSelect): FollowUp {
  return {
    id: record.id,
    bookingId: record.bookingId,
    kind: record.kind,
    dueAt: record.dueAt,
    completedAt: record.completedAt,
    outcome: record.outcome,
    nextFollowUpId: record.nextFollowUpId,
  };
}

class DrizzleBookingTransaction implements BookingTransaction {
  constructor(private readonly database: DrizzleWriter) {}

  async findFollowUpWithBookingForUpdate(followUpId: string) {
    const [record] = await this.database
      .select({ followUp: followUps, booking: bookings })
      .from(followUps)
      .innerJoin(bookings, eq(followUps.bookingId, bookings.id))
      .where(eq(followUps.id, followUpId))
      .limit(1)
      .for("update");

    if (!record) return null;
    return {
      followUp: toFollowUp(record.followUp),
      booking: toBooking(record.booking),
    };
  }

  async createBooking(input: Omit<Booking, "id">): Promise<Booking> {
    const [booking] = await this.database.insert(bookings).values(input).returning();
    if (!booking) throw new Error("Could not create booking.");
    return toBooking(booking);
  }

  async completeFollowUp(
    followUpId: string,
    input: { outcome: string; completedAt: Date },
  ): Promise<FollowUp> {
    const [followUp] = await this.database
      .update(followUps)
      .set({ ...input, updatedAt: input.completedAt })
      .where(eq(followUps.id, followUpId))
      .returning();

    if (!followUp) throw new Error("Follow-up is missing.");
    return toFollowUp(followUp);
  }

  async createFollowUp(input: CreateFollowUpInput): Promise<FollowUp> {
    const [followUp] = await this.database.insert(followUps).values(input).returning();
    if (!followUp) throw new Error("Could not create follow-up.");
    return toFollowUp(followUp);
  }

  async linkNextFollowUp(followUpId: string, nextFollowUpId: string): Promise<void> {
    await this.database
      .update(followUps)
      .set({ nextFollowUpId, updatedAt: new Date() })
      .where(eq(followUps.id, followUpId));
  }

  async updateBookingStatus(input: UpdateBookingStatusInput): Promise<Booking> {
    const [booking] = await this.database
      .update(bookings)
      .set({ status: input.status, updatedAt: new Date() })
      .where(eq(bookings.id, input.bookingId))
      .returning();

    if (!booking) throw new Error("Booking is missing.");
    return toBooking(booking);
  }

  async createAuditEntry(input: AuditEntry): Promise<void> {
    await recordAuditEntry(this.database, input);
  }
}

export class DrizzleBookingRepository implements BookingRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async createBooking(input: Omit<Booking, "id">): Promise<Booking> {
    const [booking] = await this.database.insert(bookings).values(input).returning();
    if (!booking) throw new Error("Could not create booking.");
    return toBooking(booking);
  }

  transaction<T>(operation: (transaction: BookingTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) =>
      operation(new DrizzleBookingTransaction(transaction)),
    );
  }

  async listBookings(): Promise<BookingListRecord[]> {
    const [records, openFollowUps] = await Promise.all([
      this.database
        .select({ booking: bookings, travelLeg: travelLegs })
        .from(bookings)
        .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
        .orderBy(desc(bookings.updatedAt)),
      this.database
        .select()
        .from(followUps)
        .where(isNull(followUps.completedAt))
        .orderBy(asc(followUps.dueAt)),
    ]);

    const nextActionByBooking = new Map<
      string,
      { id: string; kind: string; dueAt: Date }
    >();
    for (const followUp of openFollowUps) {
      if (!nextActionByBooking.has(followUp.bookingId)) {
        nextActionByBooking.set(followUp.bookingId, {
          id: followUp.id,
          kind: followUp.kind,
          dueAt: followUp.dueAt,
        });
      }
    }

    return records.map(({ booking, travelLeg }) => ({
      id: booking.id,
      name: booking.name,
      city: booking.city,
      region: booking.region,
      startsAt: booking.startsAt,
      endsAt: booking.endsAt,
      status: booking.status,
      probability: booking.probability,
      travelLeg: travelLeg
        ? { id: travelLeg.id, name: travelLeg.name, color: travelLeg.color }
        : null,
      nextAction: nextActionByBooking.get(booking.id) ?? null,
    }));
  }

  async getBookingDetail(bookingId: string): Promise<BookingDetail | null> {
    const [record] = await this.database
      .select({
        booking: bookings,
        organization: organizations,
        contact: contacts,
        travelLeg: travelLegs,
      })
      .from(bookings)
      .leftJoin(organizations, eq(bookings.organizationId, organizations.id))
      .leftJoin(contacts, eq(bookings.primaryContactId, contacts.id))
      .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!record) return null;

    const bookingFollowUps = await this.database
      .select()
      .from(followUps)
      .where(eq(followUps.bookingId, bookingId))
      .orderBy(desc(followUps.dueAt));
    const followUpIds = bookingFollowUps.map((followUp) => followUp.id);
    const auditFilter =
      followUpIds.length > 0
        ? or(
            and(
              eq(auditEntries.entityType, "booking"),
              eq(auditEntries.entityId, bookingId),
            ),
            and(
              eq(auditEntries.entityType, "follow_up"),
              inArray(auditEntries.entityId, followUpIds),
            ),
          )
        : and(
            eq(auditEntries.entityType, "booking"),
            eq(auditEntries.entityId, bookingId),
          );
    const history = await this.database
      .select()
      .from(auditEntries)
      .where(auditFilter)
      .orderBy(desc(auditEntries.createdAt));

    return {
      ...record,
      followUps: bookingFollowUps,
      auditEntries: history,
    };
  }

  async updateBookingDetails(
    bookingId: string,
    input: BookingEditInput,
  ): Promise<Booking | null> {
    return this.database.transaction(async (transaction) => {
      const [before] = await transaction
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .limit(1)
        .for("update");
      if (!before) return null;

      const [updated] = await transaction
        .update(bookings)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(bookings.id, bookingId))
        .returning();
      if (!updated) return null;

      await recordAuditEntry(transaction, {
        entityType: "booking",
        entityId: bookingId,
        action: "update",
        before: {
          name: before.name,
          city: before.city,
          region: before.region,
          probability: before.probability,
        },
        after: {
          name: updated.name,
          city: updated.city,
          region: updated.region,
          probability: updated.probability,
        },
      });

      return toBooking(updated);
    });
  }
}
