ALTER TABLE profile_research_suggestions
  DROP CONSTRAINT IF EXISTS profile_research_suggestions_target_kind_check;

ALTER TABLE profile_research_suggestions
  ADD CONSTRAINT profile_research_suggestions_target_kind_check
  CHECK (target_kind IN ('organization', 'contact', 'booking', 'event_date_fact'));
