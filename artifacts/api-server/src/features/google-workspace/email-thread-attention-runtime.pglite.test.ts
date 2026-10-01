import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture } from "../chatgpt-connection/test-database";
import { ensureEmailThreadAttentionSchema } from "../../db/email-thread-attention-schema";
import { EmailThreadAttentionRepository } from "./email-thread-attention-repository";
import { createEmailAttentionService } from "./email-thread-attention-runtime";
it("reads cross-actor canonical state from durable Gmail and archive evidence", async () => {
  const f = await fixture();
  try {
    await ensureEmailThreadAttentionSchema(f.db);
    await f.db
      .exec(`CREATE TABLE google_workspace_gmail_mutations(id uuid,connection_id uuid,thread_id text,message_id text,organization_id uuid,state text,last_error_code text,created_at timestamptz DEFAULT now());
   ALTER TABLE google_workspace_profile_email_threads ADD COLUMN archive_state text,ADD COLUMN last_gmail_error_code text;

   CREATE TABLE google_workspace_profile_email_messages(conversation_id uuid,connection_id uuid,gmail_message_id text);`);
    const account = randomUUID(),
      archive = randomUUID(),
      mutation = randomUUID();
    const record = await f.db.transaction((tx) =>
      new EmailThreadAttentionRepository(tx).commit(
        tx,
        {
          id: randomUUID(),
          ownerId: "owner",
          connectorId: null,
          gmailConnectionId: account,
          threadId: "thread",
          latestMessageId: "new",
          profileId: f.profileId,
          eventYear: null,
          state: "needs_your_reply",
          reason: "Reply",
          subject: "Fair",
          dueAt: null,
          followupId: null,
          expectedRevision: null,
          sourceFingerprint: "new",
          expiresAt: new Date().toISOString(),
        },
        "owner",
      ),
    );
    await f.db.query(
      "INSERT INTO email_thread_attention_operations(id,owner_id,actor_key,request_key,request_hash,preview_id,attention_id,result) VALUES($1,'owner',$2,'key','hash',$3,$4,$5)",
      [
        randomUUID(),
        f.principal.connectionId,
        randomUUID(),
        record.id,
        JSON.stringify({
          record,
          assignment: "committed",
          operationId: randomUUID(),
          committed: { mutation: { id: mutation } },
          gmailSync: { state: "retry_required" },
          archiveSync: { state: "complete" },
        }),
      ],
    );
    await f.db.query(
      "INSERT INTO google_workspace_gmail_mutations(id,connection_id,thread_id,message_id,organization_id,state) VALUES($1,$2,'thread','new',$3,'completed')",
      [mutation, account, f.profileId],
    );
    await f.db.query(
      "INSERT INTO google_workspace_profile_email_threads(id,connection_id,organization_id,archive_state,last_gmail_error_code) VALUES($1,$2,$3,'complete',null)",
      [archive, account, f.profileId],
    );
    await f.db.query(
      "INSERT INTO google_workspace_profile_email_thread_sources VALUES($1,$2,'thread')",
      [archive, account],
    );
    const service = createEmailAttentionService(f.db);
    const input = { gmailConnectionId: account, threadId: "thread" };
    const first = await service.read(
      { ownerId: "owner", connectorId: null },
      input,
    );
    expect(first?.gmailSync.state).toBe("completed");
    expect(first?.archiveSync.state).toBe("retry_required");
    await f.db.query(
      "INSERT INTO google_workspace_profile_email_messages VALUES($1,$2,'new')",
      [archive, account],
    );
    expect(
      (await service.read({ ownerId: "owner", connectorId: null }, input))
        ?.archiveSync.state,
    ).toBe("complete");
  } finally {
    await f.db.close();
  }
});
