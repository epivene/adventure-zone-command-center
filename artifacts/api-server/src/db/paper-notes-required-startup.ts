import { pool as defaultPool } from "@workspace/db";

import { ensurePaperNotesSchema } from "./paper-notes-startup-migration";

const advisoryLockSql =
  "SELECT pg_advisory_lock(hashtext('adventure-zone:paper-notes-schema'))";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:paper-notes-schema'))";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
};

type Pool = {
  connect(): Promise<Client>;
};

type EnsureSchema = (client: Client) => Promise<boolean>;

export async function ensurePaperNotesSchemaBeforeListen(options?: {
  pool?: Pool;
  ensureSchema?: EnsureSchema;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as Pool);
  const ensureSchema = options?.ensureSchema ?? ensurePaperNotesSchema;
  const client = await pool.connect();
  let locked = false;

  try {
    await client.query(advisoryLockSql);
    locked = true;
    return await ensureSchema(client);
  } finally {
    if (locked) {
      await client.query(advisoryUnlockSql).catch(() => undefined);
    }
    client.release();
  }
}
