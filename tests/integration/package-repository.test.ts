import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  DrizzlePackageRepository,
  type PackageTransaction,
} from "@/features/packages/package-repository";
import { PackageService } from "@/features/packages/package-service";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

const ids = {
  booking: "11111111-1111-4111-8111-111111111111",
  request: "22222222-2222-4222-8222-222222222222",
};

const databaseIds = {
  bookingA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  bookingB: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  adventure: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  warriors: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  resourceA: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  resourceB: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
  assignmentA1: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
  assignmentA2: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
  assignmentB: "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
};

function testSchemaName() {
  return `package_repository_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

class LockRecordingDatabase {
  readonly locks: Array<{ query: string; strength: string }> = [];
  private query = "";
  private table: unknown;
  private selection: Record<string, unknown> | undefined;

  transaction<T>(operation: (transaction: LockRecordingDatabase) => Promise<T>) {
    return operation(this);
  }

  select(selection?: Record<string, unknown>) {
    this.query = "";
    this.selection = selection;
    return this;
  }

  from(table: { [Symbol.toStringTag]?: string }) {
    this.table = table;
    this.query = String(table);
    return this;
  }

  leftJoin() {
    return this;
  }

  where() {
    return this;
  }

  limit() {
    return this;
  }

  orderBy() {
    return this;
  }

  for(strength: string) {
    this.locks.push({ query: this.query, strength });
    if (
      this.table === crmSchema.bookingResourceAssignments &&
      strength === "update"
    ) {
      return Promise.resolve([{
        id: databaseIds.assignmentA1,
        bookingId: databaseIds.bookingA,
        resourceId: databaseIds.resourceA,
        attributionSource: "inferred",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      }]);
    }
    return Promise.resolve([]);
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    let rows: unknown[] = [];
    if (this.table === crmSchema.bookingPackageSelections) {
      rows = [{ packageTemplateId: databaseIds.warriors }];
    } else if (
      this.table === crmSchema.bookingResourceAssignments &&
      this.selection?.assignmentId
    ) {
      rows = [
        {
          assignmentId: databaseIds.assignmentA1,
          packageTemplateId: databaseIds.adventure,
        },
        {
          assignmentId: databaseIds.assignmentA1,
          packageTemplateId: databaseIds.warriors,
        },
      ];
    }
    return Promise.resolve(rows).then(onfulfilled, onrejected);
  }
}

describe("DrizzlePackageRepository locking", () => {
  it("runs package work in the supplied database transaction", async () => {
    const database = new LockRecordingDatabase();
    const repository = new DrizzlePackageRepository(
      database as unknown as ConstructorParameters<typeof DrizzlePackageRepository>[0],
    );
    let received: PackageTransaction | null = null;

    await repository.transaction(async (transaction) => {
      received = transaction;
    });

    expect(received).not.toBeNull();
  });

  it("locks the booking before configuration and only locks pending requests", async () => {
    const database = new LockRecordingDatabase();
    const repository = new DrizzlePackageRepository(
      database as unknown as ConstructorParameters<typeof DrizzlePackageRepository>[0],
    );

    await repository.transaction(async (transaction) => {
      await transaction.findBookingForUpdate(ids.booking);
      await transaction.findSpecialRequestForUpdate(ids.request);
    });

    expect(database.locks.map(({ strength }) => strength)).toEqual([
      "update",
      "update",
    ]);
  });

  it("locks assigned resources and derives inferred attribution from current tags and selections", async () => {
    const database = new LockRecordingDatabase();
    const repository = new DrizzlePackageRepository(
      database as unknown as ConstructorParameters<typeof DrizzlePackageRepository>[0],
    );

    const assignments = await repository.transaction((transaction) =>
      transaction.findBookingAssignmentsForUpdate(databaseIds.bookingA)
    );

    expect(database.locks.map(({ strength }) => strength)).toEqual([
      "update",
      "share",
    ]);
    expect(assignments).toMatchObject([{
      id: databaseIds.assignmentA1,
      attributionSource: "inferred",
      resourcePackageIds: [databaseIds.adventure, databaseIds.warriors],
      attributedPackageIds: [databaseIds.warriors],
    }]);
  });
});

describe("DrizzlePackageRepository PostgreSQL transactions", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let service: PackageService;
  let schemaName = "";

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    sql = postgres(databaseUrl, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await sql.unsafe(`SET search_path TO "${schemaName}", public`);
    const journal = JSON.parse(
      await readFile(path.join(migrationDirectory, "meta", "_journal.json"), "utf8"),
    ) as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries.filter(({ idx }) => idx <= 7)) {
      for (const statement of await migrationStatements(
        `${entry.tag}.sql`,
        schemaName,
      )) {
        await sql.unsafe(statement);
      }
    }
    const db = drizzle({ client: sql, schema: crmSchema });
    service = new PackageService(new DrizzlePackageRepository(db));
    await db.insert(crmSchema.bookings).values([
      { id: databaseIds.bookingA, name: "Booking A", city: "Austin", region: "TX" },
      { id: databaseIds.bookingB, name: "Booking B", city: "Bozeman", region: "MT" },
    ]);
    await db.insert(crmSchema.packageTemplates).values([
      {
        id: databaseIds.adventure,
        code: "test_adventure",
        name: "Adventure Zone",
        baseAttractionCount: 10,
      },
      {
        id: databaseIds.warriors,
        code: "test_warriors",
        name: "Weekend Warriors",
        baseAttractionCount: 5,
      },
    ]);
    await db.insert(crmSchema.resources).values([
      {
        id: databaseIds.resourceA,
        code: "test_resource_a",
        name: "Resource A",
        category: "attraction",
      },
      {
        id: databaseIds.resourceB,
        code: "test_resource_b",
        name: "Resource B",
        category: "attraction",
      },
    ]);
    await db.insert(crmSchema.resourcePackageTags).values([
      {
        resourceId: databaseIds.resourceA,
        packageTemplateId: databaseIds.adventure,
      },
      {
        resourceId: databaseIds.resourceA,
        packageTemplateId: databaseIds.warriors,
      },
      {
        resourceId: databaseIds.resourceB,
        packageTemplateId: databaseIds.adventure,
      },
    ]);
    await db.insert(crmSchema.bookingResourceAssignments).values([
      {
        id: databaseIds.assignmentA1,
        bookingId: databaseIds.bookingA,
        resourceId: databaseIds.resourceA,
      },
      {
        id: databaseIds.assignmentA2,
        bookingId: databaseIds.bookingA,
        resourceId: databaseIds.resourceB,
      },
      {
        id: databaseIds.assignmentB,
        bookingId: databaseIds.bookingB,
        resourceId: databaseIds.resourceA,
      },
    ]);
    await db.insert(crmSchema.bookingPackageSelections).values([
      {
        bookingId: databaseIds.bookingA,
        packageTemplateId: databaseIds.warriors,
      },
      {
        bookingId: databaseIds.bookingB,
        packageTemplateId: databaseIds.adventure,
      },
    ]);
    await db.insert(crmSchema.bookingResourcePackageAttributions).values([
      {
        bookingResourceAssignmentId: databaseIds.assignmentA1,
        packageTemplateId: databaseIds.warriors,
      },
      {
        bookingResourceAssignmentId: databaseIds.assignmentB,
        packageTemplateId: databaseIds.adventure,
      },
    ]);
  });

  afterEach(async () => {
    if (!sql) return;
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await sql.end({ timeout: 5 });
    sql = undefined;
  });

  postgresTest(
    "replaces one booking's selections and all attributions without touching another booking",
    async () => {
      await expect(service.configureBooking({
        bookingId: databaseIds.bookingA,
        packageTemplateIds: [databaseIds.adventure, databaseIds.warriors],
        physicalAttractionTotal: 11,
        attractionTotalApprovalReason: null,
        manualAttributions: [{
          bookingResourceAssignmentId: databaseIds.assignmentA2,
          packageTemplateIds: [],
        }],
      })).resolves.toMatchObject({ ok: true });

      expect(await sql!.unsafe(`
        SELECT booking_id, package_template_id
        FROM booking_package_selections
        ORDER BY booking_id, package_template_id
      `)).toEqual([
        {
          booking_id: databaseIds.bookingA,
          package_template_id: databaseIds.adventure,
        },
        {
          booking_id: databaseIds.bookingA,
          package_template_id: databaseIds.warriors,
        },
        {
          booking_id: databaseIds.bookingB,
          package_template_id: databaseIds.adventure,
        },
      ]);
      expect(await sql!.unsafe(`
        SELECT a.booking_id, a.id AS assignment_id, a.attribution_source,
               p.package_template_id
        FROM booking_resource_assignments a
        LEFT JOIN booking_resource_package_attributions p
          ON p.booking_resource_assignment_id = a.id
        ORDER BY a.id, p.package_template_id
      `)).toEqual([
        {
          booking_id: databaseIds.bookingA,
          assignment_id: databaseIds.assignmentA1,
          attribution_source: "inferred",
          package_template_id: null,
        },
        {
          booking_id: databaseIds.bookingA,
          assignment_id: databaseIds.assignmentA2,
          attribution_source: "manual",
          package_template_id: null,
        },
        {
          booking_id: databaseIds.bookingB,
          assignment_id: databaseIds.assignmentB,
          attribution_source: "inferred",
          package_template_id: databaseIds.adventure,
        },
      ]);
    },
  );

  postgresTest("rejects foreign assignments and unselected packages without writes", async () => {
    const before = await sql!.unsafe(`
      SELECT
        (SELECT count(*) FROM booking_package_selections) AS selections,
        (SELECT count(*) FROM booking_resource_package_attributions) AS attributions,
        (SELECT count(*) FROM audit_entries) AS audits
    `);
    await expect(service.configureBooking({
      bookingId: databaseIds.bookingA,
      packageTemplateIds: [databaseIds.adventure],
      physicalAttractionTotal: 10,
      attractionTotalApprovalReason: null,
      manualAttributions: [{
        bookingResourceAssignmentId: databaseIds.assignmentB,
        packageTemplateIds: null,
      }],
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "ASSIGNMENT_NOT_OWNED_BY_BOOKING" },
    });
    await expect(service.configureBooking({
      bookingId: databaseIds.bookingA,
      packageTemplateIds: [databaseIds.adventure],
      physicalAttractionTotal: 10,
      attractionTotalApprovalReason: null,
      manualAttributions: [{
        bookingResourceAssignmentId: databaseIds.assignmentA1,
        packageTemplateIds: [databaseIds.warriors],
      }],
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "ATTRIBUTION_PACKAGE_NOT_SELECTED" },
    });
    expect(await sql!.unsafe(`
      SELECT
        (SELECT count(*) FROM booking_package_selections) AS selections,
        (SELECT count(*) FROM booking_resource_package_attributions) AS attributions,
        (SELECT count(*) FROM audit_entries) AS audits
    `)).toEqual(before);
  });
});
