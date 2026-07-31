import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

function testSchemaName() {
  return `act_reviewed_import_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyMigrationsThrough(
  transaction: postgres.TransactionSql,
  schemaName: string,
  lastIndex: number,
) {
  const journal = JSON.parse(await readFile(
    path.join(migrationDirectory, "meta", "_journal.json"),
    "utf8",
  )) as { entries: { idx: number; tag: string }[] };
  for (let index = 0; index <= lastIndex; index += 1) {
    const entry = journal.entries.find((candidate) => candidate.idx === index);
    if (!entry) throw new Error(`Missing migration ${index}.`);
    for (const statement of await migrationStatements(
      `${entry.tag}.sql`,
      schemaName,
    )) {
      await transaction.unsafe(statement);
    }
  }
}

describe("Act reviewed import migration", () => {
  const migrationTest = databaseUrl ? it : it.skip;

  migrationTest("adds calling lists and apply queues without changing prior CRM or preview rows", async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    const schemaName = testSchemaName();
    const schema = `"${schemaName}"`;
    const ids = {
      organization: "11111111-1111-4111-8111-111111111111",
      contact: "22222222-2222-4222-8222-222222222222",
      booking: "33333333-3333-4333-8333-333333333333",
      activity: "44444444-4444-4444-8444-444444444444",
      call: "55555555-5555-4555-8555-555555555555",
      package: "66666666-6666-4666-8666-666666666666",
      run: "77777777-7777-4777-8777-777777777777",
      record: "78787878-7878-4787-8787-787878787878",
      proposal: "88888888-8888-4888-8888-888888888888",
      externalLink: "99999999-9999-4999-8999-999999999999",
      list: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };

    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL search_path TO ${schema}, public`);
        await applyMigrationsThrough(tx, schemaName, 9);
        await tx.unsafe(`
          INSERT INTO ${schema}.organizations (id, name)
          VALUES ('${ids.organization}', 'Legacy Place');
          INSERT INTO ${schema}.contacts (id, first_name, last_name)
          VALUES ('${ids.contact}', 'Legacy', 'Person');
          INSERT INTO ${schema}.organization_contacts (
            organization_id, contact_id, active, source
          ) VALUES ('${ids.organization}', '${ids.contact}', true, 'local');
          INSERT INTO ${schema}.bookings (id, organization_id, name, city, region)
          VALUES ('${ids.booking}', '${ids.organization}', 'Legacy Booking', 'Helena', 'MT');
          INSERT INTO ${schema}.booking_contacts (booking_id, contact_id, source)
          VALUES ('${ids.booking}', '${ids.contact}', 'local');
          INSERT INTO ${schema}.activities (
            id, organization_id, contact_id, booking_id, kind, body, occurred_at
          ) VALUES (
            '${ids.activity}', '${ids.organization}', '${ids.contact}', '${ids.booking}',
            'note', 'Preserve this activity.', now()
          );
          INSERT INTO ${schema}.call_sessions (
            id, organization_id, contact_id, booking_id, disposition, started_at
          ) VALUES (
            '${ids.call}', '${ids.organization}', '${ids.contact}', '${ids.booking}',
            'no_answer', now()
          );
          INSERT INTO ${schema}.package_templates (id, code, name, base_attraction_count)
          VALUES ('${ids.package}', 'LEGACY', 'Legacy package', 1);
          INSERT INTO ${schema}.act_migration_runs (
            id, request_key, source_database_key, requested_by, status
          ) VALUES (
            '${ids.run}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'source-db', 'migration-test', 'previewed'
          );
          INSERT INTO ${schema}.act_migration_proposals (
            id, run_id, proposal_key, state, target_entity_type,
            source_record_keys, candidate_local_ids, display_snapshot
          ) VALUES (
            '${ids.proposal}', '${ids.run}', 'contact:legacy', 'new', 'contact',
            '[]', '[]', '{}'
          );
          INSERT INTO ${schema}.act_migration_records (
            id, run_id, stream_type, source_key, source_id,
            raw_snapshot, normalized_snapshot, fingerprint, proposal_key
          ) VALUES (
            '${ids.record}', '${ids.run}', 'contact', 'contact:legacy', 'legacy',
            '{}', '{}', 'legacy-fingerprint', 'contact:legacy'
          );
          INSERT INTO ${schema}.act_external_links (
            id, entity_type, source_entity_type, entity_id, act_record_id,
            is_primary, sync_mode
          ) VALUES (
            '${ids.externalLink}', 'contact', 'contact', '${ids.contact}',
            'ACT-CONTACT-1', true, 'two_way'
          );
        `);

        const [before] = await tx.unsafe(`
          SELECT
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.organizations row) AS organizations,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.contacts row) AS contacts,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.bookings row) AS bookings,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.organization_contacts row) AS organization_contacts,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.booking_contacts row) AS booking_contacts,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.activities row) AS activities,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.call_sessions row) AS calls,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.package_templates row) AS packages,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.act_migration_runs row) AS runs,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.act_migration_records row) AS records,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.act_migration_proposals row) AS proposals,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.act_external_links row) AS external_links
        `);

        for (const statement of await migrationStatements(
          "0010_act_reviewed_import.sql",
          schemaName,
        )) {
          await tx.unsafe(statement);
        }

        expect(await tx.unsafe(`
          SELECT status FROM ${schema}.act_migration_runs WHERE id = '${ids.run}'
        `)).toEqual([{ status: "previewed" }]);
        await expect(tx.unsafe(`
          INSERT INTO ${schema}.calling_lists (name, kind) VALUES ('Bad', 'dynamic')
        `)).rejects.toMatchObject({ code: "23514" });
        await tx.unsafe(`
          INSERT INTO ${schema}.calling_lists (id, name, kind)
          VALUES ('${ids.list}', 'Fair leads', 'static')
        `);
        await tx.unsafe(`
          INSERT INTO ${schema}.calling_list_memberships (calling_list_id, contact_id)
          VALUES ('${ids.list}', '${ids.contact}')
        `);
        await expect(tx.unsafe(`
          INSERT INTO ${schema}.calling_list_memberships (calling_list_id, contact_id)
          VALUES ('${ids.list}', '${ids.contact}')
        `)).rejects.toMatchObject({ code: "23505" });

        const [after] = await tx.unsafe(`
          SELECT
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.organizations row) AS organizations,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.contacts row) AS contacts,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.bookings row) AS bookings,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.organization_contacts row) AS organization_contacts,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.booking_contacts row) AS booking_contacts,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.activities row) AS activities,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.call_sessions row) AS calls,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.package_templates row) AS packages,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.act_migration_runs row) AS runs,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.act_migration_records row) AS records,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.act_migration_proposals row) AS proposals,
            (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id) FROM ${schema}.act_external_links row) AS external_links
        `);
        expect(after).toEqual(before);

        await tx.unsafe(`
          INSERT INTO ${schema}.act_migration_runs (
            request_key, source_database_key, requested_by, status
          ) VALUES (
            'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            'apply-source', 'migration-test', 'applying'
          )
        `);
        await tx.unsafe(`
          UPDATE ${schema}.act_migration_proposals
          SET decision = 'confirm_static_group'
          WHERE id = '${ids.proposal}'
        `);
      });
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end({ timeout: 5 });
    }
  });
});
