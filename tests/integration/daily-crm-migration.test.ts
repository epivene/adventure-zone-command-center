import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.DAILY_CRM_MIGRATION_TEST_DATABASE_URL;
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

function testSchemaName() {
  return `daily_crm_migration_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(
  fileName: string,
  schemaName: string,
) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("daily CRM migration", () => {
  const migrationTest = databaseUrl ? it : it.skip;

  migrationTest("preserves existing CRM and Act! record identities", async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    const schemaName = testSchemaName();
    const schema = `"${schemaName}"`;
    const ids = {
      organization: "11111111-1111-4111-8111-111111111111",
      contact: "22222222-2222-4222-8222-222222222222",
      booking: "33333333-3333-4333-8333-333333333333",
      followUp: "44444444-4444-4444-8444-444444444444",
      importRun: "55555555-5555-4555-8555-555555555555",
      actLink: "66666666-6666-4666-8666-666666666666",
    };

    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}`);
      await sql.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL search_path TO ${schema}, public`);

        const journal = JSON.parse(await readFile(
          path.join(migrationDirectory, "meta", "_journal.json"),
          "utf8",
        )) as { entries: { idx: number; tag: string }[] };
        for (const index of [0, 1, 2, 3, 4, 5]) {
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
          INSERT INTO ${schema}.organizations (id, name)
          VALUES ('${ids.organization}', 'Marias Fair');
          INSERT INTO ${schema}.contacts (id, organization_id, first_name, last_name, phone)
          VALUES ('${ids.contact}', '${ids.organization}', 'Avery', 'Example', '(406) 555-0101');
          INSERT INTO ${schema}.bookings (id, organization_id, primary_contact_id, name, city, region)
          VALUES ('${ids.booking}', '${ids.organization}', '${ids.contact}', 'Summer Fair', 'Shelby', 'MT');
          INSERT INTO ${schema}.follow_ups (id, booking_id, kind, due_at)
          VALUES ('${ids.followUp}', '${ids.booking}', 'call', now());
          INSERT INTO ${schema}.act_import_runs (id, source_file_name, status)
          VALUES ('${ids.importRun}', 'contacts.csv', 'completed');
          INSERT INTO ${schema}.act_external_links (id, entity_type, entity_id, act_record_id, import_run_id)
          VALUES ('${ids.actLink}', 'contact', '${ids.contact}', 'ACT-100', '${ids.importRun}');
        `);

        for (const statement of await migrationStatements(
          "0006_daily_crm_foundation.sql",
          schemaName,
        )) {
          await transaction.unsafe(statement);
        }

        const [contact] = await transaction.unsafe(
          `SELECT id, normalized_phone FROM ${schema}.contacts`,
        );
        const [followUp] = await transaction.unsafe(
          `SELECT id, booking_id, organization_id, contact_id FROM ${schema}.follow_ups`,
        );
        const [actLink] = await transaction.unsafe(
          `SELECT id, entity_id FROM ${schema}.act_external_links`,
        );
        const [counts] = await transaction.unsafe(`
          SELECT
            (SELECT count(*) FROM ${schema}.contacts) AS contacts,
            (SELECT count(*) FROM ${schema}.bookings) AS bookings,
            (SELECT count(*) FROM ${schema}.follow_ups) AS follow_ups,
            (SELECT count(*) FROM ${schema}.act_external_links) AS act_links
        `);

        expect(contact).toMatchObject({
          id: ids.contact,
          normalized_phone: "+14065550101",
        });
        expect(followUp).toMatchObject({
          id: ids.followUp,
          booking_id: ids.booking,
          organization_id: ids.organization,
          contact_id: ids.contact,
        });
        expect(actLink).toMatchObject({ id: ids.actLink, entity_id: ids.contact });
        expect(counts).toEqual({
          contacts: "1",
          bookings: "1",
          follow_ups: "1",
          act_links: "1",
        });
      });
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end({ timeout: 5 });
    }
  });
});
