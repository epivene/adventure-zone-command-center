import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import { inspectRelationshipInvariants } from "@/features/relationships/relationship-reconciliation";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

const ids = {
  place: "11111111-1111-4111-8111-111111111111",
  otherPlace: "22222222-2222-4222-8222-222222222222",
  validPerson: "33333333-3333-4333-8333-333333333333",
  personMissingPlaceLink: "44444444-4444-4444-8444-444444444444",
  unrelatedPerson: "55555555-5555-4555-8555-555555555555",
  bookingMissingPersonLink: "66666666-6666-4666-8666-666666666666",
  bookingWithUnrelatedPerson: "77777777-7777-4777-8777-777777777777",
  legacyBooking: "88888888-8888-4888-8888-888888888888",
  personMissingPlaceLinkTwo: "99999999-9999-4999-8999-999999999999",
  bookingMissingPersonLinkTwo: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  unrelatedPersonTwo: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  bookingWithUnrelatedPersonTwo: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  legacyBookingTwo: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};

function testSchemaName() {
  return `relationship_reconciliation_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

type FakeQueryRow = Record<string, string>;

class FakeReconciliationQuery implements PromiseLike<FakeQueryRow[]> {
  constructor(private readonly rows: FakeQueryRow[]) {}

  from() {
    return this;
  }

  leftJoin() {
    return this;
  }

  innerJoin() {
    return this;
  }

  where() {
    return this;
  }

  then<TResult1 = FakeQueryRow[], TResult2 = never>(
    onfulfilled?:
      | ((value: FakeQueryRow[]) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.rows).then(onfulfilled, onrejected);
  }
}

function fakeReconciliationDatabase(resultSets: FakeQueryRow[][]) {
  let queryIndex = 0;
  return {
    select: () =>
      new FakeReconciliationQuery(resultSets[queryIndex++] ?? []),
  } as unknown as typeof import("@/db/client").db;
}

describe("inspectRelationshipInvariants", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    sql = postgres(databaseUrl!, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await sql.unsafe(`SET search_path TO "${schemaName}", public`);
    const journal = JSON.parse(
      await readFile(path.join(migrationDirectory, "meta", "_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      for (const statement of await migrationStatements(`${entry.tag}.sql`, schemaName)) {
        await sql.unsafe(statement);
      }
    }
  });

  afterEach(async () => {
    if (!sql) return;
    try {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await sql.end({ timeout: 5 });
      sql = undefined;
    }
  });

  it("sorts every invariant category independently of database row order", async () => {
    const database = fakeReconciliationDatabase([
      [
        { id: ids.personMissingPlaceLinkTwo },
        { id: ids.personMissingPlaceLink },
      ],
      [
        { id: ids.bookingMissingPersonLinkTwo },
        { id: ids.bookingMissingPersonLink },
      ],
      [
        {
          bookingId: ids.bookingWithUnrelatedPersonTwo,
          contactId: ids.unrelatedPersonTwo,
        },
        {
          bookingId: ids.bookingWithUnrelatedPerson,
          contactId: ids.unrelatedPerson,
        },
      ],
      [
        { id: ids.legacyBookingTwo },
        { id: ids.legacyBooking },
      ],
    ]);

    await expect(inspectRelationshipInvariants(database)).resolves.toEqual({
      contactPrimaryPlaceWithoutAssociation: [
        ids.personMissingPlaceLink,
        ids.personMissingPlaceLinkTwo,
      ],
      bookingPrimaryPersonWithoutAssociation: [
        ids.bookingMissingPersonLink,
        ids.bookingMissingPersonLinkTwo,
      ],
      bookingPeopleOutsidePlace: [
        {
          bookingId: ids.bookingWithUnrelatedPerson,
          contactId: ids.unrelatedPerson,
        },
        {
          bookingId: ids.bookingWithUnrelatedPersonTwo,
          contactId: ids.unrelatedPersonTwo,
        },
      ],
      legacyBookingsWithoutPlace: [
        ids.legacyBooking,
        ids.legacyBookingTwo,
      ],
    });
  });

  postgresTest("returns four empty arrays for a fully valid graph", async () => {
    const db = drizzle({ client: sql!, schema: crmSchema });
    await db.insert(crmSchema.organizations).values({ id: ids.place, name: "Fair" });
    await db.insert(crmSchema.contacts).values([
      {
        id: ids.validPerson,
        organizationId: null,
        firstName: "Valid",
        lastName: "Primary",
      },
      {
        id: ids.unrelatedPerson,
        organizationId: null,
        firstName: "Valid",
        lastName: "Additional",
      },
    ]);
    await db.insert(crmSchema.organizationContacts).values([
      {
        organizationId: ids.place,
        contactId: ids.validPerson,
        active: true,
        isPrimary: true,
      },
      {
        organizationId: ids.place,
        contactId: ids.unrelatedPerson,
        active: true,
      },
    ]);
    await sql!.unsafe(`
      UPDATE contacts SET organization_id = '${ids.place}'
      WHERE id IN ('${ids.validPerson}', '${ids.unrelatedPerson}')
    `);
    await db.insert(crmSchema.bookings).values({
      id: ids.bookingWithUnrelatedPerson,
      organizationId: ids.place,
      primaryContactId: null,
      name: "Valid Booking",
      city: "Shelby",
      region: "MT",
    });
    await db.insert(crmSchema.bookingContacts).values([
      {
        bookingId: ids.bookingWithUnrelatedPerson,
        contactId: ids.validPerson,
        isPrimary: true,
      },
      {
        bookingId: ids.bookingWithUnrelatedPerson,
        contactId: ids.unrelatedPerson,
        isPrimary: false,
      },
    ]);
    await sql!.unsafe(`
      UPDATE bookings SET primary_contact_id = '${ids.validPerson}'
      WHERE id = '${ids.bookingWithUnrelatedPerson}'
    `);

    await expect(inspectRelationshipInvariants(db)).resolves.toEqual({
      contactPrimaryPlaceWithoutAssociation: [],
      bookingPrimaryPersonWithoutAssociation: [],
      bookingPeopleOutsidePlace: [],
      legacyBookingsWithoutPlace: [],
    });
  });

  postgresTest("reports every legacy and relationship exception deterministically", async () => {
    const db = drizzle({ client: sql!, schema: crmSchema });
    await sql!.unsafe(`
      ALTER TABLE contacts
      DROP CONSTRAINT contacts_primary_organization_contact_fk;
      ALTER TABLE bookings
      DROP CONSTRAINT bookings_primary_booking_contact_fk;
    `);
    await db.insert(crmSchema.organizations).values([
      { id: ids.place, name: "Fair" },
      { id: ids.otherPlace, name: "Other Fair" },
    ]);
    await db.insert(crmSchema.contacts).values([
      {
        id: ids.validPerson,
        organizationId: ids.place,
        firstName: "Valid",
        lastName: "Person",
      },
      {
        id: ids.personMissingPlaceLinkTwo,
        organizationId: ids.place,
        firstName: "Missing Two",
        lastName: "Place Link",
      },
      {
        id: ids.personMissingPlaceLink,
        organizationId: ids.place,
        firstName: "Missing",
        lastName: "Place Link",
      },
      {
        id: ids.unrelatedPerson,
        organizationId: ids.otherPlace,
        firstName: "Unrelated",
        lastName: "Person",
      },
      {
        id: ids.unrelatedPersonTwo,
        organizationId: ids.otherPlace,
        firstName: "Unrelated Two",
        lastName: "Person",
      },
    ]);
    await db.insert(crmSchema.organizationContacts).values([
      {
        organizationId: ids.place,
        contactId: ids.validPerson,
        active: true,
      },
      {
        organizationId: ids.otherPlace,
        contactId: ids.unrelatedPerson,
        active: true,
      },
      {
        organizationId: ids.otherPlace,
        contactId: ids.unrelatedPersonTwo,
        active: true,
      },
    ]);
    await db.insert(crmSchema.bookings).values([
      {
        id: ids.bookingMissingPersonLinkTwo,
        organizationId: ids.place,
        primaryContactId: ids.validPerson,
        name: "Missing Person Link Two",
        city: "Shelby",
        region: "MT",
      },
      {
        id: ids.bookingWithUnrelatedPerson,
        organizationId: ids.place,
        name: "Unrelated Person",
        city: "Shelby",
        region: "MT",
      },
      {
        id: ids.bookingMissingPersonLink,
        organizationId: ids.place,
        primaryContactId: ids.validPerson,
        name: "Missing Person Link",
        city: "Shelby",
        region: "MT",
      },
      {
        id: ids.bookingWithUnrelatedPersonTwo,
        organizationId: ids.place,
        name: "Unrelated Person Two",
        city: "Shelby",
        region: "MT",
      },
      {
        id: ids.legacyBookingTwo,
        organizationId: null,
        name: "Legacy Two",
        city: "Shelby",
        region: "MT",
      },
      {
        id: ids.legacyBooking,
        organizationId: null,
        name: "Legacy",
        city: "Shelby",
        region: "MT",
      },
    ]);
    await db.insert(crmSchema.bookingContacts).values([
      {
        bookingId: ids.bookingWithUnrelatedPersonTwo,
        contactId: ids.unrelatedPersonTwo,
        isPrimary: false,
      },
      {
        bookingId: ids.bookingWithUnrelatedPerson,
        contactId: ids.unrelatedPerson,
        isPrimary: false,
      },
    ]);

    await expect(inspectRelationshipInvariants(db)).resolves.toEqual({
      contactPrimaryPlaceWithoutAssociation: [
        ids.personMissingPlaceLink,
        ids.personMissingPlaceLinkTwo,
      ],
      bookingPrimaryPersonWithoutAssociation: [
        ids.bookingMissingPersonLink,
        ids.bookingMissingPersonLinkTwo,
      ],
      bookingPeopleOutsidePlace: [
        {
          bookingId: ids.bookingWithUnrelatedPerson,
          contactId: ids.unrelatedPerson,
        },
        {
          bookingId: ids.bookingWithUnrelatedPersonTwo,
          contactId: ids.unrelatedPersonTwo,
        },
      ],
      legacyBookingsWithoutPlace: [
        ids.legacyBooking,
        ids.legacyBookingTwo,
      ],
    });
  });
});
