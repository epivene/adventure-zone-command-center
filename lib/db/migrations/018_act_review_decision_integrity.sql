BEGIN;

ALTER TABLE act_replacement_review_decisions
  ADD COLUMN IF NOT EXISTS request_fingerprint text;

UPDATE act_replacement_review_decisions
SET request_fingerprint = 'legacy-unverifiable:' || id::text
WHERE request_fingerprint IS NULL OR btrim(request_fingerprint) = '';

ALTER TABLE act_replacement_review_decisions
  ALTER COLUMN request_fingerprint SET NOT NULL,
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_request_fingerprint_valid,
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_decision_valid,
  DROP CONSTRAINT IF EXISTS act_replacement_review_decisions_scope_decision_valid;

UPDATE act_replacement_review_decisions
SET active = false,
    superseded_at = COALESCE(superseded_at, now()),
    superseded_by = 'migration:018_invalid_scope_decision'
WHERE NOT (
  (scope = 'duplicate_identity' AND decision IN ('link_existing','keep_separate'))
  OR (scope = 'field_conflict' AND decision IN ('keep_local','use_source'))
  OR (scope = 'relationship' AND decision IN ('assign_parent','keep_unlinked','ignore_source'))
  OR (scope = 'unsupported_record' AND decision = 'ignore_source')
);

ALTER TABLE act_replacement_review_decisions
  ADD CONSTRAINT act_replacement_review_decisions_request_fingerprint_valid
    CHECK (btrim(request_fingerprint) <> ''),
  ADD CONSTRAINT act_replacement_review_decisions_decision_valid
    CHECK (decision IN ('link_existing','keep_separate','keep_local','use_source','assign_parent','keep_unlinked','ignore_source')),
  ADD CONSTRAINT act_replacement_review_decisions_scope_decision_valid
    CHECK (
      (scope = 'duplicate_identity' AND decision IN ('link_existing','keep_separate'))
      OR (scope = 'field_conflict' AND decision IN ('keep_local','use_source'))
      OR (scope = 'relationship' AND decision IN ('assign_parent','keep_unlinked','ignore_source'))
      OR (scope = 'unsupported_record' AND decision = 'ignore_source')
      OR (
        active = false
        AND superseded_at IS NOT NULL
        AND superseded_by = 'migration:018_invalid_scope_decision'
      )
    ) NOT VALID;

ALTER TABLE act_replacement_review_decisions
  VALIDATE CONSTRAINT act_replacement_review_decisions_scope_decision_valid;

COMMIT;
