import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  DrizzleActivityRepository,
  type ActivityRepository,
  type ActivityRevisionReader,
} from "@/features/activities/activity-repository";
import { ActivityService } from "@/features/activities/activity-service";
import type {
  ActivityRevisionPage,
  ActivityTimelineItem,
  CreateActivityInput,
} from "@/features/activities/activity-types";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  missing: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

class RecordingActivityRepository
  implements ActivityRepository, ActivityRevisionReader
{
  createCalls = 0;

  async listTimeline(): Promise<ActivityTimelineItem[]> {
    return [];
  }

  async listRevisions(): Promise<ActivityRevisionPage> {
    return { revisions: [], nextPage: null };
  }

  async create(): Promise<ActivityTimelineItem> {
    this.createCalls += 1;
    throw new Error("The repository must not be called for invalid input.");
  }

  async edit() {
    return { ok: false as const, error: { code: "ACTIVITY_NOT_FOUND" as const } };
  }
}

function testSchemaName() {
  return `activity_repository_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function createActivity(
  service: ActivityService,
  input: CreateActivityInput,
): Promise<ActivityTimelineItem> {
  const result = await service.create(input);
  if (!result.ok) throw new Error("Expected a valid activity input.");
  return result.value;
}

describe("ActivityService validation", () => {
  it("returns a typed failure for blank activity text without calling the repository", async () => {
    const repository = new RecordingActivityRepository();
    const service = new ActivityService(repository);

    await expect(
      service.create({
        organizationId: ids.organization,
        kind: "note",
        body: "   ",
        occurredAt: new Date("2026-07-28T15:00:00.000Z"),
      }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "INVALID_ACTIVITY_INPUT", message: "Add activity text." },
    });
    expect(repository.createCalls).toBe(0);
  });

  it("returns a typed failure for a missing activity parent without calling the repository", async () => {
    const repository = new RecordingActivityRepository();
    const service = new ActivityService(repository);

    await expect(
      service.create({
        kind: "note",
        body: "Left a message.",
        occurredAt: new Date("2026-07-28T15:00:00.000Z"),
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "INVALID_ACTIVITY_INPUT",
        message: "Link the activity to an organization, contact, or booking.",
      },
    });
    expect(repository.createCalls).toBe(0);
  });
});

describe("ActivityService", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";
  let service: ActivityService;

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
    service = new ActivityService(new DrizzleActivityRepository(db));
    await db.insert(crmSchema.organizations).values({
      id: ids.organization,
      name: "Marias Fair",
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

  postgresTest("keeps timeline rows collapsed, newest first, and loads revisions only on demand", async () => {
    const older = await createActivity(service, {
      organizationId: ids.organization,
      kind: "note",
      body: "Initial venue note.",
      occurredAt: new Date("2026-07-20T15:00:00.000Z"),
    });
    const newer = await createActivity(service, {
      organizationId: ids.organization,
      kind: "call",
      body: "Called about the August date.",
      occurredAt: new Date("2026-07-28T15:00:00.000Z"),
    });

    const edited = await service.edit({
      activityId: newer.id,
      body: "Confirmed the August date.",
      reason: "Corrected the call summary.",
    });

    expect(edited).toMatchObject({
      ok: true,
      value: { id: newer.id, body: "Confirmed the August date.", revisionCount: 1 },
    });
    const timeline = await service.listTimeline({ organizationId: ids.organization });
    expect(timeline).toEqual([
      expect.objectContaining({ id: newer.id, revisionCount: 1 }),
      expect.objectContaining({ id: older.id, revisionCount: 0 }),
    ]);
    expect(timeline[0]).not.toHaveProperty("revisions");
    expect(await service.listRevisions(newer.id)).toEqual({
      revisions: [
        expect.objectContaining({
          activityId: newer.id,
          priorBody: "Called about the August date.",
          replacementBody: "Confirmed the August date.",
          reason: "Corrected the call summary.",
        }),
      ],
      nextPage: null,
    });
    expect(await sql!.unsafe("SELECT action FROM audit_entries ORDER BY created_at, id")).toEqual([
      { action: "create" },
      { action: "create" },
      { action: "update" },
    ]);
  });

  postgresTest("rejects nonexistent or incoherent parents without activity or audit writes", async () => {
    await expect(service.create({
      contactId: ids.missing,
      kind: "note",
      body: "This parent does not exist.",
      occurredAt: new Date("2026-07-28T15:00:00.000Z"),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_ACTIVITY_INPUT" },
    });

    await sql!.unsafe(`
      INSERT INTO organizations (id, name)
      VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other Fair');
      INSERT INTO contacts (id, organization_id, first_name, last_name)
      VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', NULL, 'Other', 'Contact');
      INSERT INTO organization_contacts (organization_id, contact_id, source)
      VALUES (
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'legacy_backfill'
      );
      UPDATE contacts
      SET organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    `);
    await expect(service.create({
      organizationId: ids.organization,
      contactId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      kind: "note",
      body: "These parents conflict.",
      occurredAt: new Date("2026-07-28T15:00:00.000Z"),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_ACTIVITY_INPUT" },
    });
    expect(await sql!.unsafe("SELECT count(*) AS value FROM activities")).toEqual([
      { value: "0" },
    ]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM audit_entries")).toEqual([
      { value: "0" },
    ]);
  });

  postgresTest("creates an activity for a Person at a secondary active Place", async () => {
    const personId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const primaryPlaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await sql!.unsafe(`
      INSERT INTO organizations (id, name)
      VALUES ('${primaryPlaceId}', 'Primary Fair');
      INSERT INTO contacts (id, organization_id, first_name, last_name)
      VALUES ('${personId}', NULL, 'Shared', 'Person');
      INSERT INTO organization_contacts (
        organization_id, contact_id, active, source
      ) VALUES
        ('${primaryPlaceId}', '${personId}', true, 'local'),
        ('${ids.organization}', '${personId}', true, 'local');
      UPDATE contacts SET organization_id = '${primaryPlaceId}'
      WHERE id = '${personId}';
    `);

    await expect(service.create({
      organizationId: ids.organization,
      contactId: personId,
      kind: "note",
      body: "Secondary Place note.",
      occurredAt: new Date("2026-07-28T15:00:00.000Z"),
    })).resolves.toMatchObject({
      ok: true,
      value: {
        organizationId: ids.organization,
        contactId: personId,
      },
    });
  });

  postgresTest("rejects an activity for a Person with no active Place relationship", async () => {
    const personId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await sql!.unsafe(`
      INSERT INTO contacts (id, organization_id, first_name, last_name)
      VALUES ('${personId}', NULL, 'Inactive', 'Person');
      INSERT INTO organization_contacts (
        organization_id, contact_id, active, source
      ) VALUES ('${ids.organization}', '${personId}', false, 'local');
    `);

    await expect(service.create({
      organizationId: ids.organization,
      contactId: personId,
      kind: "note",
      body: "Must not be stored.",
      occurredAt: new Date("2026-07-28T15:00:00.000Z"),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_ACTIVITY_INPUT" },
    });
  });

  postgresTest("returns missing without writing a revision or audit entry", async () => {
    await expect(
      service.edit({
        activityId: ids.missing,
        body: "This must not be stored.",
        reason: "No activity exists.",
      }),
    ).resolves.toEqual({ ok: false, error: { code: "ACTIVITY_NOT_FOUND" } });
    expect(await sql!.unsafe("SELECT count(*) AS value FROM activity_revisions")).toEqual([
      { value: "0" },
    ]);
    expect(await sql!.unsafe("SELECT count(*) AS value FROM audit_entries")).toEqual([
      { value: "0" },
    ]);
  });

  postgresTest("rolls back the revision and text update when the edit audit is rejected", async () => {
    const activity = await createActivity(service, {
      organizationId: ids.organization,
      kind: "note",
      body: "Original text.",
      occurredAt: new Date("2026-07-28T15:00:00.000Z"),
    });
    await sql!.unsafe(`
      CREATE FUNCTION "${schemaName}".reject_activity_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.action = 'update' THEN RAISE EXCEPTION 'activity audit rejected'; END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER reject_activity_audit
      BEFORE INSERT ON audit_entries
      FOR EACH ROW EXECUTE FUNCTION "${schemaName}".reject_activity_audit();
    `);

    await expect(
      service.edit({
        activityId: activity.id,
        body: "Replacement text.",
        reason: "Corrected the note.",
      }),
    ).rejects.toThrow("activity audit rejected");
    expect(await service.listTimeline({ organizationId: ids.organization })).toEqual([
      expect.objectContaining({ id: activity.id, body: "Original text.", revisionCount: 0 }),
    ]);
    expect(await sql!.unsafe("SELECT action FROM audit_entries ORDER BY created_at, id")).toEqual([
      { action: "create" },
    ]);
  });
});
