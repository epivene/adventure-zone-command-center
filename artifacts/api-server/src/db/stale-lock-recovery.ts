import { pool as defaultPool } from "@workspace/db";

export type StaleLockRecoveryResult = {
  terminated: Array<{
    pid: number;
    blockedCount: number;
    queryAgeMs: number;
    transactionAgeMs: number;
  }>;
  passes: number;
};

type RecoveryPool = {
  query(
    sql: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
};

type Sleep = (delayMs: number) => Promise<void>;

const findStaleRootBlockersSql = `
  WITH RECURSIVE lock_edges AS (
    SELECT
      waiter.pid AS waiter_pid,
      blocker_pids.blocker_pid
    FROM pg_stat_activity waiter
    CROSS JOIN LATERAL unnest(pg_blocking_pids(waiter.pid))
      AS blocker_pids(blocker_pid)
    WHERE waiter.datname = current_database()
      AND waiter.backend_type = 'client backend'
  ),
  lock_tree AS (
    SELECT
      lock_edges.blocker_pid AS root_pid,
      lock_edges.waiter_pid
    FROM lock_edges

    UNION

    SELECT
      lock_tree.root_pid,
      lock_edges.waiter_pid
    FROM lock_tree
    JOIN lock_edges
      ON lock_edges.blocker_pid = lock_tree.waiter_pid
  )
  SELECT
    blocker.pid,
    count(DISTINCT lock_tree.waiter_pid)::int AS blocked_count,
    (
      extract(epoch FROM (clock_timestamp() - blocker.query_start)) * 1000
    )::bigint AS query_age_ms,
    (
      extract(epoch FROM (clock_timestamp() - blocker.xact_start)) * 1000
    )::bigint AS transaction_age_ms
  FROM pg_stat_activity blocker
  JOIN lock_tree
    ON lock_tree.root_pid = blocker.pid
  WHERE blocker.datname = current_database()
    AND blocker.usename = current_user
    AND blocker.backend_type = 'client backend'
    AND blocker.pid <> pg_backend_pid()
    AND blocker.state = 'active'
    AND blocker.query_start IS NOT NULL
    AND blocker.xact_start IS NOT NULL
    AND cardinality(pg_blocking_pids(blocker.pid)) = 0
    AND extract(epoch FROM (clock_timestamp() - blocker.query_start)) * 1000
      >= $1::double precision
    AND extract(epoch FROM (clock_timestamp() - blocker.xact_start)) * 1000
      >= $1::double precision
  GROUP BY blocker.pid, blocker.query_start, blocker.xact_start
  HAVING count(DISTINCT lock_tree.waiter_pid) >= $2::int
  ORDER BY blocked_count DESC, query_age_ms DESC
  LIMIT 4
`;

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const systemSleep: Sleep = (delayMs) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

export async function recoverStaleDatabaseLockConvoys(options?: {
  pool?: RecoveryPool;
  sleep?: Sleep;
  minimumAgeMs?: number;
  minimumBlockedSessions?: number;
  maximumPasses?: number;
  settleDelayMs?: number;
}): Promise<StaleLockRecoveryResult> {
  const pool = options?.pool ?? (defaultPool as unknown as RecoveryPool);
  const sleep = options?.sleep ?? systemSleep;
  const minimumAgeMs = options?.minimumAgeMs ?? 15 * 60_000;
  const minimumBlockedSessions = options?.minimumBlockedSessions ?? 10;
  const maximumPasses = options?.maximumPasses ?? 8;
  const settleDelayMs = options?.settleDelayMs ?? 750;
  const terminated: StaleLockRecoveryResult["terminated"] = [];
  let passes = 0;
  let recoveryTriggered = false;

  for (let pass = 0; pass < maximumPasses; pass += 1) {
    passes += 1;
    const candidates = await pool.query(findStaleRootBlockersSql, [
      minimumAgeMs,
      recoveryTriggered ? 1 : minimumBlockedSessions,
    ]);
    if (candidates.rows.length === 0) break;

    let terminatedThisPass = 0;
    for (const row of candidates.rows) {
      const pid = numberValue(row["pid"]);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const result = await pool.query(
        "SELECT pg_terminate_backend($1::int) AS terminated",
        [pid],
      );
      if (result.rows[0]?.["terminated"] !== true) continue;

      recoveryTriggered = true;
      terminatedThisPass += 1;
      terminated.push({
        pid,
        blockedCount: numberValue(row["blocked_count"]),
        queryAgeMs: numberValue(row["query_age_ms"]),
        transactionAgeMs: numberValue(row["transaction_age_ms"]),
      });
    }

    if (terminatedThisPass === 0) break;
    await sleep(settleDelayMs);
  }

  return { terminated, passes };
}
