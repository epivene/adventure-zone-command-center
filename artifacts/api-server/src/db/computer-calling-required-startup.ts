import { pool as defaultPool } from "@workspace/db";
const ensureSchemaSql = `
CREATE TABLE IF NOT EXISTS computer_call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  phone_id uuid NOT NULL REFERENCES contact_phones(id),
  provider text NOT NULL,
  provider_call_sid text UNIQUE,
  direction text NOT NULL DEFAULT 'outbound',
  method text NOT NULL DEFAULT 'browser_voip',
  status text NOT NULL,
  caller_id_snapshot text NOT NULL,
  destination_number_snapshot text NOT NULL,
  intent_expires_at timestamptz NOT NULL,
  intent_consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  duration_seconds integer,
  error_code text,
  error_summary text,
  CONSTRAINT computer_call_sessions_provider_valid CHECK (provider = 'twilio'),
  CONSTRAINT computer_call_sessions_direction_valid CHECK (direction = 'outbound'),
  CONSTRAINT computer_call_sessions_method_valid CHECK (method = 'browser_voip'),
  CONSTRAINT computer_call_sessions_status_valid CHECK (status IN ('created', 'queued', 'ringing', 'in-progress', 'completed', 'busy', 'no-answer', 'canceled', 'failed', 'unknown')),
  CONSTRAINT computer_call_sessions_duration_seconds_nonnegative CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
);

CREATE INDEX IF NOT EXISTS computer_call_sessions_owner_created_at_idx
  ON computer_call_sessions(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS computer_call_sessions_phone_id_idx
  ON computer_call_sessions(phone_id);
CREATE INDEX IF NOT EXISTS computer_call_sessions_provider_call_sid_idx
  ON computer_call_sessions(provider_call_sid);

ALTER TABLE call_sessions
  DROP CONSTRAINT IF EXISTS call_sessions_method_valid;

ALTER TABLE call_sessions
  ADD CONSTRAINT call_sessions_method_valid CHECK (method IN ('standard_call', 'office_call', 'individual_voicemail', 'mobile_log', 'browser_voip'));
`;

// Read-only metadata check avoids taking call_sessions table locks on each boot.
export const computerCallingReadySql = `SELECT
 NOT EXISTS (SELECT 1 FROM (VALUES ('id'), ('owner_id'), ('organization_id'), ('contact_id'), ('phone_id'), ('provider'), ('provider_call_sid'), ('direction'), ('method'), ('status'), ('caller_id_snapshot'), ('destination_number_snapshot'), ('intent_expires_at'), ('intent_consumed_at'), ('created_at'), ('started_at'), ('answered_at'), ('ended_at'), ('updated_at'), ('duration_seconds'), ('error_code'), ('error_summary')) expected(name)
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
     WHERE table_schema=current_schema() AND table_name='computer_call_sessions'
       AND column_name=expected.name))
 AND NOT EXISTS (SELECT 1 FROM (VALUES
   ('computer_call_sessions_owner_created_at_idx'),
   ('computer_call_sessions_phone_id_idx'),
   ('computer_call_sessions_provider_call_sid_idx')
 ) expected(name) WHERE NOT EXISTS (SELECT 1 FROM pg_index
   WHERE indexrelid=to_regclass(current_schema()||'.'||expected.name)
     AND indrelid=to_regclass(current_schema()||'.computer_call_sessions') AND indisvalid))
 AND EXISTS (SELECT 1 FROM pg_constraint
   WHERE conrelid=to_regclass(current_schema()||'.call_sessions')
     AND conname='call_sessions_method_valid' AND contype='c' AND convalidated
     AND regexp_replace(pg_get_expr(conbin, conrelid), '[()[:space:]]', '', 'g') =
       'method=ANYARRAY[''standard_call''::text,''office_call''::text,''individual_voicemail''::text,''mobile_log''::text,''browser_voip''::text]')
 AS ready`;
async function isComputerCallingSchemaReady(client: Client): Promise<boolean> {
  return (await client.query(computerCallingReadySql)).rows[0]?.ready === true;
}

const advisoryTryLockSql =
  "SELECT pg_try_advisory_xact_lock(hashtext('adventure-zone:computer-calling-schema')) AS locked";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(destroy?: boolean): void;
};
type Pool = { connect(): Promise<Client> };

export async function ensureComputerCallingSchemaBeforeListen(options?: {
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
    if (await isComputerCallingSchemaReady(client)) {
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
        throw new Error("COMPUTER_CALLING_SCHEMA_LOCK_BUSY");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, Math.max(1, deadline - Date.now()))),
      );
    }
    // A competing deploy may have finished while we waited for the lock.
    if (!(await isComputerCallingSchemaReady(client))) {
      await client.query(ensureSchemaSql);
    }
    if (!(await isComputerCallingSchemaReady(client))) {
      throw new Error("COMPUTER_CALLING_SCHEMA_INCOMPLETE");
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
