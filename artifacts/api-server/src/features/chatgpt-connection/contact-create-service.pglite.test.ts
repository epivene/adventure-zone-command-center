import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { ContactCreateService } from "./contact-create-service";
import { BookingWorkService } from "../booking-work/service";
import type { ConnectionPrincipal } from "./contracts";
vi.mock("./lead-note-service",()=>({receipt:async (_tx:any,id:string,href:string,revision:string,value:any)=>({operationId:randomUUID(),recordId:id,href,revision,savedAt:new Date().toISOString(),value})}));
vi.mock("./read-service",()=>({profileRow:async (tx:any,id:string)=> (await tx.query("SELECT * FROM organizations WHERE id=$1",[id])).rows[0]}));
let db:PGlite, service:ContactCreateService, p:ConnectionPrincipal, profileId:string, revision:string;
beforeEach(async()=>{
  db=new PGlite();
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
  profileId=randomUUID();p={ownerId:"owner",connectionId:randomUUID(),clientId:"client",scopes:["crm:read","crm:append","crm:update"]};
  await db.query("INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes) VALUES($1,$2,$3,$4)",[p.connectionId,p.ownerId,p.clientId,JSON.stringify(p.scopes)]);
  revision=(await db.query("INSERT INTO organizations(id,name) VALUES($1,'Fair') RETURNING updated_at::text AS revision",[profileId])).rows[0].revision as string;
  service=new ContactCreateService(db);
});
afterEach(async()=>{await db.close();});
const input=()=>({profileId,expectedProfileRevision:revision,firstName:"Nicole",lastName:"White",email:"nicole@example.com",jobTitle:"Committee contact",sourceUrl:"https://mail.google.com/mail/u/0/#all/source",evidence:"Nicole introduced herself as the new committee contact."});
it("creates a sourced contact atomically with relationship, audit, sync state and receipt; retry is idempotent",async()=>{
  const saved=await service.create(p,{requestKey:"new"},input());
  expect((await service.create(p,{requestKey:"new"},input())).operationId).toBe(saved.operationId);
  expect((await db.query("SELECT * FROM contacts")).rows).toHaveLength(1);
  expect((await db.query("SELECT * FROM organization_contacts")).rows[0]).toMatchObject({active:true,is_primary:false,organization_id:profileId});
  expect((await db.query("SELECT * FROM activities")).rows[0].body).toContain(input().sourceUrl);
  expect((await db.query("SELECT * FROM audit_entries")).rows).toHaveLength(1);
  expect((await db.query("SELECT * FROM act_contact_sync_states")).rows[0].state).toBe("waiting");
  await expect(service.create(p,{requestKey:"new"},{...input(),firstName:"Other"})).rejects.toMatchObject({code:"CONNECTION_REQUEST_CONFLICT"});
});
it("blocks duplicate email across profiles and same-name contacts without modifying them",async()=>{
  await service.create(p,{requestKey:"first"},input());
  await expect(service.create(p,{requestKey:"again"},{...input(),email:"NICOLE@example.com"})).rejects.toMatchObject({code:"CONNECTION_CONTACT_DUPLICATE_CANDIDATE"});
  await expect(service.create(p,{requestKey:"name"},{...input(),email:null})).rejects.toMatchObject({code:"CONNECTION_CONTACT_DUPLICATE_CANDIDATE"});
  const other=randomUUID();const r=(await db.query("INSERT INTO organizations(id,name) VALUES($1,'Other') RETURNING updated_at::text AS revision",[other])).rows[0];
  await expect(service.create(p,{requestKey:"other"},{...input(),profileId:other,expectedProfileRevision:r.revision as string})).rejects.toMatchObject({code:"CONNECTION_CONTACT_DUPLICATE_CANDIDATE"});
  expect((await db.query("SELECT * FROM contacts")).rows).toHaveLength(1);
});
it("rejects missing scope, stale profiles, consolidated profiles and revoked connections",async()=>{
  await expect(service.create({...p,scopes:["crm:read"]},{requestKey:"scope"},input())).rejects.toMatchObject({status:403});
  await expect(service.create(p,{requestKey:"stale"},{...input(),expectedProfileRevision:"old"})).rejects.toMatchObject({code:"CONNECTION_STALE_REVISION"});
  await db.query("UPDATE organizations SET consolidated_into_id=$1",[randomUUID()]);
  await expect(service.create(p,{requestKey:"merged"},input())).rejects.toMatchObject({code:"CONNECTION_PROFILE_UNAVAILABLE"});
  await db.query("UPDATE chatgpt_connections SET revoked_at=now()");
  await expect(service.create(p,{requestKey:"revoked"},input())).rejects.toMatchObject({code:"CONNECTION_REVOKED"});
  expect((await db.query("SELECT * FROM contacts")).rows).toHaveLength(0);
});
it("rolls back contact and relationship when audit persistence fails",async()=>{
  await db.exec("ALTER TABLE audit_entries ADD CONSTRAINT reject_test CHECK (action <> 'create')");
  await expect(service.create(p,{requestKey:"failure"},input())).rejects.toThrow();
  for(const table of ["contacts","organization_contacts","activities","act_contact_sync_states","chatgpt_operations"])
    expect((await db.query(`SELECT * FROM ${table}`)).rows).toHaveLength(0);
});
it("explains foreign work assignment and preserves its progress and owner",async()=>{
  const id=randomUUID(),actor={kind:"connection",id:randomUUID()};
  await db.query("INSERT INTO booking_work_activities(id,profile_id,event_year,queue,title,next_action,status,assigned_to) VALUES($1,$2,2027,'followups','Reply','Keep','waiting_customer',$3)",[id,profileId,JSON.stringify(actor)]);
  const s=new BookingWorkService(db);
  try{await s.update(p,{id,revision:1,requestKey:"work",patch:{status:"completed"}});throw Error("Expected rejection");}
  catch(e:any){expect(e.code).toBe("WORK_NOT_ASSIGNED");expect(JSON.parse(e.message)).toMatchObject({assignedTo:actor,currentConnectionId:p.connectionId,revision:1});expect(JSON.parse(e.message).recovery).toContain("reassign");}
  expect((await s.read(p,id)).nextAction).toBe("Keep");
  expect((await s.read(p,id)).revision).toBe(1);
});
it("guides unassigned work through claim and update with new revision",async()=>{
  const id=randomUUID();await db.query("INSERT INTO booking_work_activities(id,profile_id,event_year,queue,title,next_action,status) VALUES($1,$2,2027,'replies','Reply','Review','queued')",[id,profileId]);
  const s=new BookingWorkService(db);
  await expect(s.update(p,{id,revision:1,requestKey:"notmine",patch:{nextAction:"Done"}})).rejects.toMatchObject({code:"WORK_NOT_ASSIGNED",message:expect.stringContaining("claim_existing_booking_work")});
  const claimed=await s.claimExisting(p,{id,revision:1,requestKey:"claim"});
  const updated=await s.update(p,{id,revision:claimed.value.revision,requestKey:"update",patch:{nextAction:"Reviewed"}});
  expect(updated.value.nextAction).toBe("Reviewed");
});
