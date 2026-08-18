import { describe, expect, it } from "vitest";

import { inspectDatabaseHealth } from "./db-health";

describe("inspectDatabaseHealth", () => {
  it("reports pool saturation without joining the waiting queue", async () => {
    let queried = false;
    const result = await inspectDatabaseHealth({
      totalCount: 10,
      idleCount: 0,
      waitingCount: 4,
      options: { max: 10 },
      async query() {
        queried = true;
        return { rows: [] };
      },
    });

    expect(queried).toBe(false);
    expect(result.status).toBe("degraded");
    expect(result.reason).toBe("pool_saturated");
    expect(result.pool).toEqual({ total: 10, idle: 0, waiting: 4, max: 10 });
  });

  it("reports postgres lock contention when the pool has capacity", async () => {
    const result = await inspectDatabaseHealth({
      totalCount: 4,
      idleCount: 2,
      waitingCount: 0,
      options: { max: 10 },
      async query(sql: string) {
        expect(sql).toContain("pg_stat_activity");
        expect(sql).toContain("pg_blocking_pids");
        return {
          rows: [{ active: 5, lock_waiters: 3, blocked: 3, longest_active_ms: 18200 }],
        };
      },
    });

    expect(result.status).toBe("degraded");
    expect(result.reason).toBe("lock_contention");
    expect(result.database).toEqual({
      activeSessions: 5,
      lockWaiters: 3,
      blockedSessions: 3,
      longestActiveMs: 18200,
    });
  });

  it("reports healthy database access when there are no waiters or blockers", async () => {
    const result = await inspectDatabaseHealth({
      totalCount: 3,
      idleCount: 2,
      waitingCount: 0,
      options: { max: 10 },
      async query() {
        return {
          rows: [{ active: 1, lock_waiters: 0, blocked: 0, longest_active_ms: 12 }],
        };
      },
    });

    expect(result.status).toBe("ok");
    expect(result.reason).toBeNull();
  });
});
