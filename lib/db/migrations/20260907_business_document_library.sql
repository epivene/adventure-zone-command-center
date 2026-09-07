CREATE TABLE IF NOT EXISTS business_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  original_filename text NOT NULL,
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('contract','proposal','coi','insurance_policy','w9_tax','permit','vendor_application','inspection','deposit_receipt','operational_template','marketing','other')),
  lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','archived','deleted')),
  review_state text NOT NULL DEFAULT 'needs_review' CHECK (review_state IN ('accepted','needs_review','rejected')),
  current_version_id uuid,
  effective_date date,
  issue_date date,
  expiration_date date,
  notes text,
  visibility text NOT NULL DEFAULT 'owner' CHECK (visibility IN ('owner','document_access')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  CHECK (issue_date IS NULL OR expiration_date IS NULL OR issue_date <= expiration_date)
);
CREATE INDEX IF NOT EXISTS business_documents_category_review_idx ON business_documents (category, review_state);
CREATE INDEX IF NOT EXISTS business_documents_lifecycle_updated_idx ON business_documents (lifecycle, updated_at DESC);

CREATE TABLE IF NOT EXISTS business_document_blobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256_hex text NOT NULL UNIQUE CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  validation_state text NOT NULL DEFAULT 'accepted' CHECK (validation_state IN ('accepted','quarantined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sha256_hex)
);

CREATE TABLE IF NOT EXISTS business_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES business_documents(id) ON DELETE RESTRICT,
  blob_id uuid NOT NULL REFERENCES business_document_blobs(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  original_filename text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number)
);
CREATE INDEX IF NOT EXISTS business_document_versions_document_created_idx ON business_document_versions (document_id, created_at DESC);
DO $$ BEGIN
  ALTER TABLE business_documents ADD CONSTRAINT business_documents_current_version_fk
    FOREIGN KEY (current_version_id) REFERENCES business_document_versions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS business_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES business_documents(id) ON DELETE CASCADE,
  target_kind text NOT NULL CHECK (target_kind IN ('profile','booking','event_family')),
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  event_family_id uuid REFERENCES event_families(id) ON DELETE SET NULL,
  confirmation_mode text NOT NULL CHECK (confirmation_mode IN ('manual','automatic','migrated')),
  confidence numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (((organization_id IS NOT NULL)::int + (booking_id IS NOT NULL)::int + (event_family_id IS NOT NULL)::int) = 1),
  CHECK ((target_kind = 'profile' AND organization_id IS NOT NULL) OR (target_kind = 'booking' AND booking_id IS NOT NULL) OR (target_kind = 'event_family' AND event_family_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS business_document_links_profile_unique ON business_document_links (document_id, organization_id) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS business_document_links_booking_unique ON business_document_links (document_id, booking_id) WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS business_document_links_event_family_unique ON business_document_links (document_id, event_family_id) WHERE event_family_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_document_links_profile_idx ON business_document_links (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS business_document_links_booking_idx ON business_document_links (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS business_document_links_event_family_idx ON business_document_links (event_family_id, created_at DESC);

CREATE TABLE IF NOT EXISTS business_document_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES business_documents(id) ON DELETE CASCADE,
  source_kind text NOT NULL CHECK (source_kind IN ('manual','gmail','drive','business_source','google_profile_file','design_asset','design_output')),
  source_account_key text NOT NULL,
  external_id text NOT NULL,
  original_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  availability text NOT NULL DEFAULT 'available' CHECK (availability IN ('available','retry_required','unavailable')),
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_account_key, external_id)
);
CREATE INDEX IF NOT EXISTS business_document_sources_document_idx ON business_document_sources (document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS business_document_coi_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL UNIQUE REFERENCES business_documents(id) ON DELETE CASCADE,
  office_account_id uuid REFERENCES office_accounts(id) ON DELETE RESTRICT,
  certificate_name text NOT NULL,
  issue_date date,
  expiration_date date,
  review_state text NOT NULL DEFAULT 'needs_review' CHECK (review_state IN ('reviewed','needs_review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (issue_date IS NULL OR expiration_date IS NULL OR issue_date <= expiration_date)
);
CREATE INDEX IF NOT EXISTS business_document_coi_expiration_idx ON business_document_coi_metadata (expiration_date);

CREATE TABLE IF NOT EXISTS business_document_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES business_documents(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('classification','relationship','metadata','source_failure')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','deferred','approved','rejected')),
  proposals jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  deferred_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_document_review_state_created_idx ON business_document_review_items (state, created_at);
CREATE INDEX IF NOT EXISTS business_document_review_document_idx ON business_document_review_items (document_id);

CREATE TABLE IF NOT EXISTS business_document_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES business_documents(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_document_audit_document_created_idx ON business_document_audit_events (document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS business_document_import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL CHECK (source_kind IN ('legacy','drive','gmail')),
  mode text NOT NULL CHECK (mode IN ('preview','pilot','full','incremental')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','completed_with_errors','failed')),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_document_import_runs_status_created_idx ON business_document_import_runs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS business_document_import_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES business_document_import_runs(id) ON DELETE CASCADE,
  source_external_id text NOT NULL,
  status text NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered','imported','deduplicated','review','skipped','retry','failed')),
  document_id uuid REFERENCES business_documents(id) ON DELETE SET NULL,
  sha256_hex text CHECK (sha256_hex IS NULL OR sha256_hex ~ '^[0-9a-f]{64}$'),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, source_external_id)
);
CREATE INDEX IF NOT EXISTS business_document_import_items_run_status_idx ON business_document_import_items (run_id, status);

ALTER TABLE design_certificates ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES business_documents(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS design_certificates_document_unique ON design_certificates (document_id) WHERE document_id IS NOT NULL;
