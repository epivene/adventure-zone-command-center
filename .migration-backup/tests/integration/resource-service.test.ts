import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import type {
  AuditEntry,
  BookingResourceState,
  ResourceAssignmentRecord,
  ResourceConflictOverride,
  ResourceRecord,
  ResourceRepository,
  ResourceTransaction,
} from "@/features/resources/resource-repository";
import { DrizzleResourceRepository } from "@/features/resources/resource-repository";
import {
  ResourceService,
  type ResourceError,
} from "@/features/resources/resource-service";
import type { Result } from "@/lib/result";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

const ids = {
  booking: "11111111-1111-4111-8111-111111111111",
  foreignBooking: "11111111-1111-4111-8111-111111111112",
  unrelatedBooking: "11111111-1111-4111-8111-111111111113",
  paintball: "22222222-2222-4222-8222-222222222221",
  unavailable: "22222222-2222-4222-8222-222222222222",
  unknown: "22222222-2222-4222-8222-222222222223",
  assignment: "33333333-3333-4333-8333-333333333331",
  foreignAssignment: "33333333-3333-4333-8333-333333333332",
};

const postgresIds = {
  booking: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  foreignBooking: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  cancelledBooking: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  resource: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  assignment: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  foreignAssignment: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
  cancelledAssignment: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
};

function testSchemaName() {
  return `resource_service_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

type MutableState = {
  bookings: Map<string, BookingResourceState>;
  resources: Map<string, ResourceRecord>;
  assignments: Map<string, ResourceAssignmentRecord>;
  overrides: ResourceConflictOverride[];
  audits: AuditEntry[];
};

function cloneState(state: MutableState): MutableState {
  return structuredClone(state);
}

class InMemoryResourceRepository implements ResourceRepository {
  state: MutableState;
  failAudit = false;
  transactionCount = 0;
  resourceLockRequests: string[][] = [];
  private nextAssignment = 10;

  constructor() {
    this.state = {
      bookings: new Map([
        [ids.booking, {
          id: ids.booking,
          name: "Booking",
          startsAt: new Date("2026-08-10T17:00:00.000Z"),
          endsAt: new Date("2026-08-10T17:00:00.000Z"),
          latitude: 45.75,
          longitude: -108.5,
          physicalAttractionTotal: 1,
        }],
        [ids.foreignBooking, {
          id: ids.foreignBooking,
          name: "Foreign booking",
          startsAt: new Date("2026-08-11T17:00:00.000Z"),
          endsAt: new Date("2026-08-11T17:00:00.000Z"),
          latitude: 46.87,
          longitude: -113.99,
          physicalAttractionTotal: 1,
        }],
        [ids.unrelatedBooking, {
          id: ids.unrelatedBooking,
          name: "Unrelated booking",
          startsAt: new Date("2026-08-20T17:00:00.000Z"),
          endsAt: new Date("2026-08-20T17:00:00.000Z"),
          latitude: 44.97,
          longitude: -93.26,
          physicalAttractionTotal: 0,
        }],
      ]),
      resources: new Map([
        [ids.paintball, {
          id: ids.paintball,
          code: "paintball_trailer",
          name: "Paintball trailer",
          category: "trailer",
          countsAsAttraction: true,
          movable: true,
          setupMinutes: 0,
          teardownMinutes: 0,
          minimumTransferMinutes: 60,
          status: "available",
        }],
        [ids.unavailable, {
          id: ids.unavailable,
          code: "repair",
          name: "Repair resource",
          category: "equipment",
          countsAsAttraction: false,
          movable: false,
          setupMinutes: 0,
          teardownMinutes: 0,
          minimumTransferMinutes: 0,
          status: "maintenance",
        }],
      ]),
      assignments: new Map([
        [ids.assignment, {
          id: ids.assignment,
          bookingId: ids.booking,
          resourceId: ids.paintball,
          attributionSource: "manual",
        }],
        [ids.foreignAssignment, {
          id: ids.foreignAssignment,
          bookingId: ids.foreignBooking,
          resourceId: ids.paintball,
          attributionSource: "inferred",
        }],
      ]),
      overrides: [],
      audits: [],
    };
  }

  async transaction<T>(
    operation: (transaction: ResourceTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    const working = cloneState(this.state);
    const transaction: ResourceTransaction = {
      findBookingForUpdate: async (bookingId) =>
        working.bookings.get(bookingId) ?? null,
      findCurrentAssignmentsForUpdate: async (bookingId) =>
        [...working.assignments.values()].filter(
          (assignment) => assignment.bookingId === bookingId,
        ),
      findResourcesForUpdate: async (resourceIds) => {
        this.resourceLockRequests.push([...resourceIds]);
        return resourceIds.flatMap((resourceId) => {
          const resource = working.resources.get(resourceId);
          return resource ? [resource] : [];
        });
      },
      replaceBookingAssignments: async (bookingId, resourceIds) => {
        for (const [assignmentId, assignment] of working.assignments) {
          if (
            assignment.bookingId === bookingId &&
            !resourceIds.includes(assignment.resourceId)
          ) {
            working.assignments.delete(assignmentId);
          }
        }
        for (const resourceId of resourceIds) {
          const existing = [...working.assignments.values()].find(
            (assignment) =>
              assignment.bookingId === bookingId &&
              assignment.resourceId === resourceId,
          );
          if (!existing) {
            const id = `33333333-3333-4333-8333-${String(
              this.nextAssignment++,
            ).padStart(12, "0")}`;
            working.assignments.set(id, {
              id,
              bookingId,
              resourceId,
              attributionSource: "inferred",
            });
          }
        }
        return [...working.assignments.values()].filter(
          (assignment) => assignment.bookingId === bookingId,
        );
      },
      listReservationsForResources: async (resourceIds) =>
        [...working.assignments.values()]
          .filter((assignment) => resourceIds.includes(assignment.resourceId))
          .map((assignment) => {
            const booking = working.bookings.get(assignment.bookingId)!;
            const resource = working.resources.get(assignment.resourceId)!;
            return {
              assignmentId: assignment.id,
              bookingId: booking.id,
              bookingName: booking.name,
              resourceId: resource.id,
              resourceCode: resource.code,
              resourceName: resource.name,
              resourceStatus: resource.status,
              countsAsAttraction: resource.countsAsAttraction,
              movable: resource.movable,
              setupMinutes: resource.setupMinutes,
              teardownMinutes: resource.teardownMinutes,
              minimumTransferMinutes: resource.minimumTransferMinutes,
              startsAt: booking.startsAt,
              endsAt: booking.endsAt,
              location:
                booking.latitude === null || booking.longitude === null
                  ? null
                  : {
                      latitude: booking.latitude,
                      longitude: booking.longitude,
                    },
            };
          }),
      listOverrides: async (bookingId, conflictKeys) =>
        working.overrides.filter(
          (override) =>
            override.bookingId === bookingId &&
            conflictKeys.includes(override.conflictKey),
        ),
      createOverride: async (input, now) => {
        const override = {
          id: randomUUID(),
          ...input,
          createdAt: now,
        };
        working.overrides.push(override);
        return override;
      },
      createAuditEntry: async (entry) => {
        if (this.failAudit) throw new Error("audit failed");
        working.audits.push(entry);
      },
    };
    const result = await operation(transaction);
    this.state = working;
    return result;
  }
}

async function expectError(
  result: Promise<Result<unknown, ResourceError>>,
  code: ResourceError["code"],
) {
  await expect(result).resolves.toMatchObject({ ok: false, error: { code } });
}

describe("ResourceService", () => {
  it("validates canonical UUIDs and rejects duplicate or unknown resources before writes", async () => {
    const repository = new InMemoryResourceRepository();
    const service = new ResourceService(repository, {
      estimateMinutes: async () => ({ minutes: 60, source: "cached" }),
    });

    await expectError(service.configureBookingAssignments({
      bookingId: "not-a-uuid",
      resourceIds: [],
      actorId: "owner",
    }), "INVALID_RESOURCE_INPUT");
    await expectError(service.configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.paintball, ids.paintball],
      actorId: "owner",
    }), "INVALID_RESOURCE_INPUT");
    await expectError(service.configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.unknown],
      actorId: "owner",
    }), "RESOURCE_NOT_FOUND");
    expect(repository.state.assignments.get(ids.assignment)).toMatchObject({
      attributionSource: "manual",
    });
    expect(repository.state.audits).toEqual([]);
  });

  it("allows an unavailable assignment but returns a visible overridable warning", async () => {
    const repository = new InMemoryResourceRepository();
    repository.state.bookings.get(ids.booking)!.physicalAttractionTotal = 0;
    const result = await new ResourceService(repository, {
      estimateMinutes: async () => ({ minutes: 60, source: "cached" }),
    }).configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.unavailable],
      actorId: "owner",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        warnings: [{ code: "RESOURCE_UNAVAILABLE", overridden: false }],
      },
    });
  });

  it("requests multi-resource locks in deterministic resource ID order", async () => {
    const repository = new InMemoryResourceRepository();
    await new ResourceService(repository, {
      estimateMinutes: async () => ({ minutes: 60, source: "cached" }),
    }).configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.unavailable, ids.paintball],
      actorId: "owner",
    });

    expect(repository.resourceLockRequests[0]).toEqual([
      ids.paintball,
      ids.unavailable,
    ]);
  });

  it("requests acknowledgment resource locks in deterministic ID order", async () => {
    const repository = new InMemoryResourceRepository();
    const paintballAssignment = repository.state.assignments.get(ids.assignment)!;
    repository.state.assignments.delete(ids.assignment);
    repository.state.assignments.set(
      "33333333-3333-4333-8333-333333333339",
      {
        id: "33333333-3333-4333-8333-333333333339",
        bookingId: ids.booking,
        resourceId: ids.unavailable,
        attributionSource: "inferred",
      },
    );
    repository.state.assignments.set(ids.assignment, paintballAssignment);

    await new ResourceService(repository, {
      estimateMinutes: async () => ({ minutes: 60, source: "cached" }),
    }).acknowledgeConflict({
      bookingId: ids.booking,
      conflictKey: "stale-conflict-key",
      reason: "Testing lock order",
      actorId: "owner",
    });

    expect(repository.resourceLockRequests[0]).toEqual([
      ids.paintball,
      ids.unavailable,
    ]);
  });

  it("atomically replaces assignments, recomputes warnings, counts a physical resource once, and writes one actor audit", async () => {
    const repository = new InMemoryResourceRepository();
    const result = await new ResourceService(repository, {
      estimateMinutes: async () => ({ minutes: 60, source: "cached" }),
    }).configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.paintball],
      actorId: " owner_1 ",
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        bookingId: ids.booking,
        assignedAttractionCount: 1,
        warnings: [{ code: "PAINTBALL_TRANSFER_TIME", overridden: false }],
      },
    });
    expect(repository.state.assignments.get(ids.assignment)).toMatchObject({
      resourceId: ids.paintball,
      attributionSource: "manual",
    });
    expect(repository.state.audits).toHaveLength(1);
    expect(repository.state.audits[0]).toMatchObject({
      action: "configure_resources",
      after: { actorId: "owner_1" },
    });
  });

  it("rolls back assignment replacement when the audit write fails", async () => {
    const repository = new InMemoryResourceRepository();
    repository.failAudit = true;

    await expect(new ResourceService(repository, {
      estimateMinutes: async () => ({ minutes: 60, source: "cached" }),
    }).configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.paintball],
      actorId: "owner_1",
    })).rejects.toThrow("audit failed");

    expect(repository.state.assignments.get(ids.assignment)).toMatchObject({
      resourceId: ids.paintball,
      attributionSource: "manual",
    });
    expect(repository.state.audits).toEqual([]);
  });

  it("requires a reason, rejects a foreign/stale conflict key, and audits a visible override atomically", async () => {
    const repository = new InMemoryResourceRepository();
    const service = new ResourceService(repository, {
      estimateMinutes: async () => ({ minutes: 60, source: "cached" }),
    });
    const configured = await service.configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.paintball],
      actorId: "owner_1",
    });
    if (!configured.ok) throw new Error("configuration setup failed");
    const conflictKey = configured.value.warnings[0]?.conflictKey;
    if (!conflictKey) throw new Error("conflict setup failed");

    await expectError(service.acknowledgeConflict({
      bookingId: ids.booking,
      conflictKey,
      reason: " ",
      actorId: "owner_1",
    }), "INVALID_RESOURCE_INPUT");
    await expectError(service.acknowledgeConflict({
      bookingId: ids.unrelatedBooking,
      conflictKey,
      reason: "Dispatcher approved transfer",
      actorId: "owner_1",
    }), "CONFLICT_NOT_FOUND");
    await expect(service.acknowledgeConflict({
      bookingId: ids.booking,
      conflictKey,
      reason: "Dispatcher approved transfer",
      actorId: "owner_1",
    })).resolves.toEqual({ ok: true, value: undefined });

    const refreshed = await service.configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.paintball],
      actorId: "owner_1",
    });
    expect(refreshed).toMatchObject({
      ok: true,
      value: {
        warnings: [{
          conflictKey,
          overridden: true,
          override: {
            reason: "Dispatcher approved transfer",
            acknowledgedBy: "owner_1",
          },
        }],
      },
    });
    expect(repository.state.audits).toHaveLength(3);
    expect(repository.state.audits[1]).toMatchObject({
      action: "acknowledge_resource_conflict",
      after: {
        conflictKey,
        reason: "Dispatcher approved transfer",
        actorId: "owner_1",
      },
    });
  });

  it("keeps a changed fingerprint active instead of applying an old override", async () => {
    const repository = new InMemoryResourceRepository();
    const service = new ResourceService(repository, {
      estimateMinutes: async () => ({ minutes: 60, source: "cached" }),
    });
    const configured = await service.configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.paintball],
      actorId: "owner_1",
    });
    if (!configured.ok) throw new Error("configuration setup failed");
    const oldKey = configured.value.warnings[0]!.conflictKey;
    await service.acknowledgeConflict({
      bookingId: ids.booking,
      conflictKey: oldKey,
      reason: "Old timing approved",
      actorId: "owner_1",
    });

    repository.state.bookings.get(ids.foreignBooking)!.latitude = 47.5;
    const refreshed = await service.configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.paintball],
      actorId: "owner_1",
    });

    expect(refreshed).toMatchObject({
      ok: true,
      value: { warnings: [{ overridden: false, override: null }] },
    });
    if (!refreshed.ok) throw new Error("refresh failed");
    expect(refreshed.value.warnings[0]!.conflictKey).not.toBe(oldKey);
  });

  it("keeps an unavailable-resource override stable when another booking adds the resource", async () => {
    const repository = new InMemoryResourceRepository();
    repository.state.bookings.get(ids.booking)!.physicalAttractionTotal = 0;
    const service = new ResourceService(repository, {
      estimateMinutes: async () => ({ minutes: 60, source: "cached" }),
    });
    const configured = await service.configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.unavailable],
      actorId: "owner_1",
    });
    if (!configured.ok) throw new Error("configuration setup failed");
    const unavailableWarning = configured.value.warnings.find(
      ({ code }) => code === "RESOURCE_UNAVAILABLE",
    );
    if (!unavailableWarning) throw new Error("unavailable warning missing");

    const acknowledged = await service.acknowledgeConflict({
      bookingId: ids.booking,
      conflictKey: unavailableWarning.conflictKey,
      reason: "Maintenance assignment approved",
      actorId: "owner_1",
    });
    if (!acknowledged.ok) throw new Error("override setup failed");

    repository.state.assignments.get(ids.foreignAssignment)!.resourceId =
      ids.unavailable;
    const refreshed = await service.configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.unavailable],
      actorId: "owner_1",
    });

    expect(refreshed).toMatchObject({
      ok: true,
      value: {
        warnings: [{
          code: "RESOURCE_UNAVAILABLE",
          conflictKey: unavailableWarning.conflictKey,
          overridden: true,
          override: {
            reason: "Maintenance assignment approved",
          },
        }],
      },
    });
  });

  it("keeps the target count fingerprint independent of another booking's assignment", async () => {
    const repository = new InMemoryResourceRepository();
    repository.state.bookings.get(ids.booking)!.physicalAttractionTotal = 2;
    const service = new ResourceService(repository, {
      estimateMinutes: async () => ({ minutes: 60, source: "cached" }),
    });
    const withForeign = await service.configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.paintball],
      actorId: "owner_1",
    });
    if (!withForeign.ok) throw new Error("configuration setup failed");
    const originalCountKey = withForeign.value.warnings.find(
      ({ code }) => code === "ATTRACTION_TOTAL_MISMATCH",
    )!.conflictKey;

    repository.state.assignments.delete(ids.foreignAssignment);
    const withoutForeign = await service.configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.paintball],
      actorId: "owner_1",
    });
    if (!withoutForeign.ok) throw new Error("refresh failed");

    expect(withoutForeign.value.warnings.find(
      ({ code }) => code === "ATTRACTION_TOTAL_MISMATCH",
    )!.conflictKey).toBe(originalCountKey);
  });

  it("rolls back an override when its audit write fails", async () => {
    const repository = new InMemoryResourceRepository();
    const service = new ResourceService(repository, {
      estimateMinutes: async () => ({ minutes: 60, source: "cached" }),
    });
    const configured = await service.configureBookingAssignments({
      bookingId: ids.booking,
      resourceIds: [ids.paintball],
      actorId: "owner_1",
    });
    if (!configured.ok) throw new Error("configuration setup failed");
    repository.failAudit = true;

    await expect(service.acknowledgeConflict({
      bookingId: ids.booking,
      conflictKey: configured.value.warnings[0]!.conflictKey,
      reason: "This must roll back",
      actorId: "owner_1",
    })).rejects.toThrow("audit failed");

    expect(repository.state.overrides).toEqual([]);
  });
});

describe("ResourceService PostgreSQL transactions", () => {
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
      { estimateMinutes: async () => ({ minutes: 60, source: "cached" }) },
      { now: () => new Date("2026-08-12T12:00:00.000Z") },
    );
    await db.insert(crmSchema.bookings).values([
      {
        id: postgresIds.booking,
        name: "Target booking",
        city: "Billings",
        region: "MT",
        latitude: 45.75,
        longitude: -108.5,
        startsAt: new Date("2026-08-10T17:00:00.000Z"),
        endsAt: new Date("2026-08-10T17:00:00.000Z"),
        physicalAttractionTotal: 1,
      },
      {
        id: postgresIds.foreignBooking,
        name: "Other booking",
        city: "Missoula",
        region: "MT",
        latitude: 46.87,
        longitude: -113.99,
        startsAt: new Date("2026-08-11T17:00:00.000Z"),
        endsAt: new Date("2026-08-11T17:00:00.000Z"),
        physicalAttractionTotal: 1,
      },
      {
        id: postgresIds.cancelledBooking,
        name: "Cancelled future booking",
        city: "Helena",
        region: "MT",
        latitude: 46.59,
        longitude: -112.04,
        startsAt: new Date("2026-08-10T17:00:00.000Z"),
        endsAt: new Date("2026-08-10T17:00:00.000Z"),
        status: "cancelled",
        physicalAttractionTotal: 1,
      },
    ]);
    await db.insert(crmSchema.resources).values({
      id: postgresIds.resource,
      code: "paintball_trailer",
      name: "Paintball trailer",
      category: "trailer",
      countsAsAttraction: true,
      movable: true,
      minimumTransferMinutes: 60,
    });
    await db.insert(crmSchema.bookingResourceAssignments).values([
      {
        id: postgresIds.foreignAssignment,
        bookingId: postgresIds.foreignBooking,
        resourceId: postgresIds.resource,
      },
      {
        id: postgresIds.cancelledAssignment,
        bookingId: postgresIds.cancelledBooking,
        resourceId: postgresIds.resource,
      },
    ]);
  });

  afterEach(async () => {
    if (!sql) return;
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await sql.end({ timeout: 5 });
    sql = undefined;
  });

  postgresTest("rolls back assignments when an audit trigger rejects configuration", async () => {
    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_resource_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'configure_resources' THEN
          RAISE EXCEPTION 'resource audit rejected';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_resource_audit
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_resource_audit();
    `);

    await expect(service.configureBookingAssignments({
      bookingId: postgresIds.booking,
      resourceIds: [postgresIds.resource],
      actorId: "owner_pg",
    })).rejects.toHaveProperty("cause.message", "resource audit rejected");
    expect(await sql!.unsafe(`
      SELECT count(*) AS value FROM booking_resource_assignments
      WHERE booking_id = '${postgresIds.booking}'
    `)).toEqual([{ value: "0" }]);
  });

  postgresTest("persists and audits an override while a changed fingerprint remains active", async () => {
    const configured = await service.configureBookingAssignments({
      bookingId: postgresIds.booking,
      resourceIds: [postgresIds.resource],
      actorId: "owner_pg",
    });
    if (!configured.ok) throw new Error("configuration setup failed");
    expect(configured.value.warnings).toMatchObject([
      { code: "PAINTBALL_TRANSFER_TIME", overridden: false },
    ]);
    const oldKey = configured.value.warnings[0]!.conflictKey;
    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_override_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'acknowledge_resource_conflict' THEN
          RAISE EXCEPTION 'override audit rejected';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_override_audit
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_override_audit();
    `);
    await expect(service.acknowledgeConflict({
      bookingId: postgresIds.booking,
      conflictKey: oldKey,
      reason: "This override must roll back",
      actorId: "owner_pg",
    })).rejects.toHaveProperty("cause.message", "override audit rejected");
    expect(await sql!.unsafe(`
      SELECT count(*) AS value FROM resource_conflict_overrides
      WHERE booking_id = '${postgresIds.booking}'
    `)).toEqual([{ value: "0" }]);
    await sql!.unsafe("DROP TRIGGER reject_override_audit ON audit_entries");

    await expect(service.acknowledgeConflict({
      bookingId: postgresIds.booking,
      conflictKey: oldKey,
      reason: "Approved route plan",
      actorId: "owner_pg",
    })).resolves.toEqual({ ok: true, value: undefined });

    expect(await sql!.unsafe(`
      SELECT conflict_key, reason, acknowledged_by
      FROM resource_conflict_overrides
      WHERE booking_id = '${postgresIds.booking}'
    `)).toEqual([{
      conflict_key: oldKey,
      reason: "Approved route plan",
      acknowledged_by: "owner_pg",
    }]);
    expect(await sql!.unsafe(`
      SELECT action FROM audit_entries
      WHERE entity_id = '${postgresIds.booking}'
      ORDER BY created_at
    `)).toEqual([
      { action: "configure_resources" },
      { action: "acknowledge_resource_conflict" },
    ]);

    await sql!.unsafe(`
      UPDATE bookings SET latitude = 47.5
      WHERE id = '${postgresIds.foreignBooking}'
    `);
    const changed = await service.configureBookingAssignments({
      bookingId: postgresIds.booking,
      resourceIds: [postgresIds.resource],
      actorId: "owner_pg",
    });
    expect(changed).toMatchObject({
      ok: true,
      value: { warnings: [{ overridden: false, override: null }] },
    });
    if (!changed.ok) throw new Error("changed setup failed");
    expect(changed.value.warnings[0]!.conflictKey).not.toBe(oldKey);
  });
});
