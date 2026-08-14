-- Link AI booking suggestions to the matched contact / organization so the
-- UI can open the profile behind a suggestion. Nullable: older suggestions
-- and suggestions without a matched record simply have no link.
ALTER TABLE ai_booking_suggestions
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES contacts(id),
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id);
