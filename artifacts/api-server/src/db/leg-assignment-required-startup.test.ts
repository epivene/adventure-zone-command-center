import { describe, expect, it, vi } from "vitest";

import { ensureLegAssignmentSchemaBeforeListen } from "./leg-assignment-required-startup";

describe("ensureLegAssignmentSchemaBeforeListen", () => {
  it("creates the operational-window schema before the API starts", async () => {
    const queries: string[] = [];
    const release = vi.fn();
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
        return { rows: [] };
      },
      release,
    };

    await expect(
      ensureLegAssignmentSchemaBeforeListen({
        pool: { async connect() { return client; } },
      }),
    ).resolves.toBe(true);

    expect(queries.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS booking_operational_windows"))).toBe(true);
    expect(queries.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS booking_leg_assignments"))).toBe(true);
    expect(queries.some((sql) => sql.includes("INSERT INTO booking_operational_windows"))).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails startup instead of serving without the required schema when the lock is busy", async () => {
    const release = vi.fn();
    const client = {
      async query(sql: string) {
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: false }] };
        return { rows: [] };
      },
      release,
    };

    await expect(
      ensureLegAssignmentSchemaBeforeListen({
        pool: { async connect() { return client; } },
      }),
    ).rejects.toThrow("LEG_ASSIGNMENT_SCHEMA_LOCK_BUSY");
    expect(release).toHaveBeenCalledOnce();
  });
});
