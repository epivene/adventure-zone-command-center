import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  DrizzlePackageRepository,
  DrizzlePackageSettingsRepository,
} from "@/features/packages/package-repository";
import { PackageService } from "@/features/packages/package-service";
import {
  DrizzleResourceSettingsRepository,
  ResourceSettingsError,
} from "@/features/resources/resource-repository";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

const ids = {
  leg: "11111111-1111-4111-8111-111111111111",
  packageA: "22222222-2222-4222-8222-222222222221",
  packageInactive: "22222222-2222-4222-8222-222222222222",
  packageNew: "22222222-2222-4222-8222-222222222223",
  resource: "33333333-3333-4333-8333-333333333333",
  booking: "44444444-4444-4444-8444-444444444444",
  assignment: "55555555-5555-4555-8555-555555555555",
  attribution: "66666666-6666-4666-8666-666666666666",
  retainedTag: "77777777-7777-4777-8777-777777777777",
  override: "88888888-8888-4888-8888-888888888888",
};

function testSchemaName() {
  return `package_resource_settings_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("package/resource settings PostgreSQL persistence", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let packageRepository: DrizzlePackageSettingsRepository;
  let resourceRepository: DrizzleResourceSettingsRepository;
  let db: ReturnType<typeof drizzle<typeof crmSchema>>;

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

    db = drizzle({ client: sql, schema: crmSchema });
    packageRepository = new DrizzlePackageSettingsRepository(db);
    resourceRepository = new DrizzleResourceSettingsRepository(db);

    await db.insert(crmSchema.travelLegs).values({
      id: ids.leg,
      name: "North",
      color: "#112233",
      sortOrder: 1,
    });
    await db.insert(crmSchema.packageTemplates).values([
      {
        id: ids.packageA,
        code: "adventure_zone",
        name: "Adventure Zone",
        baseAttractionCount: 10,
      },
      {
        id: ids.packageInactive,
        code: "weekend_warriors",
        name: "Weekend Warriors",
        baseAttractionCount: 5,
        active: false,
      },
      {
        id: ids.packageNew,
        code: "pirates_rebellion",
        name: "Pirates Rebellion",
        baseAttractionCount: 3,
      },
    ]);
    await db.insert(crmSchema.resources).values({
      id: ids.resource,
      code: "paintball_trailer",
      name: "Paintball trailer",
      category: "trailer",
      countsAsAttraction: true,
      movable: true,
      normalTravelLegId: ids.leg,
      minimumTransferMinutes: 60,
    });
    await db.insert(crmSchema.resourcePackageTags).values([
      {
        resourceId: ids.resource,
        packageTemplateId: ids.packageA,
      },
      {
        id: ids.retainedTag,
        resourceId: ids.resource,
        packageTemplateId: ids.packageInactive,
      },
    ]);
    await db.insert(crmSchema.bookings).values({
      id: ids.booking,
      name: "Historical booking",
      city: "Billings",
      region: "MT",
    });
    await db.insert(crmSchema.bookingResourceAssignments).values({
      id: ids.assignment,
      bookingId: ids.booking,
      resourceId: ids.resource,
      attributionSource: "manual",
    });
    await db.insert(crmSchema.bookingResourcePackageAttributions).values({
      id: ids.attribution,
      bookingResourceAssignmentId: ids.assignment,
      packageTemplateId: ids.packageInactive,
    });
    await db.insert(crmSchema.bookingPackageSelections).values({
      bookingId: ids.booking,
      packageTemplateId: ids.packageA,
    });
    await db.insert(crmSchema.resourceConflictOverrides).values({
      id: ids.override,
      bookingId: ids.booking,
      resourceId: ids.resource,
      conflictKey: "RESOURCE_OVERLAP:historical",
      reason: "Owner approved the historical schedule.",
      acknowledgedBy: "owner_1",
    });
  });

  afterEach(async () => {
    if (!sql) return;
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await sql.end({ timeout: 5 });
    sql = undefined;
    schemaName = "";
  });

  postgresTest("updates a package and its audit atomically", async () => {
    await sql!.unsafe(`
      CREATE FUNCTION reject_package_settings_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.entity_type = 'package_template' THEN
          RAISE EXCEPTION 'package settings audit rejected';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_package_settings_audit
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION reject_package_settings_audit();
    `);

    await expect(packageRepository.updatePackageTemplate({
      id: ids.packageA,
      name: "Adventure Zone Deluxe",
      baseAttractionCount: 11,
      active: false,
    }, "owner_1")).rejects.toHaveProperty("cause.message", "package settings audit rejected");

    expect(await sql!.unsafe(`
      SELECT name, base_attraction_count, active
      FROM package_templates WHERE id = '${ids.packageA}'
    `)).toEqual([{
      name: "Adventure Zone",
      base_attraction_count: 10,
      active: true,
    }]);
  });

  postgresTest("deactivates a package without removing an existing selection or resource tag", async () => {
    await packageRepository.updatePackageTemplate({
      id: ids.packageA,
      name: "Adventure Zone",
      baseAttractionCount: 10,
      active: false,
    }, "owner_1");

    expect(await sql!.unsafe(`
      SELECT active FROM package_templates WHERE id = '${ids.packageA}'
    `)).toEqual([{ active: false }]);
    expect(await sql!.unsafe(`
      SELECT booking_id, package_template_id FROM booking_package_selections
      WHERE booking_id = '${ids.booking}'
    `)).toEqual([{
      booking_id: ids.booking,
      package_template_id: ids.packageA,
    }]);
    expect(await sql!.unsafe(`
      SELECT resource_id, package_template_id FROM resource_package_tags
      WHERE resource_id = '${ids.resource}' AND package_template_id = '${ids.packageA}'
    `)).toEqual([{
      resource_id: ids.resource,
      package_template_id: ids.packageA,
    }]);
    expect(await sql!.unsafe(`
      SELECT
        before ? 'actorId' AS before_has_actor_id,
        after->>'actorId' AS after_actor_id
      FROM audit_entries
      WHERE entity_type = 'package_template' AND entity_id = '${ids.packageA}'
    `)).toEqual([{
      before_has_actor_id: false,
      after_actor_id: "owner_1",
    }]);
  });

  postgresTest("archives while diffing tags and preserving assignments, overrides, manual attributions, and retained tag rows", async () => {
    await resourceRepository.upsertResource({
      id: ids.resource,
      code: "paintball_trailer",
      name: "Paintball transport",
      category: "trailer",
      countsAsAttraction: true,
      packageTemplateIds: [ids.packageInactive, ids.packageNew],
      normalTravelLegId: ids.leg,
      movable: true,
      setupMinutes: 15,
      teardownMinutes: 20,
      minimumTransferMinutes: 75,
      status: "archived",
    }, "owner_1");

    expect(await sql!.unsafe(`
      SELECT id, package_template_id
      FROM resource_package_tags
      WHERE resource_id = '${ids.resource}'
      ORDER BY package_template_id
    `)).toEqual([
      { id: ids.retainedTag, package_template_id: ids.packageInactive },
      expect.objectContaining({ package_template_id: ids.packageNew }),
    ]);
    expect(await sql!.unsafe(`
      SELECT id, attribution_source FROM booking_resource_assignments
      WHERE id = '${ids.assignment}'
    `)).toEqual([{ id: ids.assignment, attribution_source: "manual" }]);
    expect(await sql!.unsafe(`
      SELECT id, booking_resource_assignment_id, package_template_id
      FROM booking_resource_package_attributions
    `)).toEqual([{
      id: ids.attribution,
      booking_resource_assignment_id: ids.assignment,
      package_template_id: ids.packageInactive,
    }]);
    expect(await sql!.unsafe(`
      SELECT id, conflict_key, reason FROM resource_conflict_overrides
      WHERE id = '${ids.override}'
    `)).toEqual([{
      id: ids.override,
      conflict_key: "RESOURCE_OVERLAP:historical",
      reason: "Owner approved the historical schedule.",
    }]);
    expect(await sql!.unsafe(`
      SELECT status FROM resources WHERE id = '${ids.resource}'
    `)).toEqual([{ status: "archived" }]);
    expect(await sql!.unsafe(`
      SELECT
        entity_type,
        action,
        before ? 'actorId' AS before_has_actor_id,
        after->>'actorId' AS after_actor_id
      FROM audit_entries
      WHERE entity_id = '${ids.resource}'
    `)).toEqual([{
      entity_type: "resource",
      action: "update",
      before_has_actor_id: false,
      after_actor_id: "owner_1",
    }]);
  });

  postgresTest("derives inferred attribution from later resource-tag changes in the next audit", async () => {
    await sql!.unsafe(`
      DELETE FROM booking_resource_package_attributions
      WHERE booking_resource_assignment_id = '${ids.assignment}';
      UPDATE booking_resource_assignments
      SET attribution_source = 'inferred'
      WHERE id = '${ids.assignment}';
    `);
    const service = new PackageService(new DrizzlePackageRepository(db));
    await expect(service.configureBooking({
      bookingId: ids.booking,
      packageTemplateIds: [ids.packageA],
      physicalAttractionTotal: 10,
      attractionTotalApprovalReason: null,
      manualAttributions: [{
        bookingResourceAssignmentId: ids.assignment,
        packageTemplateIds: null,
      }],
    })).resolves.toMatchObject({ ok: true });
    expect(await sql!.unsafe(`
      SELECT count(*) AS value
      FROM booking_resource_package_attributions
      WHERE booking_resource_assignment_id = '${ids.assignment}'
    `)).toEqual([{ value: "0" }]);

    await resourceRepository.upsertResource({
      id: ids.resource,
      code: "paintball_trailer",
      name: "Paintball trailer",
      category: "trailer",
      countsAsAttraction: true,
      packageTemplateIds: [ids.packageNew],
      normalTravelLegId: ids.leg,
      movable: true,
      setupMinutes: 0,
      teardownMinutes: 0,
      minimumTransferMinutes: 60,
      status: "available",
    }, "owner_1");
    await expect(service.configureBooking({
      bookingId: ids.booking,
      packageTemplateIds: [ids.packageA],
      physicalAttractionTotal: 11,
      attractionTotalApprovalReason: "Approved historical variance",
      manualAttributions: [{
        bookingResourceAssignmentId: ids.assignment,
        packageTemplateIds: null,
      }],
    })).resolves.toMatchObject({ ok: true });

    expect(await sql!.unsafe(`
      SELECT before->'attributions' AS before_attributions
      FROM audit_entries
      WHERE action = 'configure_packages'
        AND after->>'physicalAttractionTotal' = '11'
    `)).toEqual([{
      before_attributions: [{
        bookingResourceAssignmentId: ids.assignment,
        source: "inferred",
        packageTemplateIds: [],
      }],
    }]);
  });

  postgresTest("creates a complete resource, active tag, and audit in one transaction", async () => {
    const created = await resourceRepository.upsertResource({
      id: null,
      code: "portable_climbing_wall",
      name: "Portable climbing wall",
      category: "attraction",
      countsAsAttraction: true,
      packageTemplateIds: [ids.packageA],
      normalTravelLegId: ids.leg,
      movable: true,
      setupMinutes: 45,
      teardownMinutes: 30,
      minimumTransferMinutes: 90,
      status: "unavailable",
    }, "owner_1");

    expect(await sql!.unsafe(`
      SELECT
        code,
        name,
        category,
        counts_as_attraction,
        normal_travel_leg_id,
        movable,
        setup_minutes,
        teardown_minutes,
        minimum_transfer_minutes,
        status
      FROM resources
      WHERE id = '${created.id}'
    `)).toEqual([{
      code: "portable_climbing_wall",
      name: "Portable climbing wall",
      category: "attraction",
      counts_as_attraction: true,
      normal_travel_leg_id: ids.leg,
      movable: true,
      setup_minutes: 45,
      teardown_minutes: 30,
      minimum_transfer_minutes: 90,
      status: "unavailable",
    }]);
    expect(await sql!.unsafe(`
      SELECT package_template_id
      FROM resource_package_tags
      WHERE resource_id = '${created.id}'
    `)).toEqual([{ package_template_id: ids.packageA }]);
    expect(await sql!.unsafe(`
      SELECT
        entity_type,
        action,
        before IS NULL AS before_is_null,
        after->>'actorId' AS actor_id
      FROM audit_entries
      WHERE entity_id = '${created.id}'
    `)).toEqual([{
      entity_type: "resource",
      action: "create",
      before_is_null: true,
      actor_id: "owner_1",
    }]);
  });

  postgresTest("rolls back the resource row and tag diff when its audit is rejected", async () => {
    await sql!.unsafe(`
      CREATE FUNCTION reject_resource_settings_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.entity_type = 'resource' THEN
          RAISE EXCEPTION 'resource settings audit rejected';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER reject_resource_settings_audit
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION reject_resource_settings_audit();
    `);

    await expect(resourceRepository.upsertResource({
      id: ids.resource,
      code: "paintball_trailer",
      name: "Changed name",
      category: "trailer",
      countsAsAttraction: true,
      packageTemplateIds: [ids.packageNew],
      normalTravelLegId: ids.leg,
      movable: true,
      setupMinutes: 0,
      teardownMinutes: 0,
      minimumTransferMinutes: 60,
      status: "archived",
    }, "owner_1")).rejects.toHaveProperty("cause.message", "resource settings audit rejected");

    expect(await sql!.unsafe(`
      SELECT name, status FROM resources WHERE id = '${ids.resource}'
    `)).toEqual([{ name: "Paintball trailer", status: "available" }]);
    expect(await sql!.unsafe(`
      SELECT package_template_id FROM resource_package_tags
      WHERE resource_id = '${ids.resource}' ORDER BY package_template_id
    `)).toEqual([
      { package_template_id: ids.packageA },
      { package_template_id: ids.packageInactive },
    ]);
  });

  postgresTest("rejects a new inactive tag and an immutable-code edit", async () => {
    await expect(resourceRepository.upsertResource({
      id: null,
      code: "new_resource",
      name: "New resource",
      category: "equipment",
      countsAsAttraction: false,
      packageTemplateIds: [ids.packageInactive],
      normalTravelLegId: null,
      movable: false,
      setupMinutes: 0,
      teardownMinutes: 0,
      minimumTransferMinutes: 0,
      status: "available",
    }, "owner_1")).rejects.toEqual(
      new ResourceSettingsError("INACTIVE_PACKAGE_TAG"),
    );

    await expect(resourceRepository.upsertResource({
      id: ids.resource,
      code: "renamed_code",
      name: "Paintball trailer",
      category: "trailer",
      countsAsAttraction: true,
      packageTemplateIds: [ids.packageInactive],
      normalTravelLegId: ids.leg,
      movable: true,
      setupMinutes: 0,
      teardownMinutes: 0,
      minimumTransferMinutes: 60,
      status: "available",
    }, "owner_1")).rejects.toEqual(
      new ResourceSettingsError("RESOURCE_CODE_IMMUTABLE"),
    );
  });

  postgresTest("maps duplicate codes and unknown package or leg references to typed errors", async () => {
    const baseInput = {
      id: null,
      code: "new_resource",
      name: "New resource",
      category: "equipment",
      countsAsAttraction: false,
      packageTemplateIds: [] as string[],
      normalTravelLegId: null as string | null,
      movable: false,
      setupMinutes: 0,
      teardownMinutes: 0,
      minimumTransferMinutes: 0,
      status: "available" as const,
    };

    await expect(resourceRepository.upsertResource({
      ...baseInput,
      code: "paintball_trailer",
    }, "owner_1")).rejects.toEqual(
      new ResourceSettingsError("DUPLICATE_RESOURCE_CODE"),
    );
    await expect(resourceRepository.upsertResource({
      ...baseInput,
      packageTemplateIds: ["99999999-9999-4999-8999-999999999991"],
    }, "owner_1")).rejects.toEqual(
      new ResourceSettingsError("UNKNOWN_PACKAGE_TAG"),
    );
    await expect(resourceRepository.upsertResource({
      ...baseInput,
      normalTravelLegId: "99999999-9999-4999-8999-999999999992",
    }, "owner_1")).rejects.toEqual(
      new ResourceSettingsError("UNKNOWN_TRAVEL_LEG"),
    );
  });

  postgresTest("does not map an unrelated wrapped failure when query parameters mention the constraint", async () => {
    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_unrelated_resource_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.entity_type = 'resource' THEN
          RAISE EXCEPTION 'unrelated resource audit rejected';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_unrelated_resource_audit
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_unrelated_resource_audit();
    `);

    await expect(resourceRepository.upsertResource({
      id: null,
      code: "resources_code_unique",
      name: "Constraint-name sentinel",
      category: "equipment",
      countsAsAttraction: false,
      packageTemplateIds: [],
      normalTravelLegId: null,
      movable: false,
      setupMinutes: 0,
      teardownMinutes: 0,
      minimumTransferMinutes: 0,
      status: "available",
    }, "owner_1")).rejects.toHaveProperty(
      "cause.message",
      "unrelated resource audit rejected",
    );
    expect(await sql!.unsafe(`
      SELECT count(*) AS value FROM resources
      WHERE code = 'resources_code_unique'
    `)).toEqual([{ value: "0" }]);
  });
});
