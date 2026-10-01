import { pool } from "@workspace/db";
import type {
  ConnectionDatabase,
  SqlQuery,
} from "../chatgpt-connection/contracts";
import { EmailThreadAttentionService } from "./email-thread-attention-service";
import { PostgresGoogleProfileAssignmentTransaction } from "./google-profile-assignment-transaction";
import { GoogleReviewProfileAssignmentService } from "./google-review-profile-assignment-service";
import { readAttentionSource } from "./email-thread-attention-source";
import type { AttentionActor } from "./email-thread-attention-types";
export function createEmailAttentionService(db: ConnectionDatabase = pool) {
  const authorize = async (
    actor: AttentionActor,
    write: boolean,
    tx: SqlQuery = db,
  ) => {
    if (!actor.ownerId) throw new Error("EMAIL_ATTENTION_ACCESS");
    if (actor.connectorId) {
      const c = (
        await tx.query(
          "SELECT scopes,revoked_at FROM chatgpt_connections WHERE id=$1 AND owner_id=$2" +
            (tx !== db ? " FOR UPDATE" : ""),
          [actor.connectorId, actor.ownerId],
        )
      ).rows[0];
      if (
        !c ||
        c.revoked_at ||
        !c.scopes.includes(write ? "email:organize" : "crm:read")
      )
        throw new Error("EMAIL_ATTENTION_ACCESS");
    }
  };
  return new EmailThreadAttentionService(db, {
    authorize,
    source: readAttentionSource,
    assign: async (tx, p, source, actor) => {
      const current = (
        await tx.query(
          "SELECT id FROM google_workspace_connections WHERE (role='workspace' OR role IS NULL) AND status='connected' ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE",
        )
      ).rows[0];
      if (current?.id !== p.gmailConnectionId)
        throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
      // Every attention decision must enqueue its own intent, even for the same profile.
      await tx.query(
        "UPDATE google_workspace_gmail_thread_intents SET current_mutation_id=NULL,generation=generation+1 WHERE connection_id=$1 AND thread_id=$2",
        [p.gmailConnectionId, p.threadId],
      );
      return new PostgresGoogleProfileAssignmentTransaction(undefined, {
        tx: tx as never,
        connectionId: p.gmailConnectionId,
      }).assignMatched({
        messageId: p.latestMessageId,
        threadId: p.threadId,
        organizationId: p.profileId,
        actorId: actor.ownerId,
        now: new Date(),
        subject: source.subject,
        from: source.from,
        to: source.to,
        internalDateMs: source.internalDateMs,
        hasAttachments: source.hasAttachments,
      });
    },
    inspect: async (record, committed) => {
      const mutation = (
        await db.query(
          "SELECT state,last_error_code FROM google_workspace_gmail_mutations WHERE connection_id=$1 AND thread_id=$2 AND message_id=$3 AND organization_id=$4 ORDER BY created_at DESC,id DESC LIMIT 1",
          [
            record.gmailConnectionId,
            record.threadId,
            record.reviewedMessageId,
            record.profileId,
          ],
        )
      ).rows[0];
      const archive = (
        await db.query(
          `SELECT t.id,t.archive_state,t.last_gmail_error_code,
    EXISTS(SELECT 1 FROM google_workspace_profile_email_messages m WHERE m.conversation_id=t.id AND m.connection_id=$1 AND m.gmail_message_id=$4) AS covered
    FROM google_workspace_profile_email_threads t JOIN google_workspace_profile_email_thread_sources s ON s.conversation_id=t.id AND s.connection_id=t.connection_id
    WHERE t.connection_id=$1 AND t.organization_id=$2 AND s.gmail_thread_id=$3`,
          [
            record.gmailConnectionId,
            record.profileId,
            record.threadId,
            record.reviewedMessageId,
          ],
        )
      ).rows[0];
      return {
        gmailSync: {
          state: mutation ? String(mutation.state) : "pending",
          errorCode: mutation
            ? (mutation.last_error_code as string | null)
            : null,
        },
        archiveSync: {
          state:
            archive?.last_gmail_error_code || !archive?.covered
              ? "retry_required"
              : String(archive.archive_state),
          conversationId: (archive?.id as string) ?? null,
          errorCode:
            (archive?.last_gmail_error_code as string) ??
            (!archive?.covered
              ? "GOOGLE_WORKSPACE_ARCHIVE_SOURCE_MISSING"
              : null),
        },
      };
    },
    sync: async (actor, committed, _record, prior) => {
      await authorize(actor, true);
      const service = new GoogleReviewProfileAssignmentService();
      return service.synchronizeAttention(
        committed,
        () => authorize(actor, true),
        prior,
      );
    },
  });
}
