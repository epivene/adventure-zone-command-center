import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ||=
    "postgres://postgres:postgres@127.0.0.1:5432/test";
});

import { ensureComputerCallingSchemaBeforeListen } from "./computer-calling-required-startup";

function createStartupPool(options?: { failSchema?: boolean }) {
  const queries: string[] = [];
  const release = vi.fn();
  const client = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("pg_try_advisory_lock"))
        return { rows: [{ locked: true }] };
      if (
        options?.failSchema &&
        sql.includes("CREATE TABLE IF NOT EXISTS computer_call_sessions")
      ) {
        throw new Error("schema failed");
      }
      return { rows: [] };
    },
    release,
  };

  return {
    queries,
    release,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}

describe("ensureComputerCallingSchemaBeforeListen", () => {
  it("installs the complete provider-neutral computer calling schema", async () => {
    const { pool, queries, release } = createStartupPool();

    await expect(
      ensureComputerCallingSchemaBeforeListen({ pool }),
    ).resolves.toBe(true);

    const schemaQueries = queries.filter((sql) =>
      sql.includes("CREATE TABLE IF NOT EXISTS computer_call_sessions"),
    );
    expect(schemaQueries).toHaveLength(1);
    expect(schemaQueries[0]).toContain(
      "direction text NOT NULL DEFAULT 'outbound'",
    );
    expect(schemaQueries[0]).toContain(
      "method text NOT NULL DEFAULT 'browser_voip'",
    );
    expect(schemaQueries[0]).toContain(
      "computer_call_sessions_direction_valid",
    );
    expect(schemaQueries[0]).toContain("computer_call_sessions_method_valid");
    expect(schemaQueries[0]).toContain("computer_call_sessions_status_valid");
    expect(schemaQueries[0]).toContain(
      "computer_call_sessions_duration_seconds_nonnegative",
    );
    expect(schemaQueries[0]).toContain("call_sessions_method_valid");
    expect(schemaQueries[0]).toContain("'browser_voip'");
    expect(queries).toEqual([
      expect.stringContaining("pg_try_advisory_lock"),
      "BEGIN",
      expect.stringContaining(
        "CREATE TABLE IF NOT EXISTS computer_call_sessions",
      ),
      "COMMIT",
      expect.stringContaining("pg_advisory_unlock"),
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("can install the schema twice without error", async () => {
    const { pool, queries, release } = createStartupPool();

    await expect(
      ensureComputerCallingSchemaBeforeListen({ pool }),
    ).resolves.toBe(true);
    await expect(
      ensureComputerCallingSchemaBeforeListen({ pool }),
    ).resolves.toBe(true);

    expect(
      queries.filter((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS computer_call_sessions"),
      ),
    ).toHaveLength(2);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("rolls back a failed schema transaction before unlocking and releasing", async () => {
    const { pool, queries, release } = createStartupPool({ failSchema: true });

    await expect(
      ensureComputerCallingSchemaBeforeListen({ pool }),
    ).rejects.toThrow("schema failed");

    expect(queries.at(-2)).toBe("ROLLBACK");
    expect(queries.at(-1)).toContain("pg_advisory_unlock");
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails startup when the schema advisory lock is busy", async () => {
    const release = vi.fn();
    const client = {
      async query(sql: string) {
        if (sql.includes("pg_try_advisory_lock"))
          return { rows: [{ locked: false }] };
        return { rows: [] };
      },
      release,
    };

    await expect(
      ensureComputerCallingSchemaBeforeListen({
        pool: {
          async connect() {
            return client;
          },
        },
      }),
    ).rejects.toThrow("COMPUTER_CALLING_SCHEMA_LOCK_BUSY");
    expect(release).toHaveBeenCalledOnce();
  });
});
