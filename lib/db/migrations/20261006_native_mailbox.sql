BEGIN;
      ALTER TABLE google_workspace_gmail_mutations
        DROP CONSTRAINT IF EXISTS google_workspace_gmail_mutations_operation_valid;
      ALTER TABLE google_workspace_gmail_mutations
        ADD CONSTRAINT google_workspace_gmail_mutations_operation_valid
          CHECK (operation IN ('assign_thread','link_thread','label_inbound_message'));
      CREATE TABLE IF NOT EXISTS google_workspace_mailbox_sends (
        connection_id uuid NOT NULL REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
        draft_id text NOT NULL,
        revision text NOT NULL,
        state text NOT NULL CHECK (state IN ('sending','sent','uncertain')),
        message_id text,
        thread_id text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (connection_id, draft_id)
      );
COMMIT;
