-- Non-destructive exact duplicate booking consolidation.
-- Exact identity: normalized name + city + region + start UTC day + end UTC day.
-- Retired duplicates keep their historical linked records intact while the surviving
-- canonical booking owns the one active next action.

CREATE TABLE IF NOT EXISTS booking_consolidations (
  source_booking_id uuid PRIMARY KEY REFERENCES bookings(id) ON DELETE RESTRICT,
  canonical_booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  original_status text NOT NULL,
  original_probability text NOT NULL,
  original_travel_leg_id uuid,
  original_starts_at timestamptz,
  original_ends_at timestamptz,
  consolidated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_consolidations_distinct_ids CHECK (source_booking_id <> canonical_booking_id)
);

CREATE INDEX IF NOT EXISTS booking_consolidations_canonical_idx
  ON booking_consolidations(canonical_booking_id);

WITH ranked AS (
  SELECT
    b.id,
    b.status,
    b.probability,
    b.travel_leg_id,
    b.starts_at,
    b.ends_at,
    regexp_replace(lower(btrim(b.name)), '\s+', ' ', 'g') AS name_key,
    lower(btrim(b.city)) AS city_key,
    lower(btrim(b.region)) AS region_key,
    (b.starts_at AT TIME ZONE 'UTC')::date AS start_day,
    (coalesce(b.ends_at, b.starts_at) AT TIME ZONE 'UTC')::date AS end_day,
    row_number() OVER (
      PARTITION BY
        regexp_replace(lower(btrim(b.name)), '\s+', ' ', 'g'),
        lower(btrim(b.city)),
        lower(btrim(b.region)),
        (b.starts_at AT TIME ZONE 'UTC')::date,
        (coalesce(b.ends_at, b.starts_at) AT TIME ZONE 'UTC')::date
      ORDER BY
        CASE b.status
          WHEN 'confirmed' THEN 100
          WHEN 'completed' THEN 95
          WHEN 'contract_received' THEN 90
          WHEN 'pending_contract' THEN 85
          WHEN 'pending_decision' THEN 80
          WHEN 'quote_sent' THEN 75
          WHEN 'interested' THEN 70
          WHEN 'contacted' THEN 65
          WHEN 'contact_due' THEN 60
          WHEN 'researching' THEN 55
          WHEN 'new_lead' THEN 50
          WHEN 'possible' THEN 45
          WHEN 'renewal_due' THEN 40
          WHEN 'unlikely' THEN 35
          WHEN 'declined' THEN 20
          WHEN 'cancelled' THEN 10
          ELSE 0
        END DESC,
        b.updated_at DESC,
        b.id ASC
    ) AS duplicate_rank
  FROM bookings b
  LEFT JOIN booking_consolidations existing
    ON existing.source_booking_id = b.id
  WHERE b.starts_at IS NOT NULL
    AND existing.source_booking_id IS NULL
), labeled AS (
  SELECT
    ranked.*,
    max(id) FILTER (WHERE duplicate_rank = 1) OVER (
      PARTITION BY name_key, city_key, region_key, start_day, end_day
    ) AS canonical_booking_id
  FROM ranked
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
  id,
  canonical_booking_id,
  status,
  probability,
  travel_leg_id,
  starts_at,
  ends_at,
  now()
FROM labeled
WHERE duplicate_rank > 1
  AND canonical_booking_id IS NOT NULL
ON CONFLICT (source_booking_id) DO NOTHING;

-- Keep exactly one open next action for each consolidated event group.
WITH booking_group AS (
  SELECT DISTINCT source_booking_id AS booking_id, canonical_booking_id
  FROM booking_consolidations
  UNION
  SELECT DISTINCT canonical_booking_id AS booking_id, canonical_booking_id
  FROM booking_consolidations
), ranked_open AS (
  SELECT
    f.id,
    f.booking_id,
    g.canonical_booking_id,
    row_number() OVER (
      PARTITION BY g.canonical_booking_id
      ORDER BY
        CASE WHEN f.booking_id = g.canonical_booking_id THEN 0 ELSE 1 END,
        f.due_at ASC,
        f.created_at ASC,
        f.id ASC
    ) AS follow_up_rank
  FROM follow_ups f
  INNER JOIN booking_group g ON g.booking_id = f.booking_id
  WHERE f.completed_at IS NULL
), winner AS (
  SELECT id, canonical_booking_id
  FROM ranked_open
  WHERE follow_up_rank = 1
)
UPDATE follow_ups f
SET
  booking_id = winner.canonical_booking_id,
  updated_at = now()
FROM winner
WHERE f.id = winner.id
  AND f.booking_id IS DISTINCT FROM winner.canonical_booking_id;

WITH booking_group AS (
  SELECT DISTINCT source_booking_id AS booking_id, canonical_booking_id
  FROM booking_consolidations
  UNION
  SELECT DISTINCT canonical_booking_id AS booking_id, canonical_booking_id
  FROM booking_consolidations
), ranked_open AS (
  SELECT
    f.id,
    g.canonical_booking_id,
    row_number() OVER (
      PARTITION BY g.canonical_booking_id
      ORDER BY
        CASE WHEN f.booking_id = g.canonical_booking_id THEN 0 ELSE 1 END,
        f.due_at ASC,
        f.created_at ASC,
        f.id ASC
    ) AS follow_up_rank
  FROM follow_ups f
  INNER JOIN booking_group g ON g.booking_id = f.booking_id
  WHERE f.completed_at IS NULL
)
UPDATE follow_ups f
SET
  completed_at = now(),
  outcome = 'Merged into canonical booking',
  updated_at = now()
FROM ranked_open ranked
WHERE f.id = ranked.id
  AND ranked.follow_up_rank > 1;

-- Record the retirement before mutating the duplicate booking row.
INSERT INTO audit_entries (
  entity_type,
  entity_id,
  action,
  before,
  after,
  created_at
)
SELECT
  'booking',
  c.source_booking_id,
  'consolidate_duplicate',
  jsonb_build_object(
    'status', c.original_status,
    'probability', c.original_probability,
    'travelLegId', c.original_travel_leg_id,
    'startsAt', c.original_starts_at,
    'endsAt', c.original_ends_at
  ),
  jsonb_build_object('canonicalBookingId', c.canonical_booking_id),
  c.consolidated_at
FROM booking_consolidations c
WHERE NOT EXISTS (
  SELECT 1
  FROM audit_entries a
  WHERE a.entity_type = 'booking'
    AND a.entity_id = c.source_booking_id
    AND a.action = 'consolidate_duplicate'
    AND a.after ->> 'canonicalBookingId' = c.canonical_booking_id::text
);

-- Retire the duplicate from active operational views without deleting its row or history.
UPDATE bookings b
SET
  status = 'completed',
  probability = 'unlikely',
  travel_leg_id = NULL,
  starts_at = NULL,
  ends_at = NULL,
  notes = concat_ws(
    E'\n\n',
    nullif(b.notes, ''),
    '[Merged duplicate] Canonical booking: ' || c.canonical_booking_id::text
  ),
  updated_at = now()
FROM booking_consolidations c
WHERE b.id = c.source_booking_id
  AND (
    b.starts_at IS NOT NULL
    OR b.ends_at IS NOT NULL
    OR b.status <> 'completed'
    OR b.probability <> 'unlikely'
    OR b.travel_leg_id IS NOT NULL
  );

-- Prevent the same exact event/date duplicate from being created again.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_exact_event_identity_unique
ON bookings (
  (regexp_replace(lower(btrim(name)), '\s+', ' ', 'g')),
  (lower(btrim(city))),
  (lower(btrim(region))),
  (((starts_at AT TIME ZONE 'UTC')::date)),
  (((coalesce(ends_at, starts_at) AT TIME ZONE 'UTC')::date))
)
WHERE starts_at IS NOT NULL;
