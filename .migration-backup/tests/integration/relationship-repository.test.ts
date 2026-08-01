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
  throw new Error("Expected the concurrent relationship write to wait on a lock.");
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

  postgresTest("writes one complete audit entry for every successful relationship mutation", async () => {
    async function expectOneAudit<T>(action: string, mutation: () => Promise<T>) {
      const before = await sql!.unsafe(`
        SELECT id, entity_type, entity_id, action, before, after FROM audit_entries
      `);
      const result = await mutation();
      const after = await sql!.unsafe(`
        SELECT id, entity_type, entity_id, action, before, after FROM audit_entries
      `);
      const added = after.filter(({ id }) => !before.some((entry) => entry.id === id));
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({ entity_type: "organization_contact", action });
      return { entry: added[0], result };
    }

    const created = await expectOneAudit("create", () => repository.associatePersonWithPlace({
      organizationId: ids.placeOne,
      contactId: ids.personOne,
      role: "Event Director",
    }, now));
    expect(created.entry).toMatchObject({
      before: null,
      after: {
        id: (created.result as { kind: "ok"; relationship: { id: string } }).relationship.id,
        organizationId: ids.placeOne,
        contactId: ids.personOne,
        role: "Event Director",
        isPrimary: false,
        active: true,
        source: "local",
      },
    });

    const updated = await expectOneAudit("update", () => repository.associatePersonWithPlace({
      organizationId: ids.placeOne,
      contactId: ids.personOne,
      role: "Coordinator",
    }, now));
    expect(updated.entry).toMatchObject({
      before: expect.objectContaining({ role: "Event Director" }),
      after: expect.objectContaining({ role: "Coordinator" }),
    });

    const primaryPlace = await expectOneAudit("primary_place_changed", () =>
      repository.setPersonPrimaryPlace({ contactId: ids.personOne, organizationId: ids.placeOne }, now));
    expect(primaryPlace.entry).toMatchObject({
      before: { organizationId: null },
      after: { organizationId: ids.placeOne },
    });

    const clearedPrimaryPlace = await expectOneAudit("primary_place_changed", () =>
      repository.setPersonPrimaryPlace({ contactId: ids.personOne, organizationId: null }, now));
    expect(clearedPrimaryPlace.entry).toMatchObject({
      before: { organizationId: ids.placeOne },
      after: { organizationId: null },
    });

    const primaryPerson = await expectOneAudit("primary_person_changed", () =>
      repository.setPlacePrimaryPerson({ organizationId: ids.placeOne, contactId: ids.personOne }, now));
    expect(primaryPerson.entry).toMatchObject({
      before: { contactId: null },
      after: { contactId: ids.personOne },
    });

    await associate(ids.placeTwo, ids.personTwo);
    const deactivated = await expectOneAudit("update", () => repository.setPlacePersonActive({
      organizationId: ids.placeTwo,
      contactId: ids.personTwo,
      active: false,
    }, now));
    expect(deactivated.entry).toMatchObject({
      before: expect.objectContaining({ active: true }),
      after: expect.objectContaining({ active: false }),
    });
  });

  postgresTest("rolls back a relationship mutation when its audit entry is rejected", async () => {
    await associate(ids.placeOne, ids.personTwo);
    const beforeAudits = await sql!.unsafe("SELECT id FROM audit_entries");
    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_relationship_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'update' THEN RAISE EXCEPTION 'relationship audit rejected'; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_relationship_audit
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_relationship_audit();
    `);

    await expect(repository.setPlacePersonActive({
      organizationId: ids.placeOne,
      contactId: ids.personTwo,
      active: false,
    }, now)).rejects.toHaveProperty("cause.message", "relationship audit rejected");
    expect(await sql!.unsafe(`
      SELECT active FROM organization_contacts
      WHERE organization_id = '${ids.placeOne}' AND contact_id = '${ids.personTwo}'
    `)).toEqual([{ active: true }]);
    expect(await sql!.unsafe("SELECT id FROM audit_entries")).toEqual(beforeAudits);
  });

  postgresTest("orders concurrent non-null relationship writes Place then Person then relationship", async () => {
    const primaryClient = postgres(databaseUrl!, { max: 1 });
    const associateClient = postgres(databaseUrl!, { max: 1 });
    const observerClient = postgres(databaseUrl!, { max: 1 });
    const releasePerson = deferred();
    const personLocked = deferred();
    const writes: Promise<unknown>[] = [];
    let personLock: Promise<unknown> | undefined;
    try {
      await primaryClient.unsafe(`SET search_path TO "${schemaName}", public`);
      await associateClient.unsafe(`SET search_path TO "${schemaName}", public`);
      await primaryClient.unsafe("SET lock_timeout = '5s'");
      await associateClient.unsafe("SET lock_timeout = '5s'");
      const primaryPidRows = await primaryClient.unsafe<{ pid: number }[]>(
        "SELECT pg_backend_pid() AS pid",
      );
      const associatePidRows = await associateClient.unsafe<{ pid: number }[]>(
        "SELECT pg_backend_pid() AS pid",
      );
      const primaryPid = primaryPidRows[0]?.pid;
      const associatePid = associatePidRows[0]?.pid;
      if (!primaryPid || !associatePid) throw new Error("Could not identify concurrent database sessions.");
      personLock = sql!.begin(async (transaction) => {
        await transaction.unsafe(`
          SELECT id FROM contacts WHERE id = '${ids.personOne}' FOR UPDATE
        `);
        personLocked.resolve();
        await releasePerson.promise;
      });
      await personLocked.promise;

      const primaryRepository = new DrizzleRelationshipRepository(
        drizzle({ client: primaryClient, schema: crmSchema }),
      );
      const associateRepository = new DrizzleRelationshipRepository(
        drizzle({ client: associateClient, schema: crmSchema }),
      );
      const primaryWrite = primaryRepository.setPersonPrimaryPlace({
        contactId: ids.personOne,
        organizationId: ids.placeOne,
      }, now);
      writes.push(primaryWrite);
      await waitForDatabaseLock(observerClient, primaryPid);
      const associationWrite = associateRepository.associatePersonWithPlace({
        organizationId: ids.placeOne,
        contactId: ids.personOne,
        role: null,
      }, now);
      writes.push(associationWrite);
      await waitForDatabaseLock(observerClient, associatePid);

      releasePerson.resolve();
      await personLock;
      await expect(Promise.all([primaryWrite, associationWrite])).resolves.toEqual([
        expect.objectContaining({ kind: "ok" }),
        expect.objectContaining({ kind: "ok" }),
      ]);
    } finally {
      releasePerson.resolve();
      if (personLock) await personLock;
      await Promise.allSettled(writes);
      await primaryClient.end({ timeout: 5 });
      await associateClient.end({ timeout: 5 });
      await observerClient.end({ timeout: 5 });
    }
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
