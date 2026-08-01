import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import { DrizzleLocalCandidateRepository } from "@/features/act-migration/local-candidate-repository";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");
const ids = {
  placeA: "11111111-1111-4111-8111-111111111111",
  placeZ: "99999999-9999-4999-8999-999999999999",
  personA: "22222222-2222-4222-8222-222222222222",
  personZ: "88888888-8888-4888-8888-888888888888",
  bookingA: "33333333-3333-4333-8333-333333333333",
  bookingZ: "77777777-7777-4777-8777-777777777777",
};

function testSchemaName() {
  return `act_local_candidates_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(
    path.join(migrationDirectory, fileName),
    "utf8",
  );
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("DrizzleLocalCandidateRepository (PostgreSQL)", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let repository: DrizzleLocalCandidateRepository;

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    sql = postgres(databaseUrl, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await sql.unsafe(`SET search_path TO "${schemaName}", public`);
    const journal = JSON.parse(
      await readFile(
        path.join(migrationDirectory, "meta", "_journal.json"),
        "utf8",
      ),
    ) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      for (const statement of await migrationStatements(
        `${entry.tag}.sql`,
        schemaName,
      )) {
        await sql.unsafe(statement);
      }
    }
    const database = drizzle({ client: sql, schema: crmSchema });
    repository = new DrizzleLocalCandidateRepository(database);

    await database.insert(crmSchema.organizations).values([
      {
        id: ids.placeZ,
        name: " Zed   Events ",
        phone: "(303) 555-0199",
        website: "https://www.ZED.example/path",
        city: " DENVER ",
        region: " co ",
      },
      {
        id: ids.placeA,
        name: "Alpha Fair",
        phone: "(303) 555-0100 ext 2",
        website: "invalid host",
        city: "New   York",
        region: "NY",
      },
    ]);
    await database.insert(crmSchema.contacts).values([
      {
        id: ids.personZ,
        organizationId: null,
        firstName: "Zoe",
        lastName: "Zulu",
        email: " INFO+Act@Example.COM ",
        phone: "303-555-0198",
      },
      {
        id: ids.personA,
        organizationId: null,
        firstName: " Avery ",
        lastName: " Alpha ",
        email: "Avery@Example.com",
        phone: "(303) 555-0101 ext 3",
      },
    ]);
    await database.insert(crmSchema.organizationContacts).values([
      {
        organizationId: ids.placeZ,
        contactId: ids.personZ,
        active: false,
        isPrimary: false,
        role: "Legacy",
        source: "act",
      },
      {
        organizationId: ids.placeA,
        contactId: ids.personA,
        active: true,
        isPrimary: false,
        role: null,
        source: "local",
      },
    ]);
    await database.insert(crmSchema.bookings).values([
      {
        id: ids.bookingZ,
        name: "Z Booking",
        city: "Denver",
        region: "CO",
      },
      {
        id: ids.bookingA,
        name: "A Booking",
        city: "Albany",
        region: "NY",
      },
    ]);
    await database.insert(crmSchema.bookingContacts).values([
      {
        bookingId: ids.bookingZ,
        contactId: ids.personZ,
        role: "Coordinator",
        isPrimary: false,
        source: "act",
      },
    ]);
    await database.insert(crmSchema.actExternalLinks).values([
      {
        entityType: "contact",
        sourceEntityType: "contact",
        entityId: ids.personZ,
        actRecordId: "CONTACT-ALIAS",
        isPrimary: false,
        syncMode: "pull_only",
      },
      {
        entityType: "organization",
        sourceEntityType: "company",
        entityId: ids.placeA,
        actRecordId: "COMPANY-A",
        isPrimary: false,
        syncMode: "pull_only",
      },
      {
        entityType: "contact",
        sourceEntityType: "contact",
        entityId: ids.personZ,
        actRecordId: "CONTACT-PRIMARY",
        isPrimary: true,
        syncMode: "two_way",
      },
    ]);
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

  postgresTest(
    "returns one normalized repeatable-read snapshot in deterministic ID order",
    async () => {
      const snapshot = await repository.loadCandidateSnapshot();

      expect(snapshot.places.map(({ id }) => id)).toEqual([
        ids.placeA,
        ids.placeZ,
      ]);
      expect(snapshot.places).toMatchObject([
        {
          normalizedName: "alpha fair",
          normalizedPhone: null,
          normalizedCity: "new york",
          normalizedRegion: "ny",
          normalizedWebsiteHost: null,
        },
        {
          normalizedName: "zed events",
          normalizedPhone: "+13035550199",
          normalizedCity: "denver",
          normalizedRegion: "co",
          normalizedWebsiteHost: "zed.example",
        },
      ]);
      expect(snapshot.people.map(({ id }) => id)).toEqual([
        ids.personA,
        ids.personZ,
      ]);
      expect(snapshot.people).toMatchObject([
        {
          displayName: "Avery Alpha",
          normalizedEmail: "avery@example.com",
          normalizedPhone: null,
          sharedEmail: false,
        },
        {
          displayName: "Zoe Zulu",
          normalizedEmail: "info+act@example.com",
          normalizedPhone: "+13035550198",
          sharedEmail: true,
        },
      ]);
      expect(snapshot.bookings.map(({ id }) => id)).toEqual([
        ids.bookingA,
        ids.bookingZ,
      ]);
      expect(snapshot.placePeople).toEqual([
        {
          organizationId: ids.placeA,
          contactId: ids.personA,
          active: true,
          isPrimary: false,
          role: null,
          source: "local",
        },
        {
          organizationId: ids.placeZ,
          contactId: ids.personZ,
          active: false,
          isPrimary: false,
          role: "Legacy",
          source: "act",
        },
      ]);
      expect(snapshot.bookingPeople).toEqual([
        {
          bookingId: ids.bookingZ,
          contactId: ids.personZ,
          isPrimary: false,
          role: "Coordinator",
          source: "act",
        },
      ]);
      expect(snapshot.externalLinks.map(({ actRecordId }) => actRecordId)).toEqual([
        "COMPANY-A",
        "CONTACT-ALIAS",
        "CONTACT-PRIMARY",
      ]);
      expect(snapshot.externalLinks.slice(1)).toMatchObject([
        { isPrimary: false, syncMode: "pull_only" },
        { isPrimary: true, syncMode: "two_way" },
      ]);
    },
  );
});
