import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SyncRepository } from "./google-mailbox-sync-repository";
import { MailboxSyncProcessor } from "./google-mailbox-sync-processor";
import { SyncFailure } from "./google-mailbox-sync-client";
const conn = "da54625d-b6f1-4486-8299-e1d85d78422e",
  profile = "20943487-43ec-4a11-8c67-36efefbf4efb";
it("refreshes a mapped draft, retains prior mappings, and refuses a mapping changed during Gmail fetch", async () => {
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
    await db.exec(
      `CREATE TABLE google_workspace_validation_mappings(connection_id uuid,message_id text,thread_id text,organization_id uuid,contact_id uuid,evidence_codes jsonb,created_at timestamptz,updated_at timestamptz,PRIMARY KEY(connection_id,message_id));CREATE TABLE google_pilot_sync(connection_id uuid,thread_id text,snapshot jsonb,baseline_state text,baseline_message_id text);INSERT INTO google_workspace_validation_mappings VALUES('${conn}','old','thread','${profile}',NULL,'[]',now(),now());`,
    );
    const repo = new SyncRepository(db as any);
    await repo.configure(conn, "owner@example.com", "active", 0);
    const a = (await repo.claimAccount(conn))!;
    await repo.enqueue(conn, ["thread"]);
    const thread = {
      id: "thread",
      subject: "Contract",
      originalGmailUrl: "",
      messages: [
        {
          id: "new",
          labelIds: ["DRAFT"],
          internalDateMs: 10,
          from: "owner@example.com",
          to: "fair@example.com",
          cc: "",
          date: "",
          subject: "Contract",
          bodyText: "Uns ent draft",
          attachments: [],
          direction: "unknown" as const,
        },
      ],
    };
    const processor = new MailboxSyncProcessor(repo, async () => thread);
    await processor.process((await repo.claimThreads(a, 1))[0], a);
    expect(
      (await db.query<any>("SELECT state FROM google_sync_snapshots")).rows[0]
        .state,
    ).toBe("draft_to_review");
    expect(
      (await db.query("SELECT * FROM google_workspace_validation_mappings"))
        .rows,
    ).toHaveLength(2);
    await db.query(
      `INSERT INTO google_pilot_sync VALUES($1,'thread',NULL,'draft_to_review','old')`,
      [conn],
    );
    const sent = new MailboxSyncProcessor(repo, async () => ({
      ...thread,
      messages: [{ ...thread.messages[0], id: "sent", labelIds: ["SENT"] }],
    }));
    for (let i = 0; i < 2; i++) {
      await repo.enqueue(conn, ["thread"]);
      await sent.process((await repo.claimThreads(a, 1))[0], a);
      expect(
        (await db.query<any>("SELECT state FROM google_sync_snapshots")).rows[0]
          .state,
      ).toBe("waiting_for_reply");
    }
    await db.query(
      "UPDATE google_pilot_sync SET snapshot=(SELECT snapshot FROM google_sync_snapshots LIMIT 1)",
    );
    await db.query("DELETE FROM google_sync_snapshots");
    await repo.enqueue(conn, ["thread"]);
    await sent.process((await repo.claimThreads(a, 1))[0], a);
    expect(
      (await db.query<any>("SELECT state FROM google_sync_snapshots")).rows[0]
        .state,
    ).toBe("waiting_for_reply");
    await repo.enqueue(conn, ["thread"]);
    await processor.process((await repo.claimThreads(a, 1))[0], a);
    await repo.enqueue(conn, ["thread"]);
    const racing = new MailboxSyncProcessor(repo, async () => {
      await db.query(
        "UPDATE google_workspace_validation_mappings SET organization_id='314df1f0-1ec8-4157-b98d-47cf4e1e65f8'",
      );
      return {
        ...thread,
        messages: [{ ...thread.messages[0], bodyText: "Wrong profile" }],
      };
    });
    await racing.process((await repo.claimThreads(a, 1))[0], a);
    expect(
      (await db.query<any>("SELECT snapshot FROM google_sync_snapshots"))
        .rows[0].snapshot.drafts[0].bodyText,
    ).toBe("Uns ent draft");
    expect(
      (await db.query("SELECT * FROM google_sync_history")).rows,
    ).toHaveLength(2);
  } finally {
    await db.close();
  }
});
it("retains the saved pilot observation when its first Gmail refresh is missing", async () => {
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
    await db.exec(`CREATE TABLE google_workspace_validation_mappings(connection_id uuid,message_id text,thread_id text,organization_id uuid);CREATE TABLE google_pilot_sync(connection_id uuid,thread_id text,profile_id uuid,snapshot jsonb,baseline_state text,baseline_message_id text);
 INSERT INTO google_workspace_validation_mappings VALUES('${conn}','old','thread','${profile}');INSERT INTO google_pilot_sync VALUES('${conn}','thread','${profile}','{"state":"owner_decision","drafts":[]}', 'owner_decision','old');`);
    const repo = new SyncRepository(db as any);
    await repo.configure(conn, "owner@example.com", "shadow", 0);
    const a = (await repo.claimAccount(conn))!;
    await repo.enqueue(conn, ["thread"]);
    await new MailboxSyncProcessor(repo, async () => {
      throw new SyncFailure("source_missing", "SYNC_SOURCE_MISSING");
    }).process((await repo.claimThreads(a, 1))[0], a);
    expect(
      (await db.query<any>("SELECT * FROM google_sync_snapshots")).rows[0],
    ).toMatchObject({
      profile_id: profile,
      state: "owner_decision",
      availability: "missing",
      snapshot: { state: "owner_decision" },
    });
  } finally {
    await db.close();
  }
});
it("links a uniquely matched contact but revalidates contact ownership before saving", async () => {
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
    await db.exec(`CREATE TABLE google_workspace_validation_mappings(connection_id uuid,message_id text,thread_id text,organization_id uuid,contact_id uuid,evidence_codes jsonb,created_at timestamptz,updated_at timestamptz,PRIMARY KEY(connection_id,message_id));CREATE TABLE google_pilot_sync(connection_id uuid,thread_id text,snapshot jsonb,baseline_state text,baseline_message_id text);
 CREATE TABLE contacts(id text,email text);CREATE TABLE organizations(id uuid,consolidated_into_id uuid);CREATE TABLE organization_contacts(contact_id text,organization_id uuid,active boolean);
 INSERT INTO contacts VALUES('c','fair@example.com');INSERT INTO organizations VALUES('${profile}',NULL);INSERT INTO organization_contacts VALUES('c','${profile}',true);`);
    const repo = new SyncRepository(db as any);
    await repo.configure(conn, "owner@example.com", "active", 0);
    const a = (await repo.claimAccount(conn))!;
    const headers = async () => ({
      participants: ["fair@example.com"],
      subject: "Fair",
    });
    const get = async (id: string) => ({
      id,
      subject: "Fair",
      originalGmailUrl: "",
      messages: [
        {
          id: "m-" + id,
          labelIds: [],
          internalDateMs: 1,
          from: "fair@example.com",
          to: "owner@example.com",
          cc: "",
          date: "",
          subject: "Fair",
          bodyText: "Hello",
          attachments: [],
          direction: "incoming" as const,
        },
      ],
    });
    await repo.enqueue(conn, ["new"]);
    await new MailboxSyncProcessor(repo, get, headers).process(
      (await repo.claimThreads(a, 1))[0],
      a,
    );
    expect(
      (await db.query<any>("SELECT * FROM google_sync_snapshots")).rows[0],
    ).toMatchObject({ profile_id: profile, state: "reply_to_review" });
    expect(
      (await db.query("SELECT * FROM google_workspace_validation_mappings"))
        .rows,
    ).toHaveLength(1);
    await repo.enqueue(conn, ["race"]);
    await new MailboxSyncProcessor(
      repo,
      async (id) => {
        await db.query("UPDATE organization_contacts SET active=false");
        return get(id);
      },
      headers,
    ).process((await repo.claimThreads(a, 1))[0], a);
    expect(
      (await db.query("SELECT * FROM google_workspace_validation_mappings"))
        .rows,
    ).toHaveLength(1);
    expect(
      (await db.query("SELECT * FROM google_sync_snapshots")).rows,
    ).toHaveLength(1);
  } finally {
    await db.close();
  }
});
