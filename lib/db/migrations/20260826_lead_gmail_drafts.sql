CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS lead_gmail_draft_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  row_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  contact_id uuid,
  google_connection_id uuid NOT NULL,
  communication_template_id uuid NOT NULL,
  template_version text NOT NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  gmail_draft_id text,
  gmail_message_id text,
  state text NOT NULL DEFAULT 'prepared',
  last_error_code text,
  idempotency_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL,
  completed_at timestamptz
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_gmail_draft_links_row_fk' AND conrelid = 'lead_gmail_draft_links'::regclass) THEN
    ALTER TABLE lead_gmail_draft_links ADD CONSTRAINT lead_gmail_draft_links_row_fk FOREIGN KEY (row_id) REFERENCES lead_import_rows(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_gmail_draft_links_organization_fk' AND conrelid = 'lead_gmail_draft_links'::regclass) THEN
    ALTER TABLE lead_gmail_draft_links ADD CONSTRAINT lead_gmail_draft_links_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_gmail_draft_links_contact_fk' AND conrelid = 'lead_gmail_draft_links'::regclass) THEN
    ALTER TABLE lead_gmail_draft_links ADD CONSTRAINT lead_gmail_draft_links_contact_fk FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_gmail_draft_links_google_connection_fk' AND conrelid = 'lead_gmail_draft_links'::regclass) THEN
    ALTER TABLE lead_gmail_draft_links ADD CONSTRAINT lead_gmail_draft_links_google_connection_fk FOREIGN KEY (google_connection_id) REFERENCES google_workspace_connections(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_gmail_draft_links_template_fk' AND conrelid = 'lead_gmail_draft_links'::regclass) THEN
    ALTER TABLE lead_gmail_draft_links ADD CONSTRAINT lead_gmail_draft_links_template_fk FOREIGN KEY (communication_template_id) REFERENCES communication_templates(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_gmail_draft_links_row_unique' AND conrelid = 'lead_gmail_draft_links'::regclass) THEN
    ALTER TABLE lead_gmail_draft_links ADD CONSTRAINT lead_gmail_draft_links_row_unique UNIQUE (row_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_gmail_draft_links_idempotency_unique' AND conrelid = 'lead_gmail_draft_links'::regclass) THEN
    ALTER TABLE lead_gmail_draft_links ADD CONSTRAINT lead_gmail_draft_links_idempotency_unique UNIQUE (idempotency_key);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_gmail_draft_links_state_valid' AND conrelid = 'lead_gmail_draft_links'::regclass) THEN
    ALTER TABLE lead_gmail_draft_links ADD CONSTRAINT lead_gmail_draft_links_state_valid CHECK (state IN ('prepared','created','retryable_error','manual_review'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_gmail_draft_links_email_valid' AND conrelid = 'lead_gmail_draft_links'::regclass) THEN
    ALTER TABLE lead_gmail_draft_links ADD CONSTRAINT lead_gmail_draft_links_email_valid CHECK (recipient_email = lower(btrim(recipient_email)) AND recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_gmail_draft_links_text_nonblank' AND conrelid = 'lead_gmail_draft_links'::regclass) THEN
    ALTER TABLE lead_gmail_draft_links ADD CONSTRAINT lead_gmail_draft_links_text_nonblank CHECK (btrim(template_version) <> '' AND btrim(subject) <> '' AND body <> '' AND btrim(idempotency_key) <> '' AND btrim(actor_id) <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_gmail_draft_links_attempt_positive' AND conrelid = 'lead_gmail_draft_links'::regclass) THEN
    ALTER TABLE lead_gmail_draft_links ADD CONSTRAINT lead_gmail_draft_links_attempt_positive CHECK (attempt_count > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_gmail_draft_links_created_complete' AND conrelid = 'lead_gmail_draft_links'::regclass) THEN
    ALTER TABLE lead_gmail_draft_links ADD CONSTRAINT lead_gmail_draft_links_created_complete CHECK (state <> 'created' OR (gmail_draft_id IS NOT NULL AND gmail_message_id IS NOT NULL AND completed_at IS NOT NULL AND last_error_code IS NULL));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS lead_gmail_draft_links_gmail_draft_unique ON lead_gmail_draft_links (gmail_draft_id) WHERE gmail_draft_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lead_gmail_draft_links_gmail_message_unique ON lead_gmail_draft_links (gmail_message_id) WHERE gmail_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lead_gmail_draft_links_state_updated_idx ON lead_gmail_draft_links (state, updated_at DESC);
CREATE INDEX IF NOT EXISTS lead_gmail_draft_links_organization_updated_idx ON lead_gmail_draft_links (organization_id, updated_at DESC);
