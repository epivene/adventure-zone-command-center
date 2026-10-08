CREATE TABLE IF NOT EXISTS festival_editions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 2200),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS festival_editions_organization_year ON festival_editions(organization_id, year);
