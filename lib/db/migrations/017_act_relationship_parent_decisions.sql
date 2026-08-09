BEGIN;

ALTER TABLE act_replacement_review_decisions
  ADD COLUMN IF NOT EXISTS relationship_slot text;

DROP INDEX IF EXISTS act_replacement_review_decisions_active_unique;

CREATE UNIQUE INDEX act_replacement_review_decisions_active_unique
  ON act_replacement_review_decisions
  (source_record_id, scope, coalesce(relationship_slot, field_name, ''))
  WHERE active = true;

ALTER TABLE act_replacement_review_decisions
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_decision_valid,
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_scope_decision_valid,
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_relationship_parent_valid;

ALTER TABLE act_replacement_review_decisions
  ADD CONSTRAINT act_replacement_review_decisions_decision_valid
    CHECK (decision IN ('link_existing','keep_separate','keep_local','use_source','assign_parent','keep_unlinked','ignore_source')),
  ADD CONSTRAINT act_replacement_review_decisions_scope_decision_valid
    CHECK ((scope = 'duplicate_identity' AND decision IN ('link_existing','keep_separate'))
      OR (scope = 'field_conflict' AND decision IN ('keep_local','use_source'))
      OR (scope = 'relationship' AND decision IN ('assign_parent','keep_unlinked','ignore_source'))
      OR (scope = 'unsupported_record' AND decision = 'ignore_source')) NOT VALID,
  ADD CONSTRAINT act_replacement_review_decisions_relationship_parent_valid
    CHECK (decision <> 'assign_parent' OR (
      scope = 'relationship'
      AND relationship_slot IS NOT NULL
      AND btrim(relationship_slot) <> ''
      AND target_entity_type IS NOT NULL
      AND target_entity_id IS NOT NULL
    ));

COMMIT;
