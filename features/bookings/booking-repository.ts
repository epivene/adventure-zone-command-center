import { eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { auditEntries, bookings, followUps } from "@/db/schema";
import type {
  BookingStatus,
  Probability,
} from "@/features/bookings/booking-types";

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

export interface BookingTransaction {
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
  findFollowUpWithBooking(
    followUpId: string,
  ): Promise<{ followUp: FollowUp; booking: Booking } | null>;
  transaction<T>(operation: (transaction: BookingTransaction) => Promise<T>): Promise<T>;
}

type DrizzleDatabase = typeof database;
type DrizzleWriter = Pick<DrizzleDatabase, "insert" | "update">;

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
    await this.database.insert(auditEntries).values(input);
  }
}

export class DrizzleBookingRepository implements BookingRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async createBooking(input: Omit<Booking, "id">): Promise<Booking> {
    const [booking] = await this.database.insert(bookings).values(input).returning();
    if (!booking) throw new Error("Could not create booking.");
    return toBooking(booking);
  }

  async findFollowUpWithBooking(
    followUpId: string,
  ): Promise<{ followUp: FollowUp; booking: Booking } | null> {
    const [record] = await this.database
      .select({ followUp: followUps, booking: bookings })
      .from(followUps)
      .innerJoin(bookings, eq(followUps.bookingId, bookings.id))
      .where(eq(followUps.id, followUpId))
      .limit(1);

    if (!record) return null;
    return { followUp: toFollowUp(record.followUp), booking: toBooking(record.booking) };
  }

  transaction<T>(operation: (transaction: BookingTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction((transaction) =>
      operation(new DrizzleBookingTransaction(transaction)),
    );
  }
}
