import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

function testSchemaName() {
  return `act_migration_staging_${randomUUID().replaceAll("-", "_")}`;
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

describe("Act migration staging migration", () => {
  const migrationTest = databaseUrl ? it : it.skip;

  migrationTest(
    "preserves legacy CRM history while backfilling canonical links and staging constraints",
    async () => {
      const sql = postgres(databaseUrl!, { max: 1 });
      const schemaName = testSchemaName();
      const schema = `"${schemaName}"`;
      const ids = {
        organization: "11111111-1111-4111-8111-111111111111",
        contact: "33333333-3333-4333-8333-333333333333",
        singleLinkContact: "44444444-4444-4444-8444-444444444444",
        reviewContact: "55555555-5555-4555-8555-555555555555",
        booking: "66666666-6666-4666-8666-666666666666",
        importRun: "77777777-7777-4777-8777-777777777777",
        actLink: "88888888-8888-4888-8888-888888888888",
        singleLink: "99999999-9999-4999-8999-999999999999",
        reviewLinkOne: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        reviewLinkTwo: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        activity: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        call: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        package: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        run: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        record: "12121212-1212-4212-8212-121212121212",
        alias: "13131313-1313-4313-8313-131313131313",
      };

      try {
        await sql.unsafe(`CREATE SCHEMA ${schema}`);
        await sql.begin(async (transaction) => {
          await transaction.unsafe(`SET LOCAL search_path TO ${schema}, public`);
          await applyMigrationsThrough(transaction, schemaName, 8);

          await transaction.unsafe(`
            INSERT INTO ${schema}.organizations (id, name, act_record_id)
            VALUES ('${ids.organization}', 'Legacy Place', 'ACT-COMPANY-1');
            INSERT INTO ${schema}.contacts (id, first_name, last_name, act_record_id)
            VALUES
              ('${ids.contact}', 'Primary', 'Person', 'ACT-CONTACT-1'),
              ('${ids.singleLinkContact}', 'Single', 'Link', NULL),
              ('${ids.reviewContact}', 'Review', 'Needed', NULL);
            INSERT INTO ${schema}.organization_contacts (
              organization_id, contact_id, is_primary, active, source
            ) VALUES (
              '${ids.organization}', '${ids.contact}', true, true, 'local'
            );
            UPDATE ${schema}.contacts
            SET organization_id = '${ids.organization}'
            WHERE id = '${ids.contact}';
            INSERT INTO ${schema}.bookings (
              id, organization_id, name, city, region, act_record_id
            ) VALUES (
              '${ids.booking}', '${ids.organization}', 'Legacy Booking',
              'Shelby', 'MT', 'ACT-OPPORTUNITY-1'
            );
            INSERT INTO ${schema}.booking_contacts (
              booking_id, contact_id, is_primary, source
            ) VALUES (
              '${ids.booking}', '${ids.contact}', true, 'local'
            );
            UPDATE ${schema}.bookings
            SET primary_contact_id = '${ids.contact}'
            WHERE id = '${ids.booking}';
            INSERT INTO ${schema}.act_import_runs
              (id, source_file_name, status)
            VALUES
              ('${ids.importRun}', 'legacy.csv', 'completed');
            INSERT INTO ${schema}.act_external_links
              (id, entity_type, entity_id, act_record_id, import_run_id)
            VALUES
              ('${ids.actLink}', 'contact', '${ids.contact}',
               'ACT-CONTACT-1', '${ids.importRun}'),
              ('${ids.singleLink}', 'contact', '${ids.singleLinkContact}',
               'ACT-CONTACT-SINGLE', NULL),
              ('${ids.reviewLinkOne}', 'contact', '${ids.reviewContact}',
               'ACT-CONTACT-REVIEW-1', NULL),
              ('${ids.reviewLinkTwo}', 'contact', '${ids.reviewContact}',
               'ACT-CONTACT-REVIEW-2', NULL);
            INSERT INTO ${schema}.activities (
              id, organization_id, contact_id, booking_id, kind, body,
              occurred_at
            ) VALUES (
              '${ids.activity}', '${ids.organization}', '${ids.contact}',
              '${ids.booking}', 'note', 'Preserve history.', now()
            );
            INSERT INTO ${schema}.call_sessions (
              id, organization_id, contact_id, booking_id, disposition,
              started_at
            ) VALUES (
              '${ids.call}', '${ids.organization}', '${ids.contact}',
              '${ids.booking}', 'no_answer', now()
            );
            INSERT INTO ${schema}.package_templates (
              id, code, name, base_attraction_count
            ) VALUES (
              '${ids.package}', 'LEGACY', 'Legacy Package', 1
            );
          `);

          const [before] = await transaction.unsafe(`
            SELECT
              (SELECT array_agg(id ORDER BY id) FROM ${schema}.organizations)
                AS organizations,
              (SELECT array_agg(id ORDER BY id) FROM ${schema}.contacts)
                AS contacts,
              (SELECT array_agg(id ORDER BY id) FROM ${schema}.bookings)
                AS bookings,
              (SELECT array_agg(
                organization_id::text || ':' || contact_id::text || ':' ||
                is_primary::text || ':' || active::text || ':' || source
                ORDER BY organization_id, contact_id
              ) FROM ${schema}.organization_contacts)
                AS organization_relationships,
              (SELECT array_agg(
                booking_id::text || ':' || contact_id::text || ':' ||
                is_primary::text || ':' || source
                ORDER BY booking_id, contact_id
              ) FROM ${schema}.booking_contacts)
                AS booking_relationships,
              (SELECT array_agg(id ORDER BY id) FROM ${schema}.activities)
                AS activities,
              (SELECT array_agg(id ORDER BY id) FROM ${schema}.call_sessions)
                AS calls,
              (SELECT array_agg(id ORDER BY id) FROM ${schema}.package_templates)
                AS packages
          `);

          for (const statement of await migrationStatements(
            "0009_act_migration_staging.sql",
            schemaName,
          )) {
            await transaction.unsafe(statement);
          }

          const links = await transaction.unsafe(`
            SELECT id, source_entity_type, is_primary, sync_mode,
              import_run_id, migration_run_id
            FROM ${schema}.act_external_links
            WHERE id = '${ids.actLink}'
          `);
          expect(links).toEqual([{
            id: ids.actLink,
            source_entity_type: "contact",
            is_primary: true,
            sync_mode: "two_way",
            import_run_id: ids.importRun,
            migration_run_id: null,
          }]);
          expect(await transaction.unsafe(`
            SELECT place_type, act_industry, phone, normalized_phone,
              address_1, address_2, city, region, postal_code, website
            FROM ${schema}.organizations
            WHERE id = '${ids.organization}'
          `)).toEqual([{
            place_type: "other",
            act_industry: null,
            phone: null,
            normalized_phone: null,
            address_1: null,
            address_2: null,
            city: null,
            region: null,
            postal_code: null,
            website: null,
          }]);

          expect(await transaction.unsafe(`
            SELECT entity_type, source_entity_type, entity_id, act_record_id,
              is_primary, sync_mode
            FROM ${schema}.act_external_links
            WHERE entity_id IN ('${ids.organization}', '${ids.booking}')
            ORDER BY entity_type
          `)).toEqual([
            {
              entity_type: "booking",
              source_entity_type: "opportunity",
              entity_id: ids.booking,
              act_record_id: "ACT-OPPORTUNITY-1",
              is_primary: true,
              sync_mode: "pull_only",
            },
            {
              entity_type: "organization",
              source_entity_type: "company",
              entity_id: ids.organization,
              act_record_id: "ACT-COMPANY-1",
              is_primary: true,
              sync_mode: "pull_only",
            },
          ]);
          expect(await transaction.unsafe(`
            SELECT c.id, c.act_record_id, l.is_primary, l.sync_mode
            FROM ${schema}.contacts c
            JOIN ${schema}.act_external_links l ON l.entity_id = c.id
            WHERE c.id = '${ids.singleLinkContact}'
          `)).toEqual([{
            id: ids.singleLinkContact,
            act_record_id: "ACT-CONTACT-SINGLE",
            is_primary: true,
            sync_mode: "two_way",
          }]);
          expect(await transaction.unsafe(`
            SELECT c.act_record_id, l.is_primary, l.sync_mode
            FROM ${schema}.contacts c
            JOIN ${schema}.act_external_links l ON l.entity_id = c.id
            WHERE c.id = '${ids.reviewContact}'
            ORDER BY l.act_record_id
          `)).toEqual([
            { act_record_id: null, is_primary: false, sync_mode: "pull_only" },
            { act_record_id: null, is_primary: false, sync_mode: "pull_only" },
          ]);

          await transaction.unsafe(`
            INSERT INTO ${schema}.act_migration_runs (
              id, request_key, source_database_key, requested_by
            ) VALUES (
              '${ids.run}', '14141414-1414-4414-8414-141414141414',
              'source-db', 'migration-test'
            );
            INSERT INTO ${schema}.act_migration_records (
              id, run_id, stream_type, source_key, source_id,
              raw_snapshot, normalized_snapshot, fingerprint
            ) VALUES (
              '${ids.record}', '${ids.run}', 'contact', 'contact:one', 'one',
              '{}', '{}', 'fingerprint'
            );
            INSERT INTO ${schema}.act_migration_records (
              run_id, stream_type, source_key, source_id,
              raw_snapshot, normalized_snapshot, fingerprint,
              proposed_action, error_code, error_fields
            ) VALUES (
              '${ids.run}', 'contact', 'error:contact:deterministic', NULL,
              '{}', '{}', 'error-fingerprint', 'error',
              'invalid_source_record', '["id"]'
            );
            INSERT INTO ${schema}.act_external_links (
              id, entity_type, source_entity_type, entity_id, act_record_id,
              is_primary, sync_mode
            ) VALUES (
              '${ids.alias}', 'contact', 'contact', '${ids.contact}',
              'ACT-CONTACT-ALIAS', false, 'pull_only'
            );
            DO $$
            BEGIN
              BEGIN
                INSERT INTO ${schema}.act_migration_records (
                  run_id, stream_type, source_key, source_id,
                  raw_snapshot, normalized_snapshot, fingerprint
                ) VALUES (
                  '${ids.run}', 'contact', 'contact:one', 'duplicate',
                  '{}', '{}', 'duplicate'
                );
                RAISE EXCEPTION 'duplicate staging record was accepted';
              EXCEPTION WHEN unique_violation THEN
                NULL;
              END;
              BEGIN
                INSERT INTO ${schema}.act_external_links (
                  entity_type, source_entity_type, entity_id, act_record_id,
                  is_primary, sync_mode
                ) VALUES (
                  'contact', 'contact', '${ids.contact}',
                  'ACT-CONTACT-SECOND-PRIMARY', true, 'two_way'
                );
                RAISE EXCEPTION 'second primary Contact link was accepted';
              EXCEPTION WHEN unique_violation THEN
                NULL;
              END;
              BEGIN
                UPDATE ${schema}.act_external_links
                SET sync_mode = 'two_way'
                WHERE id = '${ids.alias}';
                RAISE EXCEPTION 'two-way alias was accepted';
              EXCEPTION WHEN check_violation THEN
                NULL;
              END;
            END
            $$;
          `);
          expect(await transaction.unsafe(`
            SELECT source_key, source_id, proposed_action, error_code
            FROM ${schema}.act_migration_records
            WHERE source_key = 'error:contact:deterministic'
          `)).toEqual([{
            source_key: "error:contact:deterministic",
            source_id: null,
            proposed_action: "error",
            error_code: "invalid_source_record",
          }]);

          const [after] = await transaction.unsafe(`
            SELECT
              (SELECT array_agg(id ORDER BY id) FROM ${schema}.organizations)
                AS organizations,
              (SELECT array_agg(id ORDER BY id) FROM ${schema}.contacts)
                AS contacts,
              (SELECT array_agg(id ORDER BY id) FROM ${schema}.bookings)
                AS bookings,
              (SELECT array_agg(
                organization_id::text || ':' || contact_id::text || ':' ||
                is_primary::text || ':' || active::text || ':' || source
                ORDER BY organization_id, contact_id
              ) FROM ${schema}.organization_contacts)
                AS organization_relationships,
              (SELECT array_agg(
                booking_id::text || ':' || contact_id::text || ':' ||
                is_primary::text || ':' || source
                ORDER BY booking_id, contact_id
              ) FROM ${schema}.booking_contacts)
                AS booking_relationships,
              (SELECT array_agg(id ORDER BY id) FROM ${schema}.activities)
                AS activities,
              (SELECT array_agg(id ORDER BY id) FROM ${schema}.call_sessions)
                AS calls,
              (SELECT array_agg(id ORDER BY id) FROM ${schema}.package_templates)
                AS packages
          `);
          expect(after).toEqual(before);
        });
      } finally {
        await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await sql.end({ timeout: 5 });
      }
    },
  );

  migrationTest("fails closed for an unknown legacy external-link type", async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    const schemaName = testSchemaName();
    const schema = `"${schemaName}"`;
    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}`);
      await expect(sql.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL search_path TO ${schema}, public`);
        await applyMigrationsThrough(transaction, schemaName, 8);
        await transaction.unsafe(`
          INSERT INTO ${schema}.act_external_links (
            entity_type, entity_id, act_record_id
          ) VALUES (
            'unknown', '15151515-1515-4515-8515-151515151515', 'UNKNOWN-1'
          )
        `);
        for (const statement of await migrationStatements(
          "0009_act_migration_staging.sql",
          schemaName,
        )) {
          await transaction.unsafe(statement);
        }
      })).rejects.toThrow("ACT_LINK_UNKNOWN_TYPE");
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end({ timeout: 5 });
    }
  });

  migrationTest("fails closed when a direct Act id belongs to another Contact", async () => {
    const sql = postgres(databaseUrl!, { max: 1 });
    const schemaName = testSchemaName();
    const schema = `"${schemaName}"`;
    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}`);
      await expect(sql.begin(async (transaction) => {
        await transaction.unsafe(`SET LOCAL search_path TO ${schema}, public`);
        await applyMigrationsThrough(transaction, schemaName, 8);
        await transaction.unsafe(`
          INSERT INTO ${schema}.contacts (
            id, first_name, last_name, act_record_id
          ) VALUES
            ('16161616-1616-4616-8616-161616161616',
             'Direct', 'Owner', 'ACT-CONFLICT'),
            ('17171717-1717-4717-8717-171717171717',
             'Link', 'Owner', NULL);
          INSERT INTO ${schema}.act_external_links (
            entity_type, entity_id, act_record_id
          ) VALUES (
            'contact', '17171717-1717-4717-8717-171717171717',
            'ACT-CONFLICT'
          )
        `);
        for (const statement of await migrationStatements(
          "0009_act_migration_staging.sql",
          schemaName,
        )) {
          await transaction.unsafe(statement);
        }
      })).rejects.toThrow("ACT_LINK_OWNER_CONFLICT");
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end({ timeout: 5 });
    }
  });
});
