import { pool as defaultPool } from "@workspace/db";
import { readFileSync } from "node:fs";
import { isInboundCallingSchemaReady } from "./inbound-calling-schema";

const migrationFileName = "20260902_twilio_incoming_computer_calling.sql";

export function resolveInboundCallingMigrationUrl(
  bundleUrl: string | URL = import.meta.url,
): URL {
  return new URL(`./migrations/${migrationFileName}`, bundleUrl);
}

const advisoryTryLockSql =
  "SELECT pg_try_advisory_xact_lock(hashtext('adventure-zone:inbound-calling-schema')) AS locked";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(destroy?: boolean): void;
};
type Pool = { connect(): Promise<Client> };

export async function ensureInboundCallingSchemaBeforeListen(options?: {
  pool?: Pool;
  lockWaitMs?: number;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as Pool);
  const client = await pool.connect();
  let inTransaction = false;
  let destroy = false;
  try {
    await client.query("BEGIN");
    inTransaction = true;
    // Server-side limits cancel blocked work before the pool's 60s read timeout.
    // SET LOCAL never leaks a timeout setting into unrelated pooled requests.
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '20s'");
    if (await isInboundCallingSchemaReady(client)) {
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
        throw new Error("INBOUND_CALLING_SCHEMA_LOCK_BUSY");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))),
      );
    }
    // A competing deploy may have finished while we waited for the lock.
    if (!(await isInboundCallingSchemaReady(client))) {
      await client.query(
        readFileSync(resolveInboundCallingMigrationUrl(), "utf8").replace(
          /^BEGIN;|COMMIT;$/gm,
          "",
        ),
      );
    }
    if (!(await isInboundCallingSchemaReady(client))) {
      throw new Error("INBOUND_CALLING_SCHEMA_INCOMPLETE");
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
