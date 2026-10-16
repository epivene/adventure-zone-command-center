import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SyncRepository } from "./google-mailbox-sync-repository";
const conn = "da54625d-b6f1-4486-8299-e1d85d78422e";
export async function setupSyncDb() {
  const db = new PGlite();
  await db.exec(
    readFileSync(
      new URL(
        "../../../../../lib/db/migrations/20261016_google_mailbox_sync.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  return db;
}
it("defers at most 100 unambiguous outside-cohort jobs without touching mappings or uncertain work", async () => {
  const db=await setupSyncDb();
  try {
    const enrolled="20943487-43ec-4a11-8c67-36efefbf4efb", other="314df1f0-1ec8-4157-b98d-47cf4e1e65f8";
    await db.exec(`CREATE TABLE google_workspace_validation_mappings(connection_id uuid,thread_id text,organization_id uuid);
      INSERT INTO google_workspace_validation_mappings SELECT '${conn}','outside-'||i,'${other}' FROM generate_series(1,102) i;
      INSERT INTO google_workspace_validation_mappings VALUES('${conn}','enrolled','${enrolled}'),('${conn}','conflict','${enrolled}'),('${conn}','conflict','${other}'),('${conn}','null-target',NULL);`);
    const repo=new SyncRepository(db as any);
    await repo.configure(conn,"owner@example.com","shadow",3);
    await db.query("INSERT INTO google_sync_enrollments(connection_id,profile_id) VALUES($1,$2)",[conn,enrolled]);
    const names=[...Array.from({length:102},(_,i)=>`outside-${i+1}`),"enrolled","conflict","null-target","unmapped"];
    await repo.enqueue(conn,names);
    const a=(await repo.claimAccount(conn))!;
    expect(await repo.deferOutsideCohort(a)).toBe(100);
    expect(await repo.deferOutsideCohort(a)).toBe(2);
    expect((await db.query<any>("SELECT thread_id FROM google_sync_jobs WHERE generation>processed_generation ORDER BY thread_id")).rows.map(r=>r.thread_id)).toEqual(["conflict","enrolled","null-target","unmapped"]);
    expect((await db.query("SELECT * FROM google_workspace_validation_mappings")).rows).toHaveLength(106);
    expect((await db.query("SELECT * FROM google_sync_jobs")).rows).toHaveLength(106);
    await repo.release(a);
    await repo.configure(conn,"owner@example.com","active",0);
    await repo.enqueue(conn,["outside-1"]);
    const expanded=(await repo.claimAccount(conn))!;
    expect(await repo.deferOutsideCohort(expanded)).toBe(0);
    expect((await repo.claimThreads(expanded,25)).map(c=>c.threadId)).toContain("outside-1");
    expect(await repo.deferOutsideCohort(a)).toBe(0);
  } finally {await db.close();}
});
it("replaces rollout membership atomically and counts pilots within the limit", async () => {
  const db = await setupSyncDb();
  try {
    await db.exec(`CREATE TABLE google_pilot_sync(connection_id uuid,profile_id uuid);CREATE TABLE google_workspace_validation_mappings(connection_id uuid,organization_id uuid);
 INSERT INTO google_workspace_validation_mappings SELECT '${conn}',md5(i::text)::uuid FROM generate_series(1,600) i;
 INSERT INTO google_pilot_sync SELECT '${conn}',md5(i::text)::uuid FROM generate_series(598,600) i;`);
    const repo = new SyncRepository(db as any);
    for (const size of [50, 500, 3, 0]) {
      await repo.configure(conn, "owner@example.com", "shadow", size, true);
      expect(
        (
          await db.query<any>(
            "SELECT count(*)::int n FROM google_sync_enrollments",
          )
        ).rows[0].n,
      ).toBe(size || 600);
      expect(
        (
          await db.query(
            "SELECT * FROM google_sync_enrollments JOIN google_pilot_sync USING(connection_id,profile_id)",
          )
        ).rows,
      ).toHaveLength(3);
    }
  } finally {
    await db.close();
  }
});
it("commits pages once and preserves newer generations after an older claim finishes", async () => {
  const db = await setupSyncDb();
  try {
    const repo = new SyncRepository(db as any);
    await repo.configure(conn, "owner@example.com", "shadow", 3);
    const a = (await repo.claimAccount(conn))!;
    expect(a).not.toBeNull();
    expect(await repo.claimAccount(conn)).toBeNull();
    expect(
      await repo.commitPage(a, {
        threads: ["t1", "t1", "t2"],
        checkpoint: { phase: "history", cursor: "42", pageToken: null },
      }),
    ).toBe(true);
    expect(
      await repo.commitPage(a, {
        threads: ["t3"],
        checkpoint: { phase: "ready", cursor: "43", pageToken: null },
      }),
    ).toBe(false);
    expect(
      (await db.query("SELECT * FROM google_sync_jobs")).rows,
    ).toHaveLength(2);
    const claims = await repo.claimThreads(a, 25);
    expect(claims).toHaveLength(2);
    await repo.enqueue(conn, ["t1"]);
    await repo.finishThread(
      claims.find((c) => c.threadId === "t1")!,
      {
        state: "needs_review",
        profileId: null,
        snapshot: { reason: "review" },
      },
    );
    const row = (
      await db.query<any>("SELECT * FROM google_sync_jobs WHERE thread_id='t1'")
    ).rows[0];
    expect(Number(row.generation)).toBeGreaterThan(
      Number(row.processed_generation),
    );
    expect((await repo.claimThreads(a, 25)).map((c) => c.threadId)).toEqual([
      "t1",
    ]);
  } finally {
    await db.close();
  }
});
it("queues repaired app mappings without waiting for another Gmail change", async () => {
  const db = await setupSyncDb();
  try {
    await db.exec(
      "CREATE TABLE google_workspace_validation_mappings(connection_id uuid,message_id text,thread_id text,organization_id uuid,evidence_codes jsonb)",
    );
    await db.exec(
      readFileSync(
        new URL(
          "../../../../../lib/db/migrations/20261016_google_mailbox_sync.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const repo = new SyncRepository(db as any);
    await repo.configure(conn, "owner@example.com", "active", 0);
    await db.query(
      `INSERT INTO google_workspace_validation_mappings VALUES($1,'m','new-thread',NULL,'[]')`,
      [conn],
    );
    expect(
      (await db.query<any>("SELECT thread_id FROM google_sync_jobs")).rows,
    ).toEqual([{ thread_id: "new-thread" }]);
    await db.query(
      "UPDATE google_workspace_validation_mappings SET thread_id='repaired-thread'",
    );
    expect(
      (
        await db.query<any>(
          "SELECT thread_id FROM google_sync_jobs ORDER BY thread_id",
        )
      ).rows,
    ).toEqual([{ thread_id: "new-thread" }, { thread_id: "repaired-thread" }]);
  } finally {
    await db.close();
  }
});
it("fences expired and replaced account claims and preserves snapshot revisions", async () => {
  const db = await setupSyncDb();
  try {
    const repo = new SyncRepository(db as any);
    await repo.configure(conn, "owner@example.com", "shadow", 3);
    const a = (await repo.claimAccount(conn))!;
    await repo.enqueue(conn, ["t1"]);
    const [job] = await repo.claimThreads(a, 25);
    await repo.configure(conn, "owner@example.com", "off", 3);
    expect(
      await repo.finishThread(job, {
        state: "needs_review",
        profileId: null,
        snapshot: { text: "stale" },
      }),
    ).toBe(false);
    expect(
      (await db.query("SELECT * FROM google_sync_snapshots")).rows,
    ).toHaveLength(0);
    await expect(
      repo.configure(conn, "different@example.com", "active", 3),
    ).rejects.toThrow("SYNC_ACCOUNT_CHANGED");
  } finally {
    await db.close();
  }
});
it("rolls back queue writes when the checkpoint fails and blocks disconnected-account saves", async () => {
  const db = await setupSyncDb();
  try {
    let connected = true;
    const repo = new SyncRepository(db as any, async () => connected);
    await repo.configure(conn, "owner@example.com", "shadow", 3);
    const a = (await repo.claimAccount(conn))!;
    await db.exec(
      `CREATE FUNCTION reject_checkpoint() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'checkpoint failure'; END; $$ LANGUAGE plpgsql; CREATE TRIGGER reject_checkpoint BEFORE UPDATE OF checkpoint ON google_sync_accounts FOR EACH ROW EXECUTE FUNCTION reject_checkpoint();`,
    );
    await expect(
      repo.commitPage(a, {
        threads: ["t"],
        checkpoint: { phase: "ready", cursor: "42" },
      }),
    ).rejects.toThrow("checkpoint failure");
    expect(
      (await db.query("SELECT * FROM google_sync_jobs")).rows,
    ).toHaveLength(0);
    await db.exec("DROP TRIGGER reject_checkpoint ON google_sync_accounts");
    await repo.enqueue(conn, ["t"]);
    const [job] = await repo.claimThreads(a, 1);
    connected = false;
    expect(
      await repo.finishThread(job, {
        profileId: null,
        state: "needs_review",
        snapshot: {},
      }),
    ).toBe(false);
    expect(
      (await db.query("SELECT * FROM google_sync_history")).rows,
    ).toHaveLength(0);
  } finally {
    await db.close();
  }
});
