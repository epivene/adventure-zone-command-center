import { reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";

type DrizzleDatabase = typeof database;

export const REVIEWED_PACKAGE_DEFAULTS = {
  adventure_zone: {
    name: "Adventure Zone",
    basePriceCents: 900000,
    baseAttractionCount: 10,
    normalCapacity: 5,
    temporaryUnavailableQuantity: 0,
    minimumAttractionCount: 10,
    maximumAttractionCount: 12,
    baseDurationMinDays: 1,
    baseDurationMaxDays: 4,
    customerDescription:
      "A full traveling inflatable carnival with a balanced mix of slides, obstacle and competitive attractions, bounce-house and playland options, plus carnival-style games for a wide age range.",
    bookingTalkingPoints:
      "Best all-around package for fairs and community events that want something for younger kids, teens, and adults. Normal target is 10–12 main attractions; larger configurations are possible when equipment and route capacity allow. Ask about available space, power, wet rides, and carnival games.",
    operationalRequirements:
      "Plan for about 10,000–15,000 sq ft. Power within 75 ft: 3 x 50A/220V outlets, 18 x 110V outlets, or an approved equivalent/generator. Water is optional for operation unless wet rides are used, but a faucet/hose within 75 ft is needed for cleaning. If stakes cannot be used, approved ballast is required; the reviewed source lists about 80 water barrels for this unit.",
    setupNotes:
      "Plan for permission to set up 1–2 days before the event and tear down the day after. The event holder provides a forklift or loader for load-out unless another arrangement is approved. Once attractions are set, moving the setup is a major exception and may carry an additional fee.",
    knowledgeReviewNote: null,
  },
  weekend_warriors: {
    name: "Warrior's Playground",
    basePriceCents: 800000,
    baseAttractionCount: 5,
    normalCapacity: 1,
    temporaryUnavailableQuantity: 0,
    minimumAttractionCount: 5,
    maximumAttractionCount: 5,
    baseDurationMinDays: 1,
    baseDurationMaxDays: 4,
    customerDescription:
      "A competition-focused package built around five main adrenaline attractions, including an obstacle course and action-pursuit style options, plus carnival-style games.",
    bookingTalkingPoints:
      "Strong fit for older kids, teens, adults, team competition, and events that want more adrenaline than bounce-house variety. Confirm action-pursuit equipment and consumables separately because shared equipment availability must be checked.",
    operationalRequirements:
      "Plan for about 7,000–10,000 sq ft. Power within 75 ft: 2 x 50A/220V outlets, 12 x 110V outlets, or an approved equivalent/generator. Water is not required to operate the attractions, but access to a faucet/hose is useful for cleaning. If stakes cannot be used, approved ballast is required; the reviewed source lists about 75 water barrels for this unit.",
    setupNotes:
      "Use the standard 1–2 days-before setup window and day-after teardown window. The event holder provides a forklift or loader for load-out unless another arrangement is approved. Keep action-pursuit equipment availability and transfers separate from the package count.",
    knowledgeReviewNote: null,
  },
  pirates_rebellion: {
    name: "Pirate's Rebellion",
    basePriceCents: 800000,
    baseAttractionCount: 3,
    normalCapacity: 3,
    temporaryUnavailableQuantity: 0,
    minimumAttractionCount: 3,
    maximumAttractionCount: 3,
    baseDurationMinDays: 1,
    baseDurationMaxDays: 4,
    customerDescription:
      "A water-focused pirate package with pedal-style bumper boats, a super slide, a pirate-themed bounce-house combo, and carnival-style games.",
    bookingTalkingPoints:
      "Best fit for warm-weather events. Confirm footprint, power, water access, and fill timing early for the ordinary three-unit package.",
    operationalRequirements:
      "Plan for about 5,000–7,000 sq ft for marketing and layout planning. Confirm the event-specific footprint, power, water access, ballast, and setup details before contracting.",
    setupNotes:
      "Schedule pool filling as part of setup, not as a day-of detail. Plan for permission to set up 1–2 days before the event and tear down the day after. The event holder provides a forklift or loader for load-out unless another arrangement is approved.",
    knowledgeReviewNote: null,
  },
  mini_zone: {
    name: "Mini Zone",
    basePriceCents: 500000,
    baseAttractionCount: 5,
    normalCapacity: 0,
    temporaryUnavailableQuantity: 0,
    minimumAttractionCount: 5,
    maximumAttractionCount: 5,
    baseDurationMinDays: 1,
    baseDurationMaxDays: 4,
    customerDescription:
      "A smaller five-attraction version of The Adventure Zone for events that need a tighter footprint or a lower starting package price.",
    bookingTalkingPoints:
      "Use when a full Adventure Zone setup is more space or budget than an event needs. The source describes an obstacle course, one adventure attraction, a bounce-house combo, a slide, a playland, and carnival-style games; final equipment remains event-specific.",
    operationalRequirements:
      "Plan for about 3,000–5,000 sq ft. The source lists two 50A/220V power connections or a 50 kW generator and also references twelve standard outlets; confirm the exact electrical configuration before contracting. Approved ballast is required when stakes cannot be used.",
    setupNotes:
      "Use the normal 1–2 days-before setup window and day-after teardown window unless the event-specific arrangement says otherwise.",
    knowledgeReviewNote:
      "Water-barrel source conflict: 44 vs 50; confirm before quoting or contracting.",
  },
} as const;

export const DEFAULT_PACKAGE_TEMPLATE_SEED_SQL = `
  INSERT INTO package_templates (
    code, name, base_price_cents, base_attraction_count,
    normal_capacity, temporary_unavailable_quantity,
    minimum_attraction_count, maximum_attraction_count,
    base_duration_min_days, base_duration_max_days,
    customer_description, booking_talking_points,
    operational_requirements, setup_notes, knowledge_review_note, active
  )
  SELECT
    'adventure_zone', 'Adventure Zone', 900000, 10, 5, 0, 10, 12, 1, 4,
    'A full traveling inflatable carnival with a balanced mix of slides, obstacle and competitive attractions, bounce-house and playland options, plus carnival-style games for a wide age range.',
    'Best all-around package for fairs and community events that want something for younger kids, teens, and adults. Normal target is 10–12 main attractions; larger configurations are possible when equipment and route capacity allow. Ask about available space, power, wet rides, and carnival games.',
    'Plan for about 10,000–15,000 sq ft. Power within 75 ft: 3 x 50A/220V outlets, 18 x 110V outlets, or an approved equivalent/generator. Water is optional for operation unless wet rides are used, but a faucet/hose within 75 ft is needed for cleaning. If stakes cannot be used, approved ballast is required; the reviewed source lists about 80 water barrels for this unit.',
    'Plan for permission to set up 1–2 days before the event and tear down the day after. The event holder provides a forklift or loader for load-out unless another arrangement is approved. Once attractions are set, moving the setup is a major exception and may carry an additional fee.',
    NULL, true
  WHERE NOT EXISTS (SELECT 1 FROM package_templates WHERE code = 'adventure_zone');

  INSERT INTO package_templates (
    code, name, base_price_cents, base_attraction_count,
    normal_capacity, temporary_unavailable_quantity,
    minimum_attraction_count, maximum_attraction_count,
    base_duration_min_days, base_duration_max_days,
    customer_description, booking_talking_points,
    operational_requirements, setup_notes, knowledge_review_note, active
  )
  SELECT
    'weekend_warriors', 'Warrior''s Playground', 800000, 5, 1, 0, 5, 5, 1, 4,
    'A competition-focused package built around five main adrenaline attractions, including an obstacle course and action-pursuit style options, plus carnival-style games.',
    'Strong fit for older kids, teens, adults, team competition, and events that want more adrenaline than bounce-house variety. Confirm action-pursuit equipment and consumables separately because shared equipment availability must be checked.',
    'Plan for about 7,000–10,000 sq ft. Power within 75 ft: 2 x 50A/220V outlets, 12 x 110V outlets, or an approved equivalent/generator. Water is not required to operate the attractions, but access to a faucet/hose is useful for cleaning. If stakes cannot be used, approved ballast is required; the reviewed source lists about 75 water barrels for this unit.',
    'Use the standard 1–2 days-before setup window and day-after teardown window. The event holder provides a forklift or loader for load-out unless another arrangement is approved. Keep action-pursuit equipment availability and transfers separate from the package count.',
    NULL, true
  WHERE NOT EXISTS (
    SELECT 1 FROM package_templates WHERE code IN ('weekend_warriors', 'warriors_playground')
  );

  INSERT INTO package_templates (
    code, name, base_price_cents, base_attraction_count,
    normal_capacity, temporary_unavailable_quantity,
    minimum_attraction_count, maximum_attraction_count,
    base_duration_min_days, base_duration_max_days,
    customer_description, booking_talking_points,
    operational_requirements, setup_notes, knowledge_review_note, active
  )
  SELECT
    'pirates_rebellion', 'Pirate''s Rebellion', 800000, 3, 3, 0, 3, 3, 1, 4,
    'A water-focused pirate package with pedal-style bumper boats, a super slide, a pirate-themed bounce-house combo, and carnival-style games.',
    'Best fit for warm-weather events. Confirm footprint, power, water access, and fill timing early for the ordinary three-unit package.',
    'Plan for about 5,000–7,000 sq ft for marketing and layout planning. Confirm the event-specific footprint, power, water access, ballast, and setup details before contracting.',
    'Schedule pool filling as part of setup, not as a day-of detail. Plan for permission to set up 1–2 days before the event and tear down the day after. The event holder provides a forklift or loader for load-out unless another arrangement is approved.',
    NULL, true
  WHERE NOT EXISTS (
    SELECT 1 FROM package_templates WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
  );

  INSERT INTO package_templates (
    code, name, base_price_cents, base_attraction_count,
    normal_capacity, temporary_unavailable_quantity,
    minimum_attraction_count, maximum_attraction_count,
    base_duration_min_days, base_duration_max_days,
    customer_description, booking_talking_points,
    operational_requirements, setup_notes, knowledge_review_note, active
  )
  SELECT
    'mini_zone', 'Mini Zone', 500000, 5, 0, 0, 5, 5, 1, 4,
    'A smaller five-attraction version of The Adventure Zone for events that need a tighter footprint or a lower starting package price.',
    'Use when a full Adventure Zone setup is more space or budget than an event needs. The source describes an obstacle course, one adventure attraction, a bounce-house combo, a slide, a playland, and carnival-style games; final equipment remains event-specific.',
    'Plan for about 3,000–5,000 sq ft. The source lists two 50A/220V power connections or a 50 kW generator and also references twelve standard outlets; confirm the exact electrical configuration before contracting. Approved ballast is required when stakes cannot be used.',
    'Use the normal 1–2 days-before setup window and day-after teardown window unless the event-specific arrangement says otherwise.',
    'Water-barrel source conflict: 44 vs 50; confirm before quoting or contracting.', true
  WHERE NOT EXISTS (SELECT 1 FROM package_templates WHERE code = 'mini_zone');

  UPDATE package_templates
  SET base_price_cents = 900000, updated_at = now()
  WHERE code = 'adventure_zone' AND base_price_cents = 800000;

  UPDATE package_templates
  SET base_price_cents = 800000, updated_at = now()
  WHERE code IN ('pirates_rebellion', 'pirate_rebellion')
    AND base_price_cents IN (700000, 750000);

  UPDATE package_templates
  SET base_price_cents = 800000, updated_at = now()
  WHERE code IN ('weekend_warriors', 'warriors_playground')
    AND (base_price_cents IS NULL OR base_price_cents = 750000);

  UPDATE package_templates
  SET base_duration_min_days = 1,
      base_duration_max_days = 4,
      updated_at = now()
  WHERE code IN ('adventure_zone','pirates_rebellion','pirate_rebellion','weekend_warriors','warriors_playground','mini_zone')
    AND base_duration_min_days IS NULL
    AND base_duration_max_days IS NULL;

  UPDATE package_templates
  SET knowledge_review_note = 'Water-barrel source conflict: 44 vs 50; confirm before quoting or contracting.',
      updated_at = now()
  WHERE code = 'mini_zone'
    AND nullif(trim(knowledge_review_note), '') IS NULL;
`;

export async function ensureDefaultPackageTemplates(
  database: DrizzleDatabase,
): Promise<void> {
  await reconcileCapacityFacts(database,"package-inventory",async tx=>{ await tx.execute(sql.raw(DEFAULT_PACKAGE_TEMPLATE_SEED_SQL)); });
}
