CREATE TABLE IF NOT EXISTS google_workspace_profile_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  gmail_label_id text NOT NULL,
  gmail_label_name text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_workspace_profile_labels_connection_organization_unique
    UNIQUE (connection_id, organization_id),
  CONSTRAINT google_workspace_profile_labels_connection_label_unique
    UNIQUE (connection_id, gmail_label_id),
  CONSTRAINT google_workspace_profile_labels_identity_nonblank
    CHECK (btrim(gmail_label_id) <> '' AND btrim(gmail_label_name) <> ''),
  CONSTRAINT google_workspace_profile_labels_state_valid
    CHECK (state IN ('active','conflict','unavailable'))
);

CREATE TABLE IF NOT EXISTS google_workspace_gmail_mutations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES google_workspace_connections(id) ON DELETE CASCADE,
  message_id text NOT NULL,
  thread_id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  target_label_id text,
  remove_label_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  next_attempt_at timestamptz,
  processing_lease_expires_at timestamptz,
  actor_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_workspace_gmail_mutations_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT google_workspace_gmail_mutations_identity_nonblank
    CHECK (btrim(message_id) <> '' AND btrim(thread_id) <> '' AND btrim(idempotency_key) <> ''),
  CONSTRAINT google_workspace_gmail_mutations_operation_valid
    CHECK (operation IN ('assign_thread','label_inbound_message')),
  CONSTRAINT google_workspace_gmail_mutations_state_valid
    CHECK (state IN ('pending','processing','completed','retryable_error','permanent_error','conflict')),
  CONSTRAINT google_workspace_gmail_mutations_remove_labels_array
    CHECK (jsonb_typeof(remove_label_ids) = 'array'),
  CONSTRAINT google_workspace_gmail_mutations_attempt_nonnegative
    CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS google_workspace_gmail_mutations_retry_idx
  ON google_workspace_gmail_mutations (state, next_attempt_at, processing_lease_expires_at);

ALTER TABLE google_workspace_validation_review_items
  ADD COLUMN IF NOT EXISTS gmail_sync_state text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS gmail_sync_error_code text,
  ADD COLUMN IF NOT EXISTS gmail_sync_mutation_id uuid
    REFERENCES google_workspace_gmail_mutations(id) ON DELETE SET NULL;

ALTER TABLE google_workspace_validation_review_items
  DROP CONSTRAINT IF EXISTS google_workspace_validation_review_gmail_sync_state_valid;
ALTER TABLE google_workspace_validation_review_items
  ADD CONSTRAINT google_workspace_validation_review_gmail_sync_state_valid
  CHECK (gmail_sync_state IN (
    'not_requested','pending','completed','retryable_error','permanent_error','conflict'
  ));
