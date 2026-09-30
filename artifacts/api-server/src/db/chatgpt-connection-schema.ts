import type { SqlQuery } from "../features/chatgpt-connection/contracts";
export async function ensureChatGPTConnectionSchema(db: SqlQuery) {
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
}
