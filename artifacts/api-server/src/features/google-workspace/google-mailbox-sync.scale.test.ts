import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {SyncRepository} from './google-mailbox-sync-repository';
import {MailboxSyncIngestor} from './google-mailbox-sync-ingestor';
import {MailboxSyncProcessor} from './google-mailbox-sync-processor';
import {runMailboxTurn} from './google-mailbox-sync-loop';
const conn='da54625d-b6f1-4486-8299-e1d85d78422e';
it('keeps idle sync and a 20-thread change burst bounded with 4000 profiles and 12000 mapped conversations',async()=>{
 const db=new PGlite();const started=Date.now();try{
 await db.exec(readFileSync(new URL('../../../../../lib/db/migrations/20261016_google_mailbox_sync.sql',import.meta.url),'utf8'));
 await db.exec(`CREATE TABLE organizations(id uuid PRIMARY KEY,name text);CREATE TABLE notes(id int,body text);CREATE TABLE follow_ups(id int,completed_at timestamptz);CREATE TABLE archive_references(id int,reference text);
 CREATE TABLE google_workspace_validation_mappings(connection_id uuid,message_id text,thread_id text,organization_id uuid,contact_id uuid,evidence_codes jsonb,created_at timestamptz,updated_at timestamptz,PRIMARY KEY(connection_id,message_id));
 CREATE TABLE google_pilot_sync(connection_id uuid,thread_id text,snapshot jsonb,baseline_state text,baseline_message_id text);
 INSERT INTO organizations SELECT md5(i::text)::uuid,'Customer '||i FROM generate_series(1,4000) i;
 INSERT INTO notes SELECT i,'Preserved note '||i FROM generate_series(1,4000) i;
 INSERT INTO follow_ups SELECT i,NULL FROM generate_series(1,4000) i;
 INSERT INTO archive_references SELECT i,'preserved/document/'||i FROM generate_series(1,4000) i;
 INSERT INTO google_workspace_validation_mappings SELECT '${conn}','m'||i,'t'||i,md5(((i-1)%4000+1)::text)::uuid,NULL,'[]',now(),now() FROM generate_series(1,12000) i;`);
 const repo=new SyncRepository(db as any);await repo.configure(conn,'owner@example.com','active',0);
 const changes=Array.from({length:20},(_,i)=>'t'+(i+1));let bodies=0,historyCalls=0;
 const client={getMailbox:async()=>({email:'owner@example.com',historyId:'42'}),listMessagesPage:async()=>({messages:[],nextPageToken:null}),listDraftsPage:async()=>({messages:[],nextPageToken:null}),listHistory:async()=>{historyCalls++;return {historyId:'99',changedThreads:[],nextPageToken:null};}};
 // Bootstrap every mapped conversation with keyset pages; restarting the ingestor
 // each turn exercises persisted checkpoints rather than in-memory pagination.
 for(let i=0;i<125;i++){const a=(await repo.claimAccount(conn))!;await new MailboxSyncIngestor(repo,client).step(a);await repo.release(a);if((await db.query<any>('SELECT checkpoint FROM google_sync_accounts')).rows[0].checkpoint.phase==='ready')break;}
 expect((await db.query<any>('SELECT count(*)::int n FROM google_sync_jobs')).rows[0].n).toBe(12000);
 // Establish unchanged baseline, then only changed threads require hydration.
 await db.query('UPDATE google_sync_jobs SET processed_generation=generation');
 const processor=new MailboxSyncProcessor(repo,async id=>{bodies++;return {id,subject:'Draft',originalGmailUrl:'',messages:[{id:'new-'+id,labelIds:['DRAFT'],internalDateMs:1,from:'owner@example.com',to:'fair@example.com',cc:'',date:'',subject:'Draft',bodyText:'For review',attachments:[],direction:'unknown'}]};});
 const ingest=new MailboxSyncIngestor(repo,client);
 await runMailboxTurn({repo,connectionId:conn,ingest:a=>ingest.step(a),process:(c,a)=>processor.process(c,a),historyDue:true});
 expect(bodies).toBe(0);
 await repo.enqueue(conn,[...changes,...changes]);
 const result=await runMailboxTurn({repo,connectionId:conn,ingest:a=>ingest.step(a),process:(c,a)=>processor.process(c,a),historyDue:false});
 expect(result.processed).toBe(20);expect(bodies).toBe(20);
 expect((await db.query<any>('SELECT count(*)::int n FROM google_sync_history')).rows[0].n).toBe(20);
 expect((await db.query<any>('SELECT count(*)::int n FROM google_workspace_validation_mappings')).rows[0].n).toBe(12020);
 expect((await db.query<any>('SELECT count(*)::int n FROM notes')).rows[0].n).toBe(4000);
 expect((await db.query<any>('SELECT count(*)::int n FROM follow_ups WHERE completed_at IS NULL')).rows[0].n).toBe(4000);
 expect((await db.query<any>('SELECT count(*)::int n FROM archive_references')).rows[0].n).toBe(4000);
 console.info(JSON.stringify({profiles:4000,mappedThreads:12000,changedThreads:20,bodyFetches:bodies,historyCalls,elapsedMs:Date.now()-started,heapMb:Math.round(process.memoryUsage().heapUsed/1048576)}));
 }finally{await db.close();}
},120000);
