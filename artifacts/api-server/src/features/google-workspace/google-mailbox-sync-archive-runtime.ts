import type {GoogleWorkspaceReadClient} from './google-api-types';
import type {SyncRepository,AccountClaim,SyncSql} from './google-mailbox-sync-repository';
import {GoogleProfileEmailArchiveService} from './google-profile-email-archive-service';
import {PostgresGoogleProfileEmailArchiveRepository} from './google-profile-email-archive-repository';
import {GoogleProfileFileService,PostgresGoogleProfileFileRepository} from './google-profile-file-service';

export async function archiveSyncThread(repo:SyncRepository,client:GoogleWorkspaceReadClient,job:{threadId:string;profileId:string},a:AccountClaim):Promise<boolean>{
 const scoped:SyncSql={query:async(sql,params)=>repo.db.transaction(async tx=>{
  if(!await repo.valid(tx,a))throw Error('SYNC_LEASE_LOST');
  await tx.query('LOCK TABLE google_workspace_validation_mappings IN SHARE ROW EXCLUSIVE MODE');
  const targets=(await tx.query(`SELECT DISTINCT organization_id FROM google_workspace_validation_mappings WHERE connection_id=$1 AND thread_id=$2`,[a.connectionId,job.threadId])).rows;
  if(targets.length!==1||targets[0].organization_id!==job.profileId)throw Error('SYNC_PROFILE_CONFLICT');
  return tx.query(sql,params);
 })};
 const archive=new PostgresGoogleProfileEmailArchiveRepository(scoped,a.connectionId);
 const existing=await archive.findByProviderThread({organizationId:job.profileId,gmailThreadId:job.threadId});
 const snapshot=(await scoped.query(`SELECT snapshot FROM google_sync_snapshots WHERE connection_id=$1 AND thread_id=$2`,[a.connectionId,job.threadId])).rows[0]?.snapshot;
 const mail=(snapshot?.messages??[]).filter((m:any)=>!m.labelIds?.includes('DRAFT')&&!m.labelIds?.includes('TRASH'));
 if(existing?.archiveState==='complete'&&mail.length&&mail.every((m:any)=>existing.messages.some(e=>e.gmailMessageId===m.id)))return true;
 let downloads=0;
 const boundedClient={...client,getThreadDetail:async(id:string)=>{
  const detail=await client.getSyncThreadDetail!(id);
  return {...detail,messages:detail.messages.filter(m=>!m.labelIds?.includes('DRAFT')&&!m.labelIds?.includes('TRASH'))};
 },getAttachment:async(input:{messageId:string;attachmentId:string})=>{
  if(downloads++>=1)throw Error('GOOGLE_WORKSPACE_ATTACHMENT_BATCH_DEFERRED');
  return client.getSyncAttachment!(input);
 }};
 const connection={createReadClient:async()=>boundedClient};
 const validation={organizationOwnsApprovedThread:async()=>Boolean((await scoped.query('SELECT 1')).rows.length)};
 const files=new GoogleProfileFileService({connection,validation,repository:new PostgresGoogleProfileFileRepository(scoped,a.connectionId)});
 const service=new GoogleProfileEmailArchiveService({connection,validation,archive,files});
 const result=await service.archiveApprovedThread({organizationId:job.profileId,contactId:null,gmailThreadId:job.threadId});
 return result.archiveState==='complete'&&!result.lastGmailErrorCode;
}
