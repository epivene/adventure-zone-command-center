CREATE TABLE IF NOT EXISTS design_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  office_account_id uuid NOT NULL REFERENCES office_accounts(id) ON DELETE RESTRICT,
  name text NOT NULL,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES design_assets(id) ON DELETE SET NULL,
  issue_date date,
  expiration_date date,
  review_state text NOT NULL DEFAULT 'needs_review' CHECK (review_state IN ('needs_review','reviewed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (issue_date IS NULL OR expiration_date IS NULL OR issue_date <= expiration_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS design_certificates_asset_unique ON design_certificates (asset_id);
CREATE INDEX IF NOT EXISTS design_certificates_account_expiration_idx ON design_certificates (office_account_id, expiration_date);
CREATE INDEX IF NOT EXISTS design_certificates_booking_idx ON design_certificates (booking_id);
CREATE INDEX IF NOT EXISTS design_certificates_organization_idx ON design_certificates (organization_id);