import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import { DrizzleOrganizationRepository } from "@/features/organizations/organization-repository";
import { OrganizationService } from "@/features/organizations/organization-service";
import * as crmSchema from "@/db/schema";

const databaseUrl = process.env.LAST_RESORT_REPOSITORY_TEST_DATABASE_URL;
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

const ids = {
  marias: "11111111-1111-4111-8111-111111111111",
  north: "22222222-2222-4222-8222-222222222222",
  south: "33333333-3333-4333-8333-333333333333",
  contact: "44444444-4444-4444-8444-444444444444",
  mariasBooking: "55555555-5555-4555-8555-555555555555",
  northBooking: "66666666-6666-4666-8666-666666666666",
  southBooking: "77777777-7777-4777-877777777777",
  northLeg: "88888888-8888-4888-888888888888",
  southLeg: "99999999-9999-4999-899999999999",
  missing: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

function testSchemaName() {
  return `last_resort_repository_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("DrizzleOrganizationRepository (PostgreSQL)", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let repository: DrizzleOrganizationRepository;
  let contactRepository: DrizzleContactRepository;
  let bookingRepository: DrizzleBookingRepository;

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    sql = postgres(databaseUrl, { max: 1 });
    const schema = `"${schemaName}"`;
    await sql.unsafe(`CREATE SCHEMA ${schema}`);
    await sql.unsafe(`SET search_path TO ${schema}, public`);
    const journal = JSON.parse(
      await readFile(path.join(migrationDirectory, "meta", "_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      for (const statement of await migrationStatements(`${entry.tag}.sql`, schemaName)) {
        await sql.unsafe(statement);
      }
    }

    const db = drizzle({ client: sql, schema: crmSchema });
    repository = new DrizzleOrganizationRepository(db);
    contactRepository = new DrizzleContactRepository(db);
    bookingRepository = new DrizzleBookingRepository(db);
    await db.insert(crmSchema.organizations).values([
      { id: ids.marias, name: "Marias Fair" },
      {
        id: ids.north,
        name: "North Fair",
        lastResort: true,
        lastResortReason: "Prior payment dispute.",
      },
      {
        id: ids.south,
        name: "South Fair",
        lastResort: true,
        lastResortReason: "Repeated cancellations.",
      },
    ]);
    await db.insert(crmSchema.travelLegs).values([
      { id: ids.northLeg, name: "North crew", color: "#123456", sortOrder: 1 },
      { id: ids.southLeg, name: "South crew", color: "#654321", sortOrder: 2 },
    ]);
    await db.insert(crmSchema.contacts).values({
      id: ids.contact,
      organizationId: ids.marias,
      firstName: "Avery",
      lastName: "Example",
    });
    await db.insert(crmSchema.bookings).values([
      {
        id: ids.mariasBooking,
        organizationId: ids.marias,
        primaryContactId: ids.contact,
        name: "Marias County Fair",
        city: "Shelby",
        region: "MT",
        travelLegId: ids.northLeg,
      },
      {
        id: ids.northBooking,
        organizationId: ids.north,
        name: "North County Fair",
        city: "Havre",
        region: "MT",
        travelLegId: ids.northLeg,
      },
      {
        id: ids.southBooking,
        organizationId: ids.south,
        name: "South County Fair",
        city: "Billings",
        region: "MT",
        travelLegId: ids.southLeg,
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

  postgresTest("atomically audits enable and clear while contact and booking reads inherit the organization warning", async () => {
    const service = new OrganizationService(repository, {
      now: () => new Date("2026-07-28T15:00:00.000Z"),
    });

    await expect(
      service.setLastResort({
        organizationId: ids.marias,
        enabled: true,
        reason: "  Repeated cancellations. ",
      }),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect((await contactRepository.getContactDetail(ids.contact))?.contact).toMatchObject({
      organizationLastResort: true,
      organizationLastResortReason: "Repeated cancellations.",
    });
    expect((await bookingRepository.getBookingDetail(ids.mariasBooking))?.organization).toMatchObject({
      lastResort: true,
      lastResortReason: "Repeated cancellations.",
    });
    expect(await sql!.unsafe(`SELECT action FROM audit_entries WHERE entity_id = '${ids.marias}'`)).toEqual([
      { action: "last_resort_enabled" },
    ]);

    await service.setLastResort({ organizationId: ids.marias, enabled: false, reason: "" });
    expect(await sql!.unsafe(`SELECT action FROM audit_entries WHERE entity_id = '${ids.marias}' ORDER BY created_at, id`)).toEqual([
      { action: "last_resort_enabled" },
      { action: "last_resort_cleared" },
    ]);
  });

  postgresTest("returns missing without an audit, filters by Last Resort and leg, and returns bounded page results", async () => {
    const service = new OrganizationService(repository);
    await expect(
      service.setLastResort({
        organizationId: ids.missing,
        enabled: true,
        reason: "No account exists.",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "ORGANIZATION_NOT_FOUND" } });
    expect(await sql!.unsafe("SELECT count(*) AS value FROM audit_entries")).toEqual([
      { value: "0" },
    ]);

    const first = await repository.listOrganizations({
      search: "",
      lastResort: "all",
      travelLegId: ids.northLeg,
      page: 1,
      pageSize: 1,
    });
    const second = await repository.listOrganizations({
      search: "",
      lastResort: "all",
      travelLegId: ids.northLeg,
      page: 2,
      pageSize: 1,
    });
    const lastResortOnly = await repository.listOrganizations({
      search: "",
      lastResort: "only",
      travelLegId: ids.northLeg,
      page: 1,
      pageSize: 1,
    });
    const bounded = await repository.listOrganizations({
      search: "",
      lastResort: "all",
      travelLegId: ids.northLeg,
      page: 99,
      pageSize: 1,
    });

    expect(first).toMatchObject({ total: 2, page: 1, pageCount: 2 });
    expect(first.records).toEqual([
      expect.objectContaining({ id: ids.marias, contactCount: 1, bookingCount: 1 }),
    ]);
    expect(second.records.map((record) => record.id)).toEqual([ids.north]);
    expect(lastResortOnly.records.map((record) => record.id)).toEqual([ids.north]);
    expect(bounded).toMatchObject({ page: 2, pageCount: 2 });
    expect(bounded.records.map((record) => record.id)).toEqual([ids.north]);
  });

  postgresTest("rolls back the Last Resort update when the audit insert is rejected", async () => {
    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_last_resort_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'last_resort_enabled' THEN RAISE EXCEPTION 'audit rejected'; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_last_resort_audit
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_last_resort_audit();
    `);

    await expect(
      repository.setLastResort(
        { organizationId: ids.marias, enabled: true, reason: "Repeated cancellations." },
        new Date("2026-07-28T15:00:00.000Z"),
      ),
    ).rejects.toThrow("audit rejected");
    expect(await sql!.unsafe(`SELECT last_resort FROM organizations WHERE id = '${ids.marias}'`)).toEqual([
      { last_resort: false },
    ]);
    expect(await sql!.unsafe(`SELECT count(*) AS value FROM audit_entries WHERE entity_id = '${ids.marias}'`)).toEqual([
      { value: "0" },
    ]);
  });
});
