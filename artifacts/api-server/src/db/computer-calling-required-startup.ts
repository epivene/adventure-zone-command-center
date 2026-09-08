import { pool as defaultPool } from "@workspace/db";

const advisoryTryLockSql =
  "SELECT pg_try_advisory_lock(hashtext('adventure-zone:computer-calling-schema')) AS locked";
const advisoryUnlockSql =
  "SELECT pg_advisory_unlock(hashtext('adventure-zone:computer-calling-schema'))";

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

type StartupClient = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
};

type StartupPool = {
  connect(): Promise<StartupClient>;
};

export async function ensureComputerCallingSchemaBeforeListen(options?: {
  pool?: StartupPool;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as StartupPool);
  const client = await pool.connect();
  let locked = false;
  let transactionStarted = false;

  try {
    const result = await client.query(advisoryTryLockSql);
    locked = result.rows[0]?.locked === true;
    if (!locked) throw new Error("COMPUTER_CALLING_SCHEMA_LOCK_BUSY");
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(ensureSchemaSql);
    await client.query("COMMIT");
    transactionStarted = false;
    return true;
  } catch (error) {
    if (transactionStarted)
      await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    if (locked) await client.query(advisoryUnlockSql).catch(() => undefined);
    client.release();
  }
}
