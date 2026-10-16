import { createHash,randomUUID } from 'node:crypto';
import type { SyncFailure } from './google-mailbox-sync-client';
export interface SyncSql {query<T=Record<string,any>>(sql:string,params?:any[]):Promise<{rows:T[]}>}
export interface SyncDatabase extends SyncSql {transaction<T>(fn:(tx:SyncSql)=>Promise<T>):Promise<T>}
export type Checkpoint={phase:'boundary'|'mapped'|'recent'|'drafts'|'history'|'ready';cursor?:string;boundary?:string;pageToken?:string|null;mappedAfter?:string;after?:number;before?:number};
export type AccountClaim={connectionId:string;email:string;mode:'shadow'|'active';cohortLimit:number;epoch:string;version:string;token:string;checkpoint:Checkpoint};
export type ThreadClaim={connectionId:string;threadId:string;generation:string;epoch:string;token:string;accountToken:string;attempts:number};
export type ThreadResult={profileId:string|null;state:string;snapshot:Record<string,any>;availability?:string;messageIds?:string[]};
export class SyncRepository {
 constructor(public db:SyncDatabase,private accountGuard:(tx:SyncSql,connectionId:string)=>Promise<boolean>=async()=>true){}
 async configure(connectionId:string,email:string,mode:'off'|'shadow'|'active',cohortLimit:number){
  await this.db.transaction(async tx=>{
   await tx.query(`INSERT INTO google_sync_accounts(connection_id,email) VALUES($1,$2) ON CONFLICT DO NOTHING`,[connectionId,email.toLowerCase()]);
   const {rows}=await tx.query(`SELECT email FROM google_sync_accounts WHERE connection_id=$1 FOR UPDATE`,[connectionId]);
   if(rows[0].email!==email.toLowerCase())throw Error('SYNC_ACCOUNT_CHANGED');
   await tx.query(`UPDATE google_sync_accounts SET mode=$2,cohort_limit=$3,epoch=epoch+1,lease_token=NULL,lease_until=NULL,retry_at=NULL,error_code=NULL,updated_at=now() WHERE connection_id=$1`,[connectionId,mode,cohortLimit]);
  });
 }
 async claimAccount(connectionId:string):Promise<AccountClaim|null>{
  const token=randomUUID();
  const {rows}=await this.db.query(`UPDATE google_sync_accounts SET lease_token=$2,lease_until=now()+interval '90 seconds' WHERE connection_id=$1 AND mode<>'off' AND (lease_until IS NULL OR lease_until<now()) AND (retry_at IS NULL OR retry_at<=now()) RETURNING *`,[connectionId,token]);
  const r=rows[0];return r?{connectionId,email:r.email,mode:r.mode,cohortLimit:r.cohort_limit,epoch:String(r.epoch),version:String(r.version),token,checkpoint:r.checkpoint}:null;
 }
 async valid(tx:SyncSql,a:Pick<AccountClaim,'connectionId'|'epoch'|'token'>){
  if(!await this.accountGuard(tx,a.connectionId))return null;
  return (await tx.query(`SELECT * FROM google_sync_accounts WHERE connection_id=$1 AND epoch=$2 AND lease_token=$3 AND lease_until>now() AND mode<>'off' FOR UPDATE`,[a.connectionId,a.epoch,a.token])).rows[0];
 }
 async renew(a:AccountClaim){return (await this.db.query(`UPDATE google_sync_accounts SET lease_until=now()+interval '90 seconds' WHERE connection_id=$1 AND epoch=$2 AND lease_token=$3 AND lease_until>now() RETURNING connection_id`,[a.connectionId,a.epoch,a.token])).rows.length>0;}
 async release(a:AccountClaim,delayMs=0,errorCode:string|null=null){
  await this.db.query(`UPDATE google_sync_accounts SET lease_token=NULL,lease_until=NULL,retry_at=now()+($4*interval '1 millisecond'),error_code=$5 WHERE connection_id=$1 AND epoch=$2 AND lease_token=$3`,[a.connectionId,a.epoch,a.token,delayMs,errorCode]);
 }
 async enqueue(connectionId:string,threads:string[],tx:SyncSql=this.db){
  if(!threads.length)return;
  await tx.query(`INSERT INTO google_sync_jobs(connection_id,thread_id) SELECT $1,t FROM unnest($2::text[]) t GROUP BY t ON CONFLICT(connection_id,thread_id) DO UPDATE SET generation=google_sync_jobs.generation+1,retry_at=LEAST(google_sync_jobs.retry_at,now()),updated_at=now()`,[connectionId,[...new Set(threads)]]);
 }
 async commitPage(a:AccountClaim,input:{threads:string[];checkpoint:Checkpoint}):Promise<boolean>{
  return this.db.transaction(async tx=>{
   const row=await this.valid(tx,a);if(!row||String(row.version)!==a.version)return false;
   await this.enqueue(a.connectionId,input.threads,tx);
   await tx.query(`UPDATE google_sync_accounts SET checkpoint=$2::jsonb,version=version+1,last_success_at=CASE WHEN $3 THEN now() ELSE last_success_at END,next_history_at=CASE WHEN $3 THEN now()+interval '5 minutes' ELSE next_history_at END,error_code=NULL,updated_at=now() WHERE connection_id=$1`,[a.connectionId,JSON.stringify(input.checkpoint),input.checkpoint.phase==='ready']);return true;
  });
 }
 async current(a:AccountClaim):Promise<AccountClaim|null>{const r=(await this.db.query(`SELECT * FROM google_sync_accounts WHERE connection_id=$1 AND epoch=$2 AND lease_token=$3 AND lease_until>now()`,[a.connectionId,a.epoch,a.token])).rows[0];return r?{...a,version:String(r.version),checkpoint:r.checkpoint}:null;}
 async claimThreads(a:AccountClaim,limit:number):Promise<ThreadClaim[]>{
  return this.db.transaction(async tx=>{
   if(!await this.valid(tx,a))return [];
   const rows=(await tx.query(`SELECT * FROM google_sync_jobs WHERE connection_id=$1 AND generation>processed_generation AND retry_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY retry_at,thread_id LIMIT $2 FOR UPDATE SKIP LOCKED`,[a.connectionId,Math.min(25,Math.max(1,limit))])).rows;
   const claims:ThreadClaim[]=[];
   for(const r of rows){const token=randomUUID();await tx.query(`UPDATE google_sync_jobs SET claim_generation=generation,claim_token=$3,claim_epoch=$4,lease_until=now()+interval '60 seconds' WHERE connection_id=$1 AND thread_id=$2`,[a.connectionId,r.thread_id,token,a.epoch]);claims.push({connectionId:a.connectionId,threadId:r.thread_id,generation:String(r.generation),epoch:a.epoch,token,accountToken:a.token,attempts:r.attempts});}
   return claims;
  });
 }
 async finishThread(c:ThreadClaim,result:ThreadResult):Promise<boolean>{
  return this.db.transaction(async tx=>{
   const account=await this.valid(tx,{connectionId:c.connectionId,epoch:c.epoch,token:c.accountToken});if(!account)return false;
   const job=(await tx.query(`SELECT * FROM google_sync_jobs WHERE connection_id=$1 AND thread_id=$2 AND claim_token=$3 AND lease_until>now() FOR UPDATE`,[c.connectionId,c.threadId,c.token])).rows[0];if(!job)return false;
   // Only a verified existing mapping may be extended. The short table lock also
   // serializes older mapping-repair writers that do not yet use advisory locks.
   if(result.profileId&&account.mode==='active'){
    await tx.query('LOCK TABLE google_workspace_validation_mappings IN SHARE ROW EXCLUSIVE MODE');
    const links=(await tx.query(`SELECT DISTINCT organization_id FROM google_workspace_validation_mappings WHERE connection_id=$1 AND (thread_id=$2 OR message_id=ANY($3::text[]))`,[c.connectionId,c.threadId,result.messageIds??[]])).rows;
    if(links.length!==1||links[0].organization_id!==result.profileId)throw Error('SYNC_PROFILE_CONFLICT');
    await tx.query(`INSERT INTO google_workspace_validation_mappings(connection_id,message_id,thread_id,organization_id,contact_id,evidence_codes,created_at,updated_at) SELECT $1,m,$2,$3,NULL,'["incremental_sync"]'::jsonb,now(),now() FROM unnest($4::text[]) m ON CONFLICT(connection_id,message_id) DO NOTHING`,[c.connectionId,c.threadId,result.profileId,result.messageIds??[]]);
   }
   const fingerprint=createHash('sha256').update(JSON.stringify({profileId:result.profileId,state:result.state,snapshot:result.snapshot,availability:result.availability??'available'})).digest('hex');
   const args=[c.connectionId,c.threadId,result.profileId,result.state,JSON.stringify(result.snapshot),fingerprint];
   await tx.query(`INSERT INTO google_sync_history(connection_id,thread_id,profile_id,state,snapshot,fingerprint) VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING`,args);
   await tx.query(`INSERT INTO google_sync_snapshots(connection_id,thread_id,profile_id,state,snapshot,fingerprint,availability) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) ON CONFLICT(connection_id,thread_id) DO UPDATE SET profile_id=EXCLUDED.profile_id,state=EXCLUDED.state,snapshot=EXCLUDED.snapshot,fingerprint=EXCLUDED.fingerprint,availability=EXCLUDED.availability,checked_at=now()`,[...args,result.availability??'available']);
   await tx.query(`UPDATE google_sync_jobs SET processed_generation=$4,claim_token=NULL,lease_until=NULL,attempts=0,error_code=NULL WHERE connection_id=$1 AND thread_id=$2 AND claim_token=$3`,[c.connectionId,c.threadId,c.token,c.generation]);return true;
  });
 }
 async retryThread(c:ThreadClaim,failure:SyncFailure){
  const delay=Math.max(failure.retryAfterMs??0,Math.min(3600000,1000*2**Math.min(c.attempts,11)))+Math.floor(Math.random()*1000);
  await this.db.query(`UPDATE google_sync_jobs SET claim_token=NULL,lease_until=NULL,attempts=attempts+1,error_code=$4,retry_at=now()+($5*interval '1 millisecond') WHERE connection_id=$1 AND thread_id=$2 AND claim_token=$3 AND claim_epoch=$6`,[c.connectionId,c.threadId,c.token,failure.code,delay,c.epoch]);
 }
 async deferThread(c:ThreadClaim){
  await this.db.query(`UPDATE google_sync_jobs j SET processed_generation=$4,claim_token=NULL,lease_until=NULL,error_code='SYNC_OUTSIDE_COHORT' WHERE connection_id=$1 AND thread_id=$2 AND claim_token=$3 AND EXISTS(SELECT 1 FROM google_sync_accounts a WHERE a.connection_id=j.connection_id AND a.epoch=$5 AND a.lease_token=$6 AND a.lease_until>now())`,[c.connectionId,c.threadId,c.token,c.generation,c.epoch,c.accountToken]);
 }
}
