import { describe, expect, it, vi } from "vitest";

import { runActReviewMigrationsAtStartup } from "./act-review-startup";

function lockTimeoutError() {
  return Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
}

describe("runActReviewMigrationsAtStartup lock contention", () => {
  it("defers migrations and continues startup when Postgres reports lock timeout", async () => {
    const queries: string[] = [];
    let released = false;
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
        if (sql === "SET lock_timeout = '5s'" || sql === "SET statement_timeout = '20s'") return { rows: [] };
        if (sql.startsWith("RESET ") || sql.includes("pg_advisory_unlock")) return { rows: [] };
        throw lockTimeoutError();
      },
      release() { released = true; },
    };
    const onLockTimeout = vi.fn();

    await expect(runActReviewMigrationsAtStartup({
      pool: { connect: async () => client },
      runMigrations: vi.fn(async () => []),
      onLockTimeout,
    })).resolves.toEqual([]);

    expect(onLockTimeout).toHaveBeenCalledTimes(1);
    expect(queries).toContain("RESET statement_timeout");
    expect(queries).toContain("RESET lock_timeout");
    expect(queries.at(-1)).toContain("pg_advisory_unlock");
    expect(released).toBe(true);
  });

  it("still fails startup for non-lock migration errors", async () => {
    const client = {
      async query(sql: string) {
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
        if (sql === "SET lock_timeout = '5s'" || sql === "SET statement_timeout = '20s'") return { rows: [] };
        if (sql.startsWith("RESET ") || sql.includes("pg_advisory_unlock")) return { rows: [] };
        throw Object.assign(new Error("bad migration"), { code: "42601" });
      },
      release() {},
    };

    await expect(runActReviewMigrationsAtStartup({
      pool: { connect: async () => client },
      runMigrations: vi.fn(async () => []),
    })).rejects.toThrow("bad migration");
  });
});
