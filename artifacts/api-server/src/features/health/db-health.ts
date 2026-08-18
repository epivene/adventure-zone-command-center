export type DatabaseHealthResult = {
  status: "ok" | "degraded";
  reason: "pool_saturated" | "lock_contention" | null;
  pool: {
    total: number;
    idle: number;
    waiting: number;
    max: number;
  };
  database: {
    activeSessions: number;
    lockWaiters: number;
    blockedSessions: number;
    longestActiveMs: number;
  } | null;
};

type DiagnosticPool = {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  options: { max?: number };
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
};

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function inspectDatabaseHealth(
  pool: DiagnosticPool,
): Promise<DatabaseHealthResult> {
  const max = Number(pool.options.max ?? 10);
  const poolSnapshot = {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max,
  };

  if (pool.waitingCount > 0 || (pool.totalCount >= max && pool.idleCount === 0)) {
    return {
      status: "degraded",
      reason: "pool_saturated",
      pool: poolSnapshot,
      database: null,
    };
  }

  const activity = await pool.query(`
    SELECT
      count(*) FILTER (WHERE state = 'active')::int AS active,
      count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS lock_waiters,
      count(*) FILTER (WHERE cardinality(pg_blocking_pids(pid)) > 0)::int AS blocked,
      COALESCE(
        max(
          extract(epoch FROM (clock_timestamp() - query_start)) * 1000
        ) FILTER (
          WHERE state = 'active'
            AND pid <> pg_backend_pid()
            AND query_start IS NOT NULL
        ),
        0
      )::bigint AS longest_active_ms
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND backend_type = 'client backend'
  `);

  const row = activity.rows[0] ?? {};
  const database = {
    activeSessions: numberValue(row["active"]),
    lockWaiters: numberValue(row["lock_waiters"]),
    blockedSessions: numberValue(row["blocked"]),
    longestActiveMs: numberValue(row["longest_active_ms"]),
  };

  const lockContention = database.lockWaiters > 0 || database.blockedSessions > 0;
  return {
    status: lockContention ? "degraded" : "ok",
    reason: lockContention ? "lock_contention" : null,
    pool: poolSnapshot,
    database,
  };
}
