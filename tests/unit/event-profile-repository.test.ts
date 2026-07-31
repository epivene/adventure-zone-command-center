import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  activities,
  actExternalLinks,
  bookings,
  callingListMemberships,
  followUps,
  organizationContacts,
  organizations,
} from "@/db/schema";
import {
  buildEventProfile,
  DrizzleEventProfileRepository,
  type EventProfileRecordSet,
} from "@/features/event-profiles/event-profile-repository";

const id = {
  profile: "11111111-1111-4111-8111-111111111111",
  avery: "22222222-2222-4222-8222-222222222222",
  blair: "33333333-3333-4333-8333-333333333333",
  booking: "44444444-4444-4444-8444-444444444444",
  followUp: "55555555-5555-4555-8555-555555555555",
};

const records: EventProfileRecordSet = {
  place: {
    id: id.profile,
    name: "10 Mile Pride",
    placeType: "fair",
    phone: "970-555-0100",
    address1: "10 Main Street",
    address2: null,
    city: "Breckenridge",
    region: "CO",
    postalCode: "80424",
    website: "https://example.com",
    lastResort: false,
    lastResortReason: null,
    actRecordId: "COMPANY-10-MILE",
  },
  contacts: [
    {
      id: id.blair,
      firstName: "Blair",
      lastName: "Zed",
      role: "Vendor manager",
      isPrimary: false,
      phone: "970-555-0102",
      email: "blair@example.com",
      source: "act_migration",
      actRecordId: "CONTACT-BLAIR",
    },
    {
      id: id.avery,
      firstName: "Avery",
      lastName: "Able",
      role: "Director",
      isPrimary: true,
      phone: "970-555-0101",
      email: "avery@example.com",
      source: "act_migration",
      actRecordId: "CONTACT-AVERY",
    },
  ],
  bookings: [{
    id: id.booking,
    name: "10 Mile Pride 2026",
    primaryContactId: id.avery,
    city: "Breckenridge",
    region: "CO",
    startsAt: new Date("2026-07-20T16:00:00Z"),
    endsAt: new Date("2026-07-20T22:00:00Z"),
    status: "interested",
    probability: "possible",
    notes: "Needs a quiet stage entrance.",
    actRecordId: "OPPORTUNITY-10-MILE",
  }],
  activities: [{
    id: "66666666-6666-4666-8666-666666666666",
    contactId: id.avery,
    bookingId: id.booking,
    kind: "call",
    body: "Asked for an updated proposal.",
    occurredAt: new Date("2026-07-01T16:00:00Z"),
  }],
  followUps: [{
    id: id.followUp,
    contactId: id.avery,
    bookingId: id.booking,
    kind: "prepare_quote",
    dueAt: new Date("2026-07-02T16:00:00Z"),
    completedAt: null,
  }],
  groups: [{
    id: "77777777-7777-4777-8777-777777777777",
    name: "Colorado Pride Leads",
    kind: "static",
    source: "act_migration",
    sourceStatus: "active",
    actRecordId: "GROUP-CO-PRIDE",
  }],
  externalLinks: [{
    entityType: "organization",
    entityId: id.profile,
    sourceEntityType: "company",
    actRecordId: "COMPANY-10-MILE",
    isPrimary: true,
    syncMode: "pull_only",
  }],
};

describe("buildEventProfile", () => {
  it("returns one event with every operational relationship and retained source provenance", () => {
    const profile = buildEventProfile(records);

    expect(profile).toMatchObject({
      id: id.profile,
      place: { name: "10 Mile Pride", city: "Breckenridge", region: "CO" },
      contacts: [
        { id: id.avery, name: "Avery Able", phone: "970-555-0101", email: "avery@example.com" },
        { id: id.blair, name: "Blair Zed", phone: "970-555-0102", email: "blair@example.com" },
      ],
      selectedContactId: id.avery,
      notes: [{ body: "Asked for an updated proposal.", kind: "call" }],
      groups: [{ name: "Colorado Pride Leads" }],
      bookings: [{ name: "10 Mile Pride 2026", notes: "Needs a quiet stage entrance." }],
      followUps: [{ kind: "prepare_quote", completedAt: null }],
    });
    expect(profile.sourceProvenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: id.profile, actRecordId: "COMPANY-10-MILE" }),
      expect.objectContaining({ entityId: id.avery, actRecordId: "CONTACT-AVERY" }),
      expect.objectContaining({ entityId: id.booking, actRecordId: "OPPORTUNITY-10-MILE" }),
    ]));
  });

  it("uses the requested associated contact or falls back to the stable primary contact", () => {
    expect(buildEventProfile(records, id.blair).selectedContactId).toBe(id.blair);
    expect(buildEventProfile(records, "not-associated").selectedContactId).toBe(id.avery);
  });

  it("includes rows attached solely to an active associated contact", async () => {
    const contactOnlyActivity = {
      id: "88888888-8888-4888-8888-888888888888",
      contactId: id.blair,
      bookingId: null,
      kind: "email",
      body: "Contact-only activity.",
      occurredAt: new Date("2026-07-03T16:00:00Z"),
    };
    const contactOnlyFollowUp = {
      id: "99999999-9999-4999-8999-999999999999",
      contactId: id.blair,
      bookingId: null,
      kind: "send_contract",
      dueAt: new Date("2026-07-04T16:00:00Z"),
      completedAt: null,
    };
    const dialect = new PgDialect();
    const rowsFor = (table: unknown, condition: unknown) => {
      const includesContact = () => {
        const query = dialect.sqlToQuery(condition as never);
        return query.sql.includes('"contact_id" in')
          && query.params.includes(id.blair);
      };
      if (table === organizations) return [records.place];
      if (table === organizationContacts) return records.contacts;
      if (table === bookings) return records.bookings;
      if (table === activities) return includesContact() ? [contactOnlyActivity] : [];
      if (table === followUps) return includesContact() ? [contactOnlyFollowUp] : [];
      if (table === callingListMemberships || table === actExternalLinks) return [];
      throw new Error("Unexpected event profile query");
    };
    const database = {
      select: () => {
        let table: unknown;
        let condition: unknown;
        const chain = {
          from: (value: unknown) => {
            table = value;
            return chain;
          },
          innerJoin: () => chain,
          leftJoin: () => chain,
          where: (value: unknown) => {
            condition = value;
            return chain;
          },
          orderBy: () => Promise.resolve(rowsFor(table, condition)),
          limit: () => Promise.resolve(rowsFor(table, condition)),
        };
        return chain;
      },
    };

    const profile = await new DrizzleEventProfileRepository(database as never)
      .getEventProfile(id.profile);

    expect(profile?.notes).toEqual([expect.objectContaining(contactOnlyActivity)]);
    expect(profile?.followUps).toEqual([expect.objectContaining(contactOnlyFollowUp)]);
  });
});
