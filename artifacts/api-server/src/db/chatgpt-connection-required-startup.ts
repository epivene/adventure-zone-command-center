import { pool as defaultPool } from "@workspace/db";
import {
  ensureChatGPTConnectionSchema,
  isChatGPTConnectionSchemaReady,
} from "./chatgpt-connection-schema";

const advisoryTryLockSql =
  "SELECT pg_try_advisory_xact_lock(hashtext('adventure-zone:chatgpt-connection-schema')) AS locked";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(destroy?: boolean): void;
};
type Pool = { connect(): Promise<Client> };
type EnsureSchema = (client: Client) => Promise<void>;

export async function ensureChatGPTConnectionSchemaBeforeListen(options?: {
  pool?: Pool;
  ensureSchema?: EnsureSchema;
  lockWaitMs?: number;
}): Promise<void> {
  const pool = options?.pool ?? (defaultPool as unknown as Pool);
  const ensureSchema = options?.ensureSchema ?? ensureChatGPTConnectionSchema;
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
    if (
      !options?.ensureSchema &&
      (await isChatGPTConnectionSchemaReady(client))
    ) {
      await client.query("COMMIT");
      inTransaction = false;
      return;
    }
    const deadline =
      Date.now() + Math.max(0, Math.min(options?.lockWaitMs ?? 10_000, 10_000));
    for (;;) {
      const result = await client.query(advisoryTryLockSql);
      if (result.rows[0]?.locked === true) break;
      if (Date.now() >= deadline)
        throw new Error("CHATGPT_CONNECTION_SCHEMA_LOCK_BUSY");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))),
      );
    }
    await ensureSchema(client);
    if (
      !options?.ensureSchema &&
      !(await isChatGPTConnectionSchemaReady(client))
    ) {
      throw new Error("CHATGPT_CONNECTION_SCHEMA_INCOMPLETE");
    }
    await client.query("COMMIT");
    inTransaction = false;
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
