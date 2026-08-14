-- Add consolidation tracking columns to organizations.
--
-- consolidated_into_id: non-null when this profile has been retired via the
--   "Consolidate as locations" workflow and absorbed into a canonical parent.
-- consolidated_at: timestamp when the consolidation was applied.
--
-- A consolidated profile no longer appears in search, list, or duplicate
-- suggestions. Navigating to its URL returns a redirect hint to the canonical
-- org with the matching location ID.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS consolidated_into_id uuid
    REFERENCES organizations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS consolidated_at timestamptz;

-- Self-reference check: a profile cannot be its own consolidation target.
DO $$ BEGIN
  ALTER TABLE organizations
    ADD CONSTRAINT organizations_not_own_consolidation
    CHECK (consolidated_into_id IS NULL OR consolidated_into_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS organizations_consolidated_into_id_idx
  ON organizations(consolidated_into_id)
  WHERE consolidated_into_id IS NOT NULL;
