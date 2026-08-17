import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

/**
 * Render has historically used more than one migration entry point. Keep this
 * additive guard beside the feature so the API never serves package-intelligence
 * queries before the columns exist. The standalone SQL migration remains the
 * canonical deployment migration; every statement here is idempotent.
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
    SET minimum_attraction_count = COALESCE(minimum_attraction_count, base_attraction_count),
        maximum_attraction_count = COALESCE(maximum_attraction_count, base_attraction_count)
    WHERE minimum_attraction_count IS NULL
       OR maximum_attraction_count IS NULL;

    UPDATE package_templates
    SET name = 'Adventure Zone',
        base_attraction_count = 10,
        minimum_attraction_count = 10,
        maximum_attraction_count = 12,
        updated_at = now()
    WHERE code = 'adventure_zone';

    UPDATE package_templates
    SET name = 'Warrior''s Playground',
        base_attraction_count = 5,
        minimum_attraction_count = 5,
        maximum_attraction_count = 5,
        updated_at = now()
    WHERE code IN ('weekend_warriors', 'warriors_playground');

    UPDATE package_templates
    SET name = 'Pirate''s Rebellion',
        base_attraction_count = 3,
        minimum_attraction_count = 3,
        maximum_attraction_count = 3,
        updated_at = now()
    WHERE code IN ('pirates_rebellion', 'pirate_rebellion');

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
    SET package_count_category = 'main_attraction'
    WHERE package_count_category IS NULL;

    UPDATE resources
    SET package_count_category = 'special_shared', updated_at = now()
    WHERE code = 'paintball_trailer';

    UPDATE resources
    SET package_count_category = 'game_extra', updated_at = now()
    WHERE lower(category) IN ('game', 'games', 'carnival_game', 'carnival_games');

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
