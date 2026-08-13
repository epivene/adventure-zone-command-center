import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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
import {
  buildEventProfile,
  DrizzleEventProfileRepository,
  type EventProfileRecordSet,
} from "./event-profile-repository";

const parentId = "10000000-0000-4000-8000-000000000001";
const childId = "20000000-0000-4000-8000-000000000001";

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
    private readonly database: HierarchyDatabase,
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
    if (this.table === bookings) return [];
    if (this.table === activities || this.table === followUps) {
      const rendered = new PgDialect().sqlToQuery(this.condition as SQL);
      this.database.recordOwnershipCondition(
        this.table === activities ? "activities" : "followUps",
        rendered.sql.toLowerCase().replace(/\s+/g, " "),
      );
      return [];
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

class HierarchyDatabase {
  private executeCall = 0;
  readonly ownershipConditions: Record<"activities" | "followUps", string> = {
    activities: "",
    followUps: "",
  };

  recordOwnershipCondition(kind: "activities" | "followUps", condition: string) {
    this.ownershipConditions[kind] = condition;
  }

  readonly organizations = [
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
      id: childId,
      name: "Adventure Zone Reno",
      parentOrganizationId: parentId,
      placeType: "festival_event",
      phone: null,
      address1: "100 River Road",
      address2: null,
      city: "Reno",
      region: "NV",
      postalCode: "89501",
      website: "https://reno.example.com",
      lastResort: false,
      lastResortReason: null,
      actRecordId: null,
    },
  ];

  readonly contacts = [{
    id: "contact-id",
    organizationId: childId,
    firstName: "Jordan",
    lastName: "Lee",
    role: "Local",
    isPrimary: true,
    phone: null,
    email: null,
    source: "local",
    actRecordId: null,
  }];

  select(selection: Record<string, unknown>) {
    return new SelectBuilder(this, selection);
  }

  execute() {
    const rows = [
      [{
        id: childId,
        name: "Adventure Zone Reno",
        address1: "100 River Road",
        address2: null,
        city: "Reno",
        region: "NV",
        postalCode: "89501",
        website: "https://reno.example.com",
        localStatus: "confirmed",
        nextFollowUpId: null,
        nextFollowUpKind: null,
        nextFollowUpDueAt: null,
        nextBookingId: "booking-id",
        nextBookingName: "Reno Event",
        nextBookingStartsAt: new Date("2099-09-10T14:00:00.000Z"),
        nextBookingStatus: "confirmed",
        travelLegId: "leg-id",
        travelLegName: "Northern Nevada",
        travelLegColor: "#f97316",
        primaryContactFirstName: "Jordan",
        primaryContactLastName: "Lee",
      }],
      [{
        locationCount: 1,
        upcomingBookingCount: 1,
        overdueFollowUpCount: 0,
        mostRecentContactAt: new Date("2099-08-10T14:00:00.000Z"),
      }],
      [{ id: "leg-id", name: "Northern Nevada", color: "#f97316" }],
    ];
    return Promise.resolve({ rows: rows[this.executeCall++] ?? [] });
  }

  asApplicationDatabase() {
    return this as unknown as typeof ApplicationDatabase;
  }
}

const records: EventProfileRecordSet = {
  place: {
    id: parentId,
    name: "Adventure Zone",
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
  contacts: [],
  bookings: [],
  activities: [],
  followUps: [],
  groups: [],
  externalLinks: [],
};

describe("frontend event profile hierarchy reads", () => {
  it("propagates a supplied hierarchy through buildEventProfile", () => {
    const profile = buildEventProfile(records, undefined, undefined, {
      parent: { id: "group-id", name: "Adventure Zone Group", website: "https://group.example.com" },
      locations: [],
      rollups: {
        locationCount: 0,
        upcomingBookingCount: 0,
        overdueFollowUpCount: 0,
        travelLegs: [],
        mostRecentContactAt: null,
      },
    });

    expect(profile.parent?.name).toBe("Adventure Zone Group");
  });

  it("loads parent summaries and location rollups for real repository reads", async () => {
    const database = new HierarchyDatabase();
    const repository = new DrizzleEventProfileRepository(
      database.asApplicationDatabase(),
    );

    const child = await repository.getEventProfile(childId);
    const parent = await repository.getEventProfile(parentId);

    expect(child?.parent).toEqual({
      id: parentId,
      name: "Adventure Zone",
      website: "https://example.com",
    });
    expect(parent?.locations).toMatchObject([{
      id: childId,
      nextBooking: { id: "booking-id" },
      travelLeg: { id: "leg-id" },
      primaryContactName: "Jordan Lee",
    }]);
    expect(parent?.rollups).toMatchObject({
      locationCount: 1,
      upcomingBookingCount: 1,
      travelLegs: [{ id: "leg-id", name: "Northern Nevada", color: "#f97316" }],
    });
    for (const condition of Object.values(database.ownershipConditions)) {
      expect(condition).toContain('"organization_id" is not null');
      expect(condition).toContain('"organization_id" is null');
      expect(condition).toContain('"booking_id" is not null');
      expect(condition).toContain('"booking_id" is null');
      expect(condition).toContain('"contact_id" is not null');
    }
  });
});
