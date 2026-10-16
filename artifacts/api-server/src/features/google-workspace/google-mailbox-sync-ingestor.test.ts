import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SyncRepository } from "./google-mailbox-sync-repository";
import { MailboxSyncIngestor } from "./google-mailbox-sync-ingestor";
import {
  SyncFailure,
  type MailboxChangeClient,
} from "./google-mailbox-sync-client";
const conn = "da54625d-b6f1-4486-8299-e1d85d78422e";
it("bootstraps old mapped threads and drafts then replays changes made during discovery, resuming each phase", async () => {
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
      `CREATE TABLE google_workspace_validation_mappings(connection_id uuid,thread_id text,organization_id uuid);INSERT INTO google_workspace_validation_mappings VALUES('${conn}','old-thread','20943487-43ec-4a11-8c67-36efefbf4efb');`,
    );
    const repo = new SyncRepository(db as any);
    await repo.configure(conn, "owner@example.com", "shadow", 3);
    const cursors: string[] = [];
    let expired = false;
    const client: MailboxChangeClient = {
      getMailbox: async () => ({ email: "owner@example.com", historyId: "42" }),
      listMessagesPage: async () => ({
        messages: [{ id: "m", threadId: "recent" }],
        nextPageToken: null,
      }),
      listDraftsPage: async () => ({
        messages: [{ id: "draft", threadId: "draft-thread" }],
        nextPageToken: null,
      }),
      listHistory: async (input) => {
        cursors.push(input.startHistoryId);
        if (expired)
          throw new SyncFailure("expired_cursor", "SYNC_SOURCE_MISSING");
        return {
          historyId: "99",
          changedThreads: ["during-bootstrap"],
          nextPageToken: null,
        };
      },
    };
    for (let i = 0; i < 5; i++) {
      const a = (await repo.claimAccount(conn))!;
      await new MailboxSyncIngestor(repo, client).step(a);
      await repo.release(a);
    }
    expect(cursors).toEqual(["42"]);
    expect(
      (await db.query<any>("SELECT checkpoint FROM google_sync_accounts"))
        .rows[0].checkpoint,
    ).toMatchObject({ phase: "ready", cursor: "99" });
    expect(
      (
        await db.query<any>(
          "SELECT thread_id FROM google_sync_jobs ORDER BY thread_id",
        )
      ).rows.map((r) => r.thread_id),
    ).toEqual(["draft-thread", "during-bootstrap", "old-thread", "recent"]);
    expired = true;
    const a = (await repo.claimAccount(conn))!;
    await new MailboxSyncIngestor(repo, client).step(a);
    expect(
      (await db.query<any>("SELECT checkpoint FROM google_sync_accounts"))
        .rows[0].checkpoint.phase,
    ).toBe("boundary");
    expect(
      (await db.query("SELECT * FROM google_sync_jobs")).rows,
    ).toHaveLength(4);
    await repo.release(a);
    await db.query(
      `UPDATE google_sync_accounts SET checkpoint='{"phase":"history","cursor":"99","pageToken":"expired"}'`,
    );
    client.listHistory = async () => {
      throw new SyncFailure("invalid", "SYNC_PAGE_TOKEN_INVALID");
    };
    const retry = (await repo.claimAccount(conn))!;
    await new MailboxSyncIngestor(repo, client).step(retry);
    expect(
      (await db.query<any>("SELECT checkpoint FROM google_sync_accounts"))
        .rows[0].checkpoint,
    ).toMatchObject({ phase: "history", cursor: "99", pageToken: null });
  } finally {
    await db.close();
  }
});
