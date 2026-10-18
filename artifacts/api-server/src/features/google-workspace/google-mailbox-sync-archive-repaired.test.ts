import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SyncRepository } from "./google-mailbox-sync-repository";
import { completeCoveredArchives } from "./google-mailbox-sync-archive-covered";

// Catches endless retries after an audited filing repair, and unsafe completion
// when the new archive lacks evidence or the repair belongs to another thread.
it("reconciles audited destination changes only when all saved history is covered", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync(new URL("../../../../../lib/db/migrations/20261016_google_mailbox_sync.sql", import.meta.url), "utf8"));
    await db.exec(`CREATE TABLE audit_entries(entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb);
      CREATE TABLE google_workspace_validation_mappings(connection_id uuid,thread_id text,organization_id uuid);
      CREATE TABLE google_workspace_profile_email_threads(id text,connection_id uuid,organization_id uuid,archive_state text);
      CREATE TABLE google_workspace_profile_email_thread_sources(connection_id uuid,gmail_thread_id text,conversation_id text);
      CREATE TABLE google_workspace_profile_email_messages(connection_id uuid,conversation_id text,gmail_message_id text);`);
    const conn = "da54625d-b6f1-4486-8299-e1d85d78422e";
    const old = "7690afc7-0b3a-4a92-80e1-dad2145c84cd", dest = "c63ff3e4-d087-4714-9872-c54538c0446b";
    const repo = new SyncRepository(db as any);
    await repo.configure(conn, "owner@example.com", "active", 0);
    const claim = (await repo.claimAccount(conn))!;
    const names = ["good", "no-audit", "other-thread", "other-connection", "wrong-before", "wrong-after", "conflict", "partial", "unavailable", "missing-old", "missing-current"];
    for (const name of names) {
      await db.query("INSERT INTO google_sync_archive_jobs(connection_id,thread_id,profile_id,fingerprint,attempts,error_code) VALUES($1,$2,$3,'original',17,'SYNC_ARCHIVE_RETRY')", [conn,name,old]);
      await db.query(`INSERT INTO google_sync_snapshots(connection_id,thread_id,profile_id,state,snapshot,fingerprint,availability) VALUES($1,$2,$3,'waiting_for_reply','{"messages":[{"id":"current","labelIds":["SENT"]}]}','current',$4)`, [conn,name,dest,name==="unavailable"?"missing":"available"]);
      await db.query(`INSERT INTO google_sync_history(connection_id,thread_id,profile_id,state,snapshot,fingerprint) VALUES($1,$2,$3,'waiting_for_reply','{"messages":[{"id":"older","labelIds":["SENT"]}]}','old')`,[conn,name,old]);
      await db.query("INSERT INTO google_workspace_validation_mappings VALUES($1,$2,$3)",[conn,name,dest]);
      if(name==="conflict") await db.query("INSERT INTO google_workspace_validation_mappings VALUES($1,$2,$3)",[conn,name,old]);
      await db.query("INSERT INTO google_workspace_profile_email_threads VALUES($1,$2,$3,$4)",[name,conn,dest,name==="partial"?"partial":"complete"]);
      await db.query("INSERT INTO google_workspace_profile_email_thread_sources VALUES($1,$2,$2)",[conn,name]);
      for (const id of ["older","current"]) {
        if ((id==="older" && name==="missing-old") || (id==="current" && name==="missing-current")) continue;
        await db.query("INSERT INTO google_workspace_profile_email_messages VALUES($1,$2,$3)",[conn,name,id]);
      }
      if(name!=="no-audit") await db.query(`INSERT INTO audit_entries VALUES('email_profile_mapping',gen_random_uuid(),'repair',$1,$2)`,[
        JSON.stringify({gmailConnectionId:name==="other-connection"?old:conn,threadId:name==="other-thread"?"unrelated":name,mappings:[{organization_id:name==="wrong-before"?dest:old}]}),
        JSON.stringify({mappings:[{organization_id:name==="wrong-after"?old:dest}],actorId:"owner"})]);
    }
    const history = (await db.query("SELECT * FROM google_sync_history ORDER BY thread_id")).rows;
    const messages = (await db.query("SELECT * FROM google_workspace_profile_email_messages ORDER BY conversation_id,gmail_message_id")).rows;
    await db.exec(`CREATE FUNCTION reject_reconciliation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.entity_type='google_sync_archive_job' THEN RAISE EXCEPTION 'audit unavailable'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER reject_reconciliation BEFORE INSERT ON audit_entries FOR EACH ROW EXECUTE FUNCTION reject_reconciliation();`);
    await expect(completeCoveredArchives(repo,claim)).rejects.toThrow("audit unavailable");
    expect((await db.query("SELECT status FROM google_sync_archive_jobs WHERE thread_id='good'")).rows).toEqual([{status:"pending"}]);
    await db.exec("DROP TRIGGER reject_reconciliation ON audit_entries");
    expect(await completeCoveredArchives(repo,claim)).toBe(1);
    expect((await db.query("SELECT profile_id,fingerprint,status,attempts FROM google_sync_archive_jobs WHERE thread_id='good'")).rows).toEqual([{profile_id:old,fingerprint:"original",status:"complete",attempts:17}]);
    expect((await db.query("SELECT count(*)::int AS n FROM google_sync_archive_jobs WHERE status='pending'")).rows).toEqual([{n:10}]);
    expect((await db.query("SELECT * FROM google_sync_history ORDER BY thread_id")).rows).toEqual(history);
    expect((await db.query("SELECT * FROM google_workspace_profile_email_messages ORDER BY conversation_id,gmail_message_id")).rows).toEqual(messages);
    expect((await db.query("SELECT count(*)::int AS n FROM audit_entries WHERE entity_type='google_sync_archive_job' AND action='reconcile_mapping_repair'")).rows).toEqual([{n:1}]);
    const audit = (await db.query<any>("SELECT * FROM audit_entries WHERE entity_type='google_sync_archive_job'")).rows[0];
    expect(audit.before).toMatchObject({thread_id:"good",profile_id:old,status:"pending",fingerprint:"original",attempts:17});
    expect(audit.after).toMatchObject({destinationProfileId:dest,job:{profile_id:old,status:"complete",fingerprint:"original",attempts:17}});
    expect(audit.after.repairAuditId).toBeTruthy();
    expect(await completeCoveredArchives(repo,claim)).toBe(0);
    await repo.release(claim);
    expect(await completeCoveredArchives(repo,claim)).toBe(0);
  } finally { await db.close(); }
});
