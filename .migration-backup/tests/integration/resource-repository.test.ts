import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  DrizzleResourceRepository,
  type ResourceTransaction,
} from "@/features/resources/resource-repository";
import { ResourceService } from "@/features/resources/resource-service";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

const ids = {
  bookingA: "11111111-1111-4111-8111-111111111111",
  bookingB: "11111111-1111-4111-8111-111111111112",
  resourceA: "22222222-2222-4222-8222-222222222221",
  resourceB: "22222222-2222-4222-8222-222222222222",
  assignmentB: "33333333-3333-4333-8333-333333333333",
};

function testSchemaName() {
  return `resource_repository_${randomUUID().replaceAll("-", "_")}`;
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
  readonly locks: string[] = [];
  orderByCount = 0;

  transaction<T>(operation: (transaction: LockRecordingDatabase) => Promise<T>) {
    return operation(this);
  }

  select() {
    return this;
  }
  from() {
    return this;
  }
  innerJoin() {
    return this;
  }
  where() {
    return this;
  }
  limit() {
    return this;
  }
  orderBy() {
    this.orderByCount += 1;
    return this;
  }
  for(strength: string) {
    this.locks.push(strength);
    return Promise.resolve([]);
  }
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve([]).then(onfulfilled, onrejected);
  }
}

describe("DrizzleResourceRepository locking", () => {
  it("locks the booking, current assignments, and resources in its transaction", async () => {
    const database = new LockRecordingDatabase();
    const repository = new DrizzleResourceRepository(
      database as unknown as ConstructorParameters<typeof DrizzleResourceRepository>[0],
    );
    let received: ResourceTransaction | null = null;

    await repository.transaction(async (transaction) => {
      received = transaction;
      await transaction.findBookingForUpdate(ids.bookingA);
      await transaction.findCurrentAssignmentsForUpdate(ids.bookingA);
      await transaction.findResourcesForUpdate([ids.resourceA]);
    });

    expect(received).not.toBeNull();
    expect(database.locks).toEqual(["update", "update", "update"]);
    expect(database.orderByCount).toBe(1);
  });
});

class ReservationRowsDatabase {
  constructor(private readonly rows: unknown[]) {}

  transaction<T>(
    operation: (transaction: ReservationRowsDatabase) => Promise<T>,
  ) {
    return operation(this);
  }
  select() {
    return this;
  }
  from() {
    return this;
  }
  innerJoin() {
    return this;
  }
  where() {
    return Promise.resolve(this.rows);
  }
}

describe("DrizzleResourceRepository reservation scope", () => {
  it("excludes declined, cancelled, and completed bookings from current conflicts", async () => {
    const assignment = {
      id: ids.assignmentB,
      bookingId: ids.bookingB,
      resourceId: ids.resourceA,
      attributionSource: "inferred",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const resource = {
      id: ids.resourceA,
      code: "paintball_trailer",
      name: "Paintball trailer",
      category: "trailer",
      countsAsAttraction: true,
      movable: true,
      normalTravelLegId: null,
      setupMinutes: 0,
      teardownMinutes: 0,
      minimumTransferMinutes: 60,
      status: "available",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const booking = {
      id: ids.bookingB,
      name: "Current booking",
      status: "confirmed",
      startsAt: new Date("2026-09-01T17:00:00.000Z"),
      endsAt: new Date("2026-09-01T17:00:00.000Z"),
      latitude: 45.75,
      longitude: -108.5,
    };
    const rows = [
      { assignment, booking, resource },
      {
        assignment: { ...assignment, id: "33333333-3333-4333-8333-333333333334" },
        booking: {
          ...booking,
          id: "11111111-1111-4111-8111-111111111113",
          name: "Cancelled future booking",
          status: "cancelled",
        },
        resource,
      },
      {
        assignment: { ...assignment, id: "33333333-3333-4333-8333-333333333335" },
        booking: {
          ...booking,
          id: "11111111-1111-4111-8111-111111111114",
          status: "declined",
        },
        resource,
      },
      {
        assignment: { ...assignment, id: "33333333-3333-4333-8333-333333333336" },
        booking: {
          ...booking,
          id: "11111111-1111-4111-8111-111111111115",
          status: "completed",
        },
        resource,
      },
    ];
    const repository = new DrizzleResourceRepository(
      new ReservationRowsDatabase(rows) as unknown as ConstructorParameters<
        typeof DrizzleResourceRepository
      >[0],
    );

    const reservations = await repository.transaction((transaction) =>
      transaction.listReservationsForResources([ids.resourceA]),
    );

    expect(reservations.map(({ bookingName }) => bookingName)).toEqual([
      "Current booking",
    ]);
  });
});

describe("DrizzleResourceRepository PostgreSQL assignment isolation", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let service: ResourceService;

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
    service = new ResourceService(
      new DrizzleResourceRepository(db),
      { estimateMinutes: async () => ({ minutes: 0, source: "manual" }) },
    );
    await db.insert(crmSchema.bookings).values([
      {
        id: ids.bookingA,
        name: "Booking A",
        city: "Austin",
        region: "TX",
        startsAt: new Date("2026-08-10T10:00:00.000Z"),
        endsAt: new Date("2026-08-10T11:00:00.000Z"),
      },
      {
        id: ids.bookingB,
        name: "Booking B",
        city: "Bozeman",
        region: "MT",
        startsAt: new Date("2026-08-11T10:00:00.000Z"),
        endsAt: new Date("2026-08-11T11:00:00.000Z"),
      },
    ]);
    await db.insert(crmSchema.resources).values([
      {
        id: ids.resourceA,
        code: "resource_a",
        name: "Resource A",
        category: "attraction",
        countsAsAttraction: true,
      },
      {
        id: ids.resourceB,
        code: "resource_b",
        name: "Resource B",
        category: "attraction",
      },
    ]);
    await db.insert(crmSchema.bookingResourceAssignments).values({
      id: ids.assignmentB,
      bookingId: ids.bookingB,
      resourceId: ids.resourceA,
    });
  });

  afterEach(async () => {
    if (!sql) return;
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await sql.end({ timeout: 5 });
    sql = undefined;
  });

  postgresTest("replaces only the target booking and preserves another booking", async () => {
    await expect(service.configureBookingAssignments({
      bookingId: ids.bookingA,
      resourceIds: [ids.resourceA, ids.resourceB],
      actorId: "owner_1",
    })).resolves.toMatchObject({ ok: true });

    expect(await sql!.unsafe(`
      SELECT booking_id, resource_id
      FROM booking_resource_assignments
      ORDER BY booking_id, resource_id
    `)).toEqual([
      { booking_id: ids.bookingA, resource_id: ids.resourceA },
      { booking_id: ids.bookingA, resource_id: ids.resourceB },
      { booking_id: ids.bookingB, resource_id: ids.resourceA },
    ]);
  });

  postgresTest("prevents duplicate resources in input and at the database boundary", async () => {
    await expect(service.configureBookingAssignments({
      bookingId: ids.bookingA,
      resourceIds: [ids.resourceA, ids.resourceA],
      actorId: "owner_1",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_RESOURCE_INPUT" },
    });
    expect(await sql!.unsafe(`
      SELECT count(*) AS value FROM booking_resource_assignments
      WHERE booking_id = '${ids.bookingA}'
    `)).toEqual([{ value: "0" }]);

    await sql!.unsafe(`
      INSERT INTO booking_resource_assignments (booking_id, resource_id)
      VALUES ('${ids.bookingA}', '${ids.resourceA}')
    `);
    await expect(sql!.unsafe(`
      INSERT INTO booking_resource_assignments (booking_id, resource_id)
      VALUES ('${ids.bookingA}', '${ids.resourceA}')
    `)).rejects.toThrow(/booking_resource_assignments_booking_resource_unique/);
  });
});
