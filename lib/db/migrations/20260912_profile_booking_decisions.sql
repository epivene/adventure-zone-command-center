ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS application_deadline date,
  ADD COLUMN IF NOT EXISTS recommended_deal_model text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'organizations'::regclass
      AND conname = 'organizations_recommended_deal_model_valid'
  ) THEN
    ALTER TABLE organizations
      ADD CONSTRAINT organizations_recommended_deal_model_valid
      CHECK (recommended_deal_model IS NULL OR recommended_deal_model IN ('flat_fee', 'pay_per_play', 'either'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organizations_application_deadline_idx
  ON organizations (application_deadline)
  WHERE application_deadline IS NOT NULL;

CREATE INDEX IF NOT EXISTS organizations_recommended_deal_model_idx
  ON organizations (recommended_deal_model)
  WHERE recommended_deal_model IS NOT NULL;
