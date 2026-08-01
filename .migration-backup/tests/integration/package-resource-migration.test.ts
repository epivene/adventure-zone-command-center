import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

function testSchemaName() {
  return `package_resource_migration_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

const expectedNormalizedChecks = [
  {
    table_name: "booking_resource_assignments",
    constraint_name: "booking_resource_assignments_attribution_source_valid",
    normalized_expression:
      "attribution_source=any(array['inferred'::text,'manual'::text])",
  },
  {
    table_name: "booking_special_requests",
    constraint_name: "booking_special_requests_approval_status_valid",
    normalized_expression:
      "approval_status=any(array['needs_approval'::text,'approved'::text,'declined'::text])",
  },
  {
    table_name: "booking_special_requests",
    constraint_name: "booking_special_requests_description_nonblank",
    normalized_expression:
      "nullif(trim(bothfromdescription),''::text)isnotnull",
  },
  {
    table_name: "booking_special_requests",
    constraint_name: "booking_special_requests_treatment_valid",
    normalized_expression:
      "treatment=any(array['add_to_count'::text,'replace_included'::text,'note_only'::text])",
  },
  {
    table_name: "bookings",
    constraint_name: "bookings_physical_attraction_total_nonnegative",
    normalized_expression:
      "physical_attraction_totalisnullorphysical_attraction_total>=0",
  },
  {
    table_name: "package_templates",
    constraint_name: "package_templates_base_attraction_count_positive",
    normalized_expression: "base_attraction_count>0",
  },
  {
    table_name: "package_templates",
    constraint_name: "package_templates_code_nonblank",
    normalized_expression: "nullif(trim(bothfromcode),''::text)isnotnull",
  },
  {
    table_name: "package_templates",
    constraint_name: "package_templates_name_nonblank",
    normalized_expression: "nullif(trim(bothfromname),''::text)isnotnull",
  },
  {
    table_name: "resource_conflict_overrides",
    constraint_name: "resource_conflict_overrides_acknowledged_by_nonblank",
    normalized_expression:
      "nullif(trim(bothfromacknowledged_by),''::text)isnotnull",
  },
  {
    table_name: "resource_conflict_overrides",
    constraint_name: "resource_conflict_overrides_conflict_key_nonblank",
    normalized_expression:
      "nullif(trim(bothfromconflict_key),''::text)isnotnull",
  },
  {
    table_name: "resource_conflict_overrides",
    constraint_name: "resource_conflict_overrides_reason_nonblank",
    normalized_expression: "nullif(trim(bothfromreason),''::text)isnotnull",
  },
  {
    table_name: "resources",
    constraint_name: "resources_category_nonblank",
    normalized_expression:
      "nullif(trim(bothfromcategory),''::text)isnotnull",
  },
  {
    table_name: "resources",
    constraint_name: "resources_code_nonblank",
    normalized_expression: "nullif(trim(bothfromcode),''::text)isnotnull",
  },
  {
    table_name: "resources",
    constraint_name: "resources_minimum_transfer_minutes_nonnegative",
    normalized_expression: "minimum_transfer_minutes>=0",
  },
  {
    table_name: "resources",
    constraint_name: "resources_name_nonblank",
    normalized_expression: "nullif(trim(bothfromname),''::text)isnotnull",
  },
  {
    table_name: "resources",
    constraint_name: "resources_setup_minutes_nonnegative",
    normalized_expression: "setup_minutes>=0",
  },
  {
    table_name: "resources",
    constraint_name: "resources_status_valid",
    normalized_expression:
      "status=any(array['available'::text,'unavailable'::text,'maintenance'::text,'archived'::text])",
  },
  {
    table_name: "resources",
    constraint_name: "resources_teardown_minutes_nonnegative",
    normalized_expression: "teardown_minutes>=0",
  },
] as const;

describe("package and resource migration", () => {
  const migrationTest = databaseUrl ? it : it.skip;

  migrationTest(
    "preserves legacy booking notes, contacts, and Act! identities without inferring packages",
    async () => {
      const sql = postgres(databaseUrl!, { max: 1 });
      const schemaName = testSchemaName();
      const schema = `"${schemaName}"`;
      const ids = {
        organization: "11111111-1111-4111-8111-111111111111",
        contact: "22222222-2222-4222-8222-222222222222",
        booking: "33333333-3333-4333-8333-333333333333",
        actLink: "44444444-4444-4444-8444-444444444444",
      };

      try {
        await sql.unsafe(`CREATE SCHEMA ${schema}`);
        await sql.begin(async (transaction) => {
          await transaction.unsafe(`SET LOCAL search_path TO ${schema}, public`);

          const journal = JSON.parse(await readFile(
            path.join(migrationDirectory, "meta", "_journal.json"),
            "utf8",
          )) as { entries: { idx: number; tag: string }[] };
          for (const index of [0, 1, 2, 3, 4, 5, 6]) {
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
            VALUES ('${ids.organization}', 'Legacy Fair');
            INSERT INTO ${schema}.contacts (
              id, organization_id, first_name, last_name, phone, act_record_id
            ) VALUES (
              '${ids.contact}', '${ids.organization}', 'Avery', 'Legacy',
              '(406) 555-0101', 'ACT-CONTACT-100'
            );
            INSERT INTO ${schema}.bookings (
              id, organization_id, primary_contact_id, name, city, region,
              act_record_id, notes
            ) VALUES (
              '${ids.booking}', '${ids.organization}', '${ids.contact}',
              'Legacy Weekend Warriors fair', 'Shelby', 'MT',
              'ACT-BOOKING-100',
              'Weekend Warriors with paintball trailer; preserve as notes only.'
            );
            INSERT INTO ${schema}.act_external_links (
              id, entity_type, entity_id, act_record_id
            ) VALUES (
              '${ids.actLink}', 'booking', '${ids.booking}', 'ACT-BOOKING-100'
            );
          `);

          for (const statement of await migrationStatements(
            "0007_packages_resources.sql",
            schemaName,
          )) {
            await transaction.unsafe(statement);
          }

          const [booking] = await transaction.unsafe(`
            SELECT
              id,
              primary_contact_id,
              act_record_id,
              notes,
              physical_attraction_total,
              attraction_total_approval_reason
            FROM ${schema}.bookings
            WHERE id = '${ids.booking}'
          `);
          const [contact] = await transaction.unsafe(`
            SELECT id, organization_id, act_record_id
            FROM ${schema}.contacts
            WHERE id = '${ids.contact}'
          `);
          const [actLink] = await transaction.unsafe(`
            SELECT id, entity_type, entity_id, act_record_id
            FROM ${schema}.act_external_links
            WHERE id = '${ids.actLink}'
          `);
          const [selectionCount] = await transaction.unsafe(`
            SELECT count(*) AS count
            FROM ${schema}.booking_package_selections
            WHERE booking_id = '${ids.booking}'
          `);
          const lookupIndexes = await transaction.unsafe(`
            SELECT
              index_relation.relname AS name,
              index_catalog.indisunique AS is_unique,
              array_agg(attribute.attname ORDER BY key.ordinality) AS columns
            FROM pg_catalog.pg_index AS index_catalog
            JOIN pg_catalog.pg_class AS table_relation
              ON table_relation.oid = index_catalog.indrelid
            JOIN pg_catalog.pg_namespace AS namespace
              ON namespace.oid = table_relation.relnamespace
            JOIN pg_catalog.pg_class AS index_relation
              ON index_relation.oid = index_catalog.indexrelid
            CROSS JOIN LATERAL unnest(index_catalog.indkey)
              WITH ORDINALITY AS key(attribute_number, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = table_relation.oid
              AND attribute.attnum = key.attribute_number
            WHERE namespace.nspname = '${schemaName}'
              AND index_relation.relname IN (
                'booking_resource_assignments_resource_id_idx',
                'booking_special_requests_booking_status_treatment_idx'
              )
            GROUP BY index_relation.relname, index_catalog.indisunique
            ORDER BY index_relation.relname
          `);

          expect(booking).toEqual({
            id: ids.booking,
            primary_contact_id: ids.contact,
            act_record_id: "ACT-BOOKING-100",
            notes:
              "Weekend Warriors with paintball trailer; preserve as notes only.",
            physical_attraction_total: null,
            attraction_total_approval_reason: null,
          });
          expect(contact).toEqual({
            id: ids.contact,
            organization_id: ids.organization,
            act_record_id: "ACT-CONTACT-100",
          });
          expect(actLink).toEqual({
            id: ids.actLink,
            entity_type: "booking",
            entity_id: ids.booking,
            act_record_id: "ACT-BOOKING-100",
          });
          expect(selectionCount).toEqual({ count: "0" });
          expect(lookupIndexes).toEqual([
            {
              name: "booking_resource_assignments_resource_id_idx",
              is_unique: false,
              columns: ["resource_id"],
            },
            {
              name: "booking_special_requests_booking_status_treatment_idx",
              is_unique: false,
              columns: ["booking_id", "approval_status", "treatment"],
            },
          ]);
        });
      } finally {
        await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await sql.end({ timeout: 5 });
      }
    },
  );

  migrationTest(
    "catalog validation rejects index, check, and column drift in an applied 0007 schema",
    async () => {
      const sql = postgres(databaseUrl!, { max: 1 });
      const schemaName = testSchemaName();
      const schema = `"${schemaName}"`;

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

          const matchingResourceLookupIndexes = async () => {
            const [row] = await transaction.unsafe(`
              SELECT count(*) AS count
              FROM pg_catalog.pg_index
              INNER JOIN pg_catalog.pg_class AS index_relation
                ON index_relation.oid = pg_index.indexrelid
              INNER JOIN pg_catalog.pg_class AS table_relation
                ON table_relation.oid = pg_index.indrelid
              INNER JOIN pg_catalog.pg_namespace AS table_namespace
                ON table_namespace.oid = table_relation.relnamespace
              INNER JOIN pg_catalog.pg_am
                ON pg_am.oid = index_relation.relam
              WHERE table_namespace.nspname = '${schemaName}'
                AND table_relation.relname = 'booking_resource_assignments'
                AND index_relation.relname =
                  'booking_resource_assignments_resource_id_idx'
                AND NOT pg_index.indisunique
                AND pg_index.indisvalid
                AND pg_index.indisready
                AND pg_index.indpred IS NULL
                AND pg_index.indexprs IS NULL
                AND pg_am.amname = 'btree'
                AND (
                  SELECT array_agg(
                    attribute.attname::text
                    ORDER BY key.ordinality
                  )
                  FROM unnest(pg_index.indkey)
                    WITH ORDINALITY AS key(attribute_number, ordinality)
                  INNER JOIN pg_catalog.pg_attribute AS attribute
                    ON attribute.attrelid = pg_index.indrelid
                    AND attribute.attnum = key.attribute_number
                  WHERE key.ordinality <= pg_index.indnkeyatts
                ) = ARRAY['resource_id'];
            `);
            if (!row) throw new Error("Index catalog count returned no row.");
            return row.count;
          };

          expect(await matchingResourceLookupIndexes()).toBe("1");

          await transaction.unsafe(`
            DROP INDEX ${schema}.booking_resource_assignments_resource_id_idx;
            CREATE INDEX booking_resource_assignments_resource_id_idx
            ON ${schema}.booking_resource_assignments USING btree (resource_id)
            WHERE resource_id IS NOT NULL;
          `);
          expect(await matchingResourceLookupIndexes()).toBe("0");

          await transaction.unsafe(`
            DROP INDEX ${schema}.booking_resource_assignments_resource_id_idx;
            CREATE INDEX booking_resource_assignments_resource_id_idx
            ON ${schema}.booking_resource_assignments USING btree (
              lower(resource_id::text),
              resource_id
            );
          `);
          expect(await matchingResourceLookupIndexes()).toBe("0");

          await transaction.unsafe(`
            DROP INDEX ${schema}.booking_resource_assignments_resource_id_idx;
            CREATE INDEX booking_resource_assignments_resource_id_idx
            ON ${schema}.booking_resource_assignments USING hash (resource_id);
          `);
          expect(await matchingResourceLookupIndexes()).toBe("0");

          const checkNames = expectedNormalizedChecks
            .map(({ constraint_name }) => `'${constraint_name}'`)
            .join(", ");
          const checkDefinitions = await transaction.unsafe(`
            SELECT
              pg_class.relname AS table_name,
              pg_constraint.conname::text AS constraint_name,
              regexp_replace(
                lower(pg_get_expr(
                  pg_constraint.conbin,
                  pg_constraint.conrelid,
                  true
                )),
                '[[:space:]"]',
                '',
                'g'
              ) AS normalized_expression
            FROM pg_catalog.pg_constraint
            INNER JOIN pg_catalog.pg_class
              ON pg_class.oid = pg_constraint.conrelid
            INNER JOIN pg_catalog.pg_namespace
              ON pg_namespace.oid = pg_class.relnamespace
            WHERE pg_namespace.nspname = '${schemaName}'
              AND pg_constraint.contype = 'c'
              AND pg_constraint.convalidated
              AND pg_constraint.conname::text IN (${checkNames})
            ORDER BY pg_class.relname, pg_constraint.conname::text;
          `);
          expect(checkDefinitions).toEqual(expectedNormalizedChecks);

          await transaction.unsafe(`
            ALTER TABLE ${schema}.resources
              DROP CONSTRAINT resources_setup_minutes_nonnegative;
            ALTER TABLE ${schema}.resources
              ADD CONSTRAINT resources_setup_minutes_nonnegative
              CHECK (setup_minutes >= 0 OR true);
          `);
          const [weakenedCheck] = await transaction.unsafe(`
            SELECT regexp_replace(
              lower(pg_get_expr(
                pg_constraint.conbin,
                pg_constraint.conrelid,
                true
              )),
              '[[:space:]"]',
              '',
              'g'
            ) AS normalized_expression
            FROM pg_catalog.pg_constraint
            INNER JOIN pg_catalog.pg_class
              ON pg_class.oid = pg_constraint.conrelid
            INNER JOIN pg_catalog.pg_namespace
              ON pg_namespace.oid = pg_class.relnamespace
            WHERE pg_namespace.nspname = '${schemaName}'
              AND pg_class.relname = 'resources'
              AND pg_constraint.conname =
                'resources_setup_minutes_nonnegative';
          `);
          if (!weakenedCheck) {
            throw new Error("Weakened check catalog query returned no row.");
          }
          expect(weakenedCheck.normalized_expression).not.toBe(
            "setup_minutes>=0",
          );

          const matchingDecisionReasonColumns = async () => {
            const [row] = await transaction.unsafe(`
              SELECT count(*) AS count
              FROM information_schema.columns
              WHERE table_schema = '${schemaName}'
                AND table_name = 'booking_special_requests'
                AND column_name = 'decision_reason'
                AND data_type = 'text'
                AND is_nullable = 'YES'
                AND column_default IS NULL;
            `);
            if (!row) throw new Error("Column catalog count returned no row.");
            return row.count;
          };

          expect(await matchingDecisionReasonColumns()).toBe("1");
          await transaction.unsafe(`
            ALTER TABLE ${schema}.booking_special_requests
            DROP COLUMN decision_reason;
          `);
          expect(await matchingDecisionReasonColumns()).toBe("0");
        });
      } finally {
        await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await sql.end({ timeout: 5 });
      }
    },
  );
});
