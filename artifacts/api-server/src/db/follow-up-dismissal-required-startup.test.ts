import { describe, expect, it, vi } from "vitest";

import { ensureFollowUpDismissalPersistenceBeforeListen } from "./follow-up-dismissal-required-startup";

describe("ensureFollowUpDismissalPersistenceBeforeListen", () => {
  it("limits location validation to inserts and location-association changes", async () => {
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
      ensureFollowUpDismissalPersistenceBeforeListen({
        pool: { async connect() { return client; } },
      }),
    ).resolves.toBe(true);

    const schemaQuery = queries.find((sql) => sql.includes("CREATE TRIGGER follow_ups_location_org_match"));
    expect(schemaQuery).toContain(
      "BEFORE INSERT OR UPDATE OF organization_id, organization_location_id ON follow_ups",
    );
    expect(queries.some((sql) => sql.includes("pg_advisory_unlock"))).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails closed and releases the client when another startup owns the schema lock", async () => {
    const release = vi.fn();
    const client = {
      async query(sql: string) {
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: false }] };
        return { rows: [] };
      },
      release,
    };

    await expect(
      ensureFollowUpDismissalPersistenceBeforeListen({
        pool: { async connect() { return client; } },
      }),
    ).rejects.toThrow("FOLLOW_UP_DISMISSAL_SCHEMA_LOCK_BUSY");
    expect(release).toHaveBeenCalledOnce();
  });
});
