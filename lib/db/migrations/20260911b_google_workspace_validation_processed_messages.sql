CREATE TABLE IF NOT EXISTS google_workspace_validation_processed_messages (
  connection_id uuid NOT NULL
    REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, message_id),
  CONSTRAINT google_workspace_validation_processed_message_nonblank
    CHECK (btrim(message_id) <> '')
);
