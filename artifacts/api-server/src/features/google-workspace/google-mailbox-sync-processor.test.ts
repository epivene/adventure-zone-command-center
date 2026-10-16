import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {SyncRepository} from './google-mailbox-sync-repository';
import {MailboxSyncProcessor} from './google-mailbox-sync-processor';
const conn='da54625d-b6f1-4486-8299-e1d85d78422e',profile='20943487-43ec-4a11-8c67-36efefbf4efb';
it('refreshes a mapped draft, retains prior mappings, and refuses a mapping changed during Gmail fetch',async()=>{
 const db=new PGlite();try{
 await db.exec(readFileSync(new URL('../../../../../lib/db/migrations/20261016_google_mailbox_sync.sql',import.meta.url),'utf8'));
 await db.exec(`CREATE TABLE google_workspace_validation_mappings(connection_id uuid,message_id text,thread_id text,organization_id uuid,contact_id uuid,evidence_codes jsonb,created_at timestamptz,updated_at timestamptz,PRIMARY KEY(connection_id,message_id));CREATE TABLE google_pilot_sync(connection_id uuid,thread_id text,snapshot jsonb,baseline_state text,baseline_message_id text);INSERT INTO google_workspace_validation_mappings VALUES('${conn}','old','thread','${profile}',NULL,'[]',now(),now());`);
 const repo=new SyncRepository(db as any);await repo.configure(conn,'owner@example.com','active',0);
 const a=(await repo.claimAccount(conn))!;await repo.enqueue(conn,['thread']);
 const thread={id:'thread',subject:'Contract',originalGmailUrl:'',messages:[{id:'new',labelIds:['DRAFT'],internalDateMs:10,from:'owner@example.com',to:'fair@example.com',cc:'',date:'',subject:'Contract',bodyText:'Uns ent draft',attachments:[],direction:'unknown' as const}]};
 const processor=new MailboxSyncProcessor(repo,async()=>thread);
 await processor.process((await repo.claimThreads(a,1))[0],a);
 expect((await db.query<any>('SELECT state FROM google_sync_snapshots')).rows[0].state).toBe('draft_to_review');
 expect((await db.query('SELECT * FROM google_workspace_validation_mappings')).rows).toHaveLength(2);
 await repo.enqueue(conn,['thread']);
 const racing=new MailboxSyncProcessor(repo,async()=>{await db.query("UPDATE google_workspace_validation_mappings SET organization_id='314df1f0-1ec8-4157-b98d-47cf4e1e65f8'");return {...thread,messages:[{...thread.messages[0],bodyText:'Wrong profile'}]};});
 await racing.process((await repo.claimThreads(a,1))[0],a);
 expect((await db.query<any>('SELECT snapshot FROM google_sync_snapshots')).rows[0].snapshot.drafts[0].bodyText).toBe('Uns ent draft');
 expect((await db.query('SELECT * FROM google_sync_history')).rows).toHaveLength(1);
 }finally{await db.close();}
});
