import { describe, expect, it, vi } from "vitest";

import { recoverStaleDatabaseLockConvoys } from "./stale-lock-recovery";

describe("recoverStaleDatabaseLockConvoys", () => {
  it("terminates an old root blocker only when it is blocking a large lock chain", async () => {
    const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
    let candidatePass = 0;
    const pool = {
      async query(sql: string, values?: readonly unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("WITH RECURSIVE lock_edges")) {
          candidatePass += 1;
          return candidatePass === 1
            ? {
                rows: [
                  {
                    pid: 2528729,
                    blocked_count: 31,
                    query_age_ms: 5_459_400,
                    transaction_age_ms: 5_459_904,
                  },
                ],
              }
            : { rows: [] };
        }
        if (sql.includes("pg_terminate_backend")) {
          return { rows: [{ terminated: true }] };
        }
        return { rows: [] };
      },
    };
    const sleep = vi.fn(async () => undefined);

    const result = await recoverStaleDatabaseLockConvoys({
      pool: pool as never,
      sleep,
      minimumAgeMs: 15 * 60_000,
      minimumBlockedSessions: 10,
    });

    expect(result.terminated).toEqual([
      {
        pid: 2528729,
        blockedCount: 31,
        queryAgeMs: 5_459_400,
        transactionAgeMs: 5_459_904,
      },
    ]);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(queries[0]?.sql).toContain("cardinality(pg_blocking_pids(blocker.pid)) = 0");
    expect(queries[0]?.sql).toContain("blocker.usename = current_user");
    expect(queries[0]?.sql).toContain("blocker.backend_type = 'client backend'");
    expect(queries[0]?.sql).toContain("count(DISTINCT lock_tree.waiter_pid)");
    expect(queries[0]?.values).toEqual([15 * 60_000, 10]);
    expect(queries.some(({ sql }) => sql.includes("pg_terminate_backend($1::int)"))).toBe(true);
  });

  it("does nothing when there is no stale root blocker", async () => {
    const queries: string[] = [];
    const pool = {
      async query(sql: string) {
        queries.push(sql);
        return { rows: [] };
      },
    };

    const result = await recoverStaleDatabaseLockConvoys({
      pool: pool as never,
      sleep: async () => undefined,
    });

    expect(result).toEqual({ terminated: [], passes: 1 });
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toContain("pg_terminate_backend");
  });

  it("stops after the configured pass limit even if a chain keeps advancing", async () => {
    let nextPid = 100;
    const terminated: number[] = [];
    const pool = {
      async query(sql: string, values?: readonly unknown[]) {
        if (sql.includes("WITH RECURSIVE lock_edges")) {
          return {
            rows: [
              {
                pid: nextPid++,
                blocked_count: values?.[1] ?? 10,
                query_age_ms: values?.[0] ?? 900_000,
                transaction_age_ms: values?.[0] ?? 900_000,
              },
            ],
          };
        }
        if (sql.includes("pg_terminate_backend")) {
          terminated.push(Number(values?.[0]));
          return { rows: [{ terminated: true }] };
        }
        return { rows: [] };
      },
    };

    const result = await recoverStaleDatabaseLockConvoys({
      pool: pool as never,
      sleep: async () => undefined,
      maximumPasses: 3,
    });

    expect(result.passes).toBe(3);
    expect(terminated).toEqual([100, 101, 102]);
  });
});
