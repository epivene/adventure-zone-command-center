CREATE TABLE IF NOT EXISTS contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stable_key text NOT NULL,
  version integer NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  fixed_clauses jsonb NOT NULL DEFAULT '{}'::jsonb,
  arrangement_clauses jsonb NOT NULL DEFAULT '{}'::jsonb,
  operational_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  render_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_provenance jsonb NOT NULL DEFAULT '[]'::jsonb,
  effective_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_templates_stable_key_version_unique UNIQUE (stable_key, version),
  CONSTRAINT contract_templates_stable_key_nonblank CHECK (nullif(trim(stable_key), '') IS NOT NULL),
  CONSTRAINT contract_templates_version_positive CHECK (version >= 1),
  CONSTRAINT contract_templates_state_valid CHECK (state IN ('draft', 'reviewed', 'active', 'retired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS contract_templates_one_active_key_unique
  ON contract_templates (stable_key) WHERE state = 'active';

CREATE TABLE IF NOT EXISTS contract_settings (
  key text PRIMARY KEY DEFAULT 'default',
  internal_signer_name text NOT NULL DEFAULT 'Dave Gordon',
  internal_signer_email text,
  internal_signer_order integer NOT NULL DEFAULT 2,
  insurance_recipient_name text NOT NULL DEFAULT 'Amanda Morton',
  insurance_recipient_email text NOT NULL DEFAULT 'amanda@protectiveins.net',
  updated_by text NOT NULL DEFAULT 'migration',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_settings_singleton_key CHECK (key = 'default'),
  CONSTRAINT contract_settings_internal_signer_name_nonblank CHECK (nullif(trim(internal_signer_name), '') IS NOT NULL),
  CONSTRAINT contract_settings_internal_signer_order_second CHECK (internal_signer_order = 2),
  CONSTRAINT contract_settings_insurance_name_nonblank CHECK (nullif(trim(insurance_recipient_name), '') IS NOT NULL),
  CONSTRAINT contract_settings_insurance_email_nonblank CHECK (nullif(trim(insurance_recipient_email), '') IS NOT NULL)
);

INSERT INTO contract_settings (key) VALUES ('default') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS contract_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL REFERENCES contract_templates(id) ON DELETE RESTRICT,
  arrangement text,
  values jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1,
  predecessor_version_id uuid,
  finalized_at timestamptz,
  last_edited_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_drafts_arrangement_valid CHECK (
    arrangement IS NULL OR arrangement IN ('guaranteed_fee', 'pay_for_play', 'guarantee_plus_percentage')
  ),
  CONSTRAINT contract_drafts_revision_positive CHECK (revision >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS contract_drafts_one_open_booking_unique
  ON contract_drafts (booking_id) WHERE finalized_at IS NULL;
CREATE INDEX IF NOT EXISTS contract_drafts_organization_idx
  ON contract_drafts (organization_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  template_id uuid NOT NULL REFERENCES contract_templates(id) ON DELETE RESTRICT,
  draft_id uuid NOT NULL REFERENCES contract_drafts(id) ON DELETE RESTRICT,
  version_number integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  snapshot jsonb NOT NULL,
  rendered_legal_text text NOT NULL,
  signer_snapshot jsonb NOT NULL,
  predecessor_version_id uuid REFERENCES contract_versions(id) ON DELETE RESTRICT,
  superseding_version_id uuid REFERENCES contract_versions(id) ON DELETE RESTRICT,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_versions_booking_number_unique UNIQUE (booking_id, version_number),
  CONSTRAINT contract_versions_draft_unique UNIQUE (draft_id),
  CONSTRAINT contract_versions_number_positive CHECK (version_number >= 1),
  CONSTRAINT contract_versions_status_valid CHECK (
    status IN ('draft', 'ready_for_adobe', 'sent_for_signature', 'partially_signed', 'completed', 'declined', 'cancelled', 'superseded')
  )
);

CREATE INDEX IF NOT EXISTS contract_versions_organization_created_idx
  ON contract_versions (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contract_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_version_id uuid NOT NULL REFERENCES contract_versions(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  revision integer NOT NULL,
  storage_key text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/pdf',
  original_filename text NOT NULL,
  original_size_bytes integer NOT NULL,
  sha256_hex text NOT NULL,
  uploaded_by text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CONSTRAINT contract_files_kind_revision_unique UNIQUE (contract_version_id, kind, revision),
  CONSTRAINT contract_files_version_checksum_unique UNIQUE (contract_version_id, sha256_hex),
  CONSTRAINT contract_files_kind_valid CHECK (kind IN ('unsigned_generated', 'signed_completed')),
  CONSTRAINT contract_files_revision_positive CHECK (revision >= 1),
  CONSTRAINT contract_files_mime_pdf CHECK (mime_type = 'application/pdf'),
  CONSTRAINT contract_files_size_positive CHECK (original_size_bytes > 0),
  CONSTRAINT contract_files_sha256_valid CHECK (sha256_hex ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS contract_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_version_id uuid NOT NULL REFERENCES contract_versions(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  actor_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_status_events_from_valid CHECK (
    from_status IS NULL OR from_status IN ('draft', 'ready_for_adobe', 'sent_for_signature', 'partially_signed', 'completed', 'declined', 'cancelled', 'superseded')
  ),
  CONSTRAINT contract_status_events_to_valid CHECK (
    to_status IN ('draft', 'ready_for_adobe', 'sent_for_signature', 'partially_signed', 'completed', 'declined', 'cancelled', 'superseded')
  ),
  CONSTRAINT contract_status_events_key_nonblank CHECK (nullif(trim(idempotency_key), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS contract_status_events_version_created_idx
  ON contract_status_events (contract_version_id, created_at);

CREATE TABLE IF NOT EXISTS contract_coi_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_version_id uuid NOT NULL UNIQUE REFERENCES contract_versions(id) ON DELETE RESTRICT,
  recipient_name text NOT NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL,
  google_connection_id uuid,
  gmail_draft_id text,
  gmail_message_id text,
  last_error_code text,
  idempotency_key text NOT NULL UNIQUE,
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_coi_drafts_state_valid CHECK (
    state IN ('details_needed', 'prepared', 'created', 'retryable_error', 'manual_review')
  ),
  CONSTRAINT contract_coi_drafts_recipient_name_nonblank CHECK (nullif(trim(recipient_name), '') IS NOT NULL),
  CONSTRAINT contract_coi_drafts_recipient_email_nonblank CHECK (nullif(trim(recipient_email), '') IS NOT NULL),
  CONSTRAINT contract_coi_drafts_attempt_nonnegative CHECK (attempt_count >= 0),
  CONSTRAINT contract_coi_drafts_created_ids_valid CHECK (
    state <> 'created' OR (gmail_draft_id IS NOT NULL AND gmail_message_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);
