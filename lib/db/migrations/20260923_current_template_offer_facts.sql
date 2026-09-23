-- Current approved package facts used by Design Studio templates.
UPDATE package_templates
SET
  base_price_cents = 900000,
  operational_requirements =
    'Plan for about 10,000–15,000 sq ft. Power within 75 ft: 3 x 50A/220V outlets, 18 x 110V outlets, or an approved equivalent/generator. Water is optional for operation unless wet rides are used, but a faucet/hose within 75 ft is needed for cleaning. If stakes cannot be used, approved ballast is required; the reviewed source lists about 80 water barrels for this unit.',
  updated_at = now()
WHERE code = 'adventure_zone';

UPDATE package_templates
SET
  base_price_cents = 800000,
  operational_requirements =
    'Plan for about 7,000–10,000 sq ft. Power within 75 ft: 2 x 50A/220V outlets, 12 x 110V outlets, or an approved equivalent/generator. Water is not required to operate the attractions, but access to a faucet/hose is useful for cleaning. If stakes cannot be used, approved ballast is required; the reviewed source lists about 75 water barrels for this unit.',
  updated_at = now()
WHERE code IN ('weekend_warriors', 'warriors_playground');

UPDATE package_templates
SET
  base_price_cents = 800000,
  operational_requirements =
    'Plan for about 5,000–7,000 sq ft for marketing and layout planning. Confirm the event-specific footprint, power, water access, ballast, and setup details before contracting.',
  updated_at = now()
WHERE code IN ('pirates_rebellion', 'pirate_rebellion');

UPDATE package_templates
SET
  base_price_cents = 500000,
  operational_requirements =
    'Plan for about 3,000–5,000 sq ft. The source lists two 50A/220V power connections or a 50 kW generator and also references twelve standard outlets; confirm the exact electrical configuration before contracting. Approved ballast is required when stakes cannot be used.',
  updated_at = now()
WHERE code = 'mini_zone';
