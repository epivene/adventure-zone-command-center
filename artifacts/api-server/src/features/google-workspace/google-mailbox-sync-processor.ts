import type {GoogleThreadDetail} from './google-api-types';
import {observePilotThread,type PilotState} from './google-pilot-sync';
import {SyncFailure,syncFailure} from './google-mailbox-sync-client';
import {SyncMatcher} from './google-mailbox-sync-matcher';
import {SyncRepository,type AccountClaim,type ThreadClaim} from './google-mailbox-sync-repository';
export class MailboxSyncProcessor {
 constructor(private repo:SyncRepository,private getThread:(id:string)=>Promise<GoogleThreadDetail>){}
 async process(c:ThreadClaim,a:AccountClaim):Promise<void>{
  const previous=(await this.repo.db.query(`SELECT * FROM google_sync_snapshots WHERE connection_id=$1 AND thread_id=$2`,[c.connectionId,c.threadId])).rows[0];
  try{
   const match=await new SyncMatcher(this.repo.db).resolve(c.connectionId,c.threadId);
   if(match.kind==='review'){
    // Do not pull unrelated mailbox bodies into COM merely because they changed.
    if(previous?.profile_id)throw new SyncFailure('invalid',match.reason);
    await this.repo.finishThread(c,{profileId:null,state:'needs_review',snapshot:{reason:match.reason}});return;
   }
   if(a.cohortLimit>0&&!(await this.repo.db.query(`SELECT 1 FROM google_sync_enrollments WHERE connection_id=$1 AND profile_id=$2`,[a.connectionId,match.profileId])).rows.length){
    // Complete this generation without changing any saved observation. Expansion
    // explicitly queues newly enrolled mappings again.
    await this.repo.deferThread(c);return;
   }
   const source=await this.getThread(c.threadId);
   if(source.id!==c.threadId||!source.messages.length||source.messages.length>200)throw new SyncFailure('invalid','SYNC_THREAD_REVIEW_REQUIRED');
   const pilot=(await this.repo.db.query(`SELECT snapshot,baseline_state,baseline_message_id FROM google_pilot_sync WHERE connection_id=$1 AND thread_id=$2`,[c.connectionId,c.threadId])).rows[0];
   const prior=previous?.snapshot??pilot?.snapshot;
   const messages=source.messages.map(m=>({id:m.id,labelIds:m.labelIds?.filter(l=>['SENT','DRAFT','TRASH'].includes(l)),internalDateMs:m.internalDateMs,from:m.from,to:m.to,subject:m.subject,bodyText:m.bodyText}));
   const observed=observePilotThread(messages,a.email,(prior?.state??pilot?.baseline_state??'needs_review') as PilotState,prior?.latestMessageId??pilot?.baseline_message_id??'',Boolean(prior?.drafts?.length)||pilot?.baseline_state==='draft_to_review');
   await this.repo.finishThread(c,{profileId:match.profileId,state:observed.state,snapshot:{...observed,messages},messageIds:messages.map(m=>m.id)});
  }catch(error){
   const failure=error instanceof Error&&error.message==='SYNC_PROFILE_CONFLICT'?new SyncFailure('invalid','SYNC_PROFILE_CONFLICT'):syncFailure(error);
   if(failure.kind==='source_missing'&&previous){
    await this.repo.finishThread(c,{profileId:previous.profile_id,state:previous.state,snapshot:previous.snapshot,availability:'missing'});
   }else{await this.repo.retryThread(c,failure);if(failure.kind==='auth')throw failure;}
  }
 }
}
