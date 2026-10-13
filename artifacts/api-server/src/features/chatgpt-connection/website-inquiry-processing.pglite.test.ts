import { afterEach, beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "./test-database";
import { WebsiteInquiryProcessing } from "./website-inquiry-processing";
let f: Awaited<ReturnType<typeof fixture>>, service: WebsiteInquiryProcessing;
let inquiryId: string, contactId: string, bookingId: string;
beforeEach(async () => {
 f=await fixture(); service=new WebsiteInquiryProcessing(f.db,"https://example.test");
 await f.db.exec(`CREATE TABLE website_inquiries(
 id uuid PRIMARY KEY,status text,reference_code text,name text,email text,event_name text,event_date date,message text,
 converted_contact_id uuid,converted_organization_id uuid,converted_booking_id uuid,
 reviewed_by_kind text,reviewed_by_id text,reviewed_by_name text,reviewed_at timestamptz,converted_at timestamptz,
 updated_at timestamptz DEFAULT now());
 CREATE TABLE booking_contacts(booking_id uuid,contact_id uuid);
 CREATE TABLE audit_entries(entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb);`);
 inquiryId=randomUUID();contactId=randomUUID();bookingId=randomUUID();
 await f.db.query("INSERT INTO website_inquiries(id,status,reference_code,name,email,event_name,message) VALUES($1,'new','REF','Organizer','a@example.test','Fair','Original message')",[inquiryId]);
 await f.db.query("INSERT INTO contacts(id,email) VALUES($1,'a@example.test')",[contactId]);
 await f.db.query("INSERT INTO organization_contacts(organization_id,contact_id) VALUES($1,$2)",[f.profileId,contactId]);
 await f.db.query("INSERT INTO bookings(id,organization_id,name) VALUES($1,$2,'Fair 2027')",[bookingId,f.profileId]);
 await f.db.query("INSERT INTO booking_contacts VALUES($1,$2)",[bookingId,contactId]);
});
afterEach(async()=>{await f?.db.close();});
const review=()=>({inquiryId,action:"begin_review" as const});
const link=()=>({inquiryId,action:"link_existing" as const,profileId:f.profileId,contactId,bookingId});
async function apply(input=link(),requestKey="save") {
 const preview=await service.preview(f.principal,input);
 return service.apply(f.principal,{requestKey},{...input,expectedRevision:preview.expectedRevision,reason:"Verified full original inquiry and existing event history"});
}
it("marks reviewing with audit without creating CRM records or changing the message",async()=>{
 const input=review(), preview=await service.preview(f.principal,input);
 const result=await service.apply(f.principal,{requestKey:"review"},{...input,expectedRevision:preview.expectedRevision,reason:"Opened and reviewed original request"});
 expect(result.value.status).toBe("reviewing");
 expect((await f.db.query("SELECT message FROM website_inquiries")).rows[0].message).toBe("Original message");
 expect((await f.db.query("SELECT * FROM audit_entries")).rows).toHaveLength(1);
 expect((await f.db.query("SELECT * FROM follow_ups")).rows).toHaveLength(0);
});
it("links existing records, preserves booking and replays exactly without duplicate audit",async()=>{
 const input=link(), preview=await service.preview(f.principal,input);
 const payload={...input,expectedRevision:preview.expectedRevision,reason:"Verified full inquiry and existing event history"};
 const first=await service.apply(f.principal,{requestKey:"same"},payload);
 expect(first.value).toMatchObject({status:"converted",converted_organization_id:f.profileId,converted_booking_id:bookingId,createdRecords:false,sent:false});
 expect(await service.apply(f.principal,{requestKey:"same"},payload)).toEqual(first);
 expect((await f.db.query("SELECT * FROM audit_entries")).rows).toHaveLength(1);
 expect((await f.db.query("SELECT * FROM bookings")).rows).toHaveLength(1);
 expect((await f.db.query("SELECT * FROM follow_ups")).rows).toHaveLength(0);
 await expect(service.apply(f.principal,{requestKey:"same"},{...payload,reason:"Different reason and request"})).rejects.toMatchObject({code:"CONNECTION_REQUEST_CONFLICT"});
});
it.each(["inquiry","profile","contact","booking"])("rejects stale %s evidence before writing",async(target)=>{
 const input=link(), preview=await service.preview(f.principal,input);
 const [table,id]=target==="inquiry"?["website_inquiries",inquiryId]:target==="profile"?["organizations",f.profileId]:target==="contact"?["contacts",contactId]:["bookings",bookingId];
 await f.db.query("UPDATE "+table+" SET updated_at=updated_at+interval '1 second' WHERE id=$1",[id]);
 await expect(service.apply(f.principal,{requestKey:"stale"},{...input,expectedRevision:preview.expectedRevision,reason:"Verified original evidence"})).rejects.toMatchObject({code:"CONNECTION_STALE_REVISION"});
 expect((await f.db.query("SELECT * FROM audit_entries")).rows).toHaveLength(0);
});
it.each(["email","profile","membership","bookingContact"])("blocks mismatched %s",async(change)=>{
 if(change==="email")await f.db.query("UPDATE contacts SET email='other@example.test'");
 if(change==="profile")await f.db.query("UPDATE bookings SET organization_id=$1",[randomUUID()]);
 if(change==="membership")await f.db.query("UPDATE organization_contacts SET active=false");
 if(change==="bookingContact")await f.db.query("DELETE FROM booking_contacts");
 await expect(service.preview(f.principal,link())).rejects.toMatchObject({code:"WEBSITE_INQUIRY_MATCH_CONFLICT"});
});
it("blocks archived and converted inquiries and requires scopes/revocation checks",async()=>{
 const input=review(),preview=await service.preview(f.principal,input),payload={...input,expectedRevision:preview.expectedRevision,reason:"Reviewed original evidence"};
 await expect(service.apply({...f.principal,scopes:["crm:read"]},{requestKey:"denied"},payload)).rejects.toMatchObject({code:"CONNECTION_ACCESS_DENIED"});
 for(const status of ["archived","converted","spam"]){
 await f.db.query("UPDATE website_inquiries SET status=$1",[status]);
 await expect(service.preview(f.principal,input)).rejects.toMatchObject({code:"WEBSITE_INQUIRY_STATUS_CONFLICT"});
 }
 await f.db.query("UPDATE chatgpt_connections SET revoked_at=now()");
 await expect(service.preview(f.principal,input)).rejects.toMatchObject({code:"CONNECTION_REVOKED"});
 await expect(service.apply(f.principal,{requestKey:"revoked"},payload)).rejects.toMatchObject({code:"CONNECTION_REVOKED"});
});
it("rolls back the inquiry change if the audit cannot be written",async()=>{
 await f.db.exec('DROP TABLE audit_entries');
 await expect(apply()).rejects.toThrow();
 expect((await f.db.query("SELECT status FROM website_inquiries")).rows[0].status).toBe("new");
 expect((await f.db.query("SELECT * FROM chatgpt_operations")).rows).toHaveLength(0);
});

it("rejects incomplete selections and consolidated profiles",async()=>{
 await expect(service.preview(f.principal,{inquiryId,action:"link_existing"})).rejects.toMatchObject({code:"WEBSITE_INQUIRY_INPUT_INVALID"});
 await expect(service.preview(f.principal,{...review(),profileId:f.profileId})).rejects.toMatchObject({code:"WEBSITE_INQUIRY_INPUT_INVALID"});
 await f.db.query("UPDATE organizations SET consolidated_into_id=$1",[randomUUID()]);
 await expect(service.preview(f.principal,link())).rejects.toMatchObject({code:"WEBSITE_INQUIRY_MATCH_CONFLICT"});
});
