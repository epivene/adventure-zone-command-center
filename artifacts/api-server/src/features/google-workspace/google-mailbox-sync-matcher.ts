import type {SyncSql} from './google-mailbox-sync-repository';
export class SyncMatcher {
 constructor(private db:SyncSql){}
 async resolve(connectionId:string,threadId:string):Promise<{kind:'matched';profileId:string}|{kind:'review';reason:string}>{
  const rows=(await this.db.query(`SELECT DISTINCT organization_id FROM google_workspace_validation_mappings WHERE connection_id=$1 AND thread_id=$2`,[connectionId,threadId])).rows;
  if(rows.length===1&&rows[0].organization_id)return {kind:'matched',profileId:rows[0].organization_id};
  return {kind:'review',reason:rows.length?'SYNC_PROFILE_CONFLICT':'SYNC_PROFILE_LINK_REQUIRED'};
 }
}
