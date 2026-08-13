import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { describe, expect, it } from "vitest";

import { lockOrganizationFamilyReviewDomain } from "./organization-repository";

const { Pool } = pg;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("organization family database serialization", () => {
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
});
