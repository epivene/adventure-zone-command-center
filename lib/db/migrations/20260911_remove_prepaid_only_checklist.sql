-- Remove the withdrawn prepaid-only checklist requested by the owner.
-- Cancellation preserves its history and excludes it from Dave's queue.
WITH targets AS (
  SELECT id, state
  FROM boss_work_requests
  WHERE type = 'rapid_convention_notes'
    AND title = 'Yes / No: new PREPAID ONLY profiles'
    AND instructions LIKE 'Use this checklist before changing any pay-per-play or hybrid profile.%'
    AND state IN ('waiting_on_dave', 'in_progress', 'submitted_to_owner',
                  'changes_requested', 'returned_for_clarification', 'approved')
  FOR UPDATE
), cancelled AS (
  UPDATE boss_work_requests AS request
  SET state = 'cancelled', completed_at = now(), updated_at = now()
  FROM targets
  WHERE request.id = targets.id
  RETURNING request.id, targets.state AS prior_state
)
INSERT INTO boss_work_request_events
  (request_id, actor_kind, actor_id, prior_state, new_state, note, metadata)
SELECT id, 'system', NULL, prior_state, 'cancelled',
       'Owner requested removal of the prepaid-only checklist from Dave’s workspace.',
       '{"reason":"owner_requested_checklist_removal","migration":"20260911_remove_prepaid_only_checklist"}'::jsonb
FROM cancelled;
