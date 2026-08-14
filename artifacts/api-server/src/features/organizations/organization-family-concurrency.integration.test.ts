import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { describe, expect, it } from "vitest";

import {
  lockOrganizationFamilyMutationSnapshot,
  lockOrganizationHierarchyMutationDomain,
} from "./organization-family-lock";
import { lockOrganizationFamilyReviewDomain } from "./organization-repository";

const { Pool } = pg;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe.sequential("organization family database serialization", () => {
  it.skipIf(!process.env.TEST_DATABASE_URL)(
    "includes a concurrent third location that began before the authoritative snapshot",
    async () => {
      const pool = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        max: 4,
      });
      const database = drizzle(pool);
      const firstId = crypto.randomUUID();
      const secondId = crypto.randomUUID();
      const thirdId = crypto.randomUUID();
      const insertReady = deferred();
      const releaseInsert = deferred();

      await pool.query(
        `insert into organizations (id, name, website, city, region)
         values ($1, 'Lantern Festival Austin', 'https://lantern.test', 'Austin', 'TX'),
                ($2, 'Lantern Festival Denver', 'https://lantern.test', 'Denver', 'CO')`,
        [firstId, secondId],
      );

      try {
        const inserting = database.transaction(async (transaction) => {
          await transaction.execute(sql`
            insert into organizations (id, name, website, city, region)
            values (${thirdId}, 'Lantern Festival Fargo', 'https://lantern.test', 'Fargo', 'ND')
          `);
          insertReady.resolve();
          await releaseInsert.promise;
        });
        await insertReady.promise;

        let snapshotLocked = false;
        const snapshot = database.transaction(async (transaction) => {
          await lockOrganizationFamilyMutationSnapshot(transaction as never);
          snapshotLocked = true;
          const result = await transaction.execute<{ id: string }>(sql`
            select id from organizations
            where id in (${firstId}, ${secondId}, ${thirdId})
            order by id
          `);
          return result.rows.map((row) => row.id);
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(snapshotLocked).toBe(false);

        releaseInsert.resolve();
        await inserting;
        await expect(snapshot).resolves.toEqual(
          [firstId, secondId, thirdId].sort(),
        );
      } finally {
        releaseInsert.resolve();
        await pool.query(
          `delete from organization_family_reviews
           where candidate_ids ?| array[$1, $2, $3]`,
          [firstId, secondId, thirdId],
        );
        await pool.query(
          `delete from organizations where id = any($1::uuid[])`,
          [[firstId, secondId, thirdId]],
        );
        await pool.end();
      }
    },
    20_000,
  );

  it.skipIf(!process.env.TEST_DATABASE_URL)(
    "prevents hierarchy and family flows from inverting row and table locks",
    async () => {
      const pool = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        max: 4,
      });
      const database = drizzle(pool);
      const organizationId = crypto.randomUUID();
      const hierarchyLocked = deferred();
      const releaseHierarchy = deferred();

      await pool.query(
        "insert into organizations (id, name) values ($1, 'Lock order test')",
        [organizationId],
      );

      try {
        const hierarchy = database.transaction(async (transaction) => {
          await lockOrganizationHierarchyMutationDomain(transaction as never);
          await transaction.execute(sql`
            select id from organizations where id = ${organizationId} for update
          `);
          hierarchyLocked.resolve();
          await releaseHierarchy.promise;
        });
        await hierarchyLocked.promise;

        let familyLocked = false;
        const family = database.transaction(async (transaction) => {
          await lockOrganizationFamilyMutationSnapshot(transaction as never);
          familyLocked = true;
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(familyLocked).toBe(false);

        releaseHierarchy.resolve();
        await expect(Promise.all([hierarchy, family])).resolves.toEqual([
          undefined,
          undefined,
        ]);
      } finally {
        releaseHierarchy.resolve();
        await pool.query("delete from organizations where id = $1", [
          organizationId,
        ]);
        await pool.end();
      }
    },
    20_000,
  );

  it.skipIf(!process.env.TEST_DATABASE_URL)(
    "holds ACT relationship evidence stable until the family decision commits",
    async () => {
      const pool = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        max: 4,
      });
      const database = drizzle(pool);
      const snapshotLocked = deferred();
      const releaseSnapshot = deferred();

      try {
        const family = database.transaction(async (transaction) => {
          await lockOrganizationFamilyMutationSnapshot(transaction as never);
          snapshotLocked.resolve();
          await releaseSnapshot.promise;
        });
        await snapshotLocked.promise;

        let evidenceMutationLocked = false;
        const evidenceMutation = database.transaction(async (transaction) => {
          await transaction.execute(
            sql`lock table act_migration_records in row exclusive mode`,
          );
          evidenceMutationLocked = true;
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(evidenceMutationLocked).toBe(false);

        releaseSnapshot.resolve();
        await expect(Promise.all([family, evidenceMutation])).resolves.toEqual([
          undefined,
          undefined,
        ]);
      } finally {
        releaseSnapshot.resolve();
        await pool.end();
      }
    },
    20_000,
  );

  it.skipIf(!process.env.TEST_DATABASE_URL)(
    "blocks the losing flow and makes it observe the committed winner",
    async () => {
      const pool = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        max: 4,
      });
      const database = drizzle(pool);
      const tableName = `organization_family_race_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
      const table = sql.identifier(tableName);

      await pool.query(
        `create table ${tableName} (id integer primary key, candidate_exists boolean not null, proposed boolean not null)`,
      );
      await pool.query(
        `insert into ${tableName} (id, candidate_exists, proposed) values (1, true, false)`,
      );

      try {
        const proposalLocked = deferred();
        const releaseProposal = deferred();
        const proposal = database.transaction(async (transaction) => {
          await lockOrganizationFamilyReviewDomain(transaction as never);
          await transaction.execute(
            sql`update ${table} set proposed = true where id = 1`,
          );
          proposalLocked.resolve();
          await releaseProposal.promise;
        });
        await proposalLocked.promise;

        let mergeAcquired = false;
        const merge = database.transaction(async (transaction) => {
          await lockOrganizationFamilyReviewDomain(transaction as never);
          mergeAcquired = true;
          const result = await transaction.execute<{ proposed: boolean }>(
            sql`select proposed from ${table} where id = 1`,
          );
          return result.rows[0]?.proposed ?? false;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(mergeAcquired).toBe(false);

        releaseProposal.resolve();
        await proposal;
        await expect(merge).resolves.toBe(true);

        await pool.query(
          `update ${tableName} set candidate_exists = true, proposed = false where id = 1`,
        );
        const mergeLocked = deferred();
        const releaseMerge = deferred();
        const mergeFirst = database.transaction(async (transaction) => {
          await lockOrganizationFamilyReviewDomain(transaction as never);
          await transaction.execute(
            sql`update ${table} set candidate_exists = false where id = 1`,
          );
          mergeLocked.resolve();
          await releaseMerge.promise;
        });
        await mergeLocked.promise;

        let persistenceAcquired = false;
        const persistence = database.transaction(async (transaction) => {
          await lockOrganizationFamilyReviewDomain(transaction as never);
          persistenceAcquired = true;
          const result = await transaction.execute<{ candidateExists: boolean }>(
            sql`select candidate_exists as "candidateExists" from ${table} where id = 1`,
          );
          if (result.rows[0]?.candidateExists) {
            await transaction.execute(
              sql`update ${table} set proposed = true where id = 1`,
            );
          }
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(persistenceAcquired).toBe(false);

        releaseMerge.resolve();
        await mergeFirst;
        await persistence;
        const final = await pool.query(
          `select candidate_exists, proposed from ${tableName} where id = 1`,
        );
        expect(final.rows[0]).toEqual({
          candidate_exists: false,
          proposed: false,
        });
      } finally {
        await pool.query(`drop table if exists ${tableName}`);
        await pool.end();
      }
    },
    20_000,
  );

  it.skipIf(!process.env.TEST_DATABASE_URL)(
    "serializes an ACT row-lock-first importer before a family merge without deadlocking",
    async () => {
      const pool = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        max: 4,
      });
      const database = drizzle(pool);
      const organizationId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      const recordId = crypto.randomUUID();
      const importerHasActRow = deferred();
      const releaseImporterForOrganization = deferred();

      await pool.query(
        "insert into organizations (id, name) values ($1, 'ACT importer lock order test')",
        [organizationId],
      );
      await pool.query(
        `insert into act_migration_runs
          (id, request_key, source_database_key, requested_by)
         values ($1, $2, 'lock-order-test', 'vitest')`,
        [runId, `lock-order-${runId}`],
      );
      await pool.query(
        `insert into act_migration_records
          (id, run_id, stream_type, source_key, source_id, raw_snapshot,
           normalized_snapshot, fingerprint, matched_entity_type, matched_entity_id)
         values ($1, $2, 'company', $3, $4, '{}'::jsonb, '{}'::jsonb,
                 $5, 'organization', $6)`,
        [
          recordId,
          runId,
          `company:${recordId}`,
          `act-company-${recordId}`,
          `fingerprint-${recordId}`,
          organizationId,
        ],
      );

      try {
        const importer = database.transaction(async (transaction) => {
          await transaction.execute(sql`
            select id from act_migration_records
            where id = ${recordId}
            for update
          `);
          importerHasActRow.resolve();
          await releaseImporterForOrganization.promise;
          await transaction.execute(sql`
            select id from organizations
            where id = ${organizationId}
            for update
          `);
        });
        await importerHasActRow.promise;

        const familyMerge = database.transaction(async (transaction) => {
          await lockOrganizationFamilyMutationSnapshot(transaction as never);
          await transaction.execute(sql`
            update act_migration_records
            set updated_at = now()
            where id = ${recordId}
          `);
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        releaseImporterForOrganization.resolve();

        const outcomes = await Promise.allSettled([importer, familyMerge]);
        expect(outcomes).toEqual([
          { status: "fulfilled", value: undefined },
          { status: "fulfilled", value: undefined },
        ]);
      } finally {
        releaseImporterForOrganization.resolve();
        await pool.query("delete from act_migration_records where id = $1", [
          recordId,
        ]);
        await pool.query("delete from act_migration_runs where id = $1", [runId]);
        await pool.query("delete from organizations where id = $1", [
          organizationId,
        ]);
        await pool.end();
      }
    },
    20_000,
  );

  it.skipIf(!process.env.TEST_DATABASE_URL)(
    "blocks new ACT row lockers when a family snapshot wins the lock race",
    async () => {
      const pool = new Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        max: 4,
      });
      const database = drizzle(pool);
      const organizationId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      const recordId = crypto.randomUUID();
      const familyHasSnapshot = deferred();
      const releaseFamily = deferred();

      await pool.query(
        "insert into organizations (id, name) values ($1, 'Family lock order control')",
        [organizationId],
      );
      await pool.query(
        `insert into act_migration_runs
          (id, request_key, source_database_key, requested_by)
         values ($1, $2, 'lock-order-control', 'vitest')`,
        [runId, `lock-order-control-${runId}`],
      );
      await pool.query(
        `insert into act_migration_records
          (id, run_id, stream_type, source_key, source_id, raw_snapshot,
           normalized_snapshot, fingerprint, matched_entity_type, matched_entity_id)
         values ($1, $2, 'company', $3, $4, '{}'::jsonb, '{}'::jsonb,
                 $5, 'organization', $6)`,
        [
          recordId,
          runId,
          `company:${recordId}`,
          `act-company-${recordId}`,
          `fingerprint-${recordId}`,
          organizationId,
        ],
      );

      try {
        const family = database.transaction(async (transaction) => {
          await lockOrganizationFamilyMutationSnapshot(transaction as never);
          familyHasSnapshot.resolve();
          await releaseFamily.promise;
        });
        await familyHasSnapshot.promise;

        let importerHasActRow = false;
        const importer = database.transaction(async (transaction) => {
          await transaction.execute(sql`
            select id from act_migration_records
            where id = ${recordId}
            for update
          `);
          importerHasActRow = true;
          await transaction.execute(sql`
            select id from organizations
            where id = ${organizationId}
            for update
          `);
        });

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(importerHasActRow).toBe(false);

        releaseFamily.resolve();
        const outcomes = await Promise.allSettled([family, importer]);
        expect(outcomes).toEqual([
          { status: "fulfilled", value: undefined },
          { status: "fulfilled", value: undefined },
        ]);
      } finally {
        releaseFamily.resolve();
        await pool.query("delete from act_migration_records where id = $1", [
          recordId,
        ]);
        await pool.query("delete from act_migration_runs where id = $1", [runId]);
        await pool.query("delete from organizations where id = $1", [
          organizationId,
        ]);
        await pool.end();
      }
    },
    20_000,
  );

});
