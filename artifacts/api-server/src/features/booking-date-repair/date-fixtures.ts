/** Test-only provenance for fictional fixtures; never import from application code. */
import { readFileSync } from "node:fs";
export async function installReviewedDateFixtures(pg: {exec(sql:string):Promise<unknown>}) {
 await pg.exec(readFileSync(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql",import.meta.url),"utf8"));
 await pg.exec(`
 CREATE OR REPLACE FUNCTION fixture_review_date_endpoints() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE b uuid; first_field text; last_field text; kind_name text; start_value text; end_value text; start_sem text := 'instant'; end_sem text := 'instant'; rev integer;
 BEGIN
 IF TG_TABLE_NAME='bookings' THEN
 b:=NEW.id; first_field:='public_start'; last_field:='public_end'; kind_name:='verified_event';
 start_value:=booking_date_iso(NEW.starts_at); end_value:=booking_date_iso(NEW.ends_at);
 IF to_char(NEW.starts_at AT TIME ZONE 'UTC','HH24:MI:SS')='00:00:00' AND to_char(NEW.ends_at AT TIME ZONE 'UTC','HH24:MI:SS')='00:00:00' THEN start_value:=to_char(NEW.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD'); end_value:=to_char(NEW.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD'); start_sem:='inclusive_date'; end_sem:='inclusive_date'; END IF;
 ELSE
 b:=NEW.booking_id; first_field:='reservation_start'; last_field:='reservation_end'; kind_name:='verified_reservation';
 start_value:=booking_date_iso(NEW.starts_at); end_value:=booking_date_iso(NEW.ends_at);
 IF NEW.source='google_calendar' OR (to_char(NEW.starts_at AT TIME ZONE 'UTC','HH24:MI:SS')='00:00:00' AND to_char(NEW.ends_at AT TIME ZONE 'UTC','HH24:MI:SS')='00:00:00') THEN start_value:=to_char(NEW.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD'); end_value:=to_char(NEW.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD'); start_sem:='inclusive_date'; end_sem:='exclusive_date'; END IF;
 END IF;
 SELECT COALESCE(max(revision),0)+1 INTO rev FROM booking_date_evidence WHERE booking_id=b;
 INSERT INTO booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor)
 VALUES(b,first_field,kind_name,start_value,start_sem,rev,'test_fixture',b::text,rev::text,'fixture'),(b,last_field,kind_name,end_value,end_sem,rev,'test_fixture',b::text,rev::text,'fixture');
 RETURN NEW;
 END $$;
 CREATE TRIGGER fixture_review_public_dates AFTER INSERT OR UPDATE OF starts_at,ends_at ON bookings FOR EACH ROW EXECUTE FUNCTION fixture_review_date_endpoints();
 CREATE TRIGGER fixture_review_reservation_dates AFTER INSERT OR UPDATE OF starts_at,ends_at ON booking_operational_windows FOR EACH ROW EXECUTE FUNCTION fixture_review_date_endpoints();
 INSERT INTO booking_date_evidence(booking_id,field,kind,value,semantics,revision,source_type,source_id,source_revision,actor)
 SELECT id,'public_start','verified_event',CASE WHEN to_char(starts_at AT TIME ZONE 'UTC','HH24:MI:SS')='00:00:00' AND to_char(ends_at AT TIME ZONE 'UTC','HH24:MI:SS')='00:00:00' THEN to_char(starts_at AT TIME ZONE 'UTC','YYYY-MM-DD') ELSE booking_date_iso(starts_at) END,CASE WHEN to_char(starts_at AT TIME ZONE 'UTC','HH24:MI:SS')='00:00:00' AND to_char(ends_at AT TIME ZONE 'UTC','HH24:MI:SS')='00:00:00' THEN 'inclusive_date' ELSE 'instant' END,1,'test_fixture',id::text,'1','fixture' FROM bookings
 UNION ALL SELECT id,'public_end','verified_event',CASE WHEN to_char(starts_at AT TIME ZONE 'UTC','HH24:MI:SS')='00:00:00' AND to_char(ends_at AT TIME ZONE 'UTC','HH24:MI:SS')='00:00:00' THEN to_char(ends_at AT TIME ZONE 'UTC','YYYY-MM-DD') ELSE booking_date_iso(ends_at) END,CASE WHEN to_char(starts_at AT TIME ZONE 'UTC','HH24:MI:SS')='00:00:00' AND to_char(ends_at AT TIME ZONE 'UTC','HH24:MI:SS')='00:00:00' THEN 'inclusive_date' ELSE 'instant' END,1,'test_fixture',id::text,'1','fixture' FROM bookings;
 `);
}
