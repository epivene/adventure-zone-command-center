import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

function testSchemaName() {
  return `place_person_migration_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("place-person relationship migration", () => {
  const migrationTest = databaseUrl ? it : it.skip;

  migrationTest("backfills relationships without changing legacy identities and enforces compatibility pointers", async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    const schemaName = testSchemaName();
    const schema = `"${schemaName}"`;
    const ids = {
      place: "11111111-1111-4111-8111-111111111111",
      otherPlace: "22222222-2222-4222-8222-222222222222",
      person: "33333333-3333-4333-8333-333333333333",
      secondPerson: "44444444-4444-4444-8444-444444444444",
      booking: "55555555-5555-4555-8555-555555555555",
      legacyBooking: "66666666-6666-4666-8666-666666666666",
      importRun: "77777777-7777-4777-8777-777777777777",
      actLink: "88888888-8888-4888-8888-888888888888",
      activity: "99999999-9999-4999-8999-999999999999",
      followUp: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      callSession: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      packageTemplate: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      resource: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    };

    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}`);
      await sql.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL search_path TO ${schema}, public`);
        const journal = JSON.parse(await readFile(
          path.join(migrationDirectory, "meta", "_journal.json"),
          "utf8",
        )) as { entries: { idx: number; tag: string }[] };
        for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
          const entry = journal.entries.find((candidate) => candidate.idx === index);
          if (!entry) throw new Error(`Missing migration ${index}.`);
          for (const statement of await migrationStatements(
            `${entry.tag}.sql`,
            schemaName,
          )) {
            await transaction.unsafe(statement);
          }
        }

        await transaction.unsafe(`
          INSERT INTO ${schema}.organizations (id, name) VALUES
            ('${ids.place}', 'Marias Fair'),
            ('${ids.otherPlace}', 'Other Fair');
          INSERT INTO ${schema}.contacts (id, organization_id, first_name, last_name) VALUES
            ('${ids.person}', '${ids.place}', 'Avery', 'Example'),
            ('${ids.secondPerson}', '${ids.place}', 'Blake', 'Example');
          INSERT INTO ${schema}.bookings (id, organization_id, primary_contact_id, name, city, region) VALUES
            ('${ids.booking}', '${ids.place}', '${ids.person}', 'Summer Fair', 'Shelby', 'MT'),
            ('${ids.legacyBooking}', NULL, '${ids.secondPerson}', 'Legacy Fair', 'Shelby', 'MT');
          INSERT INTO ${schema}.act_import_runs (id, source_file_name, status)
          VALUES ('${ids.importRun}', 'legacy.csv', 'completed');
          INSERT INTO ${schema}.act_external_links (id, entity_type, entity_id, act_record_id, import_run_id)
          VALUES ('${ids.actLink}', 'contact', '${ids.person}', 'ACT-100', '${ids.importRun}');
          INSERT INTO ${schema}.activities (id, organization_id, contact_id, booking_id, kind, body, occurred_at)
          VALUES ('${ids.activity}', '${ids.place}', '${ids.person}', '${ids.booking}', 'note', 'Preserve me.', now());
          INSERT INTO ${schema}.follow_ups (id, booking_id, organization_id, contact_id, kind, due_at)
          VALUES ('${ids.followUp}', '${ids.booking}', '${ids.place}', '${ids.person}', 'call', now());
          INSERT INTO ${schema}.call_sessions (id, organization_id, contact_id, booking_id, disposition, started_at)
          VALUES ('${ids.callSession}', '${ids.place}', '${ids.person}', '${ids.booking}', 'no_answer', now());
          INSERT INTO ${schema}.package_templates (id, code, name, base_attraction_count)
          VALUES ('${ids.packageTemplate}', 'LEGACY', 'Legacy Package', 1);
          INSERT INTO ${schema}.resources (id, code, name, category)
          VALUES ('${ids.resource}', 'LEGACY', 'Legacy Resource', 'attraction');
        `);

        for (const statement of await migrationStatements(
          "0008_place_person_relationships.sql",
          schemaName,
        )) {
          await transaction.unsafe(statement);
        }

        expect(await transaction.unsafe(`
          SELECT organization_id, contact_id, is_primary, active, source
          FROM ${schema}.organization_contacts
          ORDER BY organization_id, contact_id
        `)).toEqual([
          {
            organization_id: ids.place,
            contact_id: ids.person,
            is_primary: false,
            active: true,
            source: "legacy_backfill",
          },
          {
            organization_id: ids.place,
            contact_id: ids.secondPerson,
            is_primary: false,
            active: true,
            source: "legacy_backfill",
          },
        ]);
        expect(await transaction.unsafe(`
          SELECT booking_id, contact_id, is_primary, source
          FROM ${schema}.booking_contacts
          ORDER BY booking_id
        `)).toEqual([
          {
            booking_id: ids.booking,
            contact_id: ids.person,
            is_primary: true,
            source: "legacy_backfill",
          },
          {
            booking_id: ids.legacyBooking,
            contact_id: ids.secondPerson,
            is_primary: true,
            source: "legacy_backfill",
          },
        ]);

        expect(await transaction.unsafe(`
          SELECT
            (SELECT array_agg(id ORDER BY id) FROM ${schema}.organizations) AS organizations,
            (SELECT array_agg(id ORDER BY id) FROM ${schema}.contacts) AS contacts,
            (SELECT array_agg(id ORDER BY id) FROM ${schema}.bookings) AS bookings,
            (SELECT array_agg(id ORDER BY id) FROM ${schema}.act_external_links) AS act_links,
            (SELECT array_agg(id ORDER BY id) FROM ${schema}.activities) AS activities,
            (SELECT array_agg(id ORDER BY id) FROM ${schema}.follow_ups) AS follow_ups,
            (SELECT array_agg(id ORDER BY id) FROM ${schema}.call_sessions) AS call_sessions,
            (SELECT array_agg(id ORDER BY id) FROM ${schema}.package_templates) AS packages,
            (SELECT array_agg(id ORDER BY id) FROM ${schema}.resources) AS resources
        `)).toEqual([{
          organizations: [ids.place, ids.otherPlace].sort(),
          contacts: [ids.person, ids.secondPerson].sort(),
          bookings: [ids.booking, ids.legacyBooking].sort(),
          act_links: [ids.actLink],
          activities: [ids.activity],
          follow_ups: [ids.followUp],
          call_sessions: [ids.callSession],
          packages: [ids.packageTemplate],
          resources: [ids.resource],
        }]);

        await transaction.unsafe(`
          DO $$
          BEGIN
            BEGIN
              UPDATE ${schema}.contacts
              SET organization_id = '${ids.otherPlace}'
              WHERE id = '${ids.person}';
              RAISE EXCEPTION 'contact pointer update did not raise foreign_key_violation';
            EXCEPTION WHEN foreign_key_violation THEN
              NULL;
            END;
            BEGIN
              UPDATE ${schema}.bookings
              SET primary_contact_id = '${ids.secondPerson}'
              WHERE id = '${ids.booking}';
              RAISE EXCEPTION 'booking pointer update did not raise foreign_key_violation';
            EXCEPTION WHEN foreign_key_violation THEN
              NULL;
            END;
          END
          $$;
        `);
      });
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end({ timeout: 5 });
    }
  });
});
