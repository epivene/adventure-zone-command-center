ALTER TABLE contract_settings
  ALTER COLUMN insurance_recipient_name SET DEFAULT 'Amanda Morton',
  ALTER COLUMN insurance_recipient_email SET DEFAULT 'amanda@protectiveins.net';

-- Promote Amanda only when the row still has the former system default.
-- Any recipient chosen by an owner remains unchanged.
UPDATE contract_settings
SET insurance_recipient_name = 'Amanda Morton',
    insurance_recipient_email = 'amanda@protectiveins.net',
    updated_by = 'migration:insurance-amanda-primary',
    updated_at = now()
WHERE insurance_recipient_name = 'Sara Toone'
  AND lower(insurance_recipient_email) = 'sara@protectiveins.net';
