CREATE TABLE IF NOT EXISTS business_source_document_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES business_source_documents(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  mime_type text NOT NULL,
  original_size_bytes bigint NOT NULL,
  sha256_hex text NOT NULL,
  uploaded_by text NOT NULL,
  uploaded_at timestamptz NOT NULL,
  CONSTRAINT business_source_document_files_size_nonnegative CHECK (original_size_bytes >= 0),
  CONSTRAINT business_source_document_files_sha256_hex_valid CHECK (sha256_hex ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS business_source_document_files_document_unique
  ON business_source_document_files(source_document_id);
CREATE UNIQUE INDEX IF NOT EXISTS business_source_document_files_storage_key_unique
  ON business_source_document_files(storage_key);

CREATE TABLE IF NOT EXISTS business_source_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES business_source_documents(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  organization_location_id uuid REFERENCES organization_locations(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  package_template_id uuid REFERENCES package_templates(id) ON DELETE SET NULL,
  link_kind text NOT NULL,
  link_note text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_source_document_links_kind_valid CHECK (
    link_kind IN ('profile','location','booking','package_reference')
  ),
  CONSTRAINT business_source_document_links_exactly_one_target CHECK (
    (organization_id IS NOT NULL)::int +
    (organization_location_id IS NOT NULL)::int +
    (booking_id IS NOT NULL)::int +
    (package_template_id IS NOT NULL)::int = 1
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS business_source_document_links_profile_unique
  ON business_source_document_links(source_document_id, organization_id)
  WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS business_source_document_links_location_unique
  ON business_source_document_links(source_document_id, organization_location_id)
  WHERE organization_location_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS business_source_document_links_booking_unique
  ON business_source_document_links(source_document_id, booking_id)
  WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS business_source_document_links_package_unique
  ON business_source_document_links(source_document_id, package_template_id)
  WHERE package_template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS business_source_document_links_organization_created_idx
  ON business_source_document_links(organization_id, created_at);
CREATE INDEX IF NOT EXISTS business_source_document_links_location_created_idx
  ON business_source_document_links(organization_location_id, created_at);
CREATE INDEX IF NOT EXISTS business_source_document_links_booking_created_idx
  ON business_source_document_links(booking_id, created_at);

CREATE TABLE IF NOT EXISTS business_source_historical_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id uuid NOT NULL REFERENCES business_source_documents(id) ON DELETE CASCADE,
  document_link_id uuid REFERENCES business_source_document_links(id) ON DELETE SET NULL,
  term_key text NOT NULL,
  label text NOT NULL,
  value_text text NOT NULL,
  value_type text NOT NULL,
  source_locator text NOT NULL,
  review_state text NOT NULL DEFAULT 'proposed',
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_source_historical_terms_value_type_valid CHECK (
    value_type IN ('text','money_cents','date','date_range','integer','boolean')
  ),
  CONSTRAINT business_source_historical_terms_review_valid CHECK (
    review_state IN ('proposed','approved','rejected')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS business_source_historical_terms_identity_unique
  ON business_source_historical_terms(source_document_id, term_key, source_locator);
CREATE INDEX IF NOT EXISTS business_source_historical_terms_document_review_idx
  ON business_source_historical_terms(source_document_id, review_state);
