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
  source_org record;
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
    FROM organizations AS child_org
    JOIN organizations AS parent_org ON parent_org.id = child_org.parent_organization_id
    WHERE child_org.parent_organization_id IS NOT NULL
      AND parent_org.parent_organization_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Cannot retire organization hierarchy: nested hierarchy requires review';
  END IF;

  FOR source_org IN EXECUTE $query$
    SELECT source.*, parent_org.id AS verified_parent_id
    FROM organizations AS source
    LEFT JOIN organizations AS parent_org ON parent_org.id = source.parent_organization_id
    WHERE source.parent_organization_id IS NOT NULL
    ORDER BY source.created_at, source.id
  $query$
  LOOP
    IF source_org.verified_parent_id IS NULL THEN
      RAISE EXCEPTION 'Cannot retire organization hierarchy: parent missing for %', source_org.id;
    END IF;
    IF source_org.consolidated_into_id IS NOT NULL
       AND source_org.consolidated_into_id <> source_org.parent_organization_id THEN
      RAISE EXCEPTION 'Cannot retire organization hierarchy: % already points to another canonical organization', source_org.id;
    END IF;

    SELECT id INTO location_id
    FROM organization_locations
    WHERE organization_id = source_org.parent_organization_id
      AND consolidation_source_org_id = source_org.id;

    IF location_id IS NULL THEN
      SELECT count(DISTINCT travel_leg_id), min(travel_leg_id::text)::uuid
      INTO distinct_leg_count, inferred_leg_id
      FROM bookings
      WHERE organization_id = source_org.id AND travel_leg_id IS NOT NULL;

      INSERT INTO organization_locations (
        organization_id, label, venue_name, address_1, address_2, city, region,
        postal_code, website, phone, normalized_phone, local_status,
        act_record_id, act_source_label, consolidation_source_org_id,
        travel_leg_id, created_at, updated_at
      ) VALUES (
        source_org.parent_organization_id,
        coalesce(nullif(concat_ws(', ', nullif(source_org.city, ''), nullif(source_org.region, '')), ''), source_org.name),
        source_org.name, source_org.address_1, source_org.address_2, source_org.city, source_org.region,
        source_org.postal_code, source_org.website, source_org.phone, source_org.normalized_phone,
        NULL, source_org.act_record_id,
        'Retired organization profile: ' || source_org.name, source_org.id,
        CASE WHEN distinct_leg_count = 1 THEN inferred_leg_id ELSE NULL END,
        source_org.created_at, now()
      )
      ON CONFLICT (organization_id, consolidation_source_org_id)
        WHERE consolidation_source_org_id IS NOT NULL
      DO UPDATE SET updated_at = EXCLUDED.updated_at
      RETURNING id INTO location_id;
    END IF;

    INSERT INTO organization_contacts (
      organization_id, contact_id, role, is_primary, active, source, created_at, updated_at
    )
    SELECT source_org.parent_organization_id, association.contact_id, association.role,
      association.is_primary AND NOT EXISTS (
        SELECT 1 FROM organization_contacts AS existing_primary
        WHERE existing_primary.organization_id = source_org.parent_organization_id
          AND existing_primary.active AND existing_primary.is_primary
      ),
      association.active, association.source, association.created_at, now()
    FROM organization_contacts AS association
    WHERE association.organization_id = source_org.id
    ON CONFLICT (organization_id, contact_id) DO UPDATE
      SET role = coalesce(organization_contacts.role, EXCLUDED.role),
          active = organization_contacts.active OR EXCLUDED.active,
          updated_at = now();

    UPDATE contacts SET organization_id = source_org.parent_organization_id,
      organization_location_id = coalesce(organization_location_id, location_id), updated_at = now()
      WHERE organization_id = source_org.id;
    UPDATE bookings SET organization_id = source_org.parent_organization_id,
      organization_location_id = coalesce(organization_location_id, location_id), updated_at = now()
      WHERE organization_id = source_org.id;
    UPDATE activities SET organization_id = source_org.parent_organization_id,
      organization_location_id = coalesce(organization_location_id, location_id), updated_at = now()
      WHERE organization_id = source_org.id;
    UPDATE follow_ups SET organization_id = source_org.parent_organization_id,
      organization_location_id = coalesce(organization_location_id, location_id), updated_at = now()
      WHERE organization_id = source_org.id;
    UPDATE call_sessions SET organization_id = source_org.parent_organization_id,
      organization_location_id = coalesce(organization_location_id, location_id)
      WHERE organization_id = source_org.id;

    DELETE FROM organization_contacts WHERE organization_id = source_org.id;

    UPDATE organizations SET consolidated_into_id = source_org.parent_organization_id,
      consolidated_at = coalesce(consolidated_at, now()), updated_at = now()
      WHERE id = source_org.id;
  END LOOP;
END $$;

DROP INDEX IF EXISTS organizations_parent_organization_idx;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_not_own_parent;
ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_parent_organization_id_fkey;
ALTER TABLE organizations DROP COLUMN IF EXISTS parent_organization_id;
