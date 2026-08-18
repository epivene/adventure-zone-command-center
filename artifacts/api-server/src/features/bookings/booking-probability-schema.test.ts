import { describe, expect, it } from "vitest";

import { ensureBookingProbabilitySchema } from "./booking-probability-schema";

describe("ensureBookingProbabilitySchema", () => {
  it("adds definite before backfilling confirmed bookings", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("to_regtype('probability')")) {
          return { rows: [{ ready: true, hasDefinite: false, hasTrigger: false }] };
        }
        if (sql.includes("pg_try_advisory_lock")) {
          return { rows: [{ locked: true }] };
        }
        return { rows: [] };
      },
      release() {},
    };
    const pool = {
      async connect() {
        return client;
      },
    };

    await ensureBookingProbabilitySchema(pool as never);

    const alterIndex = queries.findIndex((sql) =>
      sql.includes("ALTER TYPE probability ADD VALUE IF NOT EXISTS 'definite'"),
    );
    const backfillIndex = queries.findIndex((sql) =>
      sql.includes("UPDATE bookings") && sql.includes("'definite'::probability"),
    );

    expect(alterIndex).toBeGreaterThan(-1);
    expect(backfillIndex).toBeGreaterThan(alterIndex);
    expect(queries.at(-1)).toContain("pg_advisory_unlock");
  });

  it("does nothing when the probability enum or bookings table is missing", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("to_regtype('probability')")) {
          return { rows: [{ ready: false, hasDefinite: false, hasTrigger: false }] };
        }
        return { rows: [] };
      },
      release() {},
    };
    const pool = {
      async connect() {
        return client;
      },
    };

    await ensureBookingProbabilitySchema(pool as never);

    expect(queries.some((sql) => sql.includes("ALTER TYPE probability"))).toBe(false);
    expect(queries.some((sql) => sql.includes("UPDATE bookings"))).toBe(false);
    expect(queries.some((sql) => sql.includes("pg_advisory"))).toBe(false);
  });
});
