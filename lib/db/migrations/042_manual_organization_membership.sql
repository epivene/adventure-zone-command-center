ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS parent_organization_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'organizations'::regclass
      AND conname = 'organizations_parent_organization_id_fkey'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_parent_organization_id_fkey
      FOREIGN KEY (parent_organization_id)
      REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organizations_parent_organization_id_idx
  ON organizations(parent_organization_id)
  WHERE parent_organization_id IS NOT NULL;
