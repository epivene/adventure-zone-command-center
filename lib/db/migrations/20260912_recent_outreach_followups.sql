-- Reconcile the September 11-12 outreach batch without moving intentional dates.
-- Exact recipient emails avoid similarly named profiles (notably Yuma County).
WITH targets(email, kind, due_at) AS (
  VALUES
    ('mckenzie@libbyproperties.com', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('mtitensor@richmondutah.gov', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('pschenderline@bighorncountymt.gov', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('kmklein@infowest.com', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('mcallisteremail@yahoo.com', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('ryan.lyman@lincolncountywy.gov', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('chocofair@itstriangle.com', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('rachel@funatixevents.com', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('celebration@valleylionsclub.org', 'proposal_contract', '2026-09-19 12:00:00-06'::timestamptz),
    ('estadelman@ouraycountyco.gov', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('laura@fremontcountyfair.org', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('jgoodnow@moffatcounty.net', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('bob.bushta@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('moorcroftchamber@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('megang@monticelloutah.gov', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('ecfair@elmorecountyid.gov', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('crookcofair@rangeweb.net', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('pinmorek@ida.net', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('mcfair@restel.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('office@westoncountyfair.org', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('gemcofair@co.gem.id.us', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('nwatkins@laramiecountyfair.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('cmurray@yumacountyco.gov', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('president@tmhc-ccd.org', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('btech@cityofvictor.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('fouts.shandel@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('gowdfestival@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('fairgrounds@co.lake.or.us', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('msaville@rc.mt.gov', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('snakeriverdoodles@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('scofield84526@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('arobbins@madisoncountymt.gov', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('jbryan@millardcounty.gov', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('info@kamiahchamber.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('sargentcofairboard@outlook.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('ewelker@cariboumc.org', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('tara@glenwoodchamber.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('keeleyfitz@hotmail.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('parkcofair.co@gmail.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('jamie.shores.99@gmail.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('ksprys@fairplayco.us', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('greatnorthernfair@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('rmodica@adcogov.org', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('shawna_snarr@yahoo.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('ewood@co.routt.co.us', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('office@meeteetsewy.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('tsteadmon@archuletacounty.gov', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('skyebogle@elpasoco.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('rhonda.sweetser@haydencolorado.org', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('info@phillipscountyfair.org', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('kailey@sublettecountyfair.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('ucfair@uintacounty.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('wyomingfairs@gmail.com', 'convention_reply_check', '2026-09-18 12:00:00-06'::timestamptz),
    ('wfa@fairsnet.org', 'convention_reply_check', '2026-09-18 12:00:00-06'::timestamptz),
    ('director@coloradofairs.org', 'convention_reply_check', '2026-09-18 12:00:00-06'::timestamptz)
),
matched_contacts AS (
  SELECT DISTINCT ON (lower(t.email))
    lower(t.email) AS email,
    t.kind,
    t.due_at,
    c.id AS contact_id,
    coalesce(c.organization_id, membership.organization_id) AS organization_id
  FROM targets t
  JOIN contacts c ON lower(trim(c.email)) = lower(t.email)
  LEFT JOIN LATERAL (
    SELECT association.organization_id
    FROM organization_contacts association
    WHERE association.contact_id = c.id
      AND association.active
    ORDER BY association.is_primary DESC, association.updated_at DESC, association.id DESC
    LIMIT 1
  ) membership ON true
  WHERE coalesce(c.organization_id, membership.organization_id) IS NOT NULL
  ORDER BY lower(t.email), c.created_at DESC, c.id DESC
)
UPDATE follow_ups f
SET kind = matched.kind,
    updated_at = now()
FROM matched_contacts matched
WHERE f.contact_id = matched.contact_id
  AND f.completed_at IS NULL
  AND f.kind = 'email';

WITH targets(email, kind, due_at) AS (
  VALUES
    ('mckenzie@libbyproperties.com', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('mtitensor@richmondutah.gov', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('pschenderline@bighorncountymt.gov', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('kmklein@infowest.com', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('mcallisteremail@yahoo.com', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('ryan.lyman@lincolncountywy.gov', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('chocofair@itstriangle.com', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('rachel@funatixevents.com', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('celebration@valleylionsclub.org', 'proposal_contract', '2026-09-19 12:00:00-06'::timestamptz),
    ('estadelman@ouraycountyco.gov', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('laura@fremontcountyfair.org', '2027_outreach', '2026-09-19 12:00:00-06'::timestamptz),
    ('jgoodnow@moffatcounty.net', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('bob.bushta@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('moorcroftchamber@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('megang@monticelloutah.gov', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('ecfair@elmorecountyid.gov', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('crookcofair@rangeweb.net', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('pinmorek@ida.net', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('mcfair@restel.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('office@westoncountyfair.org', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('gemcofair@co.gem.id.us', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('nwatkins@laramiecountyfair.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('cmurray@yumacountyco.gov', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('president@tmhc-ccd.org', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('btech@cityofvictor.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('fouts.shandel@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('gowdfestival@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('fairgrounds@co.lake.or.us', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('msaville@rc.mt.gov', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('snakeriverdoodles@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('scofield84526@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('arobbins@madisoncountymt.gov', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('jbryan@millardcounty.gov', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('info@kamiahchamber.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('sargentcofairboard@outlook.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('ewelker@cariboumc.org', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('tara@glenwoodchamber.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('keeleyfitz@hotmail.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('parkcofair.co@gmail.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('jamie.shores.99@gmail.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('ksprys@fairplayco.us', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('greatnorthernfair@gmail.com', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('rmodica@adcogov.org', '2027_outreach', '2026-09-18 12:00:00-06'::timestamptz),
    ('shawna_snarr@yahoo.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('ewood@co.routt.co.us', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('office@meeteetsewy.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('tsteadmon@archuletacounty.gov', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('skyebogle@elpasoco.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('rhonda.sweetser@haydencolorado.org', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('info@phillipscountyfair.org', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('kailey@sublettecountyfair.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('ucfair@uintacounty.com', 'post_event_feedback', '2026-09-18 12:00:00-06'::timestamptz),
    ('wyomingfairs@gmail.com', 'convention_reply_check', '2026-09-18 12:00:00-06'::timestamptz),
    ('wfa@fairsnet.org', 'convention_reply_check', '2026-09-18 12:00:00-06'::timestamptz),
    ('director@coloradofairs.org', 'convention_reply_check', '2026-09-18 12:00:00-06'::timestamptz)
),
matched_contacts AS (
  SELECT DISTINCT ON (lower(t.email))
    lower(t.email) AS email,
    t.kind,
    t.due_at,
    c.id AS contact_id,
    coalesce(c.organization_id, membership.organization_id) AS organization_id
  FROM targets t
  JOIN contacts c ON lower(trim(c.email)) = lower(t.email)
  LEFT JOIN LATERAL (
    SELECT association.organization_id
    FROM organization_contacts association
    WHERE association.contact_id = c.id
      AND association.active
    ORDER BY association.is_primary DESC, association.updated_at DESC, association.id DESC
    LIMIT 1
  ) membership ON true
  WHERE coalesce(c.organization_id, membership.organization_id) IS NOT NULL
  ORDER BY lower(t.email), c.created_at DESC, c.id DESC
)
INSERT INTO follow_ups (
  organization_id,
  contact_id,
  kind,
  due_at,
  created_at,
  updated_at
)
SELECT
  matched.organization_id,
  matched.contact_id,
  matched.kind,
  matched.due_at,
  now(),
  now()
FROM matched_contacts matched
WHERE NOT EXISTS (
  SELECT 1
  FROM follow_ups existing
  WHERE existing.contact_id = matched.contact_id
    AND existing.completed_at IS NULL
);
