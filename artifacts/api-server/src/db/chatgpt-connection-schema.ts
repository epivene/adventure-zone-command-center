import type { SqlQuery } from "../features/chatgpt-connection/contracts";
// Read catalog metadata only: an already-installed schema must not take DDL locks
// on the live organizations table during a rolling deploy.
const requiredColumns: Record<string, string[]> = {
  chatgpt_connections: [
    "id",
    "owner_id",
    "client_id",
    "scopes",
    "grant_id",
    "revoked_at",
    "created_at",
    "last_used_at",
  ],
  chatgpt_rate_windows: ["connection_id", "window_start", "calls"],
  chatgpt_operations: [
    "id",
    "connection_id",
    "operation",
    "request_key",
    "input_hash",
    "receipt",
    "created_at",
  ],
  chatgpt_oauth_clients: ["id", "owner_id", "metadata", "created_at"],
  chatgpt_oauth_artifacts: [
    "model",
    "id_hash",
    "payload",
    "grant_id",
    "uid",
    "user_code",
    "consumed_at",
    "expires_at",
  ],
  chatgpt_lead_identities: ["identity_hash", "profile_id", "created_at"],
  chatgpt_update_proposals: [
    "id",
    "connection_id",
    "profile_id",
    "content",
    "content_hash",
    "revision",
    "created_at",
    "approval_id",
    "approved_at",
    "approval_expires_at",
    "consumed_at",
  ],
  chatgpt_external_drafts: [
    "id",
    "owner_id",
    "connection_id",
    "content",
    "revision",
    "created_at",
    "updated_at",
  ],
};
const readinessSql = `SELECT NOT EXISTS (
  SELECT 1 FROM (VALUES ${Object.entries(requiredColumns)
    .flatMap(([table, columns]) =>
      columns.map((column) => `('${table}','${column}')`),
    )
    .join(",")}) expected(table_name,column_name)
  LEFT JOIN information_schema.columns c ON c.table_schema=current_schema()
    AND c.table_name=expected.table_name AND c.column_name=expected.column_name
  WHERE c.column_name IS NULL
) AND to_regclass(current_schema() || '.chatgpt_oauth_grant_idx') IS NOT NULL
AND (to_regclass(current_schema() || '.organizations') IS NULL OR EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
  AND table_name='organizations' AND column_name='description'
)) AS ready`;

export async function isChatGPTConnectionSchemaReady(
  db: SqlQuery,
): Promise<boolean> {
  return (await db.query(readinessSql)).rows[0]?.ready === true;
}

export async function ensureChatGPTConnectionSchema(db: SqlQuery) {
  if (await isChatGPTConnectionSchemaReady(db)) return;
  const statements = `CREATE TABLE IF NOT EXISTS chatgpt_connections(
 id uuid PRIMARY KEY, owner_id text NOT NULL, client_id text NOT NULL, scopes jsonb NOT NULL DEFAULT '[]',
 grant_id text UNIQUE, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz);
 CREATE TABLE IF NOT EXISTS chatgpt_rate_windows(connection_id uuid PRIMARY KEY REFERENCES chatgpt_connections(id), window_start timestamptz NOT NULL, calls integer NOT NULL);
 CREATE TABLE IF NOT EXISTS chatgpt_operations(
 id uuid PRIMARY KEY, connection_id uuid NOT NULL REFERENCES chatgpt_connections(id), operation text NOT NULL,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 200), input_hash text NOT NULL,
 receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(connection_id,operation,request_key));
 CREATE TABLE IF NOT EXISTS chatgpt_oauth_clients(
 id text PRIMARY KEY, owner_id text NOT NULL, metadata jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS chatgpt_oauth_artifacts(
 model text NOT NULL, id_hash text NOT NULL, payload text NOT NULL, grant_id text, uid text, user_code text,
 consumed_at bigint, expires_at timestamptz, PRIMARY KEY(model,id_hash));
 CREATE INDEX IF NOT EXISTS chatgpt_oauth_grant_idx ON chatgpt_oauth_artifacts(grant_id);
 CREATE TABLE IF NOT EXISTS chatgpt_lead_identities(
 identity_hash text PRIMARY KEY, profile_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS chatgpt_update_proposals(
 id uuid PRIMARY KEY, connection_id uuid NOT NULL REFERENCES chatgpt_connections(id), profile_id uuid NOT NULL,
 content jsonb NOT NULL, content_hash text NOT NULL, revision text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 approval_id uuid UNIQUE, approved_at timestamptz, approval_expires_at timestamptz, consumed_at timestamptz);
 CREATE TABLE IF NOT EXISTS chatgpt_external_drafts(
 id uuid PRIMARY KEY, owner_id text NOT NULL, connection_id uuid NOT NULL REFERENCES chatgpt_connections(id),
 content jsonb NOT NULL, revision uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());`;
  for (const statement of statements
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)) {
    await db.query(statement);
  }
  // About historically used lazy route DDL. Install it before connector saves.
  // The isolated SQL fixture creates its CRM tables after connection tables.
  await db.query(`DO $$ BEGIN
    IF to_regclass('organizations') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name='organizations' AND column_name='description'
    ) THEN
      ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description text;
    END IF;
  END; $$`);
}
