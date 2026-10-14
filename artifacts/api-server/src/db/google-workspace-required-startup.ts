import { pool as defaultPool } from "@workspace/db";
import { ensureGoogleWorkspaceSchema } from "./google-workspace-startup-migration";
import { ensureOperationalCalendarConnectionUpgrade } from "./google-workspace-operational-calendar-upgrade";
import {
  isGoogleWorkspaceSchemaReady,
  isOperationalCalendarSchemaReady,
} from "./google-workspace-schema-readiness";
const advisoryTryLockSql =
  "SELECT pg_try_advisory_xact_lock(hashtext('adventure-zone:google-workspace-schema')) AS locked";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(destroy?: boolean): void;
};
type Pool = { connect(): Promise<Client> };

export async function ensureGoogleWorkspaceSchemaBeforeListen(options?: {
  pool?: Pool;
  lockWaitMs?: number;
  ensureSchema?: (client: Client) => Promise<boolean>;
  ensureOperationalCalendarUpgrade?: (client: Client) => Promise<boolean>;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as Pool);
  const client = await pool.connect();
  const ready = async () =>
    !options?.ensureSchema &&
    !options?.ensureOperationalCalendarUpgrade &&
    (await isGoogleWorkspaceSchemaReady(client)) &&
    (await isOperationalCalendarSchemaReady(client));
  let inTransaction = false;
  let destroy = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    // Server-side limits cancel blocked work before the pool's 60s read timeout.
    // SET LOCAL never leaks a timeout setting into unrelated pooled requests.
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    if (await ready()) {
      await client.query("COMMIT");
      inTransaction = false;
      return true;
    }
    const deadline =
      Date.now() + Math.max(0, Math.min(options?.lockWaitMs ?? 10_000, 10_000));
    for (;;) {
      const result = await client.query(advisoryTryLockSql);
      if (result.rows[0]?.locked === true) break;
      if (Date.now() >= deadline)
        throw new Error("GOOGLE_WORKSPACE_SCHEMA_LOCK_BUSY");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))),
      );
    }
    // A competing deploy may have finished while we waited for the lock.
    if (!(await ready())) {
      await (options?.ensureSchema ?? ensureGoogleWorkspaceSchema)(client);
      // The legacy base repair resets its session lock timeout.
      await client.query("SET LOCAL lock_timeout = '5s'");
      await (
        options?.ensureOperationalCalendarUpgrade ??
        ensureOperationalCalendarConnectionUpgrade
      )(client);
    }
    if (
      !options?.ensureSchema &&
      !options?.ensureOperationalCalendarUpgrade &&
      !(await ready())
    ) {
      throw new Error("GOOGLE_WORKSPACE_SCHEMA_INCOMPLETE");
    }
    await client.query("COMMIT");
    inTransaction = false;
    return true;
  } catch (error) {
    // A client-side timeout can leave work running on this connection. Never
    // return a failed migration connection or its locks to the request pool.
    destroy = true;
    const connectionUnusable =
      error instanceof Error &&
      /query read timeout|connection terminated|connection closed/i.test(
        error.message,
      );
    if (inTransaction && !connectionUnusable)
      await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release(destroy);
  }
}
