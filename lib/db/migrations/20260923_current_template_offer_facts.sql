-- Current approved package facts used by Design Studio templates.
UPDATE package_templates
SET
  base_price_cents = 900000,
  operational_requirements = regexp_replace(
    coalesce(operational_requirements, ''),
    'Plan for about [0-9,]+[–-][0-9,]+ sq ft\.',
    'Plan for about 10,000–15,000 sq ft.'
  ),
  updated_at = now()
WHERE code = 'adventure_zone';

UPDATE package_templates
SET
  base_price_cents = 800000,
  operational_requirements = regexp_replace(
    coalesce(operational_requirements, ''),
    'Plan for about [0-9,]+[–-][0-9,]+ sq ft\.',
    'Plan for about 7,000–10,000 sq ft.'
  ),
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
  operational_requirements = regexp_replace(
    coalesce(operational_requirements, ''),
    'Plan for about [0-9,]+[–-][0-9,]+ sq ft\.',
    'Plan for about 3,000–5,000 sq ft.'
  ),
  updated_at = now()
WHERE code = 'mini_zone';
