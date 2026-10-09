import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { loadActReviewMigrations, runActReviewMigrations } from "@workspace/db/migrations";

// Use real PostgreSQL catalogs and the shipped repair SQL, not mocked readiness
// responses. These fixtures are in-memory only; no archive/apply runner is used.
const fixtureSql = `
  CREATE TABLE act_source_records (
    id uuid PRIMARY KEY, source_database_key text NOT NULL, stream_type text NOT NULL,
    UNIQUE (id, source_database_key), UNIQUE (id, source_database_key, stream_type)
  );
  CREATE TABLE act_source_record_versions (
    id uuid PRIMARY KEY, source_record_id uuid NOT NULL, payload jsonb NOT NULL,
    UNIQUE (id, source_record_id)
  );
  CREATE TABLE act_archive_profile_import_jobs (
    id uuid PRIMARY KEY, source_database_key text NOT NULL,
    membership_snapshot_version integer, phase text NOT NULL, processed_count integer NOT NULL
  );
  CREATE TABLE act_archive_profile_import_results (
    job_id uuid NOT NULL, source_record_id uuid NOT NULL, source_version_id uuid NOT NULL
  );
  CREATE TABLE act_archive_profile_import_sources (
    job_id uuid NOT NULL, source_database_key text NOT NULL, source_record_id uuid NOT NULL,
    source_version_id uuid NOT NULL, phase text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE act_external_links (
    entity_type text NOT NULL, source_entity_type text NOT NULL,
    source_database_key text, source_record_id uuid, is_primary boolean NOT NULL, sync_mode text NOT NULL
  );
  INSERT INTO act_source_records VALUES
    ('11111111-1111-4111-8111-111111111111', 'fixture-archive', 'company');
  INSERT INTO act_source_record_versions VALUES
    ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111',
     '{"originalArchive":true}');
  INSERT INTO act_archive_profile_import_jobs VALUES
    ('33333333-3333-4333-8333-333333333333', 'fixture-archive', 2, 'complete', 1);
  INSERT INTO act_archive_profile_import_results VALUES
    ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111',
     '22222222-2222-4222-8222-222222222222');
  INSERT INTO act_archive_profile_import_sources VALUES
    ('33333333-3333-4333-8333-333333333333', 'fixture-archive',
     '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
     'companies', '2026-01-01T00:00:00Z');
  INSERT INTO act_external_links VALUES
    ('organization', 'company', 'fixture-archive',
     '11111111-1111-4111-8111-111111111111', true, 'pull_only');
`;

async function dataSnapshot(db: PGlite) {
  const tables = [
    "act_source_records", "act_source_record_versions", "act_archive_profile_import_jobs",
    "act_archive_profile_import_results", "act_archive_profile_import_sources", "act_external_links",
  ];
  return Promise.all(tables.map(async (table) =>
    (await db.query(`SELECT to_jsonb(row) AS data FROM ${table} row ORDER BY to_jsonb(row)::text`)).rows,
  ));
}

describe("ACT archive membership startup readiness", () => {
  it("does not mistake automatic audit setup for either completed directory import", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE TABLE organizations (
          id uuid PRIMARY KEY, name text, phone text, website text, consolidated_into_id uuid
        );
        CREATE TABLE contacts (id uuid PRIMARY KEY, first_name text, last_name text, email text);
        CREATE TABLE convention_editions (year integer, archived_at timestamptz, convention text);
      `);
      const names = [
        "20261009_directory_import_audit_schema.sql",
        "20260910_public_directory_leads.sql",
        "20260910_rmaf_online_directory.sql",
      ];
      const migrations = (await loadActReviewMigrations()).filter(({ name }) => names.includes(name));
      const attempts: string[] = [];
      const pool = {
        connect: async () => ({
          async query(sql: string) {
            const migration = migrations.find((item) => item.sql === sql);
            if (migration) {
              attempts.push(migration.name);
              await db.exec(sql);
              return { rows: [] };
            }
            return db.query<Record<string, unknown>>(sql);
          },
          release() {},
        }),
      };
      expect(await runActReviewMigrations({ pool, migrations, automatic: true })).toEqual([names[0]]);
      expect(attempts).toEqual([names[0]]);
      expect(await runActReviewMigrations({ pool, migrations, automatic: true })).toEqual([]);

      for (const name of names.slice(1)) {
        const migration = migrations.find((item) => item.name === name)!;
        expect((await db.query<{ ready: boolean }>(migration.markerSql)).rows).toEqual([{ ready: false }]);
        // Execute the real import SQL after automatic setup on the SAME DB.
        // The original prerequisite guard must still stop this explicit run.
        await expect(runActReviewMigrations({ pool, migrations: [migration] })).rejects.toThrow(
          "Expected the five existing 2026 convention editions",
        );
      }
      expect(attempts).toEqual(names);
      for (const table of ["organizations", "contacts", "directory_import_records", "directory_import_20260910_batch"]) {
        expect((await db.query(`SELECT * FROM ${table}`)).rows).toEqual([]);
      }
    } finally {
      await db.close();
    }
  }, 20_000);

  it("accepts the shipped two-column source scope, preserves data, and skips repeat repairs", async () => {
    const db = new PGlite();
    try {
      await db.exec(fixtureSql);
      const migration = (await loadActReviewMigrations()).find(
        ({ name }) => name === "023a_act_archive_profile_import_membership.sql",
      )!;
      const before = await dataSnapshot(db);
      let repairs = 0;
      const pool = {
        connect: async () => ({
          async query(sql: string) {
            if (sql === migration.sql) {
              repairs++;
              await db.exec(sql);
              return { rows: [] };
            }
            return db.query<Record<string, unknown>>(sql);
          },
          release() {},
        }),
      };
      const run = () => runActReviewMigrations({ pool, migrations: [migration] });
      const ready = async () => (await db.query<{ ready: boolean }>(migration.markerSql)).rows[0]!.ready;

      expect(await ready()).toBe(false);
      expect(await run()).toEqual([migration.name]);
      expect(await ready()).toBe(true);
      expect(await dataSnapshot(db)).toEqual(before);
      expect(await run()).toEqual([]);
      expect(repairs).toBe(1);

      // Prove the actual scope definitions differ as intended: membership is
      // two-column, while profile links also bind the source entity's type.
      const definitions = await db.query<{ conname: string; definition: string }>(`
        SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname IN ('act_archive_profile_import_sources_source_database_fk',
                         'act_external_links_archive_source_scope_fk')
        ORDER BY conname
      `);
      expect(definitions.rows).toEqual([
        {
          conname: "act_archive_profile_import_sources_source_database_fk",
          definition: "FOREIGN KEY (source_record_id, source_database_key) REFERENCES act_source_records(id, source_database_key)",
        },
        {
          conname: "act_external_links_archive_source_scope_fk",
          definition: "FOREIGN KEY (source_record_id, source_database_key, source_entity_type) REFERENCES act_source_records(id, source_database_key, stream_type)",
        },
      ]);

      // Real drift must still trigger repair rather than merely passing because
      // a constraint with the expected name exists.
      await db.exec(`
        ALTER TABLE act_archive_profile_import_sources
          DROP CONSTRAINT act_archive_profile_import_sources_source_database_fk;
      `);
      expect(await ready()).toBe(false);
      expect(await run()).toEqual([migration.name]);
      expect(await ready()).toBe(true);
      expect(await run()).toEqual([]);
      expect(await dataSnapshot(db)).toEqual(before);

      await db.exec(`
        ALTER TABLE act_archive_profile_import_sources
          DROP CONSTRAINT act_archive_profile_import_sources_phase_valid,
          ADD CONSTRAINT act_archive_profile_import_sources_phase_valid
            CHECK (phase IN ('companies', 'contacts', 'unknown'));
      `);
      expect(await ready()).toBe(false);
      expect(await run()).toEqual([migration.name]);
      expect(await run()).toEqual([]);
      expect(await dataSnapshot(db)).toEqual(before);
      expect(repairs).toBe(3);

      // Direct SQL replay must also preserve frozen membership and archive data.
      await db.exec(migration.sql);
      expect(await ready()).toBe(true);
      expect(await dataSnapshot(db)).toEqual(before);
    } finally {
      await db.close();
    }
  }, 20_000);
});
