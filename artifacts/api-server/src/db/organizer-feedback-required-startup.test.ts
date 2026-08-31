import { describe, expect, it, vi } from "vitest";

import { ensureOrganizerFeedbackSchemaBeforeListen } from "./organizer-feedback-required-startup";

describe("ensureOrganizerFeedbackSchemaBeforeListen", () => {
  it("creates the organizer feedback schema before the API starts", async () => {
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
      ensureOrganizerFeedbackSchemaBeforeListen({
        pool: { async connect() { return client; } },
      }),
    ).resolves.toBe(true);

    expect(
      queries.some((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS event_organizer_feedback_requests"),
      ),
    ).toBe(true);
    expect(
      queries.some((sql) =>
        sql.includes("CREATE TABLE IF NOT EXISTS event_organizer_feedback"),
      ),
    ).toBe(true);
    expect(
      queries.some((sql) =>
        sql.includes("ALTER TABLE event_organizer_feedback ADD COLUMN IF NOT EXISTS manager_response"),
      ),
    ).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails startup instead of serving the reviews route without its required tables", async () => {
    const release = vi.fn();
    const client = {
      async query(sql: string) {
        if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: false }] };
        return { rows: [] };
      },
      release,
    };

    await expect(
      ensureOrganizerFeedbackSchemaBeforeListen({
        pool: { async connect() { return client; } },
      }),
    ).rejects.toThrow("ORGANIZER_FEEDBACK_SCHEMA_LOCK_BUSY");
    expect(release).toHaveBeenCalledOnce();
  });
});
