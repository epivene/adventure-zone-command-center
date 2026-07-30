import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import { DrizzleRelationshipRepository } from "@/features/relationships/relationship-repository";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");
const ids = {
  placeOne: "11111111-1111-4111-8111-111111111111",
  placeTwo: "22222222-2222-4222-8222-222222222222",
  personOne: "33333333-3333-4333-8333-333333333333",
  personTwo: "44444444-4444-4444-8444-444444444444",
};

function testSchemaName() {
  return `relationship_repository_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("DrizzleRelationshipRepository (PostgreSQL)", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let repository: DrizzleRelationshipRepository;

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
    const db = drizzle({ client: sql, schema: crmSchema });
    repository = new DrizzleRelationshipRepository(db);
    await db.insert(crmSchema.organizations).values([
      { id: ids.placeOne, name: "A Place" },
      { id: ids.placeTwo, name: "B Place" },
    ]);
    await db.insert(crmSchema.contacts).values([
      { id: ids.personOne, organizationId: null, firstName: "Avery", lastName: "One" },
      { id: ids.personTwo, organizationId: null, firstName: "Blake", lastName: "Two" },
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

  const now = new Date("2026-07-29T00:00:00.000Z");
  const associate = (organizationId: string, contactId = ids.personOne) =>
    repository.associatePersonWithPlace({ organizationId, contactId, role: null }, now);

  postgresTest("associates one Person with two Places without duplicating the Person", async () => {
    await associate(ids.placeOne);
    await associate(ids.placeTwo);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM contacts")).toEqual([{ value: "2" }]);
    expect((await repository.listPlacesForPerson(ids.personOne)).map(({ organizationId }) => organizationId))
      .toEqual([ids.placeOne, ids.placeTwo]);
  });

  postgresTest("sets a Person primary Place without changing either Place primary Person", async () => {
    await associate(ids.placeOne);
    await associate(ids.placeTwo);
    await repository.setPlacePrimaryPerson({ organizationId: ids.placeOne, contactId: ids.personOne }, now);
    await repository.setPersonPrimaryPlace({ contactId: ids.personOne, organizationId: ids.placeTwo }, now);
    expect(await sql!.unsafe(`SELECT organization_id, is_primary FROM organization_contacts ORDER BY organization_id`)).toEqual([
      { organization_id: ids.placeOne, is_primary: true },
      { organization_id: ids.placeTwo, is_primary: false },
    ]);
    expect(await sql!.unsafe(`SELECT organization_id FROM contacts WHERE id = '${ids.personOne}'`))
      .toEqual([{ organization_id: ids.placeTwo }]);
  });

  postgresTest("sets exactly one primary Person for a Place", async () => {
    await associate(ids.placeOne, ids.personOne);
    await associate(ids.placeOne, ids.personTwo);
    await repository.setPlacePrimaryPerson({ organizationId: ids.placeOne, contactId: ids.personOne }, now);
    await repository.setPlacePrimaryPerson({ organizationId: ids.placeOne, contactId: ids.personTwo }, now);
    expect(await sql!.unsafe(`SELECT contact_id FROM organization_contacts WHERE organization_id = '${ids.placeOne}' AND is_primary`))
      .toEqual([{ contact_id: ids.personTwo }]);
  });

  postgresTest("keeps the old Place relationship active when the Person primary Place changes", async () => {
    await associate(ids.placeOne);
    await associate(ids.placeTwo);
    await repository.setPersonPrimaryPlace({ contactId: ids.personOne, organizationId: ids.placeOne }, now);
    await repository.setPersonPrimaryPlace({ contactId: ids.personOne, organizationId: ids.placeTwo }, now);
    expect(await sql!.unsafe(`SELECT organization_id, active FROM organization_contacts WHERE contact_id = '${ids.personOne}' ORDER BY organization_id`))
      .toEqual([
        { organization_id: ids.placeOne, active: true },
        { organization_id: ids.placeTwo, active: true },
      ]);
  });

  postgresTest("refuses to deactivate the Place primary Person", async () => {
    await associate(ids.placeOne);
    await repository.setPlacePrimaryPerson({ organizationId: ids.placeOne, contactId: ids.personOne }, now);
    await expect(repository.setPlacePersonActive({
      organizationId: ids.placeOne,
      contactId: ids.personOne,
      active: false,
    }, now)).resolves.toEqual({ kind: "primary_relationship_cannot_be_inactive" });
  });

  postgresTest("refuses to deactivate the Person primary Place", async () => {
    await associate(ids.placeOne);
    await repository.setPersonPrimaryPlace({ contactId: ids.personOne, organizationId: ids.placeOne }, now);
    await expect(repository.setPlacePersonActive({
      organizationId: ids.placeOne,
      contactId: ids.personOne,
      active: false,
    }, now)).resolves.toEqual({ kind: "primary_relationship_cannot_be_inactive" });
  });

  postgresTest("writes one audit entry in the relationship transaction", async () => {
    await associate(ids.placeOne);
    expect(await sql!.unsafe("SELECT entity_type, action FROM audit_entries ORDER BY created_at, id"))
      .toEqual([{ entity_type: "organization_contact", action: "create" }]);
  });

  postgresTest("returns stable sorted Place and Person relationship lists", async () => {
    await associate(ids.placeTwo, ids.personTwo);
    await associate(ids.placeOne, ids.personTwo);
    await associate(ids.placeOne, ids.personOne);
    expect((await repository.listPeopleForPlace(ids.placeOne)).map(({ contactId }) => contactId))
      .toEqual([ids.personOne, ids.personTwo]);
    expect((await repository.listPlacesForPerson(ids.personTwo)).map(({ organizationId }) => organizationId))
      .toEqual([ids.placeOne, ids.placeTwo]);
  });
});
