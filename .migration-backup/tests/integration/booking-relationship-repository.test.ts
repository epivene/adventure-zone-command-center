import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { DrizzleBookingRelationshipRepository } from "@/features/bookings/booking-relationship-repository";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");
const ids = {
  placeOne: "11111111-1111-4111-8111-111111111111",
  placeTwo: "22222222-2222-4222-8222-222222222222",
  placeThree: "33333333-3333-4333-8333-333333333333",
  personOne: "44444444-4444-4444-8444-444444444444",
  personTwo: "55555555-5555-4555-8555-555555555555",
  personThree: "66666666-6666-4666-8666-666666666666",
  booking: "77777777-7777-4777-8777-777777777777",
};
const now = new Date("2026-07-29T12:00:00.000Z");

function testSchemaName() {
  return `booking_relationship_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function waitForDatabaseLock(sql: postgres.Sql, backendPid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const [activity] = await sql.unsafe(`
      SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${backendPid}
    `);
    if (activity?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected the database session to wait on a lock.");
}

describe("DrizzleBookingRelationshipRepository (PostgreSQL)", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let repository: DrizzleBookingRelationshipRepository;

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    sql = postgres(databaseUrl, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await sql.unsafe(`SET search_path TO "${schemaName}", public`);
    const journal = JSON.parse(await readFile(
      path.join(migrationDirectory, "meta", "_journal.json"),
      "utf8",
    )) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      for (const statement of await migrationStatements(`${entry.tag}.sql`, schemaName)) {
        await sql.unsafe(statement);
      }
    }

    const database = drizzle({ client: sql, schema: crmSchema });
    repository = new DrizzleBookingRelationshipRepository(database);
    await database.insert(crmSchema.organizations).values([
      { id: ids.placeOne, name: "A Place" },
      { id: ids.placeTwo, name: "B Place" },
      { id: ids.placeThree, name: "C Place" },
    ]);
    await database.insert(crmSchema.contacts).values([
      { id: ids.personOne, firstName: "Avery", lastName: "One" },
      { id: ids.personTwo, firstName: "Blake", lastName: "Two" },
      { id: ids.personThree, firstName: "Casey", lastName: "Three" },
    ]);
    await database.insert(crmSchema.organizationContacts).values([
      {
        organizationId: ids.placeOne,
        contactId: ids.personOne,
        active: true,
      },
      {
        organizationId: ids.placeTwo,
        contactId: ids.personOne,
        active: true,
      },
      {
        organizationId: ids.placeOne,
        contactId: ids.personTwo,
        active: true,
      },
      {
        organizationId: ids.placeTwo,
        contactId: ids.personThree,
        active: true,
      },
      {
        organizationId: ids.placeOne,
        contactId: ids.personThree,
        active: false,
      },
    ]);
    await database.insert(crmSchema.bookings).values({
      id: ids.booking,
      organizationId: ids.placeOne,
      primaryContactId: null,
      name: "Neverwinter Adventure",
      city: "Denver",
      region: "CO",
    });
    await database.insert(crmSchema.bookingContacts).values([
      {
        bookingId: ids.booking,
        contactId: ids.personOne,
        role: "Event Director",
        isPrimary: true,
      },
      {
        bookingId: ids.booking,
        contactId: ids.personTwo,
        role: "Coordinator",
        isPrimary: false,
      },
    ]);
    await database
      .update(crmSchema.bookings)
      .set({ primaryContactId: ids.personOne })
      .where(eq(crmSchema.bookings.id, ids.booking));
    await sql.unsafe("DELETE FROM audit_entries");
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

  postgresTest("retains the primary Person when changing to a Place with an active relationship", async () => {
    await expect(repository.changePlace({
      bookingId: ids.booking,
      organizationId: ids.placeTwo,
    }, now)).resolves.toEqual({
      kind: "ok",
      value: {
        bookingId: ids.booking,
        organizationId: ids.placeTwo,
        primaryContactId: ids.personOne,
        removedContactIds: [ids.personTwo],
      },
    });
  });

  postgresTest("clears the primary Person when changing to an unrelated Place", async () => {
    const result = await repository.changePlace({
      bookingId: ids.booking,
      organizationId: ids.placeThree,
    }, now);

    expect(result).toMatchObject({
      kind: "ok",
      value: { primaryContactId: null },
    });
    expect(await sql!.unsafe(`
      SELECT organization_id, primary_contact_id
      FROM bookings WHERE id = '${ids.booking}'
    `)).toEqual([{
      organization_id: ids.placeThree,
      primary_contact_id: null,
    }]);
  });

  postgresTest("removes additional Booking People unrelated to the new Place", async () => {
    await repository.changePlace({
      bookingId: ids.booking,
      organizationId: ids.placeTwo,
    }, now);

    expect(await sql!.unsafe(`
      SELECT contact_id, is_primary FROM booking_contacts
      WHERE booking_id = '${ids.booking}' ORDER BY contact_id
    `)).toEqual([{ contact_id: ids.personOne, is_primary: true }]);
  });

  postgresTest("rejects replacement People without active Place relationships", async () => {
    await expect(repository.replacePeople({
      bookingId: ids.booking,
      people: [{
        contactId: ids.personThree,
        role: null,
        isPrimary: true,
      }],
    }, now)).resolves.toEqual({
      kind: "people_outside_place",
      contactIds: [ids.personThree],
    });
    expect(await sql!.unsafe(`
      SELECT contact_id FROM booking_contacts
      WHERE booking_id = '${ids.booking}' ORDER BY contact_id
    `)).toEqual([
      { contact_id: ids.personOne },
      { contact_id: ids.personTwo },
    ]);
  });

  postgresTest("replaces primary and additional People in one transaction", async () => {
    await repository.replacePeople({
      bookingId: ids.booking,
      people: [
        { contactId: ids.personTwo, role: "Lead", isPrimary: true },
        { contactId: ids.personOne, role: null, isPrimary: false },
      ],
    }, now);

    expect(await sql!.unsafe(`
      SELECT contact_id, role, is_primary, source
      FROM booking_contacts WHERE booking_id = '${ids.booking}'
      ORDER BY contact_id
    `)).toEqual([
      {
        contact_id: ids.personOne,
        role: null,
        is_primary: false,
        source: "local",
      },
      {
        contact_id: ids.personTwo,
        role: "Lead",
        is_primary: true,
        source: "local",
      },
    ]);
  });

  postgresTest("keeps bookings.primaryContactId equal to the primary association", async () => {
    await repository.replacePeople({
      bookingId: ids.booking,
      people: [
        { contactId: ids.personTwo, role: null, isPrimary: true },
        { contactId: ids.personOne, role: null, isPrimary: false },
      ],
    }, now);

    expect(await sql!.unsafe(`
      SELECT b.primary_contact_id, bc.contact_id AS primary_association_id
      FROM bookings b
      LEFT JOIN booking_contacts bc
        ON bc.booking_id = b.id AND bc.is_primary
      WHERE b.id = '${ids.booking}'
    `)).toEqual([{
      primary_contact_id: ids.personTwo,
      primary_association_id: ids.personTwo,
    }]);
  });

  postgresTest("writes one Booking relationship audit entry", async () => {
    await repository.replacePeople({
      bookingId: ids.booking,
      people: [
        { contactId: ids.personTwo, role: "Lead", isPrimary: true },
        { contactId: ids.personOne, role: null, isPrimary: false },
      ],
    }, now);

    expect(await sql!.unsafe(`
      SELECT entity_type, entity_id, action, before, after
      FROM audit_entries
    `)).toEqual([{
      entity_type: "booking_contact",
      entity_id: ids.booking,
      action: "people_replaced",
      before: {
        organizationId: ids.placeOne,
        primaryContactId: ids.personOne,
        people: [
          {
            contactId: ids.personOne,
            role: "Event Director",
            isPrimary: true,
          },
          {
            contactId: ids.personTwo,
            role: "Coordinator",
            isPrimary: false,
          },
        ],
      },
      after: {
        organizationId: ids.placeOne,
        primaryContactId: ids.personTwo,
        people: [
          {
            contactId: ids.personOne,
            role: null,
            isPrimary: false,
          },
          {
            contactId: ids.personTwo,
            role: "Lead",
            isPrimary: true,
          },
        ],
      },
    }]);
  });

  postgresTest("rolls back the pointer when association persistence fails", async () => {
    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_booking_contact_insert() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'booking contact insert rejected';
      END;
      $$;
      CREATE TRIGGER reject_booking_contact_insert
      BEFORE INSERT ON booking_contacts
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_booking_contact_insert();
    `);

    await expect(repository.replacePeople({
      bookingId: ids.booking,
      people: [{ contactId: ids.personTwo, role: null, isPrimary: true }],
    }, now)).rejects.toHaveProperty("cause.message", "booking contact insert rejected");
    expect(await sql!.unsafe(`
      SELECT primary_contact_id FROM bookings WHERE id = '${ids.booking}'
    `)).toEqual([{ primary_contact_id: ids.personOne }]);
    expect(await sql!.unsafe(`
      SELECT contact_id, is_primary FROM booking_contacts
      WHERE booking_id = '${ids.booking}' ORDER BY contact_id
    `)).toEqual([
      { contact_id: ids.personOne, is_primary: true },
      { contact_id: ids.personTwo, is_primary: false },
    ]);
    expect(await sql!.unsafe("SELECT id FROM audit_entries")).toEqual([]);
  });

  postgresTest("avoids an Activity versus Booking relationship deadlock", async () => {
    const bookingLockClient = postgres(databaseUrl!, { max: 1 });
    const bookingWriteClient = postgres(databaseUrl!, { max: 1 });
    const activityClient = postgres(databaseUrl!, { max: 1 });
    const observerClient = postgres(databaseUrl!, { max: 1 });
    const bookingLockHeld = deferred();
    const releaseBookingLock = deferred();
    const writes: Promise<unknown>[] = [];
    let bookingLock: Promise<unknown> | undefined;
    try {
      await Promise.all([
        bookingLockClient.unsafe(
          `SET search_path TO "${schemaName}", public`,
        ),
        bookingWriteClient.unsafe(
          `SET search_path TO "${schemaName}", public`,
        ),
        activityClient.unsafe(`SET search_path TO "${schemaName}", public`),
        observerClient.unsafe(`SET search_path TO "${schemaName}", public`),
      ]);
      await bookingWriteClient.unsafe("SET lock_timeout = '5s'");
      await activityClient.unsafe("SET lock_timeout = '5s'");
      const [{ pid: bookingWritePid } = { pid: 0 }] =
        await bookingWriteClient.unsafe<{ pid: number }[]>(
          "SELECT pg_backend_pid() AS pid",
        );
      const [{ pid: activityPid } = { pid: 0 }] =
        await activityClient.unsafe<{ pid: number }[]>(
          "SELECT pg_backend_pid() AS pid",
        );
      if (!bookingWritePid || !activityPid) {
        throw new Error("Could not identify the concurrent database sessions.");
      }

      bookingLock = bookingLockClient.begin(async (transaction) => {
        await transaction.unsafe(`
          SELECT id FROM bookings WHERE id = '${ids.booking}' FOR UPDATE
        `);
        bookingLockHeld.resolve();
        await releaseBookingLock.promise;
      });
      await bookingLockHeld.promise;

      const bookingRepository = new DrizzleBookingRelationshipRepository(
        drizzle({ client: bookingWriteClient, schema: crmSchema }),
      );
      const bookingWrite = bookingRepository.changePlace(
        {
          bookingId: ids.booking,
          organizationId: ids.placeOne,
        },
        new Date("2026-08-01T15:10:00.000Z"),
      );
      writes.push(bookingWrite);
      await waitForDatabaseLock(observerClient, bookingWritePid);

      const activityRepository = new DrizzleActivityRepository(
        drizzle({ client: activityClient, schema: crmSchema }),
      );
      const activityWrite = activityRepository.create({
        organizationId: ids.placeOne,
        contactId: ids.personOne,
        bookingId: ids.booking,
        kind: "note",
        body: "Concurrent Booking relationship check",
        occurredAt: new Date("2026-08-01T15:11:00.000Z"),
      });
      writes.push(activityWrite);
      await waitForDatabaseLock(observerClient, activityPid);

      releaseBookingLock.resolve();
      await bookingLock;
      await expect(
        Promise.all([bookingWrite, activityWrite]),
      ).resolves.toEqual([
        expect.objectContaining({
          kind: "ok",
          value: expect.objectContaining({
            bookingId: ids.booking,
            organizationId: ids.placeOne,
          }),
        }),
        expect.objectContaining({
          organizationId: ids.placeOne,
          contactId: ids.personOne,
          bookingId: ids.booking,
        }),
      ]);
    } finally {
      releaseBookingLock.resolve();
      if (bookingLock) await bookingLock;
      await Promise.allSettled(writes);
      await bookingLockClient.end({ timeout: 5 });
      await bookingWriteClient.end({ timeout: 5 });
      await activityClient.end({ timeout: 5 });
      await observerClient.end({ timeout: 5 });
    }
  });
});
