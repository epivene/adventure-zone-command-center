-- Public directory import, retrieved 2026-09-10. Never sends messages or creates bookings.
-- Source facts and every registration sub-listing are retained in the import audit.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('directory-import-20260910'));
CREATE TABLE IF NOT EXISTS directory_import_records (
  batch text NOT NULL,
  source_key text NOT NULL,
  payload jsonb NOT NULL,
  organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES contacts(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK(status IN ('created','matched','review','excluded')),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(batch, source_key)
);
CREATE TABLE IF NOT EXISTS directory_import_20260910_batch (
  batch text PRIMARY KEY,
  records integer NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);
-- Session-local helpers leave the application's matching rules unchanged.
CREATE OR REPLACE FUNCTION pg_temp.directory_name(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
 SELECT regexp_replace(
   regexp_replace(
     regexp_replace(
       regexp_replace(lower(coalesce(value,'')), '\s*\([a-z]{2}\)\s*$', ''),
       '\mco\.?\s+fair\M', 'county fair', 'g'),
     '(county fair)(grounds| fair|,?\s*(and|&)\s*(prca )?rodeo|,?\s*livestock show\s*(and|&)\s*rodeo)$', '\1'),
   '[^a-z0-9]', '', 'g')
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.directory_phone(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
 SELECT CASE WHEN regexp_replace(coalesce(value,''),'[^0-9]','','g') ~ '^(1)?[0-9]{10}$'
   AND coalesce(value,'') !~* '(ext|extension|x)[. ]*[0-9]+'
   THEN right(regexp_replace(value,'[^0-9]','','g'),10) ELSE '' END
$fn$;
CREATE OR REPLACE FUNCTION pg_temp.directory_url(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $fn$
 SELECT regexp_replace(regexp_replace(lower(coalesce(value,'')), '^https?://(www\.)?', ''), '/+$', '')
$fn$;
-- Index a transaction-local identity snapshot instead of repeatedly normalizing every CRM profile.
CREATE TEMP TABLE directory_org_identity ON COMMIT DROP AS
 SELECT id, pg_temp.directory_name(name) AS name_key, pg_temp.directory_phone(phone) AS phone_key,
   pg_temp.directory_url(website) AS url_key FROM organizations WHERE consolidated_into_id IS NULL;
CREATE INDEX ON directory_org_identity(name_key);
CREATE INDEX ON directory_org_identity(phone_key,url_key);
CREATE TEMP TABLE directory_person_identity ON COMMIT DROP AS
 SELECT id, pg_temp.directory_name(first_name||' '||last_name) AS name_key,lower(trim(email)) AS email_key FROM contacts;
CREATE INDEX ON directory_person_identity(name_key,email_key);
DO $import$
DECLARE
 r jsonb;
 batch_key constant text := 'public-directories-20260910-v1';
 org_id uuid; person_id uuid; edition_id_value uuid; member_id_value uuid;
 candidates uuid[]; possible uuid[];
 member_before jsonb; member_after jsonb; note_body text;
 result_status text; result_reason text; person_names text[];
 imported_count integer := 0;
 source_records jsonb := $seed$__SEED__$seed$::jsonb;
BEGIN
 IF EXISTS (SELECT 1 FROM directory_import_20260910_batch WHERE batch=batch_key) THEN RETURN; END IF;
 -- Stop rather than silently importing into an unexpected convention workspace.
 IF (SELECT count(*) FROM convention_editions WHERE year=2026 AND archived_at IS NULL
     AND convention IN ('Arizona AFA','Colorado','Heartland','RMAF','Wyoming')) <> 5 THEN
   RAISE EXCEPTION 'Expected the five existing 2026 convention editions';
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(source_records) LOOP
  IF EXISTS (SELECT 1 FROM directory_import_records WHERE batch=batch_key AND source_key=r->>'sourceKey') THEN CONTINUE; END IF;
  org_id:=NULL;person_id:=NULL;edition_id_value:=NULL;member_id_value:=NULL;
  candidates:=NULL;possible:=NULL;result_reason:='';result_status:='matched';
  IF pg_temp.directory_name(r->>'name') IN ('theadventurezone','adventurezone') THEN
   INSERT INTO directory_import_records(batch,source_key,payload,status,reason)
   VALUES(batch_key,r->>'sourceKey',r,'excluded','Our own business, not a lead');
   CONTINUE;
  END IF;
  IF nullif(r->>'knownOrganizationId','') IS NOT NULL THEN
   SELECT id INTO org_id FROM organizations WHERE id=(r->>'knownOrganizationId')::uuid AND consolidated_into_id IS NULL;
   IF org_id IS NULL THEN
    INSERT INTO directory_import_records(batch,source_key,payload,status,reason)
    VALUES(batch_key,r->>'sourceKey',r,'review','Previously visible profile link changed; manual reconciliation required');
    CONTINUE;
   END IF;
  ELSE
   -- A name in a different state is a different prospect. Unknown location is not positive evidence.
   SELECT array_agg(o.id ORDER BY o.id) INTO candidates FROM organizations o JOIN pg_temp.directory_org_identity oi ON oi.id=o.id
   WHERE o.consolidated_into_id IS NULL AND oi.name_key=pg_temp.directory_name(r->>'name')
    AND (upper(trim(coalesce(o.region,'')))=upper(r->>'region')
      OR (nullif(r->>'region','') IS NULL AND
          ((nullif(r->>'phone','') IS NOT NULL AND oi.phone_key=pg_temp.directory_phone(r->>'phone'))
           OR (nullif(r->>'website','') IS NOT NULL AND oi.url_key=pg_temp.directory_url(r->>'website')))));
   IF coalesce(cardinality(candidates),0)=0 THEN
    -- Strong two-field identity also handles a renamed business; never use a shared email alone.
    SELECT array_agg(o.id ORDER BY o.id) INTO candidates FROM organizations o JOIN pg_temp.directory_org_identity oi ON oi.id=o.id
    WHERE o.consolidated_into_id IS NULL
      AND length(pg_temp.directory_phone(r->>'phone'))=10
      AND oi.phone_key=pg_temp.directory_phone(r->>'phone')
      AND nullif(r->>'website','') IS NOT NULL
      AND oi.url_key=pg_temp.directory_url(r->>'website')
      AND (nullif(o.region,'') IS NULL OR nullif(r->>'region','') IS NULL OR upper(o.region)=upper(r->>'region'));
   END IF;
   IF coalesce(cardinality(candidates),0)=1 THEN org_id:=candidates[1];
   ELSIF coalesce(cardinality(candidates),0)>1 THEN result_reason:='Multiple matching profiles; review before linking';
   ELSE
    SELECT array_agg(o.id ORDER BY o.id) INTO possible FROM organizations o JOIN pg_temp.directory_org_identity oi ON oi.id=o.id
    WHERE o.consolidated_into_id IS NULL AND oi.name_key=pg_temp.directory_name(r->>'name')
      AND (nullif(o.region,'') IS NULL OR nullif(r->>'region','') IS NULL);
    IF coalesce(cardinality(possible),0)>0 THEN result_reason:='Same-name profile has insufficient location evidence';
    ELSE
     INSERT INTO organizations(name,place_type,address_1,city,region,postal_code,website,phone,normalized_phone)
     VALUES(r->>'name',r->>'placeType',nullif(r->>'address1',''),nullif(r->>'city',''),nullif(r->>'region',''),
       nullif(r->>'postalCode',''),nullif(r->>'website',''),nullif(r->>'phone',''),
       CASE WHEN length(pg_temp.directory_phone(r->>'phone'))=10 THEN '+1'||pg_temp.directory_phone(r->>'phone') END)
     RETURNING id INTO org_id;
     INSERT INTO pg_temp.directory_org_identity(id,name_key,phone_key,url_key) VALUES(org_id,pg_temp.directory_name(r->>'name'),pg_temp.directory_phone(r->>'phone'),pg_temp.directory_url(r->>'website'));
     result_status:='created';
    END IF;
   END IF;
  END IF;
  IF org_id IS NULL THEN
   INSERT INTO directory_import_records(batch,source_key,payload,status,reason)
   VALUES(batch_key,r->>'sourceKey',r,'review',result_reason);
   CONTINUE;
  END IF;
  -- Existing profile/contact fields and primary contacts are never overwritten by public directories.
  IF nullif(r->>'contact','') IS NOT NULL THEN
   SELECT array_agg(DISTINCT c.id ORDER BY c.id) INTO candidates FROM contacts c
    JOIN organization_contacts oc ON oc.contact_id=c.id AND oc.organization_id=org_id AND oc.active
    WHERE pg_temp.directory_name(c.first_name||' '||c.last_name)=pg_temp.directory_name(r->>'contact');
   IF coalesce(cardinality(candidates),0)=1 THEN person_id:=candidates[1];
   ELSIF coalesce(cardinality(candidates),0)>1 THEN result_reason:='Organization matched; duplicate named contacts need review';
   ELSE
    -- A person can legitimately represent more than one organization. Require name plus email globally.
    SELECT array_agg(id ORDER BY id) INTO candidates FROM pg_temp.directory_person_identity pi
     WHERE nullif(r->>'email','') IS NOT NULL AND pi.email_key=lower(r->>'email')
       AND pi.name_key=pg_temp.directory_name(r->>'contact');
    IF coalesce(cardinality(candidates),0)=1 THEN
     person_id:=candidates[1];
     INSERT INTO organization_contacts(organization_id,contact_id,role,is_primary,active,source)
     VALUES(org_id,person_id,'Published directory affiliation; current role unverified',false,true,batch_key)
     ON CONFLICT(organization_id,contact_id) DO NOTHING;
    ELSIF coalesce(cardinality(candidates),0)>1 THEN
     result_reason:='Organization matched; duplicate global named/email contacts need review';
    ELSE
    person_names:=regexp_split_to_array(r->>'contact','\s+');
    INSERT INTO contacts(first_name,last_name,email,phone,normalized_phone)
    VALUES(person_names[1],array_to_string(person_names[2:cardinality(person_names)],' '),nullif(r->>'email',''),nullif(r->>'phone',''),
      CASE WHEN length(pg_temp.directory_phone(r->>'phone'))=10 THEN '+1'||pg_temp.directory_phone(r->>'phone') END)
    RETURNING id INTO person_id;
    INSERT INTO pg_temp.directory_person_identity(id,name_key,email_key) VALUES(person_id,pg_temp.directory_name(r->>'contact'),lower(r->>'email'));
    INSERT INTO organization_contacts(organization_id,contact_id,role,is_primary,active,source)
    VALUES(org_id,person_id,'Published directory contact; current role unverified',false,true,batch_key);
    UPDATE contacts SET organization_id=org_id WHERE id=person_id;
    END IF;
   END IF;
  END IF;
  note_body:=concat('Public directory research — retrieved September 10, 2026', E'\n',
    'Source: ',r->>'source',CASE WHEN jsonb_array_length(r->'pages')>0 THEN ' pages '||(r->'pages')::text ELSE '' END,E'\n',
    'Directory: ',r->>'group',E'\n','Published listing: ',r->>'name',E'\n',
    CASE WHEN r->>'edition' IS NULL THEN 'General prospect. Association membership and convention attendance are not established.'
      ELSE 'Association membership evidence only. Convention attendance is unconfirmed.' END,E'\n',
    'Published contact: ',r->>'contact',E'\n', 'Source facts: ',jsonb_pretty(r->'facts'),E'\n',
    'Review notes: ',r->'notes',E'\n','Existing contact details and handling restrictions take priority over this directory.');
  INSERT INTO activities(organization_id,contact_id,kind,subject,body,occurred_at,timeline_sort_at,source_type)
  VALUES(org_id,person_id,'note','Directory source: '||(r->>'group'),note_body,now(),now(),'note');
  INSERT INTO directory_import_records(batch,source_key,payload,organization_id,contact_id,status,reason)
  VALUES(batch_key,r->>'sourceKey',r,org_id,person_id,result_status,result_reason);
  IF r->>'edition' IS NOT NULL THEN
   SELECT id INTO edition_id_value FROM convention_editions WHERE convention=r->>'edition' AND year=2026 AND archived_at IS NULL;
   -- Add evidence to every existing card for this organization, preserving individual contacts and outreach state.
   FOR member_id_value, member_before IN
    SELECT m.id,m.data FROM convention_members m WHERE m.edition_id=edition_id_value AND m.organization_id=org_id FOR UPDATE
   LOOP
    member_after:=jsonb_set(member_before,'{research}',coalesce(member_before->'research','{}') ||
      jsonb_build_object('directory_'||left(r->>'sourceKey',16),
       concat(r->>'group',': ',r->>'source','; membership only; retrieved 2026-09-10. Contact/source facts are in profile history.')));
    UPDATE convention_members SET data=member_after,revision=revision+1,updated_at=now() WHERE id=member_id_value;
    INSERT INTO convention_history(edition_id,member_id,kind,actor,mutation_key,payload)
    VALUES(edition_id_value,member_id_value,'directory_evidence','directory-import-20260910',
      batch_key||':'||(r->>'sourceKey')||':'||member_id_value,
      jsonb_build_object('before',member_before,'after',member_after,'source',r->>'source'));
   END LOOP;
   IF NOT EXISTS (SELECT 1 FROM convention_members WHERE edition_id=edition_id_value AND organization_id=org_id) THEN
    -- Reuse an unlinked card only when the name AND either the published email or full contact name uniquely agree.
    SELECT array_agg(id ORDER BY id) INTO candidates FROM convention_members m
     WHERE m.edition_id=edition_id_value AND m.organization_id IS NULL
      AND pg_temp.directory_name(m.data->>'event')=pg_temp.directory_name(r->>'name')
      AND ((nullif(r->>'email','') IS NOT NULL AND lower(trim(m.data->>'email'))=lower(r->>'email'))
        OR (nullif(r->>'contact','') IS NOT NULL AND pg_temp.directory_name(m.data->>'contact')=pg_temp.directory_name(r->>'contact')));
    IF coalesce(cardinality(candidates),0)=1 THEN
     member_id_value:=candidates[1];
     SELECT data INTO member_before FROM convention_members WHERE id=member_id_value FOR UPDATE;
     IF EXISTS(SELECT 1 FROM convention_members WHERE id=member_id_value AND organization_id IS NOT NULL) THEN
      UPDATE directory_import_records SET reason='Convention card changed during import; review link' WHERE batch=batch_key AND source_key=r->>'sourceKey';
      CONTINUE;
     END IF;
     member_after:=jsonb_set(member_before,'{research}',coalesce(member_before->'research','{}') ||
       jsonb_build_object('directory_'||left(r->>'sourceKey',16),concat(r->>'source','; membership only; retrieved 2026-09-10.')));
     UPDATE convention_members SET organization_id=org_id,
      contact_id=CASE WHEN pg_temp.directory_name(data->>'contact')=pg_temp.directory_name(r->>'contact') THEN coalesce(contact_id,person_id) ELSE contact_id END,
      data=member_after,revision=revision+1,updated_at=now() WHERE id=member_id_value;
     INSERT INTO convention_history(edition_id,member_id,kind,actor,mutation_key,payload)
     VALUES(edition_id_value,member_id_value,'directory_link','directory-import-20260910',batch_key||':'||(r->>'sourceKey'),
      jsonb_build_object('before',member_before,'after',member_after,'organizationId',org_id,'source',r->>'source'));
    ELSIF EXISTS (SELECT 1 FROM convention_members m WHERE m.edition_id=edition_id_value AND m.organization_id IS NULL
       AND pg_temp.directory_name(m.data->>'event')=pg_temp.directory_name(r->>'name')) THEN
     UPDATE directory_import_records SET reason=concat_ws('; ',nullif(reason,''),'Existing unlinked convention card needs identity review; no duplicate card added')
      WHERE batch=batch_key AND source_key=r->>'sourceKey';
    ELSE
     member_after:=jsonb_build_object('sourceKey','directory:'||(r->>'sourceKey'),'event',r->>'name','contact',r->>'contact','email',r->>'email',
       'group','confirm','outcome','not_contacted','attendance','association_only',
       'notes','Public directory member. Convention attendance and current contact role are unconfirmed.',
       'reason','Association directory research','sources',r->>'source',
       'nextAction','Review profile history, current role, and convention attendance before outreach.',
       'research',jsonb_build_object('directoryCategory',r->>'category','retrievedAt','2026-09-10'),
       'conventionResponse',jsonb_build_object('met',false,'interested',false,'followUp',false,'contact','','notes',''));
     INSERT INTO convention_members(edition_id,source_key,organization_id,contact_id,data)
     VALUES(edition_id_value,'directory:'||(r->>'sourceKey'),org_id,person_id,member_after) RETURNING id INTO member_id_value;
     INSERT INTO convention_history(edition_id,member_id,kind,actor,mutation_key,payload)
     VALUES(edition_id_value,member_id_value,'directory_import','directory-import-20260910',batch_key||':'||(r->>'sourceKey'),jsonb_build_object('after',member_after));
    END IF;
   END IF;
  END IF;
  imported_count:=imported_count+1;
 END LOOP;
 UPDATE convention_editions e SET revision=revision+1 WHERE EXISTS
  (SELECT 1 FROM convention_history h WHERE h.edition_id=e.id AND h.actor='directory-import-20260910');
 INSERT INTO directory_import_20260910_batch(batch,records) VALUES(batch_key,jsonb_array_length(source_records));
END
$import$;
COMMIT;
