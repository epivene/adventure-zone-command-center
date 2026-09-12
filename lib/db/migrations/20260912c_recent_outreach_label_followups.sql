-- Reconcile labeled September 11-12 Gmail threads through the exact profile-label map.
WITH label_targets(label_id, kind, due_at) AS (
  VALUES
    ('Label_1315', 'convention_reply_check', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1316', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1317', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1318', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1321', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1322', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1323', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1325', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1326', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1328', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1329', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1330', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1333', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1334', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_1335', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_1338', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_171', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_192', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_199', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_203', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_219', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_227', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_229', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_235', 'proposal_contract', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_244', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_489', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_507', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_521', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_527', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_532', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_547', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_560', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_675', 'convention_reply_check', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_678', 'convention_reply_check', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_685', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_686', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_690', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_692', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_693', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_695', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_701', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_711', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_732', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_738', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_747', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_757', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_758', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_759', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_786', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_814', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_817', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_818', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_819', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_823', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz)
),
mapped_organizations AS (
  SELECT DISTINCT ON (target.label_id)
    mapping.organization_id,
    target.kind,
    target.due_at
  FROM label_targets target
  JOIN google_workspace_profile_labels mapping
    ON mapping.gmail_label_id = target.label_id
   AND mapping.state = 'active'
  ORDER BY target.label_id, mapping.updated_at DESC, mapping.id DESC
)
UPDATE follow_ups follow_up
SET kind = mapped.kind,
    updated_at = now()
FROM mapped_organizations mapped
WHERE follow_up.organization_id = mapped.organization_id
  AND follow_up.completed_at IS NULL
  AND follow_up.kind = 'email';

WITH label_targets(label_id, kind, due_at) AS (
  VALUES
    ('Label_1315', 'convention_reply_check', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1316', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1317', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1318', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1321', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1322', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1323', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1325', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1326', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1328', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1329', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1330', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1333', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_1334', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_1335', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_1338', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_171', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_192', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_199', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_203', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_219', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_227', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_229', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_235', 'proposal_contract', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_244', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_489', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_507', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_521', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_527', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_532', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_547', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_560', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_675', 'convention_reply_check', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_678', 'convention_reply_check', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_685', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_686', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_690', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_692', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_693', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_695', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_701', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_711', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_732', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_738', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_747', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_757', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_758', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_759', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_786', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_814', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_817', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_818', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('Label_819', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('Label_823', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz)
),
mapped_organizations AS (
  SELECT DISTINCT ON (target.label_id)
    mapping.organization_id,
    target.kind,
    target.due_at
  FROM label_targets target
  JOIN google_workspace_profile_labels mapping
    ON mapping.gmail_label_id = target.label_id
   AND mapping.state = 'active'
  ORDER BY target.label_id, mapping.updated_at DESC, mapping.id DESC
)
INSERT INTO follow_ups (
  organization_id,
  kind,
  due_at,
  created_at,
  updated_at
)
SELECT
  mapped.organization_id,
  mapped.kind,
  mapped.due_at,
  now(),
  now()
FROM mapped_organizations mapped
WHERE NOT EXISTS (
  SELECT 1
  FROM follow_ups existing
  WHERE existing.organization_id = mapped.organization_id
    AND existing.completed_at IS NULL
);
