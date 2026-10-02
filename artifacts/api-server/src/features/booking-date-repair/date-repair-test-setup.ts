import { readFile } from "node:fs/promises";
import { planningDatabase } from "../leg-planning/planning-test-database";
import { ids } from "../leg-planning/planning-fixtures";
export { ids };
export const noteId="10000000-0000-4000-8000-000000000001";
export const orgId="10000000-0000-4000-8000-000000000002";
export const repairFixtureSql=`
ALTER TABLE bookings ADD COLUMN organization_id uuid, ADD COLUMN notes text;
ALTER TABLE booking_operational_windows ADD COLUMN updated_at timestamptz DEFAULT now();
CREATE TABLE organizations(id uuid PRIMARY KEY,name text);
CREATE TABLE activities(id uuid PRIMARY KEY,organization_id uuid,booking_id uuid,body text,subject text,updated_at timestamptz DEFAULT now(),deleted_at timestamptz,source_version_id uuid);
CREATE TABLE event_date_facts(id uuid PRIMARY KEY,organization_id uuid,starts_on date,ends_on date,status text,active boolean,verified_at timestamptz,updated_at timestamptz,source_title text);
CREATE TABLE google_operational_calendar_reviews(id uuid PRIMARY KEY,booking_id uuid,state text,proposed_changes jsonb,reviewed_at timestamptz);
CREATE TABLE business_documents(id uuid PRIMARY KEY,current_version_id uuid,lifecycle text,review_state text,display_name text,notes text,updated_at timestamptz);
CREATE TABLE business_document_versions(id uuid PRIMARY KEY,document_id uuid,blob_id uuid);
CREATE TABLE business_document_blobs(id uuid PRIMARY KEY,sha256_hex text,validation_state text);
CREATE TABLE business_document_links(id uuid PRIMARY KEY,document_id uuid,target_kind text,organization_id uuid,booking_id uuid);
CREATE TABLE audit_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb,reverses_entry_id uuid,created_at timestamptz DEFAULT now());
INSERT INTO organizations VALUES('${orgId}','Fixture profile');
UPDATE bookings SET organization_id='${orgId}',status='lead',starts_at='2026-01-01',ends_at='9999-12-31',notes='Keep history';
INSERT INTO bookings(id,name,status,organization_id,starts_at,ends_at,notes) VALUES('${ids.otherBooking}','Sibling 2028','lead','${orgId}','2028-07-21','2028-07-26','Sibling history');
INSERT INTO activities(id,booking_id,organization_id,body,subject) VALUES('${noteId}','${ids.booking}','${orgId}','Confirmed event dates 2027-07-21 through 2027-07-26; setup 2027-07-20 through exclusive 2027-07-27.','Saved event agreement');
`;
export const proposal=()=>({bookingId:ids.booking,reason:"Owner checked exact 2027 event agreement",clearFields:[],
 endpoints:[{field:"public_start",kind:"verified_event",value:"2027-07-21",semantics:"inclusive_date",sourceRef:{type:"saved_note",id:noteId}},
 {field:"public_end",kind:"verified_event",value:"2027-07-26",semantics:"inclusive_date",sourceRef:{type:"saved_note",id:noteId}}]});
export async function repairDatabase(){
 const {pg,db}=await planningDatabase({reviewDates:false});
 await pg.exec(repairFixtureSql);
 await pg.exec(await readFile(new URL("../../../../../lib/db/migrations/20261002_booking_date_provenance.sql",import.meta.url),"utf8"));
 return {pg,db};
}
