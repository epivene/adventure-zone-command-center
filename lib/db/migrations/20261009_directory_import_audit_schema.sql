-- Schema-only companion to the two guarded September directory imports.
-- Automatic setup may create audit tables without importing their datasets.
CREATE TABLE IF NOT EXISTS directory_import_records (
  batch text NOT NULL,
  source_key text NOT NULL,
  payload jsonb NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK(status IN ('created','matched','review','excluded')),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(batch, source_key)
);
CREATE TABLE IF NOT EXISTS directory_import_20260910_batch (
  batch text PRIMARY KEY,
  records integer NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
