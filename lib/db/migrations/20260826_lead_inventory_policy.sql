CREATE TABLE IF NOT EXISTS package_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  base_attraction_count integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE package_templates
  ADD COLUMN IF NOT EXISTS base_price_cents integer,
  ADD COLUMN IF NOT EXISTS minimum_attraction_count integer,
  ADD COLUMN IF NOT EXISTS maximum_attraction_count integer,
  ADD COLUMN IF NOT EXISTS base_duration_min_days integer,
  ADD COLUMN IF NOT EXISTS base_duration_max_days integer,
  ADD COLUMN IF NOT EXISTS customer_description text,
  ADD COLUMN IF NOT EXISTS booking_talking_points text,
  ADD COLUMN IF NOT EXISTS operational_requirements text,
  ADD COLUMN IF NOT EXISTS setup_notes text,
  ADD COLUMN IF NOT EXISTS knowledge_review_note text;

ALTER TABLE package_templates
  ADD COLUMN IF NOT EXISTS normal_capacity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS temporary_unavailable_quantity integer NOT NULL DEFAULT 0;

ALTER TABLE lead_availability_snapshots
  ADD COLUMN IF NOT EXISTS package_availability jsonb NOT NULL DEFAULT
    '{"status":"unresolved","packages":[],"restrictedOptions":[],"blockers":["legacy snapshot predates package-capacity evaluation"]}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_templates_normal_capacity_nonnegative') THEN
    ALTER TABLE package_templates ADD CONSTRAINT package_templates_normal_capacity_nonnegative CHECK (normal_capacity >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'package_templates_temporary_unavailable_quantity_nonnegative') THEN
    ALTER TABLE package_templates ADD CONSTRAINT package_templates_temporary_unavailable_quantity_nonnegative CHECK (temporary_unavailable_quantity >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_availability_snapshots_package_availability_object') THEN
    ALTER TABLE lead_availability_snapshots ADD CONSTRAINT lead_availability_snapshots_package_availability_object CHECK (jsonb_typeof(package_availability) = 'object');
  END IF;
END $$;

UPDATE package_templates
SET normal_capacity = CASE
  WHEN code = 'adventure_zone' THEN 5
  WHEN code IN ('pirates_rebellion', 'pirate_rebellion') THEN 3
  WHEN code IN ('weekend_warriors', 'warriors_playground') THEN 1
  WHEN code = 'mini_zone' THEN 0
  ELSE normal_capacity
END,
updated_at = now()
WHERE code IN ('adventure_zone', 'pirates_rebellion', 'pirate_rebellion', 'weekend_warriors', 'warriors_playground', 'mini_zone')
  AND normal_capacity = 0;

UPDATE package_templates
SET customer_description = 'A water-focused pirate package with pedal-style bumper boats, a super slide, a pirate-themed bounce-house combo, and carnival-style games.',
    booking_talking_points = 'Best fit for warm-weather events. Confirm footprint, power, water access, and fill timing early for the ordinary three-unit package.',
    operational_requirements = 'Confirm ordinary three-unit package footprint, power, water access, ballast, and setup details before contracting.',
    updated_at = now()
WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
  AND operational_requirements LIKE '%45,000%';

UPDATE lead_availability_snapshots
SET ready = false,
    package_availability = '{"status":"unresolved","packages":[],"restrictedOptions":[],"blockers":["legacy snapshot predates package-capacity evaluation"]}'::jsonb
WHERE package_availability->>'status' = 'unresolved';
