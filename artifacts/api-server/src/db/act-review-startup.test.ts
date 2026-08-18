import { describe, expect, it, vi } from "vitest";

import { runActReviewMigrationsAtStartup } from "./act-review-startup";

function fakeClient(options?: { locked?: boolean }) {
  const queries: string[] = [];
  let released = false;
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("pg_try_advisory_lock")) {
        return { rows: [{ locked: options?.locked ?? true }] };
      }
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  return { client, queries, wasReleased: () => released };
}

describe("runActReviewMigrationsAtStartup", () => {
  it("pre-acquires the migration lock without waiting and reuses that client", async () => {
    const { client, queries, wasReleased } = fakeClient();
    const runMigrations = vi.fn(async (options: any) => {
      const migrationClient = await options.pool.connect();
      await migrationClient.query(
        "SELECT pg_advisory_lock(hashtext('adventure-zone:act-review-migrations'))",
      );
      migrationClient.release();
      return ["043_act_archive_full_recovery.sql"];
    });

    const applied = await runActReviewMigrationsAtStartup({
      pool: { connect: async () => client },
      runMigrations,
    });

    expect(applied).toEqual(["043_act_archive_full_recovery.sql"]);
    expect(queries[0]).toContain("pg_try_advisory_lock");
    expect(queries).toContain("SET lock_timeout = '5s'");
    expect(queries).toContain("SET statement_timeout = '20s'");
    expect(queries).toContain(
      "SELECT pg_advisory_lock(hashtext('adventure-zone:act-review-migrations'))",
    );
    expect(queries).toContain("RESET statement_timeout");
    expect(queries).toContain("RESET lock_timeout");
    expect(queries.at(-1)).toContain("pg_advisory_unlock");
    expect(wasReleased()).toBe(true);
  });

  it("does not block startup when another process owns the migration lock", async () => {
    const { client, queries, wasReleased } = fakeClient({ locked: false });
    const runMigrations = vi.fn(async () => ["unexpected.sql"]);
    const onLockUnavailable = vi.fn();

    const applied = await runActReviewMigrationsAtStartup({
      pool: { connect: async () => client },
      runMigrations,
      onLockUnavailable,
    });

    expect(applied).toEqual([]);
    expect(runMigrations).not.toHaveBeenCalled();
    expect(onLockUnavailable).toHaveBeenCalledTimes(1);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("pg_try_advisory_lock");
    expect(wasReleased()).toBe(true);
  });

  it("releases the pre-acquired lock when the migration runner fails", async () => {
    const { client, queries, wasReleased } = fakeClient();

    await expect(
      runActReviewMigrationsAtStartup({
        pool: { connect: async () => client },
        runMigrations: async () => {
          throw new Error("migration failed");
        },
      }),
    ).rejects.toThrow("migration failed");

    expect(queries).toContain("RESET statement_timeout");
    expect(queries).toContain("RESET lock_timeout");
    expect(queries.at(-1)).toContain("pg_advisory_unlock");
    expect(wasReleased()).toBe(true);
  });
});
