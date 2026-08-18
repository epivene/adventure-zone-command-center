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

  it("reports postgres lock contention with safe blocker details", async () => {
    const queries: string[] = [];
    const result = await inspectDatabaseHealth({
      totalCount: 4,
      idleCount: 2,
      waitingCount: 0,
      options: { max: 10 },
      async query(sql: string) {
        queries.push(sql);
        if (sql.includes("count(*) FILTER")) {
          return {
            rows: [{ active: 5, lock_waiters: 3, blocked: 3, longest_active_ms: 18200 }],
          };
        }
        expect(sql).toContain("unnest(pg_blocking_pids");
        expect(sql).not.toContain("query AS");
        return {
          rows: [{
            blocker_pid: 441,
            state: "idle in transaction",
            application_name: "",
            wait_event_type: "Client",
            transaction_age_ms: 4810000,
            query_age_ms: 4810200,
            blocked_count: 28,
            blocking_pid_count: 1,
          }],
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
      blockers: [{
        pid: 441,
        state: "idle in transaction",
        applicationName: null,
        waitEventType: "Client",
        transactionAgeMs: 4810000,
        queryAgeMs: 4810200,
        blockedCount: 28,
        blockingPidCount: 1,
      }],
    });
    expect(queries).toHaveLength(2);
  });

  it("reports healthy database access when there are no waiters or blockers", async () => {
    let queryCount = 0;
    const result = await inspectDatabaseHealth({
      totalCount: 3,
      idleCount: 2,
      waitingCount: 0,
      options: { max: 10 },
      async query() {
        queryCount += 1;
        return {
          rows: [{ active: 1, lock_waiters: 0, blocked: 0, longest_active_ms: 12 }],
        };
      },
    });

    expect(result.status).toBe("ok");
    expect(result.reason).toBeNull();
    expect(result.database?.blockers).toEqual([]);
    expect(queryCount).toBe(1);
  });
});
