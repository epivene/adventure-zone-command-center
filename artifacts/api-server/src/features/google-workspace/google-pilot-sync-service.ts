import { randomUUID } from "node:crypto";
import { inputHash, type SqlQuery } from "../chatgpt-connection/contracts";
import { observePilotThread } from "./google-pilot-sync";
import type { GoogleThreadDetail } from "./google-api-types";
type Access = {connectionId:string; email:string; thread(id:string):Promise<Pick<GoogleThreadDetail,"id"|"messages">>};
export class PilotSyncService {
 constructor(private db:SqlQuery,private access:()=>Promise<Access>){}
 async run(profileId?:string) {
  const rows=(await this.db.query("SELECT * FROM google_pilot_sync WHERE ($1::uuid IS NULL OR profile_id=$1) ORDER BY thread_id",[profileId??null])).rows;
  for(const row of rows){
   const token=randomUUID();
   const claimed=await this.db.query(`UPDATE google_pilot_sync SET lease_token=$3,lease_until=now()+interval '3 minutes',attempted_at=now()
    WHERE connection_id=$1 AND thread_id=$2 AND (lease_until IS NULL OR lease_until<now())
    AND (attempted_at IS NULL OR attempted_at<now()-interval '60 seconds') RETURNING *`,[row.connection_id,row.thread_id,token]);
   if(!claimed.rows.length) continue;
   try {
    const access=await this.access();
    if(access.connectionId!==row.connection_id) throw Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
    const source=await access.thread(row.thread_id);
    if(source.id!==row.thread_id||!source.messages.length||source.messages.length>200) throw Error("PILOT_SOURCE_REVIEW_REQUIRED");
    // No mutable download handles or Gmail category labels in content identity.
    const messages=source.messages.map(m=>({id:m.id,labelIds:m.labelIds?.filter(l=>["SENT","DRAFT","TRASH"].includes(l)),internalDateMs:m.internalDateMs,from:m.from,to:m.to,subject:m.subject,bodyText:m.bodyText}));
    const previous=row.snapshot;
    const observed=observePilotThread(messages,access.email,previous?.state??row.baseline_state,previous?.latestMessageId??row.baseline_message_id,Boolean(previous?.drafts?.length)||(!previous&&row.baseline_state==="draft_to_review"));
    const snapshot={...observed,messages};
    const fingerprint=inputHash(snapshot);
    // One short atomic SQL statement. Gmail is never fetched while holding a DB transaction.
    const saved=await this.db.query(`WITH eligible AS (
      SELECT p.* FROM google_pilot_sync p WHERE connection_id=$1 AND thread_id=$2 AND lease_token=$3 AND lease_until>now()
      AND connection_id=(SELECT id FROM google_workspace_connections WHERE status='connected' AND (role='workspace' OR role IS NULL) ORDER BY updated_at DESC,id DESC LIMIT 1)
      AND EXISTS(SELECT 1 FROM google_workspace_validation_mappings m WHERE m.connection_id=p.connection_id AND m.thread_id=p.thread_id AND m.organization_id=p.profile_id)
      AND NOT EXISTS(SELECT 1 FROM google_workspace_validation_mappings m WHERE m.connection_id=p.connection_id AND (m.thread_id=p.thread_id OR m.message_id IN (SELECT value->>'id' FROM jsonb_array_elements($4::jsonb->'messages'))) AND m.organization_id<>p.profile_id)
     ), mappings AS (
      INSERT INTO google_workspace_validation_mappings(connection_id,message_id,thread_id,organization_id,contact_id,evidence_codes,created_at,updated_at)
      SELECT e.connection_id,m->>'id',e.thread_id,e.profile_id,NULL,'["authorized_three_customer_sync"]'::jsonb,now(),now() FROM eligible e,jsonb_array_elements($4::jsonb->'messages') m
      ON CONFLICT(connection_id,message_id) DO NOTHING
     ), history AS (
      INSERT INTO google_pilot_sync_history(connection_id,thread_id,fingerprint,snapshot)
      SELECT connection_id,thread_id,$5,$4::jsonb FROM eligible ON CONFLICT DO NOTHING
     ) UPDATE google_pilot_sync p SET snapshot=$4::jsonb,fingerprint=$5,checked_at=now(),error_code=NULL,lease_token=NULL,lease_until=NULL
     FROM eligible e WHERE p.connection_id=e.connection_id AND p.thread_id=e.thread_id RETURNING p.profile_id`,[row.connection_id,row.thread_id,token,JSON.stringify(snapshot),fingerprint]);
    if(!saved.rows.length) throw Error("PILOT_PROFILE_CONFLICT");
   } catch(error){
    const code=error instanceof Error && /^(PILOT_|GOOGLE_WORKSPACE_)[A-Z_]+$/.test(error.message)?error.message:"PILOT_SYNC_FAILED";
    await this.db.query("UPDATE google_pilot_sync SET error_code=$4,lease_token=NULL,lease_until=NULL WHERE connection_id=$1 AND thread_id=$2 AND lease_token=$3",[row.connection_id,row.thread_id,token,code]);
   }
  }
 }
}

