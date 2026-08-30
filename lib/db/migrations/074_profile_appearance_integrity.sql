-- Profiles-first integrity repair.
-- Keep technical booking/contact source rows for provenance, but retire exact duplicate
-- records from active profile views and preserve their ACT/Gmail/timeline evidence.

CREATE TABLE IF NOT EXISTS contact_consolidations (
  source_contact_id uuid PRIMARY KEY REFERENCES contacts(id) ON DELETE RESTRICT,
  canonical_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  original_role text,
  original_is_primary boolean NOT NULL DEFAULT false,
  original_active boolean NOT NULL DEFAULT true,
  original_source text,
  consolidated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_consolidations_distinct_ids
    CHECK (source_contact_id <> canonical_contact_id)
);

CREATE INDEX IF NOT EXISTS contact_consolidations_canonical_idx
  ON contact_consolidations(canonical_contact_id);
CREATE INDEX IF NOT EXISTS contact_consolidations_organization_idx
  ON contact_consolidations(organization_id);

-- Older duplicate-booking cleanup stamped the canonical ID in notes. Backfill the
-- durable mapping for any such row that predates booking_consolidations tracking.
WITH parsed AS (
  SELECT
    source.id AS source_booking_id,
    source.organization_id,
    source.status::text AS original_status,
    source.probability::text AS original_probability,
    source.travel_leg_id AS original_travel_leg_id,
    source.starts_at AS original_starts_at,
    source.ends_at AS original_ends_at,
    (regexp_match(
      coalesce(source.notes, ''),
      '\[Merged duplicate\] Canonical booking: ([0-9a-fA-F-]{36})'
    ))[1]::uuid AS canonical_booking_id
  FROM bookings source
  WHERE coalesce(source.notes, '') ~
    '\[Merged duplicate\] Canonical booking: [0-9a-fA-F-]{36}'
), valid AS (
  SELECT parsed.*
  FROM parsed
  JOIN bookings canonical
    ON canonical.id = parsed.canonical_booking_id
   AND canonical.organization_id = parsed.organization_id
  WHERE parsed.source_booking_id <> parsed.canonical_booking_id
)
INSERT INTO booking_consolidations (
  source_booking_id,
  canonical_booking_id,
  original_status,
  original_probability,
  original_travel_leg_id,
  original_starts_at,
  original_ends_at,
  consolidated_at
)
SELECT
  source_booking_id,
  canonical_booking_id,
  original_status,
  original_probability,
  original_travel_leg_id,
  original_starts_at,
  original_ends_at,
  now()
FROM valid
ON CONFLICT (source_booking_id) DO NOTHING;

-- Plan only exact, same-profile identities. A shared normalized name plus exact email
-- is authoritative here; when there is no email, the exact normalized phone is used.
DROP TABLE IF EXISTS tmp_profile_contact_merge_plan;
CREATE TEMP TABLE tmp_profile_contact_merge_plan ON COMMIT DROP AS
WITH candidates AS (
  SELECT
    oc.organization_id,
    oc.contact_id,
    oc.role,
    oc.is_primary,
    oc.active,
    oc.source,
    c.first_name,
    c.last_name,
    c.email,
    c.phone,
    c.normalized_phone,
    c.act_record_id,
    c.created_at,
    c.updated_at,
    regexp_replace(
      lower(btrim(concat_ws(' ', c.first_name, c.last_name))),
      '[^a-z0-9]+',
      '',
      'g'
    ) AS name_key,
    CASE
      WHEN nullif(lower(btrim(c.email)), '') IS NOT NULL
        THEN 'email:' || lower(btrim(c.email))
      WHEN nullif(btrim(c.normalized_phone), '') IS NOT NULL
        THEN 'phone:' || btrim(c.normalized_phone)
      ELSE NULL
    END AS identity_key,
    EXISTS (
      SELECT 1
      FROM bookings b
      WHERE b.organization_id = oc.organization_id
        AND b.primary_contact_id = oc.contact_id
        AND NOT EXISTS (
          SELECT 1
          FROM booking_consolidations bc
          WHERE bc.source_booking_id = b.id
        )
    ) AS current_appearance_primary
  FROM organization_contacts oc
  JOIN contacts c ON c.id = oc.contact_id
  JOIN organizations o ON o.id = oc.organization_id
  LEFT JOIN contact_consolidations existing
    ON existing.source_contact_id = oc.contact_id
  WHERE oc.active = true
    AND o.consolidated_into_id IS NULL
    AND existing.source_contact_id IS NULL
), ranked AS (
  SELECT
    candidates.*,
    count(*) OVER (
      PARTITION BY organization_id, name_key, identity_key
    ) AS identity_count,
    first_value(contact_id) OVER (
      PARTITION BY organization_id, name_key, identity_key
      ORDER BY
        is_primary DESC,
        current_appearance_primary DESC,
        (act_record_id IS NOT NULL) DESC,
        ((email IS NOT NULL)::int + (phone IS NOT NULL)::int) DESC,
        updated_at DESC,
        created_at ASC,
        contact_id ASC
    ) AS canonical_contact_id
  FROM candidates
  WHERE identity_key IS NOT NULL
)
SELECT
  contact_id AS source_contact_id,
  canonical_contact_id,
  organization_id,
  role AS original_role,
  is_primary AS original_is_primary,
  active AS original_active,
  source AS original_source,
  act_record_id AS source_act_record_id,
  phone AS source_phone
FROM ranked
WHERE identity_count > 1
  AND contact_id <> canonical_contact_id;

INSERT INTO contact_consolidations (
  source_contact_id,
  canonical_contact_id,
  organization_id,
  original_role,
  original_is_primary,
  original_active,
  original_source,
  consolidated_at
)
SELECT
  source_contact_id,
  canonical_contact_id,
  organization_id,
  original_role,
  original_is_primary,
  original_active,
  original_source,
  now()
FROM tmp_profile_contact_merge_plan
ON CONFLICT (source_contact_id) DO NOTHING;

-- Make sure the surviving contact has an active relationship to the profile before
-- retiring any duplicate relationship.
INSERT INTO organization_contacts (
  organization_id,
  contact_id,
  role,
  is_primary,
  active,
  source,
  created_at,
  updated_at
)
SELECT DISTINCT ON (plan.organization_id, plan.canonical_contact_id)
  plan.organization_id,
  plan.canonical_contact_id,
  coalesce(canonical_rel.role, plan.original_role),
  coalesce(canonical_rel.is_primary, false),
  true,
  coalesce(canonical_rel.source, plan.original_source, 'local'),
  now(),
  now()
FROM tmp_profile_contact_merge_plan plan
LEFT JOIN organization_contacts canonical_rel
  ON canonical_rel.organization_id = plan.organization_id
 AND canonical_rel.contact_id = plan.canonical_contact_id
WHERE canonical_rel.id IS NULL
ON CONFLICT (organization_id, contact_id) DO NOTHING;

-- Preserve booking-contact membership on the canonical contact. Insert as non-primary
-- first so the one-primary constraint cannot be violated during the transfer.
INSERT INTO booking_contacts (
  booking_id,
  contact_id,
  role,
  is_primary,
  source,
  created_at,
  updated_at
)
SELECT DISTINCT ON (bc.booking_id, plan.canonical_contact_id)
  bc.booking_id,
  plan.canonical_contact_id,
  bc.role,
  false,
  coalesce(bc.source, 'local'),
  bc.created_at,
  now()
FROM booking_contacts bc
JOIN tmp_profile_contact_merge_plan plan
  ON plan.source_contact_id = bc.contact_id
WHERE NOT EXISTS (
  SELECT 1
  FROM booking_contacts existing
  WHERE existing.booking_id = bc.booking_id
    AND existing.contact_id = plan.canonical_contact_id
)
ON CONFLICT (booking_id, contact_id) DO NOTHING;

-- Demote source relationships before promoting the survivor.
UPDATE booking_contacts bc
SET is_primary = false, updated_at = now()
FROM tmp_profile_contact_merge_plan plan
WHERE bc.contact_id = plan.source_contact_id
  AND bc.is_primary = true;

UPDATE booking_contacts canonical
SET is_primary = true, updated_at = now()
FROM bookings b
JOIN tmp_profile_contact_merge_plan plan
  ON plan.source_contact_id = b.primary_contact_id
WHERE canonical.booking_id = b.id
  AND canonical.contact_id = plan.canonical_contact_id;

UPDATE bookings b
SET primary_contact_id = plan.canonical_contact_id, updated_at = now()
FROM tmp_profile_contact_merge_plan plan
WHERE b.primary_contact_id = plan.source_contact_id;

-- Profile-owned future work and calls should resolve to the active contact.
UPDATE follow_ups f
SET contact_id = plan.canonical_contact_id, updated_at = now()
FROM tmp_profile_contact_merge_plan plan
WHERE f.contact_id = plan.source_contact_id;

UPDATE call_sessions session
SET contact_id = plan.canonical_contact_id, updated_at = now()
FROM tmp_profile_contact_merge_plan plan
WHERE session.contact_id = plan.source_contact_id;

UPDATE google_workspace_validation_mappings mapping
SET contact_id = plan.canonical_contact_id, updated_at = now()
FROM tmp_profile_contact_merge_plan plan
WHERE mapping.contact_id = plan.source_contact_id;

-- The source contact and all of its ACT IDs remain physically present. Only its active
-- membership is retired so Profiles shows one person instead of repeated shells.
UPDATE organization_contacts source_rel
SET
  is_primary = false,
  active = false,
  updated_at = now()
FROM tmp_profile_contact_merge_plan plan
WHERE source_rel.organization_id = plan.organization_id
  AND source_rel.contact_id = plan.source_contact_id;

DELETE FROM booking_contacts source_rel
USING tmp_profile_contact_merge_plan plan
WHERE source_rel.contact_id = plan.source_contact_id;

-- Preserve alternate ACT IDs/phone numbers in the profile's existing imported-history
-- area so consolidation never makes source details disappear.
INSERT INTO audit_entries (
  entity_type,
  entity_id,
  action,
  before,
  after,
  created_at
)
SELECT
  'organization',
  grouped.organization_id,
  'act_migration_applied',
  NULL,
  jsonb_build_object(
    'mergedProfileHistory',
    jsonb_build_object(
      'contactSourceIds', grouped.contact_source_ids,
      'phones', grouped.phones,
      'notes', '[]'::jsonb,
      'bookingSourceIds', '[]'::jsonb,
      'groupSourceIds', '[]'::jsonb
    ),
    'reason', 'Exact duplicate profile contacts consolidated non-destructively'
  ),
  now()
FROM (
  SELECT
    organization_id,
    coalesce(
      jsonb_agg(DISTINCT source_act_record_id)
        FILTER (WHERE source_act_record_id IS NOT NULL),
      '[]'::jsonb
    ) AS contact_source_ids,
    coalesce(
      jsonb_agg(DISTINCT source_phone)
        FILTER (WHERE nullif(btrim(source_phone), '') IS NOT NULL),
      '[]'::jsonb
    ) AS phones
  FROM tmp_profile_contact_merge_plan
  GROUP BY organization_id
) grouped
WHERE NOT EXISTS (
  SELECT 1
  FROM audit_entries existing
  WHERE existing.entity_type = 'organization'
    AND existing.entity_id = grouped.organization_id
    AND existing.action = 'act_migration_applied'
    AND existing.after ->> 'reason' =
      'Exact duplicate profile contacts consolidated non-destructively'
);

-- Normalize references that belong to previously retired appearance shells.
UPDATE follow_ups f
SET booking_id = bc.canonical_booking_id, updated_at = now()
FROM booking_consolidations bc
WHERE f.booking_id = bc.source_booking_id;

UPDATE call_sessions session
SET booking_id = bc.canonical_booking_id, updated_at = now()
FROM booking_consolidations bc
WHERE session.booking_id = bc.source_booking_id;

UPDATE google_operational_calendar_links link
SET booking_id = bc.canonical_booking_id, updated_at = now()
FROM booking_consolidations bc
WHERE link.booking_id = bc.source_booking_id
  AND NOT EXISTS (
    SELECT 1
    FROM google_operational_calendar_links existing
    WHERE existing.connection_id = link.connection_id
      AND existing.calendar_id = link.calendar_id
      AND existing.google_event_id = link.google_event_id
      AND existing.package_key = link.package_key
      AND existing.booking_id = bc.canonical_booking_id
  );

UPDATE google_operational_calendar_reviews review
SET booking_id = bc.canonical_booking_id, updated_at = now()
FROM booking_consolidations bc
WHERE review.booking_id = bc.source_booking_id;

-- Pirate Fest is supported by reviewed source evidence: the 2026 contract is signed.
-- Complete all stale 2026 work across the permanent profile and retain one 2027 renewal.
UPDATE bookings
SET
  status = 'confirmed',
  probability = 'likely',
  next_action_kind = 'renewal',
  next_action_due_at = '2027-01-15T15:00:00.000Z'::timestamptz,
  updated_at = now()
WHERE id = 'cd7ce3ca-7370-47a3-9f07-0ca617e03695'::uuid
  AND organization_id = 'f24033e1-801b-43ff-9a7e-a9d6d7b426c3'::uuid;

UPDATE follow_ups f
SET
  completed_at = coalesce(f.completed_at, now()),
  outcome = CASE
    WHEN f.completed_at IS NULL
      THEN '2026 contract is signed; replaced by the 2027 renewal reminder'
    ELSE f.outcome
  END,
  updated_at = now()
WHERE f.completed_at IS NULL
  AND (
    f.organization_id = 'f24033e1-801b-43ff-9a7e-a9d6d7b426c3'::uuid
    OR EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.id = f.booking_id
        AND b.organization_id = 'f24033e1-801b-43ff-9a7e-a9d6d7b426c3'::uuid
    )
    OR EXISTS (
      SELECT 1 FROM organization_contacts oc
      WHERE oc.contact_id = f.contact_id
        AND oc.organization_id = 'f24033e1-801b-43ff-9a7e-a9d6d7b426c3'::uuid
    )
  );

INSERT INTO follow_ups (
  organization_id,
  kind,
  due_at,
  outcome,
  created_at,
  updated_at
)
SELECT
  'f24033e1-801b-43ff-9a7e-a9d6d7b426c3'::uuid,
  'Renew Pirate Fest with Michael Ringling for 2027',
  '2027-01-15T15:00:00.000Z'::timestamptz,
  'The 2026 Pirate Fest contract is signed and confirmed. Reconnect with Michael early about Pirate Fest 2027.',
  now(),
  now()
WHERE EXISTS (
  SELECT 1 FROM organizations
  WHERE id = 'f24033e1-801b-43ff-9a7e-a9d6d7b426c3'::uuid
)
AND NOT EXISTS (
  SELECT 1
  FROM follow_ups existing
  WHERE existing.organization_id = 'f24033e1-801b-43ff-9a7e-a9d6d7b426c3'::uuid
    AND existing.completed_at IS NULL
    AND existing.due_at = '2027-01-15T15:00:00.000Z'::timestamptz
);

-- Moab had the same next action duplicated at profile and appearance level. Keep the
-- earliest canonical action and close only the redundant open row.
WITH owned AS (
  SELECT f.id,
         row_number() OVER (
           ORDER BY
             CASE WHEN f.organization_id = 'dd318274-33b8-4331-9901-766d8a6ae4aa'::uuid THEN 0 ELSE 1 END,
             f.due_at,
             f.created_at,
             f.id
         ) AS action_rank
  FROM follow_ups f
  WHERE f.completed_at IS NULL
    AND (
      f.organization_id = 'dd318274-33b8-4331-9901-766d8a6ae4aa'::uuid
      OR EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.id = f.booking_id
          AND b.organization_id = 'dd318274-33b8-4331-9901-766d8a6ae4aa'::uuid
      )
    )
)
UPDATE follow_ups f
SET
  completed_at = now(),
  outcome = 'Duplicate profile/appearance next action consolidated',
  updated_at = now()
FROM owned
WHERE f.id = owned.id
  AND owned.action_rank > 1;
