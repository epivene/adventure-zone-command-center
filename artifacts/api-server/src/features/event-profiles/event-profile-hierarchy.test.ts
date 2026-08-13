import { describe, expect, it } from "vitest";

import type { db as ApplicationDatabase } from "@/db/client";
import {
  actExternalLinks,
  activities,
  auditEntries,
  bookings,
  callingListMemberships,
  contacts,
  followUps,
  organizationContacts,
  organizations,
} from "@/db/schema";
import { DrizzleEventProfileRepository } from "./event-profile-repository";

type OrganizationRow = {
  id: string;
  name: string;
  parentOrganizationId: string | null;
  placeType: string;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  website: string | null;
  lastResort: boolean;
  lastResortReason: string | null;
  actRecordId: string | null;
};

type ContactRow = {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  role: string | null;
  isPrimary: boolean;
  phone: string | null;
  email: string | null;
  source: string;
  actRecordId: string | null;
};

type BookingRow = {
  id: string;
  organizationId: string;
  name: string;
  primaryContactId: string | null;
  city: string;
  region: string;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string;
  probability: string;
  notes: string | null;
  actRecordId: string | null;
};

type ActivityRow = {
  id: string;
  organizationId: string;
  contactId: string | null;
  bookingId: string | null;
  kind: string;
  body: string;
  occurredAt: Date;
};

type FollowUpRow = {
  id: string;
  organizationId: string;
  contactId: string | null;
  bookingId: string | null;
  kind: string;
  dueAt: Date;
  completedAt: Date | null;
};

const parentId = "10000000-0000-4000-8000-000000000001";
const austinId = "20000000-0000-4000-8000-000000000001";
const denverId = "20000000-0000-4000-8000-000000000002";

function sqlParameters(value: unknown, seen = new Set<unknown>()): unknown[] {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  if ("value" in value && value.constructor?.name === "Param") {
    return [(value as { value: unknown }).value];
  }
  if (Array.isArray(value)) return value.flatMap((item) => sqlParameters(item, seen));
  if ("queryChunks" in value) {
    return sqlParameters((value as { queryChunks: unknown[] }).queryChunks, seen);
  }
  return [];
}

class SelectBuilder implements PromiseLike<unknown[]> {
  private table: unknown;
  private condition: unknown;

  constructor(
    private readonly database: HierarchyReadDatabase,
    private readonly selection: Record<string, unknown>,
  ) {}

  from(table: unknown) {
    this.table = table;
    return this;
  }

  innerJoin() { return this; }
  leftJoin() { return this; }

  where(condition: unknown) {
    this.condition = condition;
    return this;
  }

  orderBy() { return this; }
  limit() { return this; }

  private rows() {
    const ids = sqlParameters(this.condition).filter(
      (value): value is string => typeof value === "string",
    );

    if (this.table === organizations) {
      const matches = this.database.organizations.filter((row) => ids.includes(row.id));
      return "placeType" in this.selection
        ? matches
        : matches.map(({ id, name, website }) => ({ id, name, website }));
    }
    if (this.table === organizationContacts) {
      return this.database.contacts.filter((row) => ids.includes(row.organizationId));
    }
    if (this.table === bookings) {
      return this.database.bookings.filter((row) => ids.includes(row.organizationId));
    }
    if (this.table === activities) {
      return this.database.activities.filter((row) =>
        ids.includes(row.organizationId)
        || (row.contactId !== null && ids.includes(row.contactId))
        || (row.bookingId !== null && ids.includes(row.bookingId)),
      );
    }
    if (this.table === followUps) {
      return this.database.followUps.filter((row) =>
        ids.includes(row.organizationId)
        || (row.contactId !== null && ids.includes(row.contactId))
        || (row.bookingId !== null && ids.includes(row.bookingId)),
      );
    }
    if (
      this.table === callingListMemberships
      || this.table === auditEntries
      || this.table === actExternalLinks
      || this.table === contacts
    ) return [];
    throw new Error(`Unexpected select: ${Object.keys(this.selection).join(",")}`);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.rows()).then(onfulfilled, onrejected);
  }
}

class HierarchyReadDatabase {
  private executeCall = 0;

  readonly organizations: OrganizationRow[] = [
    {
      id: parentId,
      name: "Adventure Zone",
      parentOrganizationId: null,
      placeType: "company",
      phone: null,
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
      website: "https://example.com",
      lastResort: false,
      lastResortReason: null,
      actRecordId: null,
    },
    {
      id: austinId,
      name: "Adventure Zone - Austin",
      parentOrganizationId: parentId,
      placeType: "festival_event",
      phone: null,
      address1: "100 Congress Ave",
      address2: null,
      city: "Austin",
      region: "TX",
      postalCode: "78701",
      website: "https://example.com/austin",
      lastResort: false,
      lastResortReason: null,
      actRecordId: "act-austin",
    },
    {
      id: denverId,
      name: "Adventure Zone - Denver",
      parentOrganizationId: parentId,
      placeType: "festival_event",
      phone: null,
      address1: "200 Market St",
      address2: null,
      city: "Denver",
      region: "CO",
      postalCode: "80202",
      website: "https://example.com/denver",
      lastResort: false,
      lastResortReason: null,
      actRecordId: "act-denver",
    },
  ];

  readonly contacts: ContactRow[] = [
    {
      id: "contact-parent",
      organizationId: parentId,
      firstName: "Pat",
      lastName: "Parent",
      role: "Corporate",
      isPrimary: true,
      phone: null,
      email: "parent@example.com",
      source: "local",
      actRecordId: null,
    },
    {
      id: "contact-austin",
      organizationId: austinId,
      firstName: "Alex",
      lastName: "Austin",
      role: "Local",
      isPrimary: true,
      phone: null,
      email: "austin@example.com",
      source: "act",
      actRecordId: "act-contact-austin",
    },
  ];

  readonly bookings: BookingRow[] = [
    {
      id: "booking-austin",
      organizationId: austinId,
      name: "Austin Festival",
      primaryContactId: "contact-austin",
      city: "Austin",
      region: "TX",
      startsAt: new Date("2099-09-10T14:00:00.000Z"),
      endsAt: null,
      status: "confirmed",
      probability: "likely",
      notes: null,
      actRecordId: "act-booking-austin",
    },
  ];

  readonly activities: ActivityRow[] = [
    {
      id: "activity-parent",
      organizationId: parentId,
      contactId: "contact-parent",
      bookingId: null,
      kind: "note",
      body: "Parent-only activity",
      occurredAt: new Date("2026-08-10T10:00:00.000Z"),
    },
    {
      id: "activity-austin",
      organizationId: austinId,
      contactId: "contact-austin",
      bookingId: "booking-austin",
      kind: "call",
      body: "Austin-only activity",
      occurredAt: new Date("2026-08-12T18:30:00.000Z"),
    },
  ];

  readonly followUps: FollowUpRow[] = [];

  select(selection: Record<string, unknown>) {
    return new SelectBuilder(this, selection);
  }

  execute() {
    const results = [
      [
        {
          id: austinId,
          name: "Adventure Zone - Austin",
          address1: "100 Congress Ave",
          address2: null,
          city: "Austin",
          region: "TX",
          postalCode: "78701",
          website: "https://example.com/austin",
          localStatus: "confirmed",
          nextFollowUpId: "follow-up-austin",
          nextFollowUpKind: "email",
          nextFollowUpDueAt: new Date("2099-08-14T15:00:00.000Z"),
          nextBookingId: "booking-austin",
          nextBookingName: "Austin Festival",
          nextBookingStartsAt: new Date("2099-09-10T14:00:00.000Z"),
          nextBookingStatus: "confirmed",
          travelLegId: "leg-south",
          travelLegName: "South",
          travelLegColor: "#ff6600",
          primaryContactFirstName: "Alex",
          primaryContactLastName: "Austin",
        },
        {
          id: denverId,
          name: "Adventure Zone - Denver",
          address1: "200 Market St",
          address2: null,
          city: "Denver",
          region: "CO",
          postalCode: "80202",
          website: "https://example.com/denver",
          localStatus: null,
          nextFollowUpId: null,
          nextFollowUpKind: null,
          nextFollowUpDueAt: null,
          nextBookingId: null,
          nextBookingName: null,
          nextBookingStartsAt: null,
          nextBookingStatus: null,
          travelLegId: null,
          travelLegName: null,
          travelLegColor: null,
          primaryContactFirstName: null,
          primaryContactLastName: null,
        },
      ],
      [
        {
          locationCount: 2,
          upcomingBookingCount: 1,
          overdueFollowUpCount: 1,
          mostRecentContactAt: new Date("2026-08-12T18:30:00.000Z"),
        },
      ],
      [{ id: "leg-south", name: "South", color: "#ff6600" }],
    ];
    return Promise.resolve({ rows: results[this.executeCall++] ?? [] });
  }

  asApplicationDatabase() {
    return this as unknown as typeof ApplicationDatabase;
  }
}

describe("event profile hierarchy reads", () => {
  it("keeps parent and child histories separate while preserving the child profile URL", async () => {
    const repository = new DrizzleEventProfileRepository(
      new HierarchyReadDatabase().asApplicationDatabase(),
    );

    const child = await repository.getEventProfile(austinId);
    const parent = await repository.getEventProfile(parentId);

    expect(child?.id).toBe(austinId);
    expect(child?.parent).toEqual({
      id: parentId,
      name: "Adventure Zone",
      website: "https://example.com",
    });
    expect(child?.contacts.map(({ id }) => id)).toEqual(["contact-austin"]);
    expect(child?.notes.map(({ id }) => id)).toEqual(["activity-austin"]);
    expect(child?.sourceProvenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: austinId, actRecordId: "act-austin" }),
      expect.objectContaining({ entityId: "booking-austin", actRecordId: "act-booking-austin" }),
      expect.objectContaining({ entityId: "contact-austin", actRecordId: "act-contact-austin" }),
    ]));

    expect(parent?.parent).toBeNull();
    expect(parent?.contacts.map(({ id }) => id)).toEqual(["contact-parent"]);
    expect(parent?.notes.map(({ id }) => id)).toEqual(["activity-parent"]);
    expect(parent?.locations.map(({ id }) => id)).toEqual([austinId, denverId]);
    expect(parent?.locations[0]).toMatchObject({
      id: austinId,
      nextBooking: { id: "booking-austin" },
      nextFollowUp: { id: "follow-up-austin" },
      travelLeg: { id: "leg-south" },
      primaryContactName: "Alex Austin",
    });
    expect(parent?.rollups).toEqual({
      locationCount: 2,
      upcomingBookingCount: 1,
      overdueFollowUpCount: 1,
      travelLegs: [{ id: "leg-south", name: "South", color: "#ff6600" }],
      mostRecentContactAt: new Date("2026-08-12T18:30:00.000Z"),
    });
  });
});
