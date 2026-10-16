import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SyncReadModel } from "./google-mailbox-sync-read-model";
it("paginates cached summaries without exposing draft bodies or other accounts", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      readFileSync(
        new URL(
          "../../../../../lib/db/migrations/20261016_google_mailbox_sync.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await db.exec(`CREATE TABLE organizations(id uuid,name text);CREATE TABLE follow_ups(id uuid,organization_id uuid,kind text,due_at timestamptz,completed_at timestamptz);CREATE TABLE email_thread_attention(gmail_connection_id uuid,thread_id text,reason text);INSERT INTO organizations VALUES('20943487-43ec-4a11-8c67-36efefbf4efb','Fair');
 INSERT INTO google_sync_snapshots(connection_id,thread_id,profile_id,state,snapshot,fingerprint) SELECT 'da54625d-b6f1-4486-8299-e1d85d78422e','t'||i,'20943487-43ec-4a11-8c67-36efefbf4efb','draft_to_review','{"drafts":[{"bodyText":"Private draft"}]}','f' FROM generate_series(1,3)i;`);
    const read = new SyncReadModel(db as any);
    const input = {
      connectionId: "da54625d-b6f1-4486-8299-e1d85d78422e",
      limit: 2,
    };
    const page = await read.list(input);
    expect(page.items).toHaveLength(2);
    expect(JSON.stringify(page)).not.toContain("Private draft");
    expect(page.nextCursor).toBe("t2");
    expect(
      (await read.list({ ...input, cursor: page.nextCursor! })).items,
    ).toHaveLength(1);
    expect(
      (
        await read.list({
          ...input,
          connectionId: "20943487-43ec-4a11-8c67-36efefbf4efb",
        })
      ).items,
    ).toHaveLength(0);
    expect(
      (await read.detail(input.connectionId, "t1"))?.snapshot.drafts[0]
        .bodyText,
    ).toBe("Private draft");
    await db.query(
      `INSERT INTO google_sync_snapshots(connection_id,thread_id,state,snapshot,fingerprint) VALUES($1,'new-thread','link_review','{"subject":"New fair conversation"}','review')`,
      [input.connectionId],
    );
    expect((await read.reviews(input.connectionId)).items).toMatchObject([
      { threadId: "new-thread", subject: "New fair conversation" },
    ]);
    expect((await read.status(input.connectionId)).linkReview).toBe(1);
    await db.query(`INSERT INTO google_sync_jobs(connection_id,thread_id,error_code) VALUES($1,'deferred','SYNC_OUTSIDE_COHORT'),($1,'failed','SYNC_PROVIDER_UNAVAILABLE'),($1,'queued',NULL)`,[input.connectionId]);
    expect(await read.status(input.connectionId)).toMatchObject({pending:3,blocked:1});
    expect((await db.query("SELECT error_code FROM google_sync_jobs WHERE thread_id='deferred'")).rows[0]).toMatchObject({error_code:"SYNC_OUTSIDE_COHORT"});
  } finally {
    await db.close();
  }
});
