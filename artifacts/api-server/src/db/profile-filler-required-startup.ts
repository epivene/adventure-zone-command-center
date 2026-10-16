import { pool as defaultPool } from "@workspace/db";

import {
  ensureProfileFillerSchema,
  isProfileFillerSchemaReady,
} from "./profile-filler-startup-migration";

const advisoryTryLockSql =
  "SELECT pg_try_advisory_xact_lock(hashtext('adventure-zone:profile-filler-schema')) AS locked";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(destroy?: boolean): void;
};

type Pool = {
  connect(): Promise<Client>;
};

type EnsureSchema = (
  client: Client,
  options?: { inTransaction?: boolean },
) => Promise<boolean>;

export async function ensureProfileFillerSchemaBeforeListen(options?: {
  pool?: Pool;
  ensureSchema?: EnsureSchema;
  lockWaitMs?: number;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as Pool);
  const ensureSchema = options?.ensureSchema ?? ensureProfileFillerSchema;
  const client = await pool.connect();
  let inTransaction = false;
  let destroy = false;

  try {
    await client.query("BEGIN");
    inTransaction = true;
    // Cancel blocked work on PostgreSQL before the pool's 30-second read timeout.
    // Transaction-local limits and locks cannot leak into normal API requests.
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    let changed = false;
    if (!(await isProfileFillerSchemaReady(client))) {
      const deadline =
        Date.now() + Math.max(0, Math.min(options?.lockWaitMs ?? 10_000, 10_000));
      for (;;) {
        const result = await client.query(advisoryTryLockSql);
        if (result.rows[0]?.locked === true) break;
        if (Date.now() >= deadline) throw new Error("PROFILE_FILLER_SCHEMA_LOCK_BUSY");
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))),
        );
      }
      // Recheck under the lock: another deploy may have completed the repair.
      changed = await ensureSchema(client, { inTransaction: true });
    }
    await client.query("COMMIT");
    inTransaction = false;
    return changed;
  } catch (error) {
    destroy = true;
    // A client-side read timeout can leave a query running. Do not queue more
    // SQL behind it or return its session (and possible locks) to the pool.
    const connectionUnusable =
      error instanceof Error &&
      /query read timeout|connection terminated|connection closed/i.test(error.message);
    if (inTransaction && !connectionUnusable)
      await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release(destroy);
  }
}