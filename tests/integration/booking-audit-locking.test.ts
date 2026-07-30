import { describe, expect, it } from "vitest";

import { auditEntries, bookings, followUps } from "@/db/schema";
import {
  DrizzleBookingRepository,
  type BookingTransaction,
} from "@/features/bookings/booking-repository";

type BookingRow = typeof bookings.$inferSelect;
type FollowUpRow = typeof followUps.$inferSelect;

const bookingRow: BookingRow = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: null,
  primaryContactId: null,
  name: "Adventure show",
  venueName: null,
  address1: null,
  city: "Austin",
  region: "TX",
  postalCode: null,
  latitude: null,
  longitude: null,
  startsAt: null,
  endsAt: null,
  status: "possible",
  probability: "possible",
  travelLegId: null,
  actRecordId: null,
  notes: null,
  physicalAttractionTotal: null,
  attractionTotalApprovalReason: null,
  createdAt: new Date("2026-07-25T12:00:00.000Z"),
  updatedAt: new Date("2026-07-25T12:00:00.000Z"),
};

const followUpRow: FollowUpRow = {
  id: "22222222-2222-4222-8222-222222222222",
  bookingId: bookingRow.id,
  organizationId: null,
  contactId: null,
  kind: "call",
  dueAt: new Date("2026-08-01T15:00:00.000Z"),
  completedAt: null,
  outcome: null,
  nextFollowUpId: null,
  createdAt: new Date("2026-07-25T12:00:00.000Z"),
  updatedAt: new Date("2026-07-25T12:00:00.000Z"),
};

class SelectBuilder implements PromiseLike<unknown[]> {
  private source: unknown;
  private joined = false;

  constructor(
    private readonly database: RecordingDrizzleDatabase,
    private readonly selection: unknown,
  ) {}

  from(table: unknown) {
    this.source = table;
    return this;
  }

  innerJoin() {
    this.joined = true;
    return this;
  }

  where() {
    return this;
  }

  limit() {
    return this;
  }

  for(strength: string) {
    this.database.locks.push({ source: this.source, strength });
    return Promise.resolve(this.rows());
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?:
      | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows()).then(onfulfilled, onrejected);
  }

  private rows() {
    if (this.joined) {
      return [{ booking: bookingRow, followUp: followUpRow }];
    }
    if (this.source === followUps) {
      return this.database.openFollowUps.map((followUp) =>
        this.selection
          ? { dueAt: followUp.dueAt, completedAt: followUp.completedAt }
          : followUp,
      );
    }
    return [bookingRow];
  }
}

class RecordingDrizzleDatabase {
  readonly locks: { source: unknown; strength: string }[] = [];
  readonly audits: Record<string, unknown>[] = [];
  readonly bookingUpdates: Record<string, unknown>[] = [];
  openFollowUps: FollowUpRow[] = [followUpRow];

  select(selection?: unknown) {
    return new SelectBuilder(this, selection);
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => {
        if (table === bookings) this.bookingUpdates.push(values);
        return {
          where: () => ({
            returning: async () =>
              table === bookings ? [{ ...bookingRow, ...values }] : [],
          }),
        };
      },
    };
  }

  insert(table: unknown) {
    return {
      values: async (values: Record<string, unknown>) => {
        if (table === auditEntries) this.audits.push(values);
      },
    };
  }

  transaction<T>(
    operation: (transaction: RecordingDrizzleDatabase) => Promise<T>,
  ) {
    return operation(this);
  }
}

function repository(database: RecordingDrizzleDatabase) {
  return new DrizzleBookingRepository(
    database as unknown as ConstructorParameters<
      typeof DrizzleBookingRepository
    >[0],
  );
}

describe("DrizzleBookingRepository audit snapshots", () => {
  it("locks a booking before capturing its edit snapshot", async () => {
    const database = new RecordingDrizzleDatabase();

    await repository(database).updateBookingDetails(
      bookingRow.id,
      {
        name: "Updated adventure",
        venueName: "River Grounds",
        address1: "10 Main St",
        city: "Austin",
        region: "TX",
        postalCode: "78701",
        latitude: 30.2672,
        longitude: -97.7431,
        startsAt: new Date("2026-08-10T17:00:00.000Z"),
        endsAt: new Date("2026-08-12T17:00:00.000Z"),
        status: "confirmed",
        probability: "likely",
        travelLegId: null,
        notes: "Updated logistics",
      },
      new Date("2026-07-25T12:00:00.000Z"),
    );

    expect(database.locks).toEqual([
      { source: bookings, strength: "update" },
      { source: followUps, strength: "share" },
    ]);
    expect(database.bookingUpdates[0]).toMatchObject({
      venueName: "River Grounds",
      latitude: 30.2672,
      longitude: -97.7431,
      status: "confirmed",
      notes: "Updated logistics",
    });
    expect(database.audits[0]).toMatchObject({
      entityType: "booking",
      action: "update",
      before: {
        venueName: null,
        latitude: null,
        longitude: null,
        status: "possible",
        notes: null,
      },
      after: {
        venueName: "River Grounds",
        latitude: 30.2672,
        longitude: -97.7431,
        status: "confirmed",
        notes: "Updated logistics",
      },
    });
  });

  it("rejects an active edit before mutation when no future follow-up remains", async () => {
    const database = new RecordingDrizzleDatabase();
    database.openFollowUps = [];

    await expect(
      repository(database).updateBookingDetails(
        bookingRow.id,
        {
          name: bookingRow.name,
          venueName: null,
          address1: null,
          city: bookingRow.city,
          region: bookingRow.region,
          postalCode: null,
          latitude: null,
          longitude: null,
          startsAt: null,
          endsAt: null,
          status: "possible",
          probability: "likely",
          travelLegId: null,
          notes: null,
        },
        new Date("2026-07-25T12:00:00.000Z"),
      ),
    ).rejects.toThrow("NEXT_ACTION_REQUIRED");

    expect(database.bookingUpdates).toHaveLength(0);
    expect(database.audits).toHaveLength(0);
  });

  it("loads the follow-up and booking under a transaction row lock", async () => {
    const database = new RecordingDrizzleDatabase();

    const context = await repository(database).transaction(
      async (transaction: BookingTransaction) =>
        transaction.findFollowUpWithBookingForUpdate(followUpRow.id),
    );

    expect(context).toMatchObject({
      booking: { id: bookingRow.id },
      followUp: { id: followUpRow.id },
    });
    expect(database.locks).toEqual([
      { source: followUps, strength: "update" },
    ]);
  });
});
