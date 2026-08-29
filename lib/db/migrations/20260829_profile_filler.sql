ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS filler boolean DEFAULT false NOT NULL;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS filler_reason text;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS filler_changed_at timestamptz;

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_filler_reason_required;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_filler_reason_required
  CHECK (NOT filler OR nullif(btrim(filler_reason), '') IS NOT NULL);
