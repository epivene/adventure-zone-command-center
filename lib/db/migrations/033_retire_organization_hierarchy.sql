-- Complete the move from child organization profiles to internal locations.
-- This migration is deliberately restart-safe: source organizations are keyed
-- through consolidation_source_org_id and every reassignment is idempotent.

ALTER TABLE organization_locations
  ADD COLUMN IF NOT EXISTS travel_leg_id uuid
    REFERENCES travel_legs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS organization_locations_travel_leg_id_idx
  ON organization_locations(travel_leg_id);

-- A location inherits a planning leg only when all of its leg-assigned
-- bookings agree. Booking rows themselves remain unchanged.
WITH unanimous AS (
  SELECT organization_location_id AS location_id, min(travel_leg_id::text)::uuid AS travel_leg_id
  FROM bookings
  WHERE organization_location_id IS NOT NULL AND travel_leg_id IS NOT NULL
  GROUP BY organization_location_id
  HAVING count(DISTINCT travel_leg_id) = 1
)
UPDATE organization_locations AS location
SET travel_leg_id = unanimous.travel_leg_id,
    updated_at = now()
FROM unanimous
WHERE location.id = unanimous.location_id
  AND location.travel_leg_id IS NULL;

DO $$
DECLARE
  child record;
  location_id uuid;
  distinct_leg_count integer;
  inferred_leg_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'organizations'
      AND column_name = 'parent_organization_id'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestry AS (
      SELECT id AS origin_id, parent_organization_id AS ancestor_id,
        ARRAY[id]::uuid[] AS path, false AS cycle
      FROM organizations WHERE parent_organization_id IS NOT NULL
      UNION ALL
      SELECT ancestry.origin_id, organizations.parent_organization_id,
        ancestry.path || ancestry.ancestor_id,
        ancestry.ancestor_id = ANY(ancestry.path)
      FROM ancestry
      JOIN organizations ON organizations.id = ancestry.ancestor_id
      WHERE ancestry.ancestor_id IS NOT NULL AND NOT ancestry.cycle
    )
    SELECT 1 FROM ancestry WHERE cycle
  ) THEN
    RAISE EXCEPTION 'Cannot retire organization hierarchy: cycle detected';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM organizations AS child
    JOIN organizations AS parent ON parent.id = child.parent_organization_id
    WHERE child.parent_organization_id IS NOT NULL
      AND parent.parent_organization_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot retire organization hierarchy: nested hierarchy requires review';
  END IF;

  FOR child IN EXECUTE $query$
    SELECT source.*, parent.id AS verified_parent_id
    FROM organizations AS source
    LEFT JOIN organizations AS parent ON parent.id = source.parent_organization_id
    WHERE source.parent_organization_id IS NOT NULL
    ORDER BY source.created_at, source.id
  $query$
  LOOP
    IF child.verified_parent_id IS NULL THEN
      RAISE EXCEPTION 'Cannot retire organization hierarchy: parent missing for %', child.id;
    END IF;
    IF child.consolidated_into_id IS NOT NULL
       AND child.consolidated_into_id <> child.parent_organization_id THEN
      RAISE EXCEPTION 'Cannot retire organization hierarchy: % already points to another canonical organization', child.id;
    END IF;

    SELECT id INTO location_id
    FROM organization_locations
    WHERE organization_id = child.parent_organization_id
      AND consolidation_source_org_id = child.id;

    IF location_id IS NULL THEN
      SELECT count(DISTINCT travel_leg_id), min(travel_leg_id::text)::uuid
      INTO distinct_leg_count, inferred_leg_id
      FROM bookings
      WHERE organization_id = child.id AND travel_leg_id IS NOT NULL;

      INSERT INTO organization_locations (
        organization_id, label, venue_name, address_1, address_2, city, region,
        postal_code, website, phone, normalized_phone, local_status,
        act_record_id, act_source_label, consolidation_source_org_id,
        travel_leg_id, created_at, updated_at
      ) VALUES (
        child.parent_organization_id,
        coalesce(nullif(concat_ws(', ', nullif(child.city, ''), nullif(child.region, '')), ''), child.name),
        child.name, child.address_1, child.address_2, child.city, child.region,
        child.postal_code, child.website, child.phone, child.normalized_phone,
        NULL, child.act_record_id,
        'Retired organization profile: ' || child.name, child.id,
        CASE WHEN distinct_leg_count = 1 THEN inferred_leg_id ELSE NULL END,
        child.created_at, now()
      )
      ON CONFLICT (organization_id, consolidation_source_org_id)
        WHERE consolidation_source_org_id IS NOT NULL
      DO UPDATE SET updated_at = EXCLUDED.updated_at
      RETURNING id INTO location_id;
    END IF;

    INSERT INTO organization_contacts (
      organization_id, contact_id, role, is_primary, active, source, created_at, updated_at
    )
    SELECT child.parent_organization_id, association.contact_id, association.role,
      association.is_primary AND NOT EXISTS (
        SELECT 1 FROM organization_contacts AS existing_primary
        WHERE existing_primary.organization_id = child.parent_organization_id
          AND existing_primary.active AND existing_primary.is_primary
      ),
      association.active, association.source, association.created_at, now()
    FROM organization_contacts AS association
    WHERE association.organization_id = child.id
    ON CONFLICT (organization_id, contact_id) DO UPDATE
      SET role = coalesce(organization_contacts.role, EXCLUDED.role),
          active = organization_contacts.active OR EXCLUDED.active,
          updated_at = now();

    UPDATE contacts SET organization_id = child.parent_organization_id,
      organization_location_id = coalesce(organization_location_id, location_id), updated_at = now()
      WHERE organization_id = child.id;
    UPDATE bookings SET organization_id = child.parent_organization_id,
      organization_location_id = coalesce(organization_location_id, location_id), updated_at = now()
      WHERE organization_id = child.id;
    UPDATE activities SET organization_id = child.parent_organization_id,
      organization_location_id = coalesce(organization_location_id, location_id), updated_at = now()
      WHERE organization_id = child.id;
    UPDATE follow_ups SET organization_id = child.parent_organization_id,
      organization_location_id = coalesce(organization_location_id, location_id), updated_at = now()
      WHERE organization_id = child.id;
    UPDATE call_sessions SET organization_id = child.parent_organization_id,
      organization_location_id = coalesce(organization_location_id, location_id)
      WHERE organization_id = child.id;

    DELETE FROM organization_contacts WHERE organization_id = child.id;

    UPDATE organizations SET consolidated_into_id = child.parent_organization_id,
      consolidated_at = coalesce(consolidated_at, now()), updated_at = now()
      WHERE id = child.id;
  END LOOP;
END $$;

DROP INDEX IF EXISTS organizations_parent_organization_idx;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_not_own_parent;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_parent_organization_id_fkey;
ALTER TABLE organizations DROP COLUMN IF EXISTS parent_organization_id;
