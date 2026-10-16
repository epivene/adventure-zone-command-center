import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {SyncRepository} from './google-mailbox-sync-repository';
import {SyncArchiveWorker} from './google-mailbox-sync-archive-worker';
it('keeps incomplete archives pending and completes each immutable job only once',async()=>{
 const db=new PGlite();try{
 await db.exec(readFileSync(new URL('../../../../../lib/db/migrations/20261016_google_mailbox_sync.sql',import.meta.url),'utf8'));
 const conn='da54625d-b6f1-4486-8299-e1d85d78422e';const repo=new SyncRepository(db as any);await repo.configure(conn,'owner@example.com','active',0);const a=(await repo.claimAccount(conn))!;
 await db.query(`INSERT INTO google_sync_archive_jobs(connection_id,thread_id,fingerprint,profile_id) VALUES($1,'t','hash','20943487-43ec-4a11-8c67-36efefbf4efb')`,[conn]);
 let complete=false,calls=0;const worker=new SyncArchiveWorker(repo,async()=>{calls++;return complete;});
 await worker.step(a);expect((await db.query<any>('SELECT status FROM google_sync_archive_jobs')).rows[0].status).toBe('pending');
 complete=true;await db.query('UPDATE google_sync_archive_jobs SET retry_at=now()');await worker.step(a);await worker.step(a);
 expect(calls).toBe(2);expect((await db.query<any>('SELECT status FROM google_sync_archive_jobs')).rows[0].status).toBe('complete');
 }finally{await db.close();}
});
