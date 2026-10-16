import {pool} from '@workspace/db';
import {PostgresGoogleConnectionRepository} from './google-connection-repository';
import {SyncRepository,type SyncDatabase,type SyncSql} from './google-mailbox-sync-repository';
import {MailboxSyncIngestor} from './google-mailbox-sync-ingestor';
import {MailboxSyncProcessor} from './google-mailbox-sync-processor';
import {MailboxSyncLoop,runMailboxTurn} from './google-mailbox-sync-loop';
import {SyncReadModel} from './google-mailbox-sync-read-model';
import {SyncFailure} from './google-mailbox-sync-client';
import {logger} from '@/lib/logger';
import {SyncArchiveWorker} from './google-mailbox-sync-archive-worker';
import {archiveSyncThread} from './google-mailbox-sync-archive-runtime';

const database:SyncDatabase={
 query:(sql,params)=>pool.query(sql,params),
 async transaction(fn){const client=await pool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='3s'");await client.query("SET LOCAL statement_timeout='10s'");const result=await fn(client as SyncSql);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}},
};
export const syncRepository=new SyncRepository(database,async(tx,id)=>{
 const row=(await tx.query(`SELECT c.id FROM google_workspace_connections c JOIN google_sync_accounts a ON a.connection_id=c.id WHERE c.id=$1 AND c.status='connected' AND lower(c.account_email)=a.email AND c.id=(SELECT id FROM google_workspace_connections WHERE status='connected' AND (role='workspace' OR role IS NULL) ORDER BY updated_at DESC,id DESC LIMIT 1) FOR SHARE OF c`,[id])).rows[0];return Boolean(row);
});
export const syncReadModel=new SyncReadModel(database);
const connections=new PostgresGoogleConnectionRepository();
export async function currentSyncAccount(){const current=await connections.getCurrent();if(!current||current.status!=='connected')throw new SyncFailure('auth','SYNC_REAUTH_REQUIRED');return current;}

// Session advisory lock: no transaction spans Gmail. Cutover and old/new workers
// share this lock so a mode change cannot race an in-flight legacy sweep.
async function schedulerLock<T>(work:()=>Promise<T>):Promise<T|null>{
 const client=await pool.connect();let locked=false;
 try{locked=Boolean((await client.query("SELECT pg_try_advisory_lock(hashtext('com-gmail-scheduled-owner')) AS locked")).rows[0]?.locked);if(!locked)return null;return await work();}
 finally{if(locked)await client.query("SELECT pg_advisory_unlock(hashtext('com-gmail-scheduled-owner'))");client.release();}
}
export async function runLegacyGmail(work:()=>Promise<void>){
 await schedulerLock(async()=>{const current=await connections.getCurrent();if(!current)return;const state=(await pool.query('SELECT mode FROM google_sync_accounts WHERE connection_id=$1',[current.id])).rows[0];if(state?.mode!=='active')await work();});
}
export async function configureSync(mode:'off'|'shadow'|'active',cohortLimit:0|3|50|500){
 const result=await schedulerLock(async()=>{
  const current=await currentSyncAccount();await syncRepository.configure(current.id,current.email,mode,cohortLimit);
  if(mode!=='off')await database.transaction(async tx=>{
   // Seed the explicitly reviewed pilot first; then expand deterministically.
   await tx.query(`INSERT INTO google_sync_enrollments(connection_id,profile_id) SELECT connection_id,profile_id FROM google_pilot_sync WHERE connection_id=$1 ON CONFLICT DO NOTHING`,[current.id]);
   if(cohortLimit!==3)await tx.query(`INSERT INTO google_sync_enrollments(connection_id,profile_id) SELECT $1,organization_id FROM google_workspace_validation_mappings WHERE connection_id=$1 AND organization_id IS NOT NULL GROUP BY organization_id ORDER BY organization_id LIMIT $2 ON CONFLICT DO NOTHING`,[current.id,cohortLimit||2147483647]);
   await tx.query(`UPDATE google_sync_accounts SET checkpoint='{"phase":"boundary"}',version=version+1,next_history_at=NULL WHERE connection_id=$1`,[current.id]);
  });
  return syncReadModel.status(current.id);
 });
 if(!result)throw new SyncFailure('retryable','SYNC_PREVIOUS_WORKER_DRAINING');return result;
}
export async function requestSyncCheck(){const current=await currentSyncAccount();await pool.query(`UPDATE google_sync_accounts SET next_history_at=now() WHERE connection_id=$1 AND mode<>'off'`,[current.id]);return syncReadModel.status(current.id);}

async function tick(){
 const current=await connections.getCurrent();if(!current||current.status!=='connected')return {nextDelayMs:60000};
 const state=(await pool.query(`SELECT mode,checkpoint,next_history_at FROM google_sync_accounts WHERE connection_id=$1`,[current.id])).rows[0];
 if(!state||state.mode==='off')return {nextDelayMs:60000};
 const result=await schedulerLock(async()=>{
  const client=await connections.createReadClient();if(!client?.mailboxSync||!client.getSyncThreadDetail)throw new SyncFailure('auth','SYNC_REAUTH_REQUIRED');
  const ingestor=new MailboxSyncIngestor(syncRepository,client.mailboxSync);
  const processor=new MailboxSyncProcessor(syncRepository,async id=>{const check=await currentSyncAccount();if(check.id!==current.id)throw new SyncFailure('auth','SYNC_ACCOUNT_CHANGED');return client.getSyncThreadDetail!(id);},client.mailboxSync.getThreadHeaders);
  const archiver=new SyncArchiveWorker(syncRepository,(job,a)=>archiveSyncThread(syncRepository,client,job,a));
  return runMailboxTurn({repo:syncRepository,connectionId:current.id,ingest:a=>ingestor.step(a),process:(c,a)=>processor.process(c,a),archive:a=>archiver.step(a),historyDue:!state.next_history_at||new Date(state.next_history_at).getTime()<=Date.now()});
 });
 return {nextDelayMs:result?.processed||state.checkpoint.phase!=='ready'?1000:30000};
}
export const mailboxSyncLoop=new MailboxSyncLoop(tick,()=>logger.warn('Mailbox sync deferred; saved customer records retained'));
