import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  createBookingOperationsSummaryProvider,
} from "@/features/bookings/booking-operations-summary";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");
const ids = {
  booking: "10000000-0000-4000-8000-000000000001",
  otherBooking: "10000000-0000-4000-8000-000000000002",
  activePackage: "20000000-0000-4000-8000-000000000001",
  inactivePackage: "20000000-0000-4000-8000-000000000002",
  hiddenPackage: "20000000-0000-4000-8000-000000000003",
  paintball: "30000000-0000-4000-8000-000000000001",
  archived: "30000000-0000-4000-8000-000000000002",
  hiddenArchived: "30000000-0000-4000-8000-000000000003",
  available: "30000000-0000-4000-8000-000000000004",
  paintballAssignment: "40000000-0000-4000-8000-000000000001",
  archivedAssignment: "40000000-0000-4000-8000-000000000002",
  otherAssignment: "40000000-0000-4000-8000-000000000003",
};

function schemaName() {
  return `booking_operations_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, testSchema: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${testSchema}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("booking operations PostgreSQL read models", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let testSchema = "";
  let db: ReturnType<typeof drizzle<typeof crmSchema>>;

  beforeEach(async () => {
    if (!databaseUrl) return;
    testSchema = schemaName();
    sql = postgres(databaseUrl, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${testSchema}"`);
    await sql.unsafe(`SET search_path TO "${testSchema}", public`);
    const journal = JSON.parse(
      await readFile(path.join(migrationDirectory, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries.filter(({ idx }) => idx <= 7)) {
      for (const statement of await migrationStatements(entry.tag + ".sql", testSchema)) {
        await sql.unsafe(statement);
      }
    }
    db = drizzle({ client: sql, schema: crmSchema });
    await db.insert(crmSchema.bookings).values([
      {
        id: ids.booking,
        name: "Target Fair",
        city: "Shelby",
        region: "MT",
        startsAt: new Date("2026-08-10T17:00:00.000Z"),
        endsAt: new Date("2026-08-10T17:00:00.000Z"),
        latitude: 48.5,
        longitude: -111.9,
        physicalAttractionTotal: 11,
      },
      {
        id: ids.otherBooking,
        name: "Other Fair",
        city: "Missoula",
        region: "MT",
        startsAt: new Date("2026-08-11T17:00:00.000Z"),
        endsAt: new Date("2026-08-11T17:00:00.000Z"),
        latitude: 46.9,
        longitude: -114,
      },
    ]);
    await db.insert(crmSchema.packageTemplates).values([
      {
        id: ids.activePackage,
        code: "test_adventure",
        name: "Adventure Zone",
        baseAttractionCount: 10,
        active: true,
      },
      {
        id: ids.inactivePackage,
        code: "test_historical",
        name: "Historical Package",
        baseAttractionCount: 4,
        active: false,
      },
      {
        id: ids.hiddenPackage,
        code: "test_hidden",
        name: "Hidden Package",
        baseAttractionCount: 3,
        active: false,
      },
    ]);
    await db.insert(crmSchema.bookingPackageSelections).values([
      { bookingId: ids.booking, packageTemplateId: ids.activePackage },
      { bookingId: ids.booking, packageTemplateId: ids.inactivePackage },
    ]);
    await db.insert(crmSchema.resources).values([
      {
        id: ids.paintball,
        code: "paintball_trailer",
        name: "Paintball",
        category: "attraction",
        countsAsAttraction: true,
        movable: true,
        minimumTransferMinutes: 90,
      },
      {
        id: ids.archived,
        code: "test_archived",
        name: "Archived assigned",
        category: "trailer",
        status: "archived",
      },
      {
        id: ids.hiddenArchived,
        code: "test_hidden_archived",
        name: "Archived hidden",
        category: "trailer",
        status: "archived",
      },
      {
        id: ids.available,
        code: "test_available",
        name: "Available resource",
        category: "trailer",
      },
    ]);
    await db.insert(crmSchema.resourcePackageTags).values([
      { resourceId: ids.paintball, packageTemplateId: ids.activePackage },
      { resourceId: ids.paintball, packageTemplateId: ids.inactivePackage },
    ]);
    await db.insert(crmSchema.bookingResourceAssignments).values([
      {
        id: ids.paintballAssignment,
        bookingId: ids.booking,
        resourceId: ids.paintball,
      },
      {
        id: ids.archivedAssignment,
        bookingId: ids.booking,
        resourceId: ids.archived,
        attributionSource: "manual",
      },
      {
        id: ids.otherAssignment,
        bookingId: ids.otherBooking,
        resourceId: ids.paintball,
      },
    ]);
    await db.insert(crmSchema.bookingSpecialRequests).values({
      bookingId: ids.booking,
      description: "Ferris wheel",
      treatment: "add_to_count",
      approvalStatus: "needs_approval",
    });
  });

  afterEach(async () => {
    if (!sql) return;
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
    await sql.end({ timeout: 5 });
    sql = undefined;
  });

  postgresTest("retains historical options, infers new attribution, and projects warnings through one shared algorithm", async () => {
    const provider = createBookingOperationsSummaryProvider(db);
    const resourceSummary = await provider.getResourceSummaryForBooking(ids.booking);
    const model = await new DrizzleBookingRepository(db)
      .getPackageResourceEditorModel(
        ids.booking,
        resourceSummary?.warnings ?? [],
      );
    const operations = await provider.getForBooking(ids.booking);

    expect(model?.packageOptions).toMatchObject([
      { id: ids.activePackage, selected: true, active: true },
      { id: ids.inactivePackage, selected: true, active: false },
    ]);
    expect(model?.packageOptions.some(({ id }) => id === ids.hiddenPackage)).toBe(false);
    expect(model?.resourceOptions.find(({ id }) => id === ids.archived)).toMatchObject({
      assigned: true,
      status: "archived",
      attributionSource: "manual",
      attributedPackageIds: [],
    });
    expect(model?.resourceOptions.some(({ id }) => id === ids.hiddenArchived)).toBe(false);
    expect(model?.resourceOptions.find(({ id }) => id === ids.available)).toMatchObject({
      assigned: false,
      status: "available",
    });
    expect(model?.resourceOptions.find(({ id }) => id === ids.paintball)).toMatchObject({
      attributionSource: "inferred",
      attributedPackageIds: [ids.activePackage, ids.inactivePackage],
    });
    expect(model?.warnings).toEqual(resourceSummary?.warnings);
    expect(operations).toMatchObject({
      packageNames: ["Adventure Zone", "Historical Package"],
      sharedAttractionTotal: 11,
      pendingRequestCount: 1,
      warnings: [
        { kind: "package", severity: "warning" },
        { kind: "resource", severity: "blocking" },
        { kind: "resource", severity: "warning" },
        { kind: "route", severity: "warning" },
      ],
    });
  });
});
