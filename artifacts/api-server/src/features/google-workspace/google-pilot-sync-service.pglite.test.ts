import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PilotSyncService } from "./google-pilot-sync-service";
it("refreshes edited draft mappings once, retains history and refuses conflicting identities", async () => {
 const db=new PGlite();
 try {
 await db.exec(`CREATE TABLE google_workspace_connections(id uuid,status text,role text,updated_at timestamptz); INSERT INTO google_workspace_connections VALUES('da54625d-b6f1-4486-8299-e1d85d78422e','connected','workspace',now());
 CREATE TABLE google_workspace_validation_mappings(connection_id uuid,message_id text,thread_id text,organization_id uuid,contact_id uuid,evidence_codes jsonb,created_at timestamptz,updated_at timestamptz,PRIMARY KEY(connection_id,message_id));`);
 await db.exec(readFileSync(new URL("../../../../../lib/db/migrations/20261016_google_pilot_sync.sql",import.meta.url),"utf8"));
 const thread="1a0a277b5f84ad3a",profile="3f17b281-9e49-4ee9-a640-53d04b218322";
 await db.query("INSERT INTO google_workspace_validation_mappings VALUES($1,'old-draft',$2,$3,NULL,'[]',now(),now())",["da54625d-b6f1-4486-8299-e1d85d78422e",thread,profile]);
 const message={id:"new-draft",labelIds:["DRAFT"],internalDateMs:5,from:"theadventurezone12@gmail.com",to:"tara@example.com",cc:"",date:"",direction:"unknown" as const,attachments:[],subject:"2027",bodyText:"Edited by owner"};
 let reads=0,fail=false;
 const service=new PilotSyncService(db as any,async()=>({connectionId:"da54625d-b6f1-4486-8299-e1d85d78422e",email:"theadventurezone12@gmail.com",thread:async()=>{reads++;if(fail)throw Error("GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED");return {id:thread,messages:[message]};}}));
 await service.run(profile);
 await service.run(profile);
 expect(reads).toBe(1);
 await db.query("UPDATE google_pilot_sync SET attempted_at=now()-interval '61 seconds' WHERE profile_id=$1",[profile]); await service.run(profile);
 expect((await db.query<any>("SELECT snapshot FROM google_pilot_sync WHERE profile_id=$1",[profile])).rows[0].snapshot.drafts[0].bodyText).toBe("Edited by owner");
 expect((await db.query("SELECT * FROM google_pilot_sync_history")).rows).toHaveLength(1);
 expect((await db.query("SELECT * FROM google_workspace_validation_mappings")).rows).toHaveLength(2);
 message.id="newer-draft";message.bodyText="Second owner revision";
 await db.query("UPDATE google_pilot_sync SET attempted_at=now()-interval '61 seconds' WHERE profile_id=$1",[profile]); await service.run(profile);
 expect((await db.query("SELECT * FROM google_pilot_sync_history")).rows).toHaveLength(2);
 expect((await db.query("SELECT * FROM google_workspace_validation_mappings")).rows).toHaveLength(3);
 await db.exec(`CREATE TABLE organizations(id uuid,name text);CREATE TABLE follow_ups(id uuid,organization_id uuid,kind text,due_at timestamptz,completed_at timestamptz);CREATE TABLE email_thread_attention(gmail_connection_id uuid,thread_id text,reason text);
 INSERT INTO organizations VALUES('${profile}','Strawberry Days');INSERT INTO follow_ups VALUES('71ec17e8-5d4d-4141-81a7-cbba9160351a','${profile}','Review draft','2026-10-15',NULL);`);
 const {readPilotSync}=await import("./google-pilot-sync-runtime");
 const view=await readPilotSync(db as any);
 expect(view.items[0]).toMatchObject({profileName:"Strawberry Days",followups:[{kind:"Review draft"}],snapshot:{state:"draft_to_review"}});
 expect(view.items[0].snapshot).not.toHaveProperty("messages");
 fail=true;
 await db.query("UPDATE google_pilot_sync SET attempted_at=now()-interval '61 seconds' WHERE profile_id=$1",[profile]); await service.run(profile);
 expect((await db.query<any>("SELECT error_code,snapshot FROM google_pilot_sync WHERE profile_id=$1",[profile])).rows[0]).toMatchObject({error_code:"GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED",snapshot:{drafts:[{bodyText:"Second owner revision"}]}});
 fail=false;
 await db.query("UPDATE google_workspace_validation_mappings SET organization_id='20943487-43ec-4a11-8c67-36efefbf4efb' WHERE message_id='old-draft'");
 message.bodyText="Unverified change";
 await db.query("UPDATE google_pilot_sync SET attempted_at=now()-interval '61 seconds' WHERE profile_id=$1",[profile]); await service.run(profile);
 expect((await db.query<any>("SELECT error_code,snapshot FROM google_pilot_sync WHERE profile_id=$1",[profile])).rows[0]).toMatchObject({error_code:"PILOT_PROFILE_CONFLICT",snapshot:{drafts:[{bodyText:"Second owner revision"}]}});
 await db.query("UPDATE google_workspace_connections SET status='disconnected'");
 await db.query("UPDATE google_pilot_sync SET attempted_at=now()-interval '61 seconds' WHERE profile_id=$1",[profile]); await service.run(profile);
 expect((await db.query("SELECT * FROM google_pilot_sync_history")).rows).toHaveLength(2);
 } finally {await db.close();}
});

