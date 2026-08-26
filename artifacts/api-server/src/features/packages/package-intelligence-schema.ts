import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

/**
 * Render has historically used more than one migration entry point. Keep this
 * additive guard beside the feature so the API never serves package-intelligence
 * queries before the columns exist. It fills missing defaults only; it never
 * overwrites values an admin has already edited in Settings.
 *
 * Keep startup DDL lightweight: constraints are created only when absent rather
 * than dropped/recreated on every process restart.
 */
export async function ensurePackageIntelligenceSchema(
  pool: Pool = defaultPool,
): Promise<void> {
  await pool.query(`
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

    UPDATE package_templates
    SET minimum_attraction_count = CASE
          WHEN code = 'adventure_zone' THEN 10
          WHEN code IN ('weekend_warriors', 'warriors_playground') THEN 5
          WHEN code IN ('pirates_rebellion', 'pirate_rebellion') THEN 3
          WHEN code = 'mini_zone' THEN 5
          ELSE base_attraction_count
        END
    WHERE minimum_attraction_count IS NULL;

    UPDATE package_templates
    SET maximum_attraction_count = CASE
          WHEN code = 'adventure_zone' THEN 12
          WHEN code IN ('weekend_warriors', 'warriors_playground') THEN 5
          WHEN code IN ('pirates_rebellion', 'pirate_rebellion') THEN 3
          WHEN code = 'mini_zone' THEN 5
          ELSE COALESCE(minimum_attraction_count, base_attraction_count)
        END
    WHERE maximum_attraction_count IS NULL;

    UPDATE package_templates
    SET base_duration_min_days = 1,
        base_duration_max_days = 4
    WHERE code IN (
      'adventure_zone',
      'weekend_warriors',
      'warriors_playground',
      'pirates_rebellion',
      'pirate_rebellion',
      'mini_zone'
    )
      AND base_duration_min_days IS NULL
      AND base_duration_max_days IS NULL;

    -- Seed reviewed package content only when the field is still blank.
    UPDATE package_templates
    SET customer_description = 'A full traveling inflatable carnival with a balanced mix of slides, obstacle and competitive attractions, bounce-house and playland options, plus carnival-style games for a wide age range.'
    WHERE code = 'adventure_zone'
      AND nullif(trim(customer_description), '') IS NULL;

    UPDATE package_templates
    SET booking_talking_points = 'Best all-around package for fairs and community events that want something for younger kids, teens, and adults. Normal target is 10–12 main attractions; larger configurations are possible when equipment and route capacity allow. Ask about available space, power, wet rides, and carnival games.'
    WHERE code = 'adventure_zone'
      AND nullif(trim(booking_talking_points), '') IS NULL;

    UPDATE package_templates
    SET operational_requirements = 'Plan for about 7,000–10,000 sq ft. Power within 75 ft: 3 x 50A/220V outlets, 18 x 110V outlets, or an approved equivalent/generator. Water is optional for operation unless wet rides are used, but a faucet/hose within 75 ft is needed for cleaning. If stakes cannot be used, approved ballast is required; the reviewed source lists about 80 water barrels for this unit.'
    WHERE code = 'adventure_zone'
      AND nullif(trim(operational_requirements), '') IS NULL;

    UPDATE package_templates
    SET setup_notes = 'Plan for permission to set up 1–2 days before the event and tear down the day after. The event holder provides a forklift or loader for load-out unless another arrangement is approved. Once attractions are set, moving the setup is a major exception and may carry an additional fee.'
    WHERE code = 'adventure_zone'
      AND nullif(trim(setup_notes), '') IS NULL;

    UPDATE package_templates
    SET customer_description = 'A competition-focused package built around five main adrenaline attractions, including an obstacle course and action-pursuit style options, plus carnival-style games.'
    WHERE code IN ('weekend_warriors', 'warriors_playground')
      AND nullif(trim(customer_description), '') IS NULL;

    UPDATE package_templates
    SET booking_talking_points = 'Strong fit for older kids, teens, adults, team competition, and events that want more adrenaline than bounce-house variety. Confirm action-pursuit equipment and consumables separately because shared equipment availability must be checked.'
    WHERE code IN ('weekend_warriors', 'warriors_playground')
      AND nullif(trim(booking_talking_points), '') IS NULL;

    UPDATE package_templates
    SET operational_requirements = 'Plan for about 8,000–10,000 sq ft. Power within 75 ft: 2 x 50A/220V outlets, 12 x 110V outlets, or an approved equivalent/generator. Water is not required to operate the attractions, but access to a faucet/hose is useful for cleaning. If stakes cannot be used, approved ballast is required; the reviewed source lists about 75 water barrels for this unit.'
    WHERE code IN ('weekend_warriors', 'warriors_playground')
      AND nullif(trim(operational_requirements), '') IS NULL;

    UPDATE package_templates
    SET setup_notes = 'Use the standard 1–2 days-before setup window and day-after teardown window. The event holder provides a forklift or loader for load-out unless another arrangement is approved. Keep action-pursuit equipment availability and transfers separate from the package count.'
    WHERE code IN ('weekend_warriors', 'warriors_playground')
      AND nullif(trim(setup_notes), '') IS NULL;

    UPDATE package_templates
    SET customer_description = 'A water-focused pirate package with pedal-style bumper boats, a super slide, a pirate-themed bounce-house combo, and carnival-style games.'
    WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
      AND nullif(trim(customer_description), '') IS NULL;

    UPDATE package_templates
    SET booking_talking_points = 'Best fit for warm-weather events. Confirm ordinary three-unit package footprint, power, water access, and fill timing early.'
    WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
      AND nullif(trim(booking_talking_points), '') IS NULL;

    UPDATE package_templates
    SET operational_requirements = 'Confirm ordinary three-unit package footprint, power, water access, ballast, and setup details before contracting.'
    WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
      AND nullif(trim(operational_requirements), '') IS NULL;

    UPDATE package_templates
    SET setup_notes = 'Schedule pool filling as part of setup, not as a day-of detail. Plan for permission to set up 1–2 days before the event and tear down the day after. The event holder provides a forklift or loader for load-out unless another arrangement is approved.'
    WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
      AND nullif(trim(setup_notes), '') IS NULL;

    UPDATE package_templates
    SET customer_description = 'A smaller five-attraction version of The Adventure Zone for events that need a tighter footprint or a lower starting package price.'
    WHERE code = 'mini_zone'
      AND nullif(trim(customer_description), '') IS NULL;

    UPDATE package_templates
    SET booking_talking_points = 'Use when a full Adventure Zone setup is more space or budget than an event needs. The source describes an obstacle course, one adventure attraction, a bounce-house combo, a slide, a playland, and carnival-style games; final equipment remains event-specific.'
    WHERE code = 'mini_zone'
      AND nullif(trim(booking_talking_points), '') IS NULL;

    UPDATE package_templates
    SET operational_requirements = 'Plan for about 4,000–7,000 sq ft. The source lists two 50A/220V power connections or a 50 kW generator and also references twelve standard outlets; confirm the exact electrical configuration before contracting. Approved ballast is required when stakes cannot be used.'
    WHERE code = 'mini_zone'
      AND nullif(trim(operational_requirements), '') IS NULL;

    UPDATE package_templates
    SET setup_notes = 'Use the normal 1–2 days-before setup window and day-after teardown window unless the event-specific arrangement says otherwise.'
    WHERE code = 'mini_zone'
      AND nullif(trim(setup_notes), '') IS NULL;

    UPDATE package_templates
    SET knowledge_review_note = 'Water-barrel source conflict: 44 vs 50; confirm before quoting or contracting.'
    WHERE code = 'mini_zone'
      AND nullif(trim(knowledge_review_note), '') IS NULL;

    -- Correct legacy display labels once, but do not overwrite later admin renames.
    UPDATE package_templates
    SET name = 'Warrior''s Playground', updated_at = now()
    WHERE code IN ('weekend_warriors', 'warriors_playground')
      AND lower(trim(name)) IN ('weekend warriors', 'weekend warrior', 'warriors playground', 'warrior playground');

    UPDATE package_templates
    SET name = 'Pirate''s Rebellion', updated_at = now()
    WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
      AND lower(trim(name)) IN ('pirates rebellion', 'pirate rebellion');

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'package_templates_base_price_cents_nonnegative'
      ) THEN
        ALTER TABLE package_templates
          ADD CONSTRAINT package_templates_base_price_cents_nonnegative
            CHECK (base_price_cents IS NULL OR base_price_cents >= 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'package_templates_minimum_attraction_count_positive'
      ) THEN
        ALTER TABLE package_templates
          ADD CONSTRAINT package_templates_minimum_attraction_count_positive
            CHECK (minimum_attraction_count IS NULL OR minimum_attraction_count > 0);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'package_templates_maximum_attraction_count_valid'
      ) THEN
        ALTER TABLE package_templates
          ADD CONSTRAINT package_templates_maximum_attraction_count_valid
            CHECK (
              maximum_attraction_count IS NULL
              OR minimum_attraction_count IS NULL
              OR maximum_attraction_count >= minimum_attraction_count
            );
      END IF;

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

    ALTER TABLE resources
      ADD COLUMN IF NOT EXISTS package_count_category text;

    UPDATE resources
    SET package_count_category = 'special_shared', updated_at = now()
    WHERE code = 'paintball_trailer'
      AND package_count_category IS NULL;

    UPDATE resources
    SET package_count_category = 'game_extra', updated_at = now()
    WHERE lower(category) IN ('game', 'games', 'carnival_game', 'carnival_games')
      AND package_count_category IS NULL;

    UPDATE resources
    SET package_count_category = 'main_attraction'
    WHERE package_count_category IS NULL;

    ALTER TABLE resources
      ALTER COLUMN package_count_category SET DEFAULT 'main_attraction',
      ALTER COLUMN package_count_category SET NOT NULL;

    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'resources_package_count_category_valid'
      ) THEN
        ALTER TABLE resources
          ADD CONSTRAINT resources_package_count_category_valid
            CHECK (package_count_category IN ('main_attraction', 'game_extra', 'special_shared'));
      END IF;
    END $$;
  `);
}
