-- Existing facts and provider lookup timestamps are not staff confirmations.
-- Leave all historical dates unknown; confirmations belong to one annual stop.
ALTER TABLE festival_crew_stops
  ADD COLUMN IF NOT EXISTS rig_fit_confirmed_on date,
  ADD COLUMN IF NOT EXISTS hookups_confirmed_on date,
  ADD COLUMN IF NOT EXISTS overnight_confirmed_on date;
