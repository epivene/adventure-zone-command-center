import {beforeEach, afterEach, it, expect, vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {randomUUID} from "node:crypto";
import {BookingWorkService} from "./service";
import {bookingWorkTools} from "../chatgpt-connection/booking-work-tools";
import type {ConnectionPrincipal} from "../chatgpt-connection/contracts";
vi.mock("../chatgpt-connection/lead-note-service",()=>({receipt:async (_tx:any,id:string,href:string,revision:string,value:any)=>({operationId:randomUUID(),recordId:id,href,revision,savedAt:new Date().toISOString(),value})}));
vi.mock("../chatgpt-connection/read-service",()=>({profileRow:async (tx:any,id:string)=> (await tx.query("SELECT * FROM organizations WHERE id=$1 FOR UPDATE",[id])).rows[0]}));
let db:PGlite,s:BookingWorkService,p:ConnectionPrincipal,old:string,id:string;
beforeEach(async()=>{db=new PGlite();
  await db.exec(`
    CREATE TABLE organizations(id uuid PRIMARY KEY,name text,consolidated_into_id uuid,updated_at timestamptz DEFAULT now());
    CREATE TABLE contacts(id uuid PRIMARY KEY,organization_id uuid,first_name text NOT NULL,last_name text NOT NULL,email text,job_title text,updated_at timestamptz DEFAULT now());
    CREATE TABLE organization_contacts(organization_id uuid REFERENCES organizations(id),contact_id uuid REFERENCES contacts(id),active boolean,is_primary boolean,source text,UNIQUE(organization_id,contact_id));
    ALTER TABLE contacts ADD FOREIGN KEY(organization_id,id) REFERENCES organization_contacts(organization_id,contact_id);
    CREATE TABLE act_contact_sync_states(contact_id uuid PRIMARY KEY REFERENCES contacts(id),local_dirty boolean,state text);
    CREATE TABLE activities(id uuid PRIMARY KEY,organization_id uuid,contact_id uuid,kind text,subject text,body text,occurred_at timestamptz,timeline_sort_at timestamptz);
    CREATE TABLE audit_entries(id uuid DEFAULT gen_random_uuid(),entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb);
    CREATE TABLE chatgpt_connections(id uuid PRIMARY KEY,owner_id text,client_id text,scopes jsonb,revoked_at timestamptz,last_used_at timestamptz);
    CREATE TABLE chatgpt_operations(id uuid PRIMARY KEY,connection_id uuid,operation text,request_key text,input_hash text,receipt jsonb,UNIQUE(connection_id,operation,request_key));
    CREATE TABLE booking_work_activities(id uuid PRIMARY KEY,profile_id uuid,event_year integer,booking_id uuid,queue text,title text,next_action text,assigned_to jsonb,status text,due_at timestamptz,progress jsonb,links jsonb DEFAULT '[]',revision integer DEFAULT 1,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
  `);

 p={ownerId:"owner",connectionId:randomUUID(),clientId:"client",scopes:["crm:read","crm:update"]};old=randomUUID();id=randomUUID();
 for(const cid of [p.connectionId,old]) await db.query("INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes) VALUES($1,'owner','client',$2)",[cid,JSON.stringify(p.scopes)]);
 await db.query("UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1",[old]);
 const profileId=randomUUID();await db.query("INSERT INTO organizations(id,name) VALUES($1,'Fair')",[profileId]);
 await db.query("INSERT INTO booking_work_activities(id,profile_id,event_year,queue,title,next_action,status,assigned_to,due_at,progress,links) VALUES($1,$2,2027,'followups','Follow-up','Keep next action','waiting_customer',$3,'2026-10-15', $4,$5)",[id,profileId,JSON.stringify({kind:"connection",id:old}),JSON.stringify({total:1,completed:1,summary:"Sent"}),JSON.stringify([{kind:"email",label:"Sent mail",url:"https://mail.google.com/mail/u/0/#all/abc"}])]);
 s=new BookingWorkService(db);
});
afterEach(async()=>{await db.close()});
const input=()=>({id,revision:1,previousConnectionId:old,requestKey:"recover"});
it("recovers through connector, preserves work, records both actors, and retries idempotently",async()=>{
 const before=await s.read(p,id);const t=bookingWorkTools(s,p).find(t=>t.name==="recover_booking_work")!;
 const r:any=await t.call(t.schema.parse(input()));
 expect(r.value.activity).toMatchObject({...before,assignedTo:{kind:"connection",id:p.connectionId},revision:2,updatedAt:expect.any(String)});
 expect(r.value.previousAssignment).toEqual(before.assignedTo);
 expect((await s.recover(p,input())).operationId).toBe(r.operationId);
 expect((await db.query("SELECT * FROM chatgpt_operations")).rows).toHaveLength(1);
 await expect(s.recover(p,{...input(),previousConnectionId:randomUUID()})).rejects.toMatchObject({code:"CONNECTION_REQUEST_CONFLICT"});
});
it.each(["active","owner","client"])("rejects %s prior connections without edits",async kind=>{
 if(kind==="active") await db.query("UPDATE chatgpt_connections SET revoked_at=NULL WHERE id=$1",[old]);
 else await db.query(`UPDATE chatgpt_connections SET ${kind==="owner"?'owner_id':'client_id'}='other' WHERE id=$1`,[old]);
 await expect(s.recover(p,input())).rejects.toMatchObject({code:"WORK_OWNER_HANDOFF_REQUIRED"});
 expect((await s.read(p,id)).revision).toBe(1);
});
it("rejects stale revisions, changed assignments, and terminal cards",async()=>{
 await expect(s.recover(p,{...input(),revision:2})).rejects.toMatchObject({code:"WORK_REVISION_CONFLICT"});
 await expect(s.recover(p,{...input(),previousConnectionId:randomUUID()})).rejects.toMatchObject({code:"WORK_ASSIGNMENT_CHANGED"});
 await db.query("UPDATE booking_work_activities SET assigned_to=$1",[JSON.stringify({kind:"owner",id:"owner"})]);
 await expect(s.recover(p,input())).rejects.toMatchObject({code:"WORK_ASSIGNMENT_CHANGED"});
 await db.query("UPDATE booking_work_activities SET status='completed'");
 await expect(s.recover(p,input())).rejects.toMatchObject({code:"WORK_CLOSED"});
});
it("requires existing update scope and an active caller",async()=>{
 await expect(s.recover({...p,scopes:["crm:read"]},input())).rejects.toMatchObject({status:403});
 await db.query("UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1",[p.connectionId]);
 await expect(s.recover(p,input())).rejects.toMatchObject({code:"CONNECTION_REVOKED"});
});
it("rolls back assignment if the operation receipt cannot persist",async()=>{
 await db.exec("ALTER TABLE chatgpt_operations ADD CONSTRAINT reject_test CHECK (operation <> 'recover_booking_work')");
 await expect(s.recover(p,input())).rejects.toThrow();
 expect((await s.read(p,id)).assignedTo).toEqual({kind:"connection",id:old});
 expect((await s.read(p,id)).revision).toBe(1);
});
