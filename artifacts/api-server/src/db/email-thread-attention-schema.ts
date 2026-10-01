type Sql = { query(sql: string, values?: any[]): Promise<unknown> };
export async function ensureEmailThreadAttentionSchema(sql: Sql): Promise<void> {
 const ddl = `
 CREATE TABLE IF NOT EXISTS email_thread_attention (
  id uuid PRIMARY KEY, gmail_connection_id uuid NOT NULL, thread_id text NOT NULL,
  profile_id uuid NOT NULL, event_year integer, state text NOT NULL CHECK(state IN ('needs_your_reply','waiting_for_their_reply','resolved')),
  reason text NOT NULL, subject text NOT NULL, due_at timestamptz, followup_id uuid,
  reviewed_message_id text NOT NULL, revision uuid NOT NULL, actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(gmail_connection_id,thread_id)
 );
 CREATE INDEX IF NOT EXISTS email_thread_attention_open_idx ON email_thread_attention(profile_id) WHERE state <> 'resolved';
 CREATE TABLE IF NOT EXISTS email_thread_attention_previews (
  id uuid PRIMARY KEY, owner_id text NOT NULL, connector_id uuid, payload jsonb NOT NULL, expires_at timestamptz NOT NULL
 );
 CREATE TABLE IF NOT EXISTS email_thread_attention_audit (
  id uuid PRIMARY KEY, attention_id uuid NOT NULL REFERENCES email_thread_attention(id), actor_id text NOT NULL,
  before_value jsonb, after_value jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
 );
 CREATE TABLE IF NOT EXISTS email_thread_attention_operations (
  id uuid PRIMARY KEY, owner_id text NOT NULL, actor_key text NOT NULL, request_key text NOT NULL,
  request_hash text NOT NULL, preview_id uuid NOT NULL, attention_id uuid NOT NULL REFERENCES email_thread_attention(id),
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,actor_key,request_key)
 );`;
 for (const statement of ddl.split(";").filter(s => s.trim())) await sql.query(statement);
}
export async function ensureEmailThreadAttentionSchemaBeforeListen() {
 const { pool } = await import("@workspace/db");
 await ensureEmailThreadAttentionSchema(pool);
}
