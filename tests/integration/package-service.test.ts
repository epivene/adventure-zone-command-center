import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  PackageService,
  type AddSpecialRequestInput,
  type BookingSpecialRequest,
  type ConfigureBookingPackagesInput,
  type DecideSpecialRequestInput,
  type PackageConfigurationError,
} from "@/features/packages/package-service";
import type {
  AuditEntry,
  BookingPackageState,
  BookingResourceAssignmentPackageState,
  PackageRepository,
  PackageTransaction,
} from "@/features/packages/package-repository";
import { DrizzlePackageRepository } from "@/features/packages/package-repository";
import type { PackageTemplateSummary } from "@/features/packages/package-types";
import type { Result } from "@/lib/result";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

const ids = {
  booking: "11111111-1111-4111-8111-111111111111",
  foreignBooking: "11111111-1111-4111-8111-111111111112",
  adventure: "22222222-2222-4222-8222-222222222222",
  warriors: "33333333-3333-4333-8333-333333333333",
  inactive: "44444444-4444-4444-8444-444444444444",
  unknown: "55555555-5555-4555-8555-555555555555",
  assignmentOne: "66666666-6666-4666-8666-666666666666",
  assignmentTwo: "77777777-7777-4777-8777-777777777777",
  foreignAssignment: "88888888-8888-4888-8888-888888888888",
};

const postgresIds = {
  booking: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  adventure: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  warriors: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  resource: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  assignment: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};

function testSchemaName() {
  return `package_service_${randomUUID().replaceAll("-", "_")}`;
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
  bookings: Map<string, BookingPackageState>;
  templates: Map<string, PackageTemplateSummary & { active: boolean }>;
  assignments: Map<string, BookingResourceAssignmentPackageState>;
  requests: Map<string, BookingSpecialRequest>;
  audits: AuditEntry[];
};

function cloneState(state: MutableState): MutableState {
  return structuredClone(state);
}

class InMemoryPackageRepository implements PackageRepository {
  state: MutableState;
  failAudit = false;
  transactionCount = 0;
  private nextRequest = 1;

  constructor() {
    this.state = {
      bookings: new Map([
        [ids.booking, {
          id: ids.booking,
          physicalAttractionTotal: null,
          attractionTotalApprovalReason: null,
          packageTemplateIds: [],
        }],
        [ids.foreignBooking, {
          id: ids.foreignBooking,
          physicalAttractionTotal: null,
          attractionTotalApprovalReason: null,
          packageTemplateIds: [],
        }],
      ]),
      templates: new Map([
        [ids.adventure, {
          id: ids.adventure,
          code: "adventure_zone",
          name: "Adventure Zone",
          baseAttractionCount: 10,
          active: true,
        }],
        [ids.warriors, {
          id: ids.warriors,
          code: "weekend_warriors",
          name: "Weekend Warriors",
          baseAttractionCount: 5,
          active: true,
        }],
        [ids.inactive, {
          id: ids.inactive,
          code: "retired",
          name: "Retired package",
          baseAttractionCount: 4,
          active: false,
        }],
      ]),
      assignments: new Map([
        [ids.assignmentOne, {
          id: ids.assignmentOne,
          bookingId: ids.booking,
          attributionSource: "inferred",
          resourcePackageIds: [ids.adventure, ids.warriors],
          attributedPackageIds: [],
        }],
        [ids.assignmentTwo, {
          id: ids.assignmentTwo,
          bookingId: ids.booking,
          attributionSource: "inferred",
          resourcePackageIds: [ids.adventure],
          attributedPackageIds: [],
        }],
        [ids.foreignAssignment, {
          id: ids.foreignAssignment,
          bookingId: ids.foreignBooking,
          attributionSource: "inferred",
          resourcePackageIds: [ids.warriors],
          attributedPackageIds: [],
        }],
      ]),
      requests: new Map(),
      audits: [],
    };
  }

  async transaction<T>(
    operation: (transaction: PackageTransaction) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    const working = cloneState(this.state);
    const transaction: PackageTransaction = {
      findBookingForUpdate: async (bookingId) =>
        working.bookings.get(bookingId) ?? null,
      findPackageTemplatesForShare: async (templateIds) =>
        templateIds.flatMap((id) => {
          const template = working.templates.get(id);
          return template ? [template] : [];
        }),
      findBookingAssignmentsForUpdate: async (bookingId) =>
        [...working.assignments.values()].filter(
          (assignment) => assignment.bookingId === bookingId,
        ),
      replacePackageSelections: async (bookingId, packageTemplateIds) => {
        const booking = working.bookings.get(bookingId);
        if (!booking) throw new Error("booking disappeared");
        booking.packageTemplateIds = [...packageTemplateIds];
      },
      replacePackageAttributions: async (bookingId, attributions) => {
        const bookingAssignmentIds = new Set(
          [...working.assignments.values()]
            .filter((assignment) => assignment.bookingId === bookingId)
            .map((assignment) => assignment.id),
        );
        if (attributions.some((item) => !bookingAssignmentIds.has(item.assignmentId))) {
          throw new Error("foreign attribution");
        }
        for (const item of attributions) {
          const assignment = working.assignments.get(item.assignmentId)!;
          assignment.attributionSource = item.source;
          assignment.attributedPackageIds = [...item.packageTemplateIds];
        }
      },
      updateBookingAttractionTotal: async (
        bookingId,
        physicalAttractionTotal,
        attractionTotalApprovalReason,
      ) => {
        const booking = working.bookings.get(bookingId);
        if (!booking) throw new Error("booking disappeared");
        booking.physicalAttractionTotal = physicalAttractionTotal;
        booking.attractionTotalApprovalReason = attractionTotalApprovalReason;
      },
      countApprovedAddToCountRequests: async (bookingId) =>
        [...working.requests.values()].filter(
          (request) =>
            request.bookingId === bookingId &&
            request.treatment === "add_to_count" &&
            request.approvalStatus === "approved",
        ).length,
      createSpecialRequest: async (input, now) => {
        const request: BookingSpecialRequest = {
          id: `99999999-9999-4999-8999-${String(this.nextRequest++).padStart(12, "0")}`,
          bookingId: input.bookingId,
          description: input.description,
          treatment: input.treatment,
          approvalStatus: "needs_approval",
          decisionReason: null,
          decidedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        working.requests.set(request.id, request);
        return request;
      },
      findSpecialRequestForUpdate: async (requestId) => {
        const request = working.requests.get(requestId);
        return request?.approvalStatus === "needs_approval" ? request : null;
      },
      updateSpecialRequestDecision: async (requestId, decision, reason, now) => {
        const request = working.requests.get(requestId);
        if (!request || request.approvalStatus !== "needs_approval") return null;
        const decided = {
          ...request,
          approvalStatus: decision,
          decisionReason: reason,
          decidedAt: now,
          updatedAt: now,
        };
        working.requests.set(requestId, decided);
        return decided;
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

function configuration(
  overrides: Partial<ConfigureBookingPackagesInput> = {},
): ConfigureBookingPackagesInput {
  return {
    bookingId: ids.booking,
    packageTemplateIds: [ids.adventure, ids.warriors],
    physicalAttractionTotal: 11,
    attractionTotalApprovalReason: null,
    manualAttributions: [
      {
        bookingResourceAssignmentId: ids.assignmentOne,
        packageTemplateIds: null,
      },
      {
        bookingResourceAssignmentId: ids.assignmentTwo,
        packageTemplateIds: [],
      },
    ],
    ...overrides,
  };
}

async function expectError(
  result: Promise<Result<unknown, PackageConfigurationError>>,
  code: PackageConfigurationError["code"],
) {
  await expect(result).resolves.toMatchObject({ ok: false, error: { code } });
}

describe("PackageService", () => {
  it("atomically replaces two packages, total, and inferred/manual attribution with one audit", async () => {
    const repository = new InMemoryPackageRepository();
    const result = await new PackageService(repository).configureBooking(
      configuration(),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        bookingId: ids.booking,
        physicalAttractionTotal: 11,
        attractionTotalApprovalReason: null,
        suggestedPhysicalAttractionTotal: 10,
        packages: [{ id: ids.adventure }, { id: ids.warriors }],
      },
    });
    expect(repository.state.bookings.get(ids.booking)).toMatchObject({
      packageTemplateIds: [ids.adventure, ids.warriors],
      physicalAttractionTotal: 11,
      attractionTotalApprovalReason: null,
    });
    expect(repository.state.assignments.get(ids.assignmentOne)).toMatchObject({
      attributionSource: "inferred",
      attributedPackageIds: [ids.adventure, ids.warriors],
    });
    expect(repository.state.assignments.get(ids.assignmentTwo)).toMatchObject({
      attributionSource: "manual",
      attributedPackageIds: [],
    });
    expect(repository.state.audits).toHaveLength(1);
    expect(repository.state.audits[0]).toMatchObject({
      entityType: "booking",
      entityId: ids.booking,
      action: "configure_packages",
      after: {
        packageTemplateIds: [ids.adventure, ids.warriors],
        physicalAttractionTotal: 11,
      },
    });
  });

  it("preserves a legacy no-package booking with a null total", async () => {
    const repository = new InMemoryPackageRepository();
    const result = await new PackageService(repository).configureBooking(
      configuration({
        packageTemplateIds: [],
        physicalAttractionTotal: null,
        manualAttributions: [],
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        packages: [],
        physicalAttractionTotal: null,
        suggestedPhysicalAttractionTotal: null,
      },
    });
  });

  it.each([
    ["INVALID_PACKAGE_INPUT", configuration({
      packageTemplateIds: [ids.adventure, ids.adventure],
    })],
    ["PACKAGE_TEMPLATE_NOT_FOUND", configuration({
      packageTemplateIds: [ids.adventure, ids.unknown],
    })],
    ["PACKAGE_TEMPLATE_INACTIVE", configuration({
      packageTemplateIds: [ids.inactive],
      physicalAttractionTotal: 4,
    })],
    ["ASSIGNMENT_NOT_OWNED_BY_BOOKING", configuration({
      manualAttributions: [{
        bookingResourceAssignmentId: ids.foreignAssignment,
        packageTemplateIds: null,
      }],
    })],
    ["ATTRIBUTION_PACKAGE_NOT_SELECTED", configuration({
      packageTemplateIds: [ids.adventure],
      physicalAttractionTotal: 10,
      manualAttributions: [{
        bookingResourceAssignmentId: ids.assignmentOne,
        packageTemplateIds: [ids.warriors],
      }],
    })],
    ["APPROVAL_REASON_REQUIRED", configuration({
      physicalAttractionTotal: 13,
    })],
  ] as const)("rejects invalid configuration with %s before writes", async (code, input) => {
    const repository = new InMemoryPackageRepository();

    await expectError(new PackageService(repository).configureBooking(input), code);

    expect(repository.state.bookings.get(ids.booking)?.packageTemplateIds).toEqual([]);
    expect(repository.state.audits).toEqual([]);
  });

  it("preserves an already selected inactive package but rejects adding a new inactive package", async () => {
    const repository = new InMemoryPackageRepository();
    repository.state.bookings.get(ids.booking)!.packageTemplateIds = [
      ids.inactive,
    ];
    const service = new PackageService(repository);

    await expect(service.configureBooking(configuration({
      packageTemplateIds: [ids.inactive],
      physicalAttractionTotal: 4,
      manualAttributions: [],
    }))).resolves.toMatchObject({
      ok: true,
      value: { packages: [{ id: ids.inactive }] },
    });

    repository.state.bookings.get(ids.booking)!.packageTemplateIds = [];
    await expect(service.configureBooking(configuration({
      packageTemplateIds: [ids.inactive],
      physicalAttractionTotal: 4,
      manualAttributions: [],
    }))).resolves.toEqual({
      ok: false,
      error: { code: "PACKAGE_TEMPLATE_INACTIVE" },
    });
  });

  it("rolls back package, attribution, and total writes when audit insertion fails", async () => {
    const repository = new InMemoryPackageRepository();
    repository.failAudit = true;

    await expect(
      new PackageService(repository).configureBooking(configuration()),
    ).rejects.toThrow("audit failed");

    expect(repository.state.bookings.get(ids.booking)).toMatchObject({
      packageTemplateIds: [],
      physicalAttractionTotal: null,
    });
    expect(repository.state.assignments.get(ids.assignmentOne)).toMatchObject({
      attributionSource: "inferred",
      attributedPackageIds: [],
    });
    expect(repository.state.audits).toEqual([]);
  });

  it.each(["add_to_count", "replace_included", "note_only"] as const)(
    "adds a pending %s request with null decision fields and one audit",
    async (treatment) => {
      const repository = new InMemoryPackageRepository();
      const result = await new PackageService(repository, {
        now: () => new Date("2026-08-01T12:00:00.000Z"),
      }).addSpecialRequest({
        bookingId: ids.booking,
        description: "Specific attraction",
        treatment,
      });

      expect(result).toMatchObject({
        ok: true,
        value: {
          treatment,
          approvalStatus: "needs_approval",
          decisionReason: null,
          decidedAt: null,
        },
      });
      expect(repository.state.audits).toHaveLength(1);
    },
  );

  it.each(["approved", "declined"] as const)(
    "records a one-time %s decision and audits it",
    async (decision) => {
      const repository = new InMemoryPackageRepository();
      const service = new PackageService(repository, {
        now: () => new Date("2026-08-02T12:00:00.000Z"),
      });
      const added = await service.addSpecialRequest({
        bookingId: ids.booking,
        description: "Specific attraction",
        treatment: "add_to_count",
      });
      if (!added.ok) throw new Error("request setup failed");

      const result = await service.decideSpecialRequest({
        specialRequestId: added.value.id,
        decision,
        reason: "Owner reviewed",
      });

      expect(result).toMatchObject({
        ok: true,
        value: {
          approvalStatus: decision,
          decisionReason: "Owner reviewed",
          decidedAt: new Date("2026-08-02T12:00:00.000Z"),
        },
      });
      await expectError(service.decideSpecialRequest({
        specialRequestId: added.value.id,
        decision: decision === "approved" ? "declined" : "approved",
        reason: "Try again",
      }), "SPECIAL_REQUEST_NOT_PENDING");
      expect(repository.state.audits).toHaveLength(2);
    },
  );

  it("approval increases only the displayed suggestion and never rewrites the saved total", async () => {
    const repository = new InMemoryPackageRepository();
    const service = new PackageService(repository);
    await service.configureBooking(configuration());
    const added = await service.addSpecialRequest({
      bookingId: ids.booking,
      description: "Specific attraction",
      treatment: "add_to_count",
    });
    if (!added.ok) throw new Error("request setup failed");
    await service.decideSpecialRequest({
      specialRequestId: added.value.id,
      decision: "approved",
      reason: "Approved",
    });

    const result = await service.configureBooking(configuration());

    expect(result).toMatchObject({
      ok: true,
      value: {
        physicalAttractionTotal: 11,
        suggestedPhysicalAttractionTotal: 11,
      },
    });
    expect(repository.state.bookings.get(ids.booking)?.physicalAttractionTotal).toBe(11);
  });

  it.each([
    {
      name: "single-package",
      packageTemplateIds: [ids.adventure],
      physicalAttractionTotal: 11,
    },
    {
      name: "multi-package",
      packageTemplateIds: [ids.adventure, ids.warriors],
      physicalAttractionTotal: 13,
    },
  ])(
    "validates an approved add-to-count suggestion against the base $name range",
    async ({ packageTemplateIds, physicalAttractionTotal }) => {
      const repository = new InMemoryPackageRepository();
      const service = new PackageService(repository);
      const added = await service.addSpecialRequest({
        bookingId: ids.booking,
        description: "Approved extra attraction",
        treatment: "add_to_count",
      });
      if (!added.ok) throw new Error("request setup failed");
      await service.decideSpecialRequest({
        specialRequestId: added.value.id,
        decision: "approved",
        reason: "Owner approved",
      });

      await expectError(service.configureBooking(configuration({
        packageTemplateIds,
        physicalAttractionTotal,
        attractionTotalApprovalReason: null,
      })), "APPROVAL_REASON_REQUIRED");

      await expect(service.configureBooking(configuration({
        packageTemplateIds,
        physicalAttractionTotal,
        attractionTotalApprovalReason: "Outside the base package range",
      }))).resolves.toMatchObject({
        ok: true,
        value: {
          physicalAttractionTotal,
          suggestedPhysicalAttractionTotal: 11,
        },
      });
    },
  );

  it("rolls back special-request creation and decisions on audit failure", async () => {
    const repository = new InMemoryPackageRepository();
    const service = new PackageService(repository);
    repository.failAudit = true;
    await expect(service.addSpecialRequest({
      bookingId: ids.booking,
      description: "Specific attraction",
      treatment: "note_only",
    })).rejects.toThrow("audit failed");
    expect(repository.state.requests.size).toBe(0);

    repository.failAudit = false;
    const added = await service.addSpecialRequest({
      bookingId: ids.booking,
      description: "Specific attraction",
      treatment: "note_only",
    });
    if (!added.ok) throw new Error("request setup failed");
    repository.failAudit = true;
    await expect(service.decideSpecialRequest({
      specialRequestId: added.value.id,
      decision: "declined",
      reason: "Not available",
    })).rejects.toThrow("audit failed");
    expect(repository.state.requests.get(added.value.id)?.approvalStatus)
      .toBe("needs_approval");
  });

  it("validates malformed service inputs before opening a transaction", async () => {
    const repository = new InMemoryPackageRepository();

    await expectError(new PackageService(repository).addSpecialRequest({
      bookingId: "bad",
      description: "",
      treatment: "note_only",
    } as AddSpecialRequestInput), "INVALID_PACKAGE_INPUT");
    await expectError(new PackageService(repository).decideSpecialRequest({
      specialRequestId: "bad",
      decision: "approved",
      reason: "",
    } as DecideSpecialRequestInput), "INVALID_PACKAGE_INPUT");

    expect(repository.transactionCount).toBe(0);
  });
});

describe("PackageService PostgreSQL transactions", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let service: PackageService;

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
    service = new PackageService(new DrizzlePackageRepository(db), {
      now: () => new Date("2026-08-03T12:00:00.000Z"),
    });
    await db.insert(crmSchema.bookings).values({
      id: postgresIds.booking,
      name: "Transactional booking",
      city: "Austin",
      region: "TX",
      physicalAttractionTotal: 5,
    });
    await db.insert(crmSchema.packageTemplates).values([
      {
        id: postgresIds.adventure,
        code: "service_adventure",
        name: "Adventure Zone",
        baseAttractionCount: 10,
      },
      {
        id: postgresIds.warriors,
        code: "service_warriors",
        name: "Weekend Warriors",
        baseAttractionCount: 5,
      },
    ]);
    await db.insert(crmSchema.resources).values({
      id: postgresIds.resource,
      code: "service_resource",
      name: "Service resource",
      category: "attraction",
    });
    await db.insert(crmSchema.resourcePackageTags).values([
      {
        resourceId: postgresIds.resource,
        packageTemplateId: postgresIds.adventure,
      },
      {
        resourceId: postgresIds.resource,
        packageTemplateId: postgresIds.warriors,
      },
    ]);
    await db.insert(crmSchema.bookingResourceAssignments).values({
      id: postgresIds.assignment,
      bookingId: postgresIds.booking,
      resourceId: postgresIds.resource,
    });
    await db.insert(crmSchema.bookingPackageSelections).values({
      bookingId: postgresIds.booking,
      packageTemplateId: postgresIds.warriors,
    });
    await db.insert(crmSchema.bookingResourcePackageAttributions).values({
      bookingResourceAssignmentId: postgresIds.assignment,
      packageTemplateId: postgresIds.warriors,
    });
  });

  afterEach(async () => {
    if (!sql) return;
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await sql.end({ timeout: 5 });
    sql = undefined;
  });

  postgresTest("rolls back configuration when its audit insert is rejected", async () => {
    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_package_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'configure_packages' THEN
          RAISE EXCEPTION 'package audit rejected';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_package_audit
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_package_audit();
    `);

    await expect(service.configureBooking({
      bookingId: postgresIds.booking,
      packageTemplateIds: [postgresIds.adventure, postgresIds.warriors],
      physicalAttractionTotal: 11,
      attractionTotalApprovalReason: null,
      manualAttributions: [{
        bookingResourceAssignmentId: postgresIds.assignment,
        packageTemplateIds: [],
      }],
    })).rejects.toThrow("package audit rejected");
    expect(await sql!.unsafe(`
      SELECT physical_attraction_total FROM bookings
      WHERE id = '${postgresIds.booking}'
    `)).toEqual([{ physical_attraction_total: 5 }]);
    expect(await sql!.unsafe(`
      SELECT package_template_id FROM booking_package_selections
      WHERE booking_id = '${postgresIds.booking}'
    `)).toEqual([{ package_template_id: postgresIds.warriors }]);
    expect(await sql!.unsafe(`
      SELECT a.attribution_source, p.package_template_id
      FROM booking_resource_assignments a
      JOIN booking_resource_package_attributions p
        ON p.booking_resource_assignment_id = a.id
      WHERE a.id = '${postgresIds.assignment}'
    `)).toEqual([{
      attribution_source: "inferred",
      package_template_id: postgresIds.warriors,
    }]);
  });

  postgresTest("rolls back special-request creation and decision audit failures", async () => {
    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_request_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.entity_type = 'booking_special_request' THEN
          RAISE EXCEPTION 'request audit rejected';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_request_audit
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_request_audit();
    `);
    await expect(service.addSpecialRequest({
      bookingId: postgresIds.booking,
      description: "Rollback creation",
      treatment: "note_only",
    })).rejects.toThrow("request audit rejected");
    expect(await sql!.unsafe(
      "SELECT count(*) AS value FROM booking_special_requests",
    )).toEqual([{ value: "0" }]);

    await sql!.unsafe("DROP TRIGGER reject_request_audit ON audit_entries");
    const added = await service.addSpecialRequest({
      bookingId: postgresIds.booking,
      description: "Rollback decision",
      treatment: "note_only",
    });
    if (!added.ok) throw new Error("Request setup failed.");
    await sql!.unsafe(`
      CREATE TRIGGER reject_request_audit
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_request_audit();
    `);
    await expect(service.decideSpecialRequest({
      specialRequestId: added.value.id,
      decision: "declined",
      reason: "Unavailable",
    })).rejects.toThrow("request audit rejected");
    expect(await sql!.unsafe(`
      SELECT approval_status, decision_reason, decided_at
      FROM booking_special_requests WHERE id = '${added.value.id}'
    `)).toEqual([{
      approval_status: "needs_approval",
      decision_reason: null,
      decided_at: null,
    }]);
  });

  postgresTest(
    "serializes concurrent decisions and never changes the saved total on approval",
    async () => {
      await sql!.unsafe(`
        UPDATE bookings SET physical_attraction_total = 11
        WHERE id = '${postgresIds.booking}'
      `);
      const added = await service.addSpecialRequest({
        bookingId: postgresIds.booking,
        description: "Concurrent decision",
        treatment: "add_to_count",
      });
      if (!added.ok) throw new Error("Request setup failed.");

      const secondSql = postgres(databaseUrl!, { max: 1 });
      try {
        await secondSql.unsafe(`SET search_path TO "${schemaName}", public`);
        const secondService = new PackageService(
          new DrizzlePackageRepository(
            drizzle({ client: secondSql, schema: crmSchema }),
          ),
        );
        const results = await Promise.all([
          service.decideSpecialRequest({
            specialRequestId: added.value.id,
            decision: "approved",
            reason: "Approved concurrently",
          }),
          secondService.decideSpecialRequest({
            specialRequestId: added.value.id,
            decision: "declined",
            reason: "Declined concurrently",
          }),
        ]);
        expect(results.filter(({ ok }) => ok)).toHaveLength(1);
        expect(results.filter(({ ok }) => !ok)).toEqual([
          {
            ok: false,
            error: { code: "SPECIAL_REQUEST_NOT_PENDING" },
          },
        ]);
      } finally {
        await secondSql.end({ timeout: 5 });
      }
      expect(await sql!.unsafe(`
        SELECT count(*) AS value FROM audit_entries
        WHERE entity_type = 'booking_special_request'
          AND entity_id = '${added.value.id}'
          AND action = 'decision'
      `)).toEqual([{ value: "1" }]);
      expect(await sql!.unsafe(`
        SELECT physical_attraction_total FROM bookings
        WHERE id = '${postgresIds.booking}'
      `)).toEqual([{ physical_attraction_total: 11 }]);

      const approval = await service.addSpecialRequest({
        bookingId: postgresIds.booking,
        description: "Explicit approval",
        treatment: "add_to_count",
      });
      if (!approval.ok) throw new Error("Approval setup failed.");
      await expect(service.decideSpecialRequest({
        specialRequestId: approval.value.id,
        decision: "approved",
        reason: "Approved",
      })).resolves.toMatchObject({ ok: true });
      expect(await sql!.unsafe(`
        SELECT physical_attraction_total FROM bookings
        WHERE id = '${postgresIds.booking}'
      `)).toEqual([{ physical_attraction_total: 11 }]);
    },
  );
});
