ALTER TABLE google_workspace_connections
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'workspace',
  ADD COLUMN IF NOT EXISTS operational_calendar_id text;

ALTER TABLE google_workspace_oauth_states
  ADD COLUMN IF NOT EXISTS connection_role text NOT NULL DEFAULT 'workspace';

DROP INDEX IF EXISTS google_workspace_connections_single_active_unique;
DROP INDEX IF EXISTS google_workspace_connections_active_role_unique;

CREATE UNIQUE INDEX IF NOT EXISTS google_workspace_connections_active_role_unique
  ON google_workspace_connections(role)
  WHERE status IN ('connected', 'reauthorization_required');

DO $$ BEGIN
  ALTER TABLE google_workspace_connections
    ADD CONSTRAINT google_workspace_connections_role_valid
    CHECK (role IN ('workspace', 'operational_calendar'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE google_workspace_connections
    ADD CONSTRAINT google_workspace_connections_operational_calendar_role_valid
    CHECK (role = 'operational_calendar' OR operational_calendar_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE google_workspace_oauth_states
    ADD CONSTRAINT google_workspace_oauth_states_connection_role_valid
    CHECK (connection_role IN ('workspace', 'operational_calendar'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
