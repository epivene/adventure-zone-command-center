-- Consolidate the Aug. 27, 2026 Carol O'Donnell / CS OktoberFest outreach notes
-- into one useful CRM history entry. Older fragments are soft-deleted so they
-- remain recoverable but no longer clutter the active profile timeline.

WITH target AS (
  SELECT id
  FROM organizations
  WHERE lower(trim(name)) IN (
    'oktoberfest (colorado springs) co',
    'colorado springs oktoberfest'
  )
    AND lower(trim(coalesce(city, ''))) = 'colorado springs'
  ORDER BY CASE WHEN lower(trim(name)) = 'oktoberfest (colorado springs) co' THEN 0 ELSE 1 END
  LIMIT 1
)
UPDATE activities
SET deleted_at = now(),
    updated_at = now()
WHERE organization_id = (SELECT id FROM target)
  AND kind = 'note'
  AND deleted_at IS NULL
  AND subject IN (
    'Carol O''Donnell reply — 2026 OktoberFest outreach',
    'Carol follow-up — future interest, kids craft fair, Mini Zone mentioned',
    'Pay-per-play terms — historical guidance'
  );

WITH target AS (
  SELECT id
  FROM organizations
  WHERE lower(trim(name)) IN (
    'oktoberfest (colorado springs) co',
    'colorado springs oktoberfest'
  )
    AND lower(trim(coalesce(city, ''))) = 'colorado springs'
  ORDER BY CASE WHEN lower(trim(name)) = 'oktoberfest (colorado springs) co' THEN 0 ELSE 1 END
  LIMIT 1
)
INSERT INTO activities (
  organization_id,
  kind,
  subject,
  body,
  occurred_at,
  timeline_sort_at,
  created_at,
  updated_at
)
SELECT
  id,
  'note',
  '2026 outreach — Carol O''Donnell / CS OktoberFest',
  'Aug. 27, 2026 outreach summary: Carol O''Donnell declined the full package for 2026 because it was outside the event budget. She explained that CS OktoberFest previously used one inflatable but stopped after an unauthorized birthday-party group overloaded it and it deflated, creating an operations/safety concern. Desiree replied that Adventure Zone is professionally staffed and supervised for the entire event, handles setup/teardown, and carries a $2M policy listing the event holder as additionally insured. Desiree also explained the pay-per-play possibility and sent the Adventure Zone website/video. Historical pay-per-play terms vary by event: prior 2026 examples include a Mini Zone with a $5,000 sales guarantee before revenue sharing, a hybrid half-upfront arrangement with 10% of ticket-box sales after Adventure Zone reaches its normal package target, and some no-upfront/no-guarantee arrangements. Do not promise one structure; confirm any minimum/guarantee and percentage with Dave before quoting firm terms. Carol later said she will keep Adventure Zone in mind for the future and explained that a kids'' craft fair now occupies most remaining open space, with roughly 20 kid-run booths each day on Saturday and Sunday. Desiree mentioned the smaller Mini Zone only in passing as a possible future option when space is limited. Treat this as a warm future lead, not an active 2026 opportunity. Current contact: Carol O''Donnell, carol@odonnell2.com, 719-635-8803 Ext 2.',
  now(),
  now(),
  now(),
  now()
FROM target
WHERE NOT EXISTS (
  SELECT 1
  FROM activities a
  WHERE a.organization_id = target.id
    AND a.kind = 'note'
    AND a.subject = '2026 outreach — Carol O''Donnell / CS OktoberFest'
    AND a.deleted_at IS NULL
);
