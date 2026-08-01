import { describe, expect, it } from "vitest";

import {
  bookingContacts,
  bookings,
  contacts,
  followUps,
  organizationContacts,
  organizations,
} from "@/db/schema";
import { DrizzleCallRepository } from "@/features/calls/call-repository";
import type { CompleteCallInput } from "@/features/calls/call-types";

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  changedOrganization: "22222222-2222-4222-8222-222222222222",
  contact: "33333333-3333-4333-8333-333333333333",
  booking: "44444444-4444-4444-8444-444444444444",
  followUp: "55555555-5555-4555-8555-555555555555",
};

const input = {
  requestKey: "66666666-6666-4666-8666-666666666666",
  organizationId: null,
  contactId: null,
  bookingId: null,
  followUpId: ids.followUp,
  note: "Called.",
  disposition: "booked",
  resultingBookingStatus: "confirmed",
  startedAt: new Date("2026-07-29T12:00:00.000Z"),
  endedAt: new Date("2026-07-29T12:05:00.000Z"),
  nextAction: null,
  lastResortReason: null,
  lastResortConfirmed: false,
  approvedContactUpdates: null,
  approvedBookingUpdates: null,
} satisfies CompleteCallInput;

class RecordingCallContextDatabase {
  readonly events: string[] = [];
  bookingOrganizationAfterPersonLock: string | null = null;
  organization = {
    id: ids.organization,
    name: "Marias Fair",
    lastResort: false,
    lastResortReason: null,
  };
  contact = {
    id: ids.contact,
    organizationId: ids.organization,
    firstName: "Avery",
    lastName: "Example",
    jobTitle: null,
    email: null,
    phone: "406-555-0101",
    address1: null,
    address2: null,
    city: null,
    region: null,
    postalCode: null,
  };
  booking = {
    id: ids.booking,
    organizationId: ids.organization,
    primaryContactId: ids.contact,
    status: "interested",
  };
  followUp = {
    id: ids.followUp,
    bookingId: ids.booking,
    organizationId: null,
    contactId: null,
    completedAt: null,
    outcome: null,
    nextFollowUpId: null,
  };

  private label(table: unknown) {
    if (table === organizations) return "organization";
    if (table === contacts) return "contact";
    if (table === bookings) return "booking";
    if (table === followUps) return "follow_up";
    if (table === organizationContacts) return "organization_contact";
    if (table === bookingContacts) return "booking_contact";
    return "unknown";
  }

  private records(table: unknown) {
    if (table === organizations) return [{ ...this.organization }];
    if (table === contacts) return [{ ...this.contact }];
    if (table === bookings) return [{ ...this.booking }];
    if (table === followUps) return [{ ...this.followUp }];
    if (table === organizationContacts || table === bookingContacts) {
      return [{ id: "77777777-7777-4777-8777-777777777777" }];
    }
    return [];
  }

  select() {
    return {
      from: (table: unknown) => ({
        where: () => {
          const terminal = {
            limit: () => terminal,
            for: async () => {
              this.events.push(`lock:${this.label(table)}`);
              if (
                table === contacts &&
                this.bookingOrganizationAfterPersonLock
              ) {
                this.booking.organizationId =
                  this.bookingOrganizationAfterPersonLock;
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
          return terminal;
        },
      }),
    };
  }

  transaction<T>(
    operation: (transaction: RecordingCallContextDatabase) => Promise<T>,
  ) {
    return operation(this);
  }
}

describe("DrizzleCallRepository context locking", () => {
  it("discovers derived IDs and locks canonical parents before associations", async () => {
    const database = new RecordingCallContextDatabase();
    const repository = new DrizzleCallRepository(database as never);

    await expect(
      repository.transaction((transaction) => transaction.lockContext(input)),
    ).resolves.toMatchObject({
      organization: { id: ids.organization },
      contact: { id: ids.contact },
      booking: { id: ids.booking },
      followUp: { id: ids.followUp },
      contactHasActiveOrganizationRelationship: true,
      contactHasBookingRelationship: true,
    });

    expect(database.events).toEqual([
      "discover:follow_up",
      "discover:booking",
      "discover:contact",
      "lock:organization",
      "lock:contact",
      "lock:booking",
      "lock:follow_up",
      "lock:organization_contact",
      "lock:booking_contact",
    ]);
  });

  it("aborts instead of locking a newly derived Place after Person", async () => {
    const database = new RecordingCallContextDatabase();
    database.bookingOrganizationAfterPersonLock = ids.changedOrganization;
    const repository = new DrizzleCallRepository(database as never);

    await expect(
      repository.transaction((transaction) => transaction.lockContext(input)),
    ).rejects.toThrow("Call context changed while locks were acquired.");
    expect(database.events).not.toContain("lock:organization_contact");
    expect(database.events).not.toContain("lock:booking_contact");
  });
});
