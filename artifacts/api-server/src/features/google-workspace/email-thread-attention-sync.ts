import { randomUUID } from "node:crypto";
import type { SqlQuery } from "../chatgpt-connection/contracts";
import type { GoogleGmailMutationRecord } from "./google-gmail-mutation-repository";
import type { GoogleGmailLabelMutationClient } from "./google-api-types";
import { EmailThreadAttentionRepository } from "./email-thread-attention-repository";
import { readAttentionSource } from "./email-thread-attention-source";
import { applyAttentionLabels } from "./email-thread-attention-labels";
export function attentionLabelHandler(
  db: SqlQuery,
  gmail: GoogleGmailLabelMutationClient,
) {
  return async (
    mutation: GoogleGmailMutationRecord,
    profileLabelId: string,
    oldProfileLabelIds: string[],
  ): Promise<string[] | null> => {
    let r = await new EmailThreadAttentionRepository(db).read(
      mutation.connectionId,
      mutation.threadId,
    );
    if (!r) return null;
    if (r.profileId !== mutation.organizationId)
      throw new Error("GOOGLE_WORKSPACE_ATTENTION_ASSIGNMENT_CHANGED");
    const operation = (
      await db.query(
        "SELECT * FROM email_thread_attention_operations WHERE attention_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
        [r.id],
      )
    ).rows[0];
    if (!operation)
      throw new Error("GOOGLE_WORKSPACE_ATTENTION_AUTHORIZATION_MISSING");
    const authorized = async () => {
      if (operation.actor_key === "owner") return;
      const c = (
        await db.query(
          "SELECT scopes,revoked_at FROM chatgpt_connections WHERE id=$1 AND owner_id=$2",
          [operation.actor_key, operation.owner_id],
        )
      ).rows[0];
      if (!c || c.revoked_at || !c.scopes.includes("email:organize"))
        throw new Error("GOOGLE_WORKSPACE_ATTENTION_AUTHORIZATION_REVOKED");
    };
    await authorized();
    let source = await readAttentionSource(mutation.messageId);
    if (
      source.gmailConnectionId !== r.gmailConnectionId ||
      source.threadId !== r.threadId
    )
      throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
    if (source.latestMessageId !== r.reviewedMessageId) {
      if (source.latestDirection !== "incoming")
        throw new Error("GOOGLE_WORKSPACE_ATTENTION_REVIEW_REQUIRED");
      // The existing mutation service holds the thread lock. CAS and audit share one statement.
      const updated = (
        await db.query(
          `WITH before AS (SELECT * FROM email_thread_attention WHERE id=$1 AND revision=$2 FOR UPDATE),
    changed AS (UPDATE email_thread_attention SET state='needs_your_reply',reviewed_message_id=$3,revision=$4,reason='New incoming reply',updated_at=now()
      WHERE id IN(SELECT id FROM before) RETURNING *),
    audited AS (INSERT INTO email_thread_attention_audit(id,attention_id,actor_id,before_value,after_value)
     SELECT $5,changed.id,'inbound-sync',to_jsonb(before),to_jsonb(changed) FROM before,changed)
    SELECT id FROM changed`,
          [
            r.id,
            r.revision,
            source.latestMessageId,
            randomUUID(),
            randomUUID(),
          ],
        )
      ).rows[0];
      if (!updated)
        throw new Error("GOOGLE_WORKSPACE_ATTENTION_REVIEW_REQUIRED");
      r = (await new EmailThreadAttentionRepository(db).read(
        mutation.connectionId,
        mutation.threadId,
      ))!;
    }
    const revision = r.revision,
      latest = source.latestMessageId;
    const guard = async () => {
      await authorized();
      const current = await new EmailThreadAttentionRepository(db).read(
        mutation.connectionId,
        mutation.threadId,
      );
      const fresh = await readAttentionSource(mutation.messageId);
      if (
        current?.revision !== revision ||
        fresh.latestMessageId !== latest ||
        fresh.gmailConnectionId !== mutation.connectionId
      )
        throw new Error("GOOGLE_WORKSPACE_ATTENTION_REVIEW_REQUIRED");
      source = fresh;
    };
    return applyAttentionLabels(
      gmail,
      {
        threadId: r.threadId,
        profileLabelId,
        oldProfileLabelIds,
        state: r.state,
        readMessages: async () => source.messageLabels,
        archive:
          mutation.operation === "assign_thread" &&
          latest === operation.result.record.reviewedMessageId,
      },
      guard,
    );
  };
}
