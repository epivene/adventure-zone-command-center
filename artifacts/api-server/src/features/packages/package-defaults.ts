import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";

type DrizzleDatabase = typeof database;

export const DEFAULT_PACKAGE_TEMPLATE_SEED_SQL = `
  INSERT INTO package_templates (
    code, name, base_price_cents, base_attraction_count,
    minimum_attraction_count, maximum_attraction_count,
    customer_description, booking_talking_points,
    operational_requirements, setup_notes, active
  )
  SELECT
    'adventure_zone',
    'Adventure Zone',
    800000,
    10,
    10,
    12,
    'A full traveling inflatable carnival with a balanced mix of slides, obstacle/competitive attractions, bounce-house and playland options, plus carnival-style games for a wide age range.',
    'Best all-around package for fairs and community events that want something for younger kids, teens, and adults. Normal target is 10–12 main attractions; larger configurations are allowed. Ask about available space, power, wet rides, and whether carnival games are expected. Starting price is editable and event-specific.',
    'Prefer about 10,000 sq ft; can squeeze to about 7,000. Power within 75 ft: 3 x 50A/220V outlets, or 18 x 110V outlets, or approved equivalent/generator (public FAQ lists 50 kW). Water is optional unless wet rides are used; then provide a faucet/hose within 75 ft. Approx. 80 stakes, or approved ballast such as 30 one-ton cement barricades or 80 heavy water barrels.',
    'Plan for permission to set up 2 days before the event and one day after for teardown. Event holder provides forklift/loader for load-out. Public FAQ lists a $500 procurement fee if Adventure Zone must obtain one and $2,500 if already-set inflatables must be moved.',
    true
  WHERE NOT EXISTS (
    SELECT 1 FROM package_templates WHERE code = 'adventure_zone'
  );

  INSERT INTO package_templates (
    code, name, base_price_cents, base_attraction_count,
    minimum_attraction_count, maximum_attraction_count,
    customer_description, booking_talking_points,
    operational_requirements, setup_notes, active
  )
  SELECT
    'weekend_warriors',
    'Warrior''s Playground',
    NULL,
    5,
    5,
    5,
    'A competition-focused package built around five main attractions such as Warrior games, an obstacle course, and the action-pursuit arena, plus carnival-style games.',
    'Strong fit for older kids, teens, adults, team-style competition, and events that want more adrenaline than bounce-house variety. Normal target is about 5 main competitive attractions. Confirm shared action-pursuit or paintball equipment separately. Starting price is blank until a reliable base price is entered.',
    'Prefer about 15,000 sq ft; can squeeze to about 12,000. Power within 75 ft: 2 x 50A/220V outlets, or 12 x 15A/110V outlets, or approved equivalent/generator (public FAQ lists 25 kW). Water is not needed to operate rides, but a faucet/hose within 75 ft is preferred for daily cleaning. Approx. 60 stakes, or approved ballast such as 25 one-ton cement barricades or 60 heavy water barrels.',
    'Use the standard setup/teardown window: permission to set up 2 days before and one day after for teardown. Event holder provides forklift/loader for load-out. Keep paintball/action-pursuit equipment availability and transfers separate from the package count.',
    true
  WHERE NOT EXISTS (
    SELECT 1 FROM package_templates
    WHERE code IN ('weekend_warriors', 'warriors_playground')
  );

  INSERT INTO package_templates (
    code, name, base_price_cents, base_attraction_count,
    minimum_attraction_count, maximum_attraction_count,
    customer_description, booking_talking_points,
    operational_requirements, setup_notes, active
  )
  SELECT
    'pirates_rebellion',
    'Pirate''s Rebellion',
    700000,
    3,
    3,
    3,
    'A water-focused pirate package centered on a large pool with pedal-style bumper boats, a 25-ft-plus super slide, a pirate bounce-house combo, and carnival-style games.',
    'Best fit for warm-weather events that can support a large wet footprint and significant water access. Normal target is about 3 main wet attractions. Ask about pool-fill water access very early because filling by garden hose can take about 2 days. Starting price is editable and event-specific.',
    'Prefer about 7,000 sq ft; can squeeze to about 5,000. Power within 75 ft: 1 x 50A/220V outlet, or 6 x 15A/110V outlets, or approved equivalent/generator (public FAQ lists 50 kW). Water is a major requirement: garden-hose pool fill may take about 2 days; dedicated supply is faster, plus a faucet/hose within 75 ft for replacement water. Approx. 30 stakes, or approved ballast such as 10 one-ton cement barricades or 30 heavy water barrels.',
    'Schedule water and pool filling as part of setup, not as a day-of detail. Use the standard 2-days-before setup permission and one-day-after teardown window. Event holder provides forklift/loader for load-out.',
    true
  WHERE NOT EXISTS (
    SELECT 1 FROM package_templates
    WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
  );
`;

export async function ensureDefaultPackageTemplates(
  database: DrizzleDatabase,
): Promise<void> {
  await database.execute(sql.raw(DEFAULT_PACKAGE_TEMPLATE_SEED_SQL));
}
