import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

/**
 * Render has historically used more than one migration entry point. Keep this
 * additive guard beside the feature so the API never serves package-intelligence
 * queries before the columns exist. It fills missing defaults only; it never
 * overwrites values an admin has already edited in Settings.
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

    -- Correct legacy display labels once, but do not overwrite later admin renames.
    UPDATE package_templates
    SET name = 'Warrior''s Playground', updated_at = now()
    WHERE code IN ('weekend_warriors', 'warriors_playground')
      AND lower(trim(name)) IN ('weekend warriors', 'weekend warrior', 'warriors playground', 'warrior playground');

    UPDATE package_templates
    SET name = 'Pirate''s Rebellion', updated_at = now()
    WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
      AND lower(trim(name)) IN ('pirates rebellion', 'pirate rebellion');

    ALTER TABLE package_templates
      DROP CONSTRAINT IF EXISTS package_templates_minimum_attraction_count_positive,
      DROP CONSTRAINT IF EXISTS package_templates_maximum_attraction_count_valid;

    ALTER TABLE package_templates
      ADD CONSTRAINT package_templates_minimum_attraction_count_positive
        CHECK (minimum_attraction_count IS NULL OR minimum_attraction_count > 0),
      ADD CONSTRAINT package_templates_maximum_attraction_count_valid
        CHECK (
          maximum_attraction_count IS NULL
          OR minimum_attraction_count IS NULL
          OR maximum_attraction_count >= minimum_attraction_count
        );

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

    ALTER TABLE resources
      DROP CONSTRAINT IF EXISTS resources_package_count_category_valid;
    ALTER TABLE resources
      ADD CONSTRAINT resources_package_count_category_valid
        CHECK (package_count_category IN ('main_attraction', 'game_extra', 'special_shared'));
  `);
}
