import { describe, expect, it, vi } from "vitest";

import { ensureEventReviewDismissalSchemaBeforeListen } from "./event-review-dismissal-required-startup";

describe("ensureEventReviewDismissalSchemaBeforeListen", () => {
  it("creates the non-destructive review-dismissal table before the API starts", async () => {
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
      ensureEventReviewDismissalSchemaBeforeListen({
        pool: { async connect() { return client; } },
      }),
    ).resolves.toBe(true);

    expect(
      queries.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS event_manager_review_dismissals")),
    ).toBe(true);
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
      ensureEventReviewDismissalSchemaBeforeListen({
        pool: { async connect() { return client; } },
      }),
    ).rejects.toThrow("EVENT_REVIEW_DISMISSAL_SCHEMA_LOCK_BUSY");
    expect(release).toHaveBeenCalledOnce();
  });
});
