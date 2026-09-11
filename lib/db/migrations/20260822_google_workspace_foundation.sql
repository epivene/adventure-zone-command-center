CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS google_workspace_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_email text NOT NULL,
  status text NOT NULL DEFAULT 'connected',
  encrypted_refresh_token jsonb NOT NULL,
  granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  google_subject text,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  disconnected_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_workspace_connections_account_email_unique
    UNIQUE (account_email),
  CONSTRAINT google_workspace_connections_status_valid
    CHECK (status IN ('connected', 'reauthorization_required', 'disconnected')),
  CONSTRAINT google_workspace_connections_encrypted_token_object
    CHECK (jsonb_typeof(encrypted_refresh_token) = 'object'),
  CONSTRAINT google_workspace_connections_granted_scopes_array
    CHECK (jsonb_typeof(granted_scopes) = 'array')
);

DO $ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'google_workspace_connections'
      AND column_name = 'role'
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS google_workspace_connections_single_active_unique
      ON google_workspace_connections ((1))
      WHERE status IN ('connected', 'reauthorization_required');
  END IF;
END $;
CREATE INDEX IF NOT EXISTS google_workspace_connections_status_idx
  ON google_workspace_connections (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS google_workspace_oauth_states (
  state_hash text PRIMARY KEY,
  return_path text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_workspace_oauth_states_return_path_nonblank
    CHECK (btrim(return_path) <> '')
);

CREATE INDEX IF NOT EXISTS google_workspace_oauth_states_unconsumed_expiry_idx
  ON google_workspace_oauth_states (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS google_workspace_label_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL
    REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
  label_id text NOT NULL,
  label_name text NOT NULL,
  root_label_id text NOT NULL,
  root_label_name text NOT NULL,
  selected boolean NOT NULL DEFAULT true,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_workspace_label_scopes_connection_label_unique
    UNIQUE (connection_id, label_id),
  CONSTRAINT google_workspace_label_scopes_identity_nonblank
    CHECK (
      btrim(label_id) <> '' AND
      btrim(label_name) <> '' AND
      btrim(root_label_id) <> '' AND
      btrim(root_label_name) <> ''
    )
);

CREATE INDEX IF NOT EXISTS google_workspace_label_scopes_selected_idx
  ON google_workspace_label_scopes (connection_id, root_label_id, label_id)
  WHERE selected = true;

CREATE TABLE IF NOT EXISTS google_workspace_calendar_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL
    REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
  calendar_id text NOT NULL,
  summary text NOT NULL,
  primary_calendar boolean NOT NULL DEFAULT false,
  selected boolean NOT NULL DEFAULT true,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_workspace_calendar_scopes_connection_calendar_unique
    UNIQUE (connection_id, calendar_id),
  CONSTRAINT google_workspace_calendar_scopes_identity_nonblank
    CHECK (btrim(calendar_id) <> '' AND btrim(summary) <> '')
);

CREATE INDEX IF NOT EXISTS google_workspace_calendar_scopes_selected_idx
  ON google_workspace_calendar_scopes (connection_id, calendar_id)
  WHERE selected = true;

CREATE TABLE IF NOT EXISTS google_workspace_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_kind text NOT NULL,
  actor_id text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_workspace_audit_events_actor_kind_valid
    CHECK (actor_kind IN ('owner', 'office', 'system')),
  CONSTRAINT google_workspace_audit_events_action_nonblank
    CHECK (btrim(action) <> ''),
  CONSTRAINT google_workspace_audit_events_target_type_nonblank
    CHECK (btrim(target_type) <> ''),
  CONSTRAINT google_workspace_audit_events_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS google_workspace_audit_events_created_idx
  ON google_workspace_audit_events (created_at DESC, id DESC);
