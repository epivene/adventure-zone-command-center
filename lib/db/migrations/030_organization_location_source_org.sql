-- Track which source organization (retired via consolidation) produced each
-- organization_locations record. Used for accurate redirect lookups.
--
-- Nullable: pre-existing locations created outside the consolidation workflow
-- leave this null. Within a consolidation, at most one location per source org
-- is ever created under a given canonical org (enforced by the unique index).

ALTER TABLE organization_locations
  ADD COLUMN IF NOT EXISTS consolidation_source_org_id uuid
    REFERENCES organizations(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS organization_locations_consolidation_source_org_unique
  ON organization_locations(organization_id, consolidation_source_org_id)
  WHERE consolidation_source_org_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS organization_locations_consolidation_source_org_idx
  ON organization_locations(consolidation_source_org_id)
  WHERE consolidation_source_org_id IS NOT NULL;
