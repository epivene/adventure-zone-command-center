ALTER TABLE booking_opportunities
  ADD COLUMN IF NOT EXISTS email_automation_protected boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS territory_exception_approved boolean NOT NULL DEFAULT false;
