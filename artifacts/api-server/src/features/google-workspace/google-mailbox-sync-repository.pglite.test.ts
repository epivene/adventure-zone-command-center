import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { expect,it } from 'vitest';
import { SyncRepository } from './google-mailbox-sync-repository';
const conn='da54625d-b6f1-4486-8299-e1d85d78422e';
export async function setupSyncDb(){
 const db=new PGlite();
 await db.exec(readFileSync(new URL('../../../../../lib/db/migrations/20261016_google_mailbox_sync.sql',import.meta.url),'utf8'));
 return db;
}
it('commits pages once and preserves newer generations after an older claim finishes',async()=>{
 const db=await setupSyncDb();try{
 const repo=new SyncRepository(db as any);
 await repo.configure(conn,'owner@example.com','shadow',3);
 const a=(await repo.claimAccount(conn))!;
 expect(a).not.toBeNull();
 expect(await repo.claimAccount(conn)).toBeNull();
 expect(await repo.commitPage(a,{threads:['t1','t1','t2'],checkpoint:{phase:'history',cursor:'42',pageToken:null}})).toBe(true);
 expect(await repo.commitPage(a,{threads:['t3'],checkpoint:{phase:'ready',cursor:'43',pageToken:null}})).toBe(false);
 expect((await db.query('SELECT * FROM google_sync_jobs')).rows).toHaveLength(2);
 const claims=await repo.claimThreads(a,25);expect(claims).toHaveLength(2);
 await repo.enqueue(conn,['t1']);
 await repo.finishThread(claims.find(c=>c.threadId==='t1')!,{state:'needs_review',profileId:null,snapshot:{reason:'review'}});
 const row=(await db.query<any>("SELECT * FROM google_sync_jobs WHERE thread_id='t1'")).rows[0];
 expect(Number(row.generation)).toBeGreaterThan(Number(row.processed_generation));
 expect((await repo.claimThreads(a,25)).map(c=>c.threadId)).toEqual(['t1']);
 }finally{await db.close();}
});
it('fences expired and replaced account claims and preserves snapshot revisions',async()=>{
 const db=await setupSyncDb();try{
 const repo=new SyncRepository(db as any);await repo.configure(conn,'owner@example.com','shadow',3);
 const a=(await repo.claimAccount(conn))!;await repo.enqueue(conn,['t1']);const [job]=await repo.claimThreads(a,25);
 await repo.configure(conn,'owner@example.com','off',3);
 expect(await repo.finishThread(job,{state:'needs_review',profileId:null,snapshot:{text:'stale'}})).toBe(false);
 expect((await db.query('SELECT * FROM google_sync_snapshots')).rows).toHaveLength(0);
 await expect(repo.configure(conn,'different@example.com','active',3)).rejects.toThrow('SYNC_ACCOUNT_CHANGED');
 }finally{await db.close();}
});
it('rolls back queue writes when the checkpoint fails and blocks disconnected-account saves',async()=>{
 const db=await setupSyncDb();try{
 let connected=true;const repo=new SyncRepository(db as any,async()=>connected);await repo.configure(conn,'owner@example.com','shadow',3);
 const a=(await repo.claimAccount(conn))!;
 await db.exec(`CREATE FUNCTION reject_checkpoint() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'checkpoint failure'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_checkpoint BEFORE UPDATE OF checkpoint ON google_sync_accounts FOR EACH ROW EXECUTE FUNCTION reject_checkpoint();`);
 await expect(repo.commitPage(a,{threads:['t'],checkpoint:{phase:'ready',cursor:'42'}})).rejects.toThrow('checkpoint failure');
 expect((await db.query('SELECT * FROM google_sync_jobs')).rows).toHaveLength(0);
 await db.exec('DROP TRIGGER reject_checkpoint ON google_sync_accounts');
 await repo.enqueue(conn,['t']);const [job]=await repo.claimThreads(a,1);connected=false;
 expect(await repo.finishThread(job,{profileId:null,state:'needs_review',snapshot:{}})).toBe(false);
 expect((await db.query('SELECT * FROM google_sync_history')).rows).toHaveLength(0);
 }finally{await db.close();}
});
