import { describe, expect, it } from "vitest";

import {
  auditEntries,
  bookingContacts,
  bookings,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import {
  DrizzleBookingRelationshipRepository,
  ensureBookingContact,
  setBookingPrimaryContact,
} from "@/features/bookings/booking-relationship-repository";

const ids = {
  currentPlace: "11111111-1111-4111-8111-111111111111",
  targetPlace: "22222222-2222-4222-8222-222222222222",
  personOne: "33333333-3333-4333-8333-333333333333",
  personTwo: "44444444-4444-4444-8444-444444444444",
  booking: "55555555-5555-4555-8555-555555555555",
};
const now = new Date("2026-07-29T12:00:00.000Z");

class RecordingBookingRelationshipDatabase {
  readonly events: string[] = [];
  bookingOrganizationAfterPeopleLock: string | null = null;
  lastEnsuredContactId: string | null = null;
  booking = {
    id: ids.booking,
    organizationId: ids.currentPlace,
    primaryContactId: ids.personOne,
  };
  readonly bookingPeople = new Map([
    [
      ids.personOne,
      {
        id: "66666666-6666-4666-8666-666666666666",
        bookingId: ids.booking,
        contactId: ids.personOne,
        role: "Lead",
        isPrimary: true,
        source: "local",
      },
    ],
    [
      ids.personTwo,
      {
        id: "77777777-7777-4777-8777-777777777777",
        bookingId: ids.booking,
        contactId: ids.personTwo,
        role: null,
        isPrimary: false,
        source: "local",
      },
    ],
  ]);

  private label(table: unknown) {
    if (table === organizations) return "organizations";
    if (table === contacts) return "contacts";
    if (table === bookings) return "bookings";
    if (table === organizationContacts) return "organization_contacts";
    if (table === bookingContacts) return "booking_contacts";
    return "unknown";
  }

  private records(table: unknown) {
    if (table === organizations) {
      return [{ id: ids.currentPlace }, { id: ids.targetPlace }];
    }
    if (table === contacts) {
      return [{ id: ids.personOne }, { id: ids.personTwo }];
    }
    if (table === bookings) return [{ ...this.booking }];
    if (table === organizationContacts) {
      return [{ contactId: ids.personOne }, { contactId: ids.personTwo }];
    }
    if (table === bookingContacts) {
      return [...this.bookingPeople.values()].map((person) => ({ ...person }));
    }
    return [];
  }

  select() {
    return {
      from: (table: unknown) => {
        const builder = {
          innerJoin: () => builder,
          where: () => terminal,
          orderBy: () => terminal,
        };
        const terminal = {
          innerJoin: () => terminal,
          where: () => terminal,
          orderBy: () => terminal,
          limit: () => terminal,
          for: async () => {
            this.events.push(`lock:${this.label(table)}`);
            if (
              table === contacts &&
              this.bookingOrganizationAfterPeopleLock
            ) {
              this.booking.organizationId =
                this.bookingOrganizationAfterPeopleLock;
            }
            return this.records(table);
          },
          then: (
            resolve: (value: unknown[]) => unknown,
            reject?: (reason: unknown) => unknown,
          ) => {
            this.events.push(`discover:${this.label(table)}`);
            return Promise.resolve(this.records(table)).then(resolve, reject);
          },
        };
        return builder;
      },
    };
  }

  insert(table: unknown) {
    return {
      values: (
        input:
          | Record<string, unknown>
          | Array<Record<string, unknown>>,
      ) => {
        if (table === auditEntries) return {};
        if (table !== bookingContacts) {
          throw new Error("Unexpected insert in Booking lock test.");
        }
        const values = Array.isArray(input) ? input : [input];
        for (const person of values) {
          const contactId = String(person.contactId);
          this.bookingPeople.set(contactId, {
            ...person,
            id:
              this.bookingPeople.get(contactId)?.id ??
              "88888888-8888-4888-8888-888888888888",
          } as never);
          this.lastEnsuredContactId = contactId;
        }
        this.events.push("write:booking_contacts");
        return {
          onConflictDoUpdate: async () => undefined,
        };
      },
    };
  }

  update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => ({
        where: () => {
          if (table === bookings) Object.assign(this.booking, values);
          if (table === bookingContacts) {
            for (const person of this.bookingPeople.values()) {
              Object.assign(person, values);
            }
          }
          this.events.push(`write:${this.label(table)}`);
          return {
            returning: async () =>
              table === bookingContacts
                ? [{ contactId: this.lastEnsuredContactId ?? ids.personOne }]
                : [{ id: ids.booking }],
          };
        },
      }),
    };
  }

  delete(table: unknown) {
    return {
      where: async () => {
        this.events.push(`write:delete:${this.label(table)}`);
      },
    };
  }

  transaction<T>(
    operation: (
      transaction: RecordingBookingRelationshipDatabase,
    ) => Promise<T>,
  ) {
    return operation(this);
  }
}

function lockEvents(database: RecordingBookingRelationshipDatabase) {
  return database.events.filter(
    (event) => event.startsWith("discover:") || event.startsWith("lock:"),
  );
}

describe("Booking relationship parent locking", () => {
  it("locks Place and Person before Booking in ensureBookingContact", async () => {
    const database = new RecordingBookingRelationshipDatabase();

    await ensureBookingContact(database as never, {
      bookingId: ids.booking,
      contactId: ids.personTwo,
      source: "local",
      now,
    });

    expect(lockEvents(database)).toEqual([
      "discover:bookings",
      "lock:organizations",
      "lock:contacts",
      "lock:bookings",
      "lock:organization_contacts",
    ]);
  });

  it("locks all existing and target People before Booking when setting the primary Person", async () => {
    const database = new RecordingBookingRelationshipDatabase();

    await setBookingPrimaryContact(database as never, {
      bookingId: ids.booking,
      contactId: ids.personTwo,
      source: "local",
      now,
    });

    expect(lockEvents(database)).toEqual([
      "discover:bookings",
      "discover:booking_contacts",
      "lock:organizations",
      "lock:contacts",
      "lock:bookings",
      "lock:booking_contacts",
      "lock:organization_contacts",
    ]);
  });

  it("locks current and target Places and discovered People before Booking when changing Place", async () => {
    const database = new RecordingBookingRelationshipDatabase();

    await new DrizzleBookingRelationshipRepository(
      database as never,
    ).changePlace(
      { bookingId: ids.booking, organizationId: ids.targetPlace },
      now,
    );

    expect(lockEvents(database).slice(0, 6)).toEqual([
      "discover:bookings",
      "discover:booking_contacts",
      "lock:organizations",
      "lock:contacts",
      "lock:bookings",
      "lock:booking_contacts",
    ]);
  });

  it("locks current and selected People before Booking when replacing People", async () => {
    const database = new RecordingBookingRelationshipDatabase();

    await new DrizzleBookingRelationshipRepository(
      database as never,
    ).replacePeople(
      {
        bookingId: ids.booking,
        people: [
          { contactId: ids.personTwo, role: "Lead", isPrimary: true },
        ],
      },
      now,
    );

    expect(lockEvents(database).slice(0, 6)).toEqual([
      "discover:bookings",
      "discover:booking_contacts",
      "lock:organizations",
      "lock:contacts",
      "lock:bookings",
      "lock:booking_contacts",
    ]);
  });

  it("aborts when the Booking Place changes after parent discovery", async () => {
    const database = new RecordingBookingRelationshipDatabase();
    database.bookingOrganizationAfterPeopleLock = ids.targetPlace;

    await expect(
      setBookingPrimaryContact(database as never, {
        bookingId: ids.booking,
        contactId: ids.personTwo,
        source: "local",
        now,
      }),
    ).rejects.toThrow("Booking relationships changed while locks were acquired.");
    expect(database.events.some((event) => event.startsWith("write:"))).toBe(
      false,
    );
  });
});
