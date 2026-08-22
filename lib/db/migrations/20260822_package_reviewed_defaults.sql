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

-- Upgrade only the known old starter values. Owner-edited prices remain untouched.
UPDATE package_templates
SET base_price_cents = 900000,
    updated_at = now()
WHERE code = 'adventure_zone'
  AND base_price_cents = 800000;

UPDATE package_templates
SET base_price_cents = 750000,
    updated_at = now()
WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
  AND base_price_cents = 700000;

UPDATE package_templates
SET base_price_cents = 750000,
    updated_at = now()
WHERE code IN ('weekend_warriors', 'warriors_playground')
  AND base_price_cents IS NULL;

UPDATE package_templates
SET base_duration_min_days = 1,
    base_duration_max_days = 4,
    updated_at = now()
WHERE code IN (
  'adventure_zone',
  'pirates_rebellion',
  'pirate_rebellion',
  'weekend_warriors',
  'warriors_playground',
  'mini_zone'
)
  AND base_duration_min_days IS NULL
  AND base_duration_max_days IS NULL;

-- Upgrade earlier Command Center seed wording only when it still exactly matches
-- the old seed. This avoids overwriting any owner-edited business knowledge.
UPDATE package_templates
SET customer_description = 'A full traveling inflatable carnival with a balanced mix of slides, obstacle and competitive attractions, bounce-house and playland options, plus carnival-style games for a wide age range.',
    booking_talking_points = 'Best all-around package for fairs and community events that want something for younger kids, teens, and adults. Normal target is 10–12 main attractions; larger configurations are possible when equipment and route capacity allow. Ask about available space, power, wet rides, and carnival games.',
    operational_requirements = 'Plan for about 7,000–10,000 sq ft. Power within 75 ft: 3 x 50A/220V outlets, 18 x 110V outlets, or an approved equivalent/generator. Water is optional for operation unless wet rides are used, but a faucet/hose within 75 ft is needed for cleaning. If stakes cannot be used, approved ballast is required; the reviewed source lists about 80 water barrels for this unit.',
    setup_notes = 'Plan for permission to set up 1–2 days before the event and tear down the day after. The event holder provides a forklift or loader for load-out unless another arrangement is approved. Once attractions are set, moving the setup is a major exception and may carry an additional fee.',
    updated_at = now()
WHERE code = 'adventure_zone'
  AND customer_description = 'A full traveling inflatable carnival with a balanced mix of slides, obstacle/competitive attractions, bounce-house and playland options, plus carnival-style games for a wide age range.'
  AND booking_talking_points = 'Best all-around package for fairs and community events that want something for younger kids, teens, and adults. Normal Command Center target is 10–12 main attractions; larger configurations are allowed. Ask about available space, power, wet rides, and whether carnival games are expected.'
  AND operational_requirements = 'Prefer about 10,000 sq ft; can squeeze to about 7,000. Power within 75 ft: 3 x 50A/220V outlets, or 18 x 110V outlets, or approved equivalent/generator (public FAQ lists 50 kW). Water is optional unless wet rides are used; then provide a faucet/hose within 75 ft. Approx. 80 stakes, or approved ballast such as 30 one-ton cement barricades or 80 heavy water barrels.';

UPDATE package_templates
SET customer_description = 'A competition-focused package built around five main adrenaline attractions, including an obstacle course and action-pursuit style options, plus carnival-style games.',
    booking_talking_points = 'Strong fit for older kids, teens, adults, team competition, and events that want more adrenaline than bounce-house variety. Confirm action-pursuit equipment and consumables separately because shared equipment availability must be checked.',
    operational_requirements = 'Plan for about 8,000–10,000 sq ft. Power within 75 ft: 2 x 50A/220V outlets, 12 x 110V outlets, or an approved equivalent/generator. Water is not required to operate the attractions, but access to a faucet/hose is useful for cleaning. If stakes cannot be used, approved ballast is required; the reviewed source lists about 75 water barrels for this unit.',
    setup_notes = 'Use the standard 1–2 days-before setup window and day-after teardown window. The event holder provides a forklift or loader for load-out unless another arrangement is approved. Keep action-pursuit equipment availability and transfers separate from the package count.',
    updated_at = now()
WHERE code IN ('weekend_warriors', 'warriors_playground')
  AND customer_description = 'A competition-focused package built around five main attractions such as Warrior games, an obstacle course, and the action-pursuit arena, plus carnival-style games.'
  AND operational_requirements = 'Prefer about 15,000 sq ft; can squeeze to about 12,000. Power within 75 ft: 2 x 50A/220V outlets, or 12 x 15A/110V outlets, or approved equivalent/generator (public FAQ lists 25 kW). Water is not needed to operate rides, but a faucet/hose within 75 ft is preferred for daily cleaning. Approx. 60 stakes, or approved ballast such as 25 one-ton cement barricades or 60 heavy water barrels.';

UPDATE package_templates
SET customer_description = 'A water-focused pirate package centered on a large inflatable pool with pedal-style bumper boats, a super slide, a pirate-themed bounce-house combo, and carnival-style games.',
    booking_talking_points = 'Best fit for warm-weather events that can support a large wet footprint and significant water access. Ask about pool-fill water access early because a garden-hose fill can require roughly two setup days.',
    operational_requirements = 'Plan for about 5,000–7,000 sq ft on a flat surface. Power within 75 ft: 1 x 50A/220V outlet, 6 x 110V outlets, or an approved equivalent/generator. Water is a major requirement: the source lists roughly 20,000 gallons for a smaller pool and 45,000–50,000 gallons for the larger pool. If stakes cannot be used, approved ballast is required; the reviewed source lists about 25 water barrels for this unit.',
    setup_notes = 'Schedule pool filling as part of setup, not as a day-of detail. Plan for permission to set up 1–2 days before the event and tear down the day after. The event holder provides a forklift or loader for load-out unless another arrangement is approved.',
    updated_at = now()
WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
  AND customer_description = 'A water-focused pirate package centered on a large pool with pedal-style bumper boats, a 25-ft-plus super slide, a pirate bounce-house combo, and carnival-style games.'
  AND operational_requirements LIKE 'Prefer about 7,000 sq ft; can squeeze to about 5,000.%';

INSERT INTO package_templates (
  code, name, base_price_cents, base_attraction_count,
  minimum_attraction_count, maximum_attraction_count,
  base_duration_min_days, base_duration_max_days,
  customer_description, booking_talking_points,
  operational_requirements, setup_notes, knowledge_review_note, active
)
SELECT
  'mini_zone',
  'Mini Zone',
  500000,
  5,
  5,
  5,
  1,
  4,
  'A smaller five-attraction version of The Adventure Zone for events that need a tighter footprint or a lower starting package price.',
  'Use when a full Adventure Zone setup is more space or budget than an event needs. The source describes an obstacle course, one adventure attraction, a bounce-house combo, a slide, a playland, and carnival-style games; final equipment remains event-specific.',
  'Plan for about 4,000–7,000 sq ft. The source lists two 50A/220V power connections or a 50 kW generator and also references twelve standard outlets; confirm the exact electrical configuration before contracting. Approved ballast is required when stakes cannot be used.',
  'Use the normal 1–2 days-before setup window and day-after teardown window unless the event-specific arrangement says otherwise.',
  'Water-barrel source conflict: 44 vs 50; confirm before quoting or contracting.',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM package_templates WHERE code = 'mini_zone'
);

UPDATE package_templates
SET knowledge_review_note = 'Water-barrel source conflict: 44 vs 50; confirm before quoting or contracting.',
    updated_at = now()
WHERE code = 'mini_zone'
  AND nullif(trim(knowledge_review_note), '') IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'package_templates_base_duration_valid'
  ) THEN
    ALTER TABLE package_templates
      ADD CONSTRAINT package_templates_base_duration_valid
      CHECK (
        (base_duration_min_days IS NULL AND base_duration_max_days IS NULL)
        OR (
          base_duration_min_days > 0
          AND base_duration_max_days >= base_duration_min_days
        )
      );
  END IF;
END $$;
