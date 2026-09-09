BEGIN;

-- Repair only the known Gmail campaign format-reset pattern. Require a
-- pending plain-text snapshot matching the current stored revision, so newer
-- unsent edits, approved templates and unrelated templates are not overwritten.
CREATE TEMP TABLE gmail_review_repair ON COMMIT DROP AS
SELECT DISTINCT ON (t.id)
  t.id AS template_id, good.request_id AS keep_request_id,
  good_request.assigned_boss_account_id AS boss_id,
  good.subject_snapshot, good.body_snapshot, good.template_version
FROM communication_templates t
JOIN communication_template_reviews good ON good.template_id = t.id
JOIN boss_work_requests good_request ON good_request.id = good.request_id
WHERE t.code IN (
  'convention_before_general_v2', 'convention_before_new_event_v2',
  'convention_before_past_event_v2', 'convention_during_new_event_v2',
  'convention_during_past_event_v2', 'convention_after_new_event_v2',
  'convention_after_past_event_v2'
)
  AND t.category = 'convention_campaign' AND t.owner_kind = 'company'
  AND t.template_version = '2026-09-gmail-final-v2'
  AND t.state IN ('draft', 'reviewed') AND t.body_format = 'plain_text'
  AND ltrim(t.body_template) LIKE '<div%'
  AND good.body_format_snapshot = 'html' AND good.decision = 'pending'
  AND good.template_version = t.template_version
  AND good_request.state IN ('waiting_on_dave', 'in_progress')
  AND EXISTS (
    SELECT 1 FROM communication_template_reviews bad
    JOIN boss_work_requests bad_request ON bad_request.id = bad.request_id
    WHERE bad.template_id = t.id AND bad.body_format_snapshot = 'plain_text'
      AND bad.decision = 'pending'
      AND bad.body_snapshot = t.body_template
      AND bad.subject_snapshot IS NOT DISTINCT FROM t.subject_template
      AND bad.template_version IS NOT DISTINCT FROM t.template_version
      AND bad_request.assigned_boss_account_id = good_request.assigned_boss_account_id
      AND bad_request.state IN ('waiting_on_dave', 'in_progress')
  )
ORDER BY t.id, good.created_at DESC, good.id DESC;

UPDATE communication_templates t SET
  body_format = 'html', body_template = repair.body_snapshot,
  subject_template = repair.subject_snapshot,
  template_version = repair.template_version, updated_at = now()
FROM gmail_review_repair repair WHERE t.id = repair.template_id;

WITH obsolete AS (
  SELECT request.id, request.state AS prior_state, request.deduplication_key
  FROM boss_work_requests request
  JOIN communication_template_reviews review ON review.request_id = request.id
  JOIN gmail_review_repair repair ON repair.template_id = review.template_id
  WHERE request.id <> repair.keep_request_id
    AND request.assigned_boss_account_id = repair.boss_id
    AND request.state IN ('waiting_on_dave', 'in_progress', 'returned_for_clarification')
    AND review.decision = 'pending'
), closed AS (
  UPDATE boss_work_requests request
  SET state = 'cancelled', completed_at = now(), updated_at = now(), deduplication_key = NULL
  FROM obsolete WHERE request.id = obsolete.id
  RETURNING request.id, obsolete.prior_state, obsolete.deduplication_key
)
INSERT INTO boss_work_request_events(request_id,actor_kind,actor_id,prior_state,new_state,note,metadata)
SELECT id,'system','system:template-review-repair',prior_state,'cancelled',
  'Closed duplicate; retained the existing Gmail-style HTML review and restored its exact template revision.',
  jsonb_build_object('previousDeduplicationKey',deduplication_key)
FROM closed;

-- Every newly inserted pending snapshot replaces older open snapshots for
-- this same template and assignee. Keep snapshots, decisions and notes as history.
CREATE OR REPLACE FUNCTION supersede_pending_template_reviews() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  assignee uuid;
BEGIN
  IF NEW.decision <> 'pending' THEN RETURN NEW; END IF;
  SELECT assigned_boss_account_id INTO assignee FROM boss_work_requests
  WHERE id = NEW.request_id
    AND state IN ('waiting_on_dave', 'in_progress', 'returned_for_clarification');
  IF assignee IS NULL THEN RETURN NEW; END IF;
  -- Serialize competing review inserts for a template, including different revisions.
  PERFORM id FROM communication_templates WHERE id = NEW.template_id FOR UPDATE;
  WITH obsolete AS (
    SELECT request.id, request.state AS prior_state, request.deduplication_key
    FROM boss_work_requests request
    JOIN communication_template_reviews review ON review.request_id = request.id
    WHERE review.template_id = NEW.template_id AND request.id <> NEW.request_id
      AND request.assigned_boss_account_id = assignee
      AND request.state IN ('waiting_on_dave', 'in_progress', 'returned_for_clarification')
      AND review.decision = 'pending'
  ), closed AS (
    UPDATE boss_work_requests request
    SET state = 'cancelled', completed_at = now(), updated_at = now(), deduplication_key = NULL
    FROM obsolete WHERE request.id = obsolete.id
    RETURNING request.id, obsolete.prior_state, obsolete.deduplication_key
  )
  INSERT INTO boss_work_request_events(request_id,actor_kind,actor_id,prior_state,new_state,note,metadata)
  SELECT id,'system','system:template-review-superseded',prior_state,'cancelled',
    'Superseded by a newer email template review.',
    jsonb_build_object('replacementRequestId',NEW.request_id,'previousDeduplicationKey',deduplication_key)
  FROM closed;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS communication_template_reviews_supersede_pending ON communication_template_reviews;
CREATE TRIGGER communication_template_reviews_supersede_pending
AFTER INSERT ON communication_template_reviews
FOR EACH ROW EXECUTE FUNCTION supersede_pending_template_reviews();

COMMIT;
