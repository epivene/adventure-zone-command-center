import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { ensureActivityDeleteSchema } from "./activity-delete-schema";

function fakePool(deleteAction: string | null) {
  const queries: string[] = [];
  const query = vi.fn(async (statement: string) => {
    queries.push(statement);
    if (statement.includes("FROM pg_constraint")) {
      return {
        rows: deleteAction === null
          ? []
          : [{ deleteAction }],
      };
    }
    return { rows: [] };
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));

  return {
    pool: { connect } as unknown as Pool,
    queries,
    query,
    release,
  };
}

describe("ensureActivityDeleteSchema", () => {
  it("changes the call-session note FK to ON DELETE SET NULL", async () => {
    const fake = fakePool("a");

    await ensureActivityDeleteSchema(fake.pool);

    expect(fake.queries.some((statement) =>
      statement.includes("DROP CONSTRAINT call_sessions_note_activity_id_activities_id_fk")
      && statement.includes("ON DELETE SET NULL"),
    )).toBe(true);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("does not rebuild the FK when it already uses SET NULL", async () => {
    const fake = fakePool("n");

    await ensureActivityDeleteSchema(fake.pool);

    expect(fake.queries.some((statement) =>
      statement.includes("DROP CONSTRAINT call_sessions_note_activity_id_activities_id_fk"),
    )).toBe(false);
    expect(fake.release).toHaveBeenCalledOnce();
  });

  it("does nothing when the relationship is not present yet", async () => {
    const fake = fakePool(null);

    await ensureActivityDeleteSchema(fake.pool);

    expect(fake.queries.some((statement) =>
      statement.includes("DROP CONSTRAINT call_sessions_note_activity_id_activities_id_fk"),
    )).toBe(false);
    expect(fake.release).toHaveBeenCalledOnce();
  });
});
