import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import { ensureProfileTouchSchema } from "../features/organizations/profile-touch-schema";
import { profileTouchReadySql } from "../features/organizations/profile-touch-schema";
function fixture(ready: boolean[], locks = [true], failure?: Error) {
  const query = vi.fn(async (sql: string) => {
    if (sql === profileTouchReadySql)
      return { rows: [{ ready: ready.length > 1 ? ready.shift() : ready[0] }] };
    if (sql.includes("pg_try_advisory_xact_lock"))
      return {
        rows: [{ locked: locks.length > 1 ? locks.shift() : locks[0] }],
      };
    if (sql.includes("CREATE TABLE") && failure) throw failure;
    return { rows: [] };
  });
  const release = vi.fn();
  return {
    query,
    release,
    pool: { connect: async () => ({ query, release }) },
  };
}
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});
describe("profile touch startup", () => {
  it("skips DDL and advisory locks when installed", async () => {
    const f = fixture([true], [false]);
    await expect(ensureProfileTouchSchema(f.pool)).resolves.toBeUndefined();
    expect(f.query.mock.calls.some(([s]) => s.includes("CREATE TABLE"))).toBe(
      false,
    );
    expect(f.query.mock.calls.some(([s]) => s.includes("advisory"))).toBe(
      false,
    );
    expect(f.release).toHaveBeenCalledWith(false);
  });
  it("migrates a missing schema inside bounded transaction and verifies it", async () => {
    const f = fixture([false, false, true]);
    await ensureProfileTouchSchema(f.pool);
    const sql = f.query.mock.calls.map(([s]) => s);
    expect(sql.slice(0, 3)).toEqual([
      "BEGIN",
      "SET LOCAL lock_timeout = '5s'",
      "SET LOCAL statement_timeout = '20s'",
    ]);
    expect(sql.find((s) => s.includes("CREATE TABLE"))).not.toMatch(
      /BEGIN;|COMMIT;/,
    );
    expect(sql.at(-1)).toBe("COMMIT");
  });
  it("rechecks after another deploy installs schema", async () => {
    const f = fixture([false, true]);
    await ensureProfileTouchSchema(f.pool);
    expect(f.query.mock.calls.some(([s]) => s.includes("CREATE TABLE"))).toBe(
      false,
    );
  });
  it("waits through brief lock contention", async () => {
    vi.useFakeTimers();
    const f = fixture([false, true], [false, true]);
    const work = ensureProfileTouchSchema(f.pool);
    await vi.runAllTimersAsync();
    await work;
    expect(f.release).toHaveBeenCalledWith(false);
  });
  it("fails closed and discards connection after persistent contention", async () => {
    const f = fixture([false], [false]);
    await expect(
      ensureProfileTouchSchema(f.pool, { lockWaitMs: 0 }),
    ).rejects.toThrow("LOCK_BUSY");
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it("rolls back an incomplete repair", async () => {
    const f = fixture([false]);
    await expect(ensureProfileTouchSchema(f.pool)).rejects.toThrow(
      "INCOMPLETE",
    );
    expect(f.query).toHaveBeenCalledWith("ROLLBACK");
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it.each(["canceling statement due to lock timeout", "Query read timeout"])(
    "cleans up %s",
    async (message) => {
      const f = fixture([false], [true], new Error(message));
      await expect(ensureProfileTouchSchema(f.pool)).rejects.toThrow(message);
      expect(f.release).toHaveBeenCalledWith(true);
      expect(f.query.mock.calls.some(([s]) => s === "ROLLBACK")).toBe(
        !message.includes("read timeout"),
      );
    },
  );
});
