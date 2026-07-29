import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  buildContactSearchCondition,
  contactSyncState,
  DrizzleContactRepository,
  phoneMatch,
} from "@/features/contacts/contact-repository";
import type { ContactListRecord, QuickCallerInput } from "@/features/contacts/contact-types";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

function testSchemaName() {
  return `contact_repository_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const repositoryIds = {
  organization: "11111111-1111-4111-8111-111111111111",
  existingContact: "22222222-2222-4222-8222-222222222222",
};

const quickCaller: QuickCallerInput = {
  requestKey: "99999999-9999-4999-8999-999999999999",
  firstName: "Bailey",
  lastName: "Caller",
  organizationName: "  marias   fair ",
  phone: "406-555-0111",
  email: "bailey@example.com",
  reason: "Asked about an August event.",
  eventDate: "2026-08-14",
  eventLocation: "Shelby, MT",
};

describe("contact repository query contract", () => {
  it("searches contact name, company, email, phone, and location", () => {
    const condition = buildContactSearchCondition("North Dakota");
    expect(condition).not.toBeNull();

    const query = new PgDialect().sqlToQuery(condition!);
    expect(query.sql).toContain("first_name");
    expect(query.sql).toContain("last_name");
    expect(query.sql).toContain("organizations");
    expect(query.sql).toContain("email");
    expect(query.sql).toContain("phone");
    expect(query.sql).toContain("city");
    expect(query.sql).toContain("region");
    expect(query.sql).toContain("postal_code");
    expect(query.params).toEqual(
      Array.from({ length: 7 }, () => "%North Dakota%"),
    );
  });

  it("treats a missing sync row as unlinked", () => {
    expect(contactSyncState(null)).toBe("unlinked");
    expect(contactSyncState("waiting")).toBe("waiting");
  });

  it("returns one, many, or no exact caller matches without fuzzy phone results", () => {
    const contact = {
      id: "contact-1",
      firstName: "Avery",
      lastName: "Example",
      organizationName: "Marias Fair",
      jobTitle: null,
      email: null,
      phone: "406-555-0101",
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
      syncState: "unlinked",
      updatedAt: new Date("2026-07-28T12:00:00Z"),
      lastSyncedAt: null,
    } satisfies ContactListRecord;

    expect(phoneMatch("+14065550101", [contact])).toEqual({ kind: "one", contact });
    expect(phoneMatch("+14065550101", [contact, { ...contact, id: "contact-2" }])).toEqual({
      kind: "many",
      contacts: [contact, { ...contact, id: "contact-2" }],
    });
    expect(phoneMatch("+14065550101", [])).toEqual({
      kind: "none",
      normalizedPhone: "+14065550101",
    });
  });
});

describe("DrizzleContactRepository caller matching and intake", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let repository: DrizzleContactRepository;

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    sql = postgres(databaseUrl, { max: 1 });
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
    const db = drizzle({ client: sql, schema: crmSchema });
    repository = new DrizzleContactRepository(db);
    await db.insert(crmSchema.organizations).values({
      id: repositoryIds.organization,
      name: "Marias Fair",
      actRecordId: "ACT-ORG-1",
    });
    await db.insert(crmSchema.contacts).values({
      id: repositoryIds.existingContact,
      organizationId: repositoryIds.organization,
      firstName: "Avery",
      lastName: "Example",
      phone: "(406) 555-0101",
      normalizedPhone: "+14065550101",
      actRecordId: "ACT-CONTACT-1",
    });
    await db.insert(crmSchema.actContactSyncStates).values({
      contactId: repositoryIds.existingContact,
      state: "synced",
      localDirty: false,
    });
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

  postgresTest("uses normalized exact lookup and creates the complete local caller intake without changing Act metadata", async () => {
    await expect(repository.findContactsByPhone("406.555.0101")).resolves.toMatchObject({
      kind: "one",
      contact: { id: repositoryIds.existingContact },
    });
    await sql!.unsafe(`
      INSERT INTO contacts (id, organization_id, first_name, last_name, phone, normalized_phone)
      VALUES ('33333333-3333-4333-8333-333333333333', '${repositoryIds.organization}', 'Avery', 'Duplicate', '406-555-0101', '+14065550101')
    `);
    await expect(repository.findContactsByPhone("1 406 555 0101")).resolves.toMatchObject({
      kind: "many",
      contacts: [
        { id: "33333333-3333-4333-8333-333333333333" },
        { id: repositoryIds.existingContact },
      ],
    });
    await expect(repository.findContactsByPhone("406-555-0199")).resolves.toEqual({
      kind: "none",
      normalizedPhone: "+14065550199",
    });

    const created = await repository.createQuickCaller(quickCaller);
    expect(created).toMatchObject({ kind: "created" });
    if (created.kind !== "created") throw new Error("Expected a new caller.");
    const contactId = created.contactId;

    expect(await sql!.unsafe("SELECT id, act_record_id FROM organizations ORDER BY id")).toEqual([
      { id: repositoryIds.organization, act_record_id: "ACT-ORG-1" },
    ]);
    expect(await sql!.unsafe(`SELECT organization_id, phone, normalized_phone, act_record_id FROM contacts WHERE id = '${contactId}'`)).toEqual([
      {
        organization_id: repositoryIds.organization,
        phone: "406-555-0111",
        normalized_phone: "+14065550111",
        act_record_id: null,
      },
    ]);
    expect(await sql!.unsafe(`SELECT state, local_dirty FROM act_contact_sync_states WHERE contact_id = '${contactId}'`)).toEqual([
      { state: "waiting", local_dirty: true },
    ]);
    expect(await sql!.unsafe(`SELECT kind, body FROM activities WHERE contact_id = '${contactId}'`)).toEqual([
      {
        kind: "note",
        body: "Reason for calling: Asked about an August event.\nEvent date: 2026-08-14\nEvent location: Shelby, MT",
      },
    ]);
    expect(await sql!.unsafe(`SELECT entity_type, action FROM audit_entries WHERE entity_id = '${contactId}' ORDER BY entity_type`)).toEqual([
      { entity_type: "contact", action: "create" },
    ]);
    expect(await sql!.unsafe("SELECT entity_type, action FROM audit_entries ORDER BY entity_type, action")).toEqual([
      { entity_type: "activity", action: "create" },
      { entity_type: "contact", action: "create" },
    ]);
    expect(await sql!.unsafe(`SELECT act_record_id FROM contacts WHERE id = '${repositoryIds.existingContact}'`)).toEqual([
      { act_record_id: "ACT-CONTACT-1" },
    ]);
  });

  postgresTest("replays one concurrent intake request without duplicate local writes", async () => {
    const secondSql = postgres(databaseUrl!, { max: 1 });
    try {
      await secondSql.unsafe(`SET search_path TO "${schemaName}", public`);
      const secondRepository = new DrizzleContactRepository(
        drizzle({ client: secondSql, schema: crmSchema }),
      );

      const [first, replay] = await Promise.all([
        repository.createQuickCaller(quickCaller),
        secondRepository.createQuickCaller(quickCaller),
      ]);

      expect(first).toMatchObject({ kind: "created" });
      expect(replay).toMatchObject({ kind: "created" });
      if (first.kind !== "created" || replay.kind !== "created") {
        throw new Error("Expected a replayed caller creation.");
      }
      expect(replay.contactId).toBe(first.contactId);
      expect(await sql!.unsafe("SELECT count(*) AS value FROM contacts")).toEqual([
        { value: "2" },
      ]);
      expect(await sql!.unsafe("SELECT count(*) AS value FROM activities")).toEqual([
        { value: "1" },
      ]);
      expect(await sql!.unsafe("SELECT count(*) AS value FROM audit_entries")).toEqual([
        { value: "2" },
      ]);
    } finally {
      await secondSql.end({ timeout: 5 });
    }
  });

  postgresTest("serializes normalized organization resolution and audits one creation", async () => {
    const secondSql = postgres(databaseUrl!, { max: 1 });
    try {
      await secondSql.unsafe(`SET search_path TO "${schemaName}", public`);
      const secondRepository = new DrizzleContactRepository(
        drizzle({ client: secondSql, schema: crmSchema }),
      );
      const firstInput = {
        ...quickCaller,
        requestKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        organizationName: "  County   Fair ",
        phone: "406-555-0121",
      };
      const secondInput = {
        ...quickCaller,
        requestKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        organizationName: "county fair",
        phone: "406-555-0122",
      };

      const [first, second] = await Promise.all([
        repository.createQuickCaller(firstInput),
        secondRepository.createQuickCaller(secondInput),
      ]);
      expect(first).toMatchObject({ kind: "created" });
      expect(second).toMatchObject({ kind: "created" });

      expect(await sql!.unsafe(`
        SELECT count(*) AS value
        FROM organizations
        WHERE lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = 'county fair'
      `)).toEqual([{ value: "1" }]);
      expect(await sql!.unsafe(`
        SELECT count(DISTINCT organization_id) AS organizations, count(*) AS contacts
        FROM contacts
        WHERE phone IN ('406-555-0121', '406-555-0122')
      `)).toEqual([{ organizations: "1", contacts: "2" }]);
      expect(await sql!.unsafe(`
        SELECT count(*) AS value
        FROM audit_entries
        WHERE entity_type = 'organization' AND action = 'create'
      `)).toEqual([{ value: "1" }]);
    } finally {
      await secondSql.end({ timeout: 5 });
    }
  });

  postgresTest("rolls caller, activity, and audits back together when an activity or audit write is rejected", async () => {
    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_caller_note() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'note rejected'; END; $$;
      CREATE TRIGGER reject_caller_note BEFORE INSERT ON activities
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_caller_note();
    `);
    await expect(repository.createQuickCaller(quickCaller)).rejects.toThrow("note rejected");
    expect(await sql!.unsafe("SELECT count(*) AS value FROM contacts")).toEqual([{ value: "1" }]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM audit_entries")).toEqual([{ value: "0" }]);
    await sql!.unsafe("DROP TRIGGER reject_caller_note ON activities");

    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_caller_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.entity_type = 'activity' THEN RAISE EXCEPTION 'activity audit rejected'; END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER reject_caller_audit BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_caller_audit();
    `);
    await expect(repository.createQuickCaller(quickCaller)).rejects.toThrow("activity audit rejected");
    expect(await sql!.unsafe("SELECT count(*) AS value FROM contacts")).toEqual([{ value: "1" }]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM activities")).toEqual([{ value: "0" }]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM audit_entries")).toEqual([{ value: "0" }]);
  });
});
