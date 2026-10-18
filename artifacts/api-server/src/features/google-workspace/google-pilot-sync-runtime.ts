import { pool } from "@workspace/db";
import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import { PilotSyncService } from "./google-pilot-sync-service";
import type { SqlQuery } from "../chatgpt-connection/contracts";
export const pilotSync = new PilotSyncService(pool, async()=>{
 const connections=new PostgresGoogleConnectionRepository();
 const current=await connections.getCurrent();
 const client=await connections.createReadClient();
 if(!current||!client?.getThreadDetail) throw Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
 if((await connections.getCurrent())?.id!==current.id) throw Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
 return {connectionId:current.id,email:current.email,thread:id=>client.getThreadDetail!(id)};
});
export async function readPilotSync(db:SqlQuery=pool){
 const result=await db.query(`SELECT p.profile_id AS "profileId",o.name AS "profileName",p.thread_id AS "threadId",p.snapshot,p.checked_at AS "checkedAt",p.attempted_at AS "attemptedAt",p.error_code AS "errorCode",a.reason AS "ownerDecision",
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'dueAt',f.due_at)) FROM follow_ups f WHERE f.organization_id=p.profile_id AND f.completed_at IS NULL),'[]'::jsonb) AS followups
 FROM google_pilot_sync p JOIN organizations o ON o.id=p.profile_id
 LEFT JOIN email_thread_attention a ON a.gmail_connection_id=p.connection_id AND a.thread_id=p.thread_id
 WHERE p.connection_id=(SELECT id FROM google_workspace_connections WHERE status='connected' AND (role='workspace' OR role IS NULL) ORDER BY updated_at DESC,id DESC LIMIT 1)
 ORDER BY o.name`);
 return {items:result.rows.map(row=>{
   const {messages,...snapshot}=row.snapshot??{};
   const latest=messages?.find((m:{id:string})=>m.id===snapshot.latestMessageId);
   return {...row,snapshot:row.snapshot?{...snapshot,latestEmail:latest?{...latest,bodyText:latest.bodyText.slice(0,1500)}:null}:null};
 }),intervalMinutes:60};
}
