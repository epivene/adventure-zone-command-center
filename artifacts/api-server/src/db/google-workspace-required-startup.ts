import { pool as defaultPool } from "@workspace/db";

import { ensureOperationalCalendarConnectionUpgrade } from "./google-workspace-operational-calendar-upgrade";
import { ensureGoogleWorkspaceSchema } from "./google-workspace-startup-migration";

const advisoryTryLockSql =
  "SELECT pg_try_advisory_lock(hashtext('adventure-zone:google-workspace-schema')) AS locked";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:google-workspace-schema'))";

type StartupClient = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
};

type StartupPool = {
  connect(): Promise<StartupClient>;
};

type EnsureSchema = (client: StartupClient) => Promise<boolean>;

export async function ensureGoogleWorkspaceSchemaBeforeListen(options?: {
  pool?: StartupPool;
  ensureSchema?: EnsureSchema;
  ensureOperationalCalendarUpgrade?: EnsureSchema;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as StartupPool);
  const ensureSchema = options?.ensureSchema ?? ensureGoogleWorkspaceSchema;
  const ensureOperationalCalendarUpgrade =
    options?.ensureOperationalCalendarUpgrade ?? ensureOperationalCalendarConnectionUpgrade;
  const client = await pool.connect();
  let locked = false;

  try {
    const result = await client.query(advisoryTryLockSql);
    locked = result.rows[0]?.locked === true;
    if (!locked) {
      throw new Error("GOOGLE_WORKSPACE_SCHEMA_LOCK_BUSY");
    }
    await ensureSchema(client);
    await ensureOperationalCalendarUpgrade(client);
    return true;
  } finally {
    if (locked) {
      await client.query(advisoryUnlockSql).catch(() => undefined);
    }
    client.release();
  }
}
