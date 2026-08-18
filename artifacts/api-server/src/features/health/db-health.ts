export type DatabaseBlocker = {
  pid: number;
  state: string | null;
  applicationName: string | null;
  waitEventType: string | null;
  transactionAgeMs: number;
  queryAgeMs: number;
  blockedCount: number;
  blockingPidCount: number;
};

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
    blockers: DatabaseBlocker[];
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

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  const activeSessions = numberValue(row["active"]);
  const lockWaiters = numberValue(row["lock_waiters"]);
  const blockedSessions = numberValue(row["blocked"]);
  const longestActiveMs = numberValue(row["longest_active_ms"]);
  const lockContention = lockWaiters > 0 || blockedSessions > 0;

  let blockers: DatabaseBlocker[] = [];
  if (lockContention) {
    const blockerRows = await pool.query(`
      WITH blocked AS (
        SELECT
          blocked.pid AS blocked_pid,
          unnest(pg_blocking_pids(blocked.pid)) AS blocker_pid
        FROM pg_stat_activity blocked
        WHERE blocked.datname = current_database()
          AND blocked.backend_type = 'client backend'
          AND cardinality(pg_blocking_pids(blocked.pid)) > 0
      ), blocker_counts AS (
        SELECT blocker_pid, count(DISTINCT blocked_pid)::int AS blocked_count
        FROM blocked
        GROUP BY blocker_pid
      )
      SELECT
        blocker.pid AS blocker_pid,
        blocker.state,
        NULLIF(blocker.application_name, '') AS application_name,
        blocker.wait_event_type,
        COALESCE(
          extract(epoch FROM (clock_timestamp() - blocker.xact_start)) * 1000,
          0
        )::bigint AS transaction_age_ms,
        COALESCE(
          extract(epoch FROM (clock_timestamp() - blocker.query_start)) * 1000,
          0
        )::bigint AS query_age_ms,
        counts.blocked_count,
        cardinality(pg_blocking_pids(blocker.pid))::int AS blocking_pid_count
      FROM blocker_counts counts
      JOIN pg_stat_activity blocker ON blocker.pid = counts.blocker_pid
      ORDER BY counts.blocked_count DESC,
               blocker.xact_start ASC NULLS LAST,
               blocker.query_start ASC NULLS LAST
      LIMIT 10
    `);

    blockers = blockerRows.rows.map((blocker) => ({
      pid: numberValue(blocker["blocker_pid"]),
      state: optionalString(blocker["state"]),
      applicationName: optionalString(blocker["application_name"]),
      waitEventType: optionalString(blocker["wait_event_type"]),
      transactionAgeMs: numberValue(blocker["transaction_age_ms"]),
      queryAgeMs: numberValue(blocker["query_age_ms"]),
      blockedCount: numberValue(blocker["blocked_count"]),
      blockingPidCount: numberValue(blocker["blocking_pid_count"]),
    }));
  }

  return {
    status: lockContention ? "degraded" : "ok",
    reason: lockContention ? "lock_contention" : null,
    pool: poolSnapshot,
    database: {
      activeSessions,
      lockWaiters,
      blockedSessions,
      longestActiveMs,
      blockers,
    },
  };
}
