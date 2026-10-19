import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SyncRepository } from "./google-mailbox-sync-repository";
import { completeCoveredArchives } from "./google-mailbox-sync-archive-covered";

it("finishes only bounded, fully saved, unambiguous archive work and retains all source history", async () => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync(new URL("../../../../../lib/db/migrations/20261016_google_mailbox_sync.sql", import.meta.url), "utf8"));
    const conn = "da54625d-b6f1-4486-8299-e1d85d78422e", profile = "20943487-43ec-4a11-8c67-36efefbf4efb";
    await db.exec(`CREATE TABLE audit_entries(entity_type text,entity_id uuid,action text,"before" jsonb,"after" jsonb);
      CREATE TABLE google_workspace_validation_mappings(connection_id uuid,thread_id text,organization_id uuid);
      CREATE TABLE google_workspace_profile_email_threads(id text,connection_id uuid,organization_id uuid,archive_state text);
      CREATE TABLE google_workspace_profile_email_thread_sources(connection_id uuid,gmail_thread_id text,conversation_id text);
      CREATE TABLE google_workspace_profile_email_messages(connection_id uuid,conversation_id text,gmail_message_id text);`);
    const repo = new SyncRepository(db as any);
    await repo.configure(conn, "owner@example.com", "active", 0);
    const a = (await repo.claimAccount(conn))!;
    for (const name of [...Array.from({length:102},(_,i)=>`good-${i}`), "partial", "missing-message", "conflict", "missing-source", "draft-only", "old-history-missing"]) {
      const snapshot = { messages: [{id:"m1",labelIds: name === "draft-only" ? ["DRAFT"] : ["SENT"]}] };
      await db.query("INSERT INTO google_sync_archive_jobs(connection_id,thread_id,profile_id,fingerprint) VALUES($1,$2,$3,'hash')", [conn,name,profile]);
      await db.query("INSERT INTO google_sync_snapshots(connection_id,thread_id,profile_id,state,snapshot,fingerprint,availability) VALUES($1,$2,$3,'waiting_for_reply',$4,'snapshot',$5)",[conn,name,profile,JSON.stringify(snapshot),name==="missing-source"?"missing":"available"]);
      await db.query("INSERT INTO google_sync_history(connection_id,thread_id,profile_id,state,snapshot,fingerprint) VALUES($1,$2,$3,'waiting_for_reply',$4,'snapshot')",[conn,name,profile,JSON.stringify(snapshot)]);
      await db.query("INSERT INTO google_workspace_validation_mappings VALUES($1,$2,$3)",[conn,name,profile]);
      await db.query("INSERT INTO google_workspace_profile_email_threads VALUES($1,$2,$3,$4)",[name,conn,profile,name==="partial"?"partial":"complete"]);
      await db.query("INSERT INTO google_workspace_profile_email_thread_sources VALUES($1,$2,$2)",[conn,name]);
      if(name!=="missing-message") await db.query("INSERT INTO google_workspace_profile_email_messages VALUES($1,$2,'m1')",[conn,name]);
    }
    await db.query("INSERT INTO google_workspace_validation_mappings VALUES($1,'conflict','314df1f0-1ec8-4157-b98d-47cf4e1e65f8')",[conn]);
    await db.query(`INSERT INTO google_sync_history(connection_id,thread_id,profile_id,state,snapshot,fingerprint) VALUES($1,'old-history-missing',$2,'waiting_for_reply','{"messages":[{"id":"older","labelIds":["SENT"]}]}','old')`,[conn,profile]);
    const historyBefore = (await db.query("SELECT * FROM google_sync_history ORDER BY thread_id,fingerprint")).rows;
    expect(await completeCoveredArchives(repo,a)).toBe(100);
    expect(await completeCoveredArchives(repo,a)).toBe(2);
    expect((await db.query<any>("SELECT thread_id FROM google_sync_archive_jobs WHERE status='pending' ORDER BY thread_id")).rows.map(r=>r.thread_id)).toEqual(["conflict","draft-only","missing-message","missing-source","old-history-missing","partial"]);
    expect((await db.query("SELECT * FROM google_sync_history ORDER BY thread_id,fingerprint")).rows).toEqual(historyBefore);
    await repo.release(a);
    expect(await completeCoveredArchives(repo,a)).toBe(0);
  } finally { await db.close(); }
});
