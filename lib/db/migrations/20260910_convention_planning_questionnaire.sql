BEGIN;

ALTER TABLE boss_work_requests DROP CONSTRAINT IF EXISTS boss_work_requests_type_valid;
ALTER TABLE boss_work_requests ADD CONSTRAINT boss_work_requests_type_valid
  CHECK (type IN ('rapid_convention_notes', 'email_template_approval', 'convention_planning_questionnaire'));

WITH inserted AS (
  INSERT INTO boss_work_requests
    (type, title, instructions, created_by_owner_id, assigned_boss_account_id, deduplication_key)
  SELECT 'convention_planning_questionnaire', 'Convention Planning Decisions',
    'Fill in your convention planning decisions. Save progress or submit answers when ready.',
    'system:convention-planning-questionnaire', id,
    'convention-planning:2026-2027:gmail-1a083d3ca1ce74c4'
  FROM boss_accounts
  WHERE enabled = true AND display_name ILIKE '%dave%'
  ORDER BY id LIMIT 1
  ON CONFLICT DO NOTHING
  RETURNING id
)
INSERT INTO boss_work_request_events (request_id, actor_kind, new_state, note)
SELECT id, 'system', 'waiting_on_dave',
  'Added Convention Planning Decisions from the Gmail questionnaire.'
FROM inserted;

COMMIT;
