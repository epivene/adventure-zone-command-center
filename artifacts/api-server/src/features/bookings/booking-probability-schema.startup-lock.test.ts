import { describe, expect, it } from "vitest";

import { ensureBookingProbabilitySchema } from "./booking-probability-schema";

describe("ensureBookingProbabilitySchema startup locking", () => {
  it("returns without an advisory lock or writes when the schema is already healthy", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("to_regtype('probability')")) {
          return { rows: [{ ready: true, hasDefinite: true, hasTrigger: true }] };
        }
        return { rows: [] };
      },
      release() {},
    };

    await ensureBookingProbabilitySchema({ connect: async () => client } as never);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("to_regtype('probability')");
    expect(queries.some((sql) => sql.includes("pg_advisory"))).toBe(false);
    expect(queries.some((sql) => sql.includes("UPDATE bookings"))).toBe(false);
  });

  it("uses a non-blocking repair lock and database lock timeout", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("to_regtype('probability')")) {
          return { rows: [{ ready: true, hasDefinite: true, hasTrigger: false }] };
        }
        if (sql.includes("pg_try_advisory_lock")) {
          return { rows: [{ locked: true }] };
        }
        return { rows: [] };
      },
      release() {},
    };

    await ensureBookingProbabilitySchema({ connect: async () => client } as never);

    expect(queries.some((sql) => sql.includes("pg_try_advisory_lock"))).toBe(true);
    expect(queries.some((sql) => sql.includes("SELECT pg_advisory_lock("))).toBe(false);
    expect(queries.some((sql) => sql.includes("SET lock_timeout"))).toBe(true);
    expect(queries.some((sql) => sql.includes("UPDATE bookings"))).toBe(true);
  });

  it("fails immediately when another repair owns the advisory lock", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("to_regtype('probability')")) {
          return { rows: [{ ready: true, hasDefinite: true, hasTrigger: false }] };
        }
        if (sql.includes("pg_try_advisory_lock")) {
          return { rows: [{ locked: false }] };
        }
        return { rows: [] };
      },
      release() {},
    };

    await expect(
      ensureBookingProbabilitySchema({ connect: async () => client } as never),
    ).rejects.toThrow("Booking probability schema repair lock unavailable");

    expect(queries.some((sql) => sql.includes("UPDATE bookings"))).toBe(false);
  });
});
