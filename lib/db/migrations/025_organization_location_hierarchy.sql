ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS parent_organization_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_parent_organization_fk'
      AND conrelid = 'organizations'::regclass
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_parent_organization_fk
      FOREIGN KEY (parent_organization_id)
      REFERENCES organizations(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'organizations_not_own_parent'
      AND conrelid = 'organizations'::regclass
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_not_own_parent
      CHECK (parent_organization_id IS NULL OR parent_organization_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organizations_parent_organization_idx
  ON organizations(parent_organization_id);

CREATE TABLE IF NOT EXISTS organization_family_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key text NOT NULL UNIQUE,
  candidate_ids jsonb NOT NULL,
  status text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_family_reviews_status_valid
    CHECK (status IN ('proposed', 'not_related')),
  CONSTRAINT organization_family_reviews_candidates_array
    CHECK (jsonb_typeof(candidate_ids) = 'array')
);
