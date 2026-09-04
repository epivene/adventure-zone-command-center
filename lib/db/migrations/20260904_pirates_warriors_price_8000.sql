UPDATE package_templates
SET base_price_cents = 800000,
    updated_at = now()
WHERE code IN (
  'pirates_rebellion',
  'pirate_rebellion',
  'weekend_warriors',
  'warriors_playground'
)
  AND base_price_cents IS DISTINCT FROM 800000;
