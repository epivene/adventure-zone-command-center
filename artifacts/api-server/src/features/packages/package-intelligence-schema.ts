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
      ADD COLUMN IF NOT EXISTS minimum_attraction_count integer,
      ADD COLUMN IF NOT EXISTS maximum_attraction_count integer,
      ADD COLUMN IF NOT EXISTS customer_description text,
      ADD COLUMN IF NOT EXISTS booking_talking_points text,
      ADD COLUMN IF NOT EXISTS operational_requirements text,
      ADD COLUMN IF NOT EXISTS setup_notes text;

    UPDATE package_templates
    SET minimum_attraction_count = CASE
          WHEN code = 'adventure_zone' THEN 10
          WHEN code IN ('weekend_warriors', 'warriors_playground') THEN 5
          WHEN code IN ('pirates_rebellion', 'pirate_rebellion') THEN 3
          ELSE base_attraction_count
        END
    WHERE minimum_attraction_count IS NULL;

    UPDATE package_templates
    SET maximum_attraction_count = CASE
          WHEN code = 'adventure_zone' THEN 12
          WHEN code IN ('weekend_warriors', 'warriors_playground') THEN 5
          WHEN code IN ('pirates_rebellion', 'pirate_rebellion') THEN 3
          ELSE COALESCE(minimum_attraction_count, base_attraction_count)
        END
    WHERE maximum_attraction_count IS NULL;

    -- Seed reviewed package content only when the field is still blank.
    UPDATE package_templates
    SET customer_description = 'A full traveling inflatable carnival with a balanced mix of slides, obstacle/competitive attractions, bounce-house and playland options, plus carnival-style games for a wide age range.'
    WHERE code = 'adventure_zone'
      AND nullif(trim(customer_description), '') IS NULL;

    UPDATE package_templates
    SET booking_talking_points = 'Best all-around package for fairs and community events that want something for younger kids, teens, and adults. Normal Command Center target is 10–12 main attractions; larger configurations are allowed. Ask about available space, power, wet rides, and whether carnival games are expected.'
    WHERE code = 'adventure_zone'
      AND nullif(trim(booking_talking_points), '') IS NULL;

    UPDATE package_templates
    SET operational_requirements = 'Prefer about 10,000 sq ft; can squeeze to about 7,000. Power within 75 ft: 3 x 50A/220V outlets, or 18 x 110V outlets, or approved equivalent/generator (public FAQ lists 50 kW). Water is optional unless wet rides are used; then provide a faucet/hose within 75 ft. Approx. 80 stakes, or approved ballast such as 30 one-ton cement barricades or 80 heavy water barrels.'
    WHERE code = 'adventure_zone'
      AND nullif(trim(operational_requirements), '') IS NULL;

    UPDATE package_templates
    SET setup_notes = 'Plan for permission to set up 2 days before the event and one day after for teardown. Event holder provides forklift/loader for load-out. Public FAQ lists a $500 procurement fee if Adventure Zone must obtain one and $2,500 if already-set inflatables must be moved.'
    WHERE code = 'adventure_zone'
      AND nullif(trim(setup_notes), '') IS NULL;

    UPDATE package_templates
    SET customer_description = 'A competition-focused package built around five main attractions such as Warrior games, an obstacle course, and the action-pursuit arena, plus carnival-style games.'
    WHERE code IN ('weekend_warriors', 'warriors_playground')
      AND nullif(trim(customer_description), '') IS NULL;

    UPDATE package_templates
    SET booking_talking_points = 'Strong fit for older kids, teens, adults, team-style competition, and events that want more adrenaline than bounce-house variety. Normal target is about 5 main competitive attractions. Confirm whether action-pursuit equipment such as paintball is being requested because shared equipment must be checked separately.'
    WHERE code IN ('weekend_warriors', 'warriors_playground')
      AND nullif(trim(booking_talking_points), '') IS NULL;

    UPDATE package_templates
    SET operational_requirements = 'Prefer about 15,000 sq ft; can squeeze to about 12,000. Power within 75 ft: 2 x 50A/220V outlets, or 12 x 15A/110V outlets, or approved equivalent/generator (public FAQ lists 25 kW). Water is not needed to operate rides, but a faucet/hose within 75 ft is preferred for daily cleaning. Approx. 60 stakes, or approved ballast such as 25 one-ton cement barricades or 60 heavy water barrels.'
    WHERE code IN ('weekend_warriors', 'warriors_playground')
      AND nullif(trim(operational_requirements), '') IS NULL;

    UPDATE package_templates
    SET setup_notes = 'Use the standard setup/teardown window: permission to set up 2 days before and one day after for teardown. Event holder provides forklift/loader for load-out. Keep paintball/action-pursuit equipment availability and transfers separate from the package count.'
    WHERE code IN ('weekend_warriors', 'warriors_playground')
      AND nullif(trim(setup_notes), '') IS NULL;

    UPDATE package_templates
    SET customer_description = 'A water-focused pirate package centered on a large pool with pedal-style bumper boats, a 25-ft-plus super slide, a pirate bounce-house combo, and carnival-style games.'
    WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
      AND nullif(trim(customer_description), '') IS NULL;

    UPDATE package_templates
    SET booking_talking_points = 'Best fit for warm-weather events that can support a large wet footprint and significant water access. Normal target is about 3 main wet attractions. Ask about pool-fill water access very early because filling by garden hose can take about 2 days.'
    WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
      AND nullif(trim(booking_talking_points), '') IS NULL;

    UPDATE package_templates
    SET operational_requirements = 'Use the FAQ detailed guidance: prefer about 7,000 sq ft; can squeeze to about 5,000. Power within 75 ft: 1 x 50A/220V outlet, or 6 x 15A/110V outlets, or approved equivalent/generator (public FAQ lists 50 kW). Water is a major requirement: garden-hose pool fill may take about 2 days; dedicated supply is faster, plus a faucet/hose within 75 ft for replacement water. Approx. 30 stakes, or approved ballast such as 10 one-ton cement barricades or 30 heavy water barrels.'
    WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
      AND nullif(trim(operational_requirements), '') IS NULL;

    UPDATE package_templates
    SET setup_notes = 'Schedule water and pool filling as part of setup, not as a day-of detail. Use the standard 2-days-before setup permission and one-day-after teardown window. Event holder provides forklift/loader for load-out.'
    WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
      AND nullif(trim(setup_notes), '') IS NULL;

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
