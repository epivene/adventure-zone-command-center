BEGIN;

ALTER TABLE act_replacement_review_decisions
  ADD COLUMN IF NOT EXISTS decided_by text;

UPDATE act_replacement_review_decisions
SET decided_by = 'owner'
WHERE decided_by IS NULL OR btrim(decided_by) = '';

ALTER TABLE act_replacement_review_decisions
  ALTER COLUMN decided_by SET NOT NULL;

ALTER TABLE act_replacement_review_decisions
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_scope_check,
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_decision_check,
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_scope_valid,
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_decision_valid,
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_scope_decision_valid,
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_actor_valid;

ALTER TABLE act_replacement_review_decisions
  ADD CONSTRAINT act_replacement_review_decisions_scope_valid
    CHECK (scope IN ('duplicate_identity','field_conflict','relationship','unsupported_record')),
  ADD CONSTRAINT act_replacement_review_decisions_decision_valid
    CHECK (decision IN ('link_existing','keep_separate','keep_local','use_source','keep_unlinked','ignore_source')),
  ADD CONSTRAINT act_replacement_review_decisions_scope_decision_valid
    CHECK ((scope = 'duplicate_identity' AND decision IN ('link_existing','keep_separate'))
      OR (scope = 'field_conflict' AND decision IN ('keep_local','use_source'))
      OR (scope = 'relationship' AND decision IN ('keep_unlinked','ignore_source'))
      OR (scope = 'unsupported_record' AND decision = 'ignore_source')) NOT VALID,
  ADD CONSTRAINT act_replacement_review_decisions_actor_valid
    CHECK (btrim(decided_by) <> '');

ALTER TABLE act_replacement_outcomes
  DROP CONSTRAINT IF EXISTS act_replacement_outcomes_state_check,
  DROP CONSTRAINT IF EXISTS act_replacement_outcomes_state_valid;

ALTER TABLE act_replacement_outcomes
  ADD CONSTRAINT act_replacement_outcomes_state_valid
    CHECK (state IN ('pending','leased','ready','already_present','awaiting_review','unassigned','unsupported','ignored','applied','failed'));

COMMIT;
