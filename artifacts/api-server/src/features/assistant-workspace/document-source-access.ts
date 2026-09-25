import type { Queryable, RunContext } from "./contracts";
import type { GoogleWorkspaceReadClient } from "../google-workspace/google-api-types";
// Correlated to business_documents AS d. Every linked booking must have a year;
// INNER JOIN would silently discard bookings whose opportunity is still missing.
export const documentEventYearSql = `(SELECT CASE
  WHEN count(*)>0 AND count(o.event_year)=count(*) AND count(DISTINCT o.event_year)=1
  THEN min(o.event_year) ELSE NULL END
  FROM business_document_links l LEFT JOIN booking_opportunities o ON o.booking_id=l.booking_id
  WHERE l.document_id=d.id AND l.booking_id IS NOT NULL)`;
export async function documentSourceMetadata(
  db: Queryable,
  context: RunContext,
  documentId: string,
): Promise<{ eventYear: number | null }> {
  const row = (
    await db.query(
      `SELECT d.id,
    coalesce((SELECT jsonb_agg(DISTINCT coalesce(l.organization_id,b.organization_id)) FROM business_document_links l LEFT JOIN bookings b ON b.id=l.booking_id WHERE l.document_id=d.id),'[]'::jsonb) AS organizations,
    ${documentEventYearSql} AS event_year
    FROM business_documents d WHERE d.id=$1 AND d.lifecycle<>'deleted'`,
      [documentId],
    )
  ).rows[0];
  if (!row) throw new Error("ASSISTANT_DOCUMENT_UNAVAILABLE");
  if (
    context.selection.organizationIds.length &&
    !row.organizations.some((id: string) =>
      context.selection.organizationIds.includes(id),
    )
  )
    throw new Error("ASSISTANT_TARGET_NOT_IN_BATCH");
  return { eventYear: row.event_year ?? null };
}
export async function assertAttachmentScope(
  db: Queryable,
  context: RunContext,
  source: { messageId: string; attachmentId: string },
  client: GoogleWorkspaceReadClient,
  connectionId: string,
): Promise<void> {
  if (connectionId !== context.actor.connectionId)
    throw new Error("ASSISTANT_CONNECTION_CHANGED");
  if (!client.getMessageMetadata || !client.getThreadDetail)
    throw new Error("ASSISTANT_ATTACHMENT_NOT_FOUND");
  const message = await client.getMessageMetadata(source.messageId);
  if (message.id !== source.messageId)
    throw new Error("ASSISTANT_ATTACHMENT_NOT_FOUND");
  if (
    context.selection.threadId &&
    context.selection.threadId !== message.threadId
  )
    throw new Error("ASSISTANT_THREAD_CHANGED");
  const thread = await client.getThreadDetail(message.threadId);
  if (
    thread.id !== message.threadId ||
    !thread.messages.some(
      (m) =>
        m.id === source.messageId &&
        m.attachments.some(
          (a) =>
            a.messageId === source.messageId &&
            a.attachmentId === source.attachmentId,
        ),
    )
  )
    throw new Error("ASSISTANT_ATTACHMENT_NOT_FOUND");
  if (!context.selection.organizationIds.length) return;
  const scope = await db.query(
    `SELECT organization_id FROM google_workspace_validation_mappings
    WHERE connection_id=$1 AND message_id=$2 AND thread_id=$3 AND organization_id=ANY($4::uuid[])
    UNION SELECT t.organization_id FROM google_workspace_profile_email_threads t
    JOIN google_workspace_profile_email_thread_sources s ON s.conversation_id=t.id AND s.connection_id=t.connection_id
    WHERE t.connection_id=$1 AND s.gmail_thread_id=$3 AND t.organization_id=ANY($4::uuid[])`,
    [
      connectionId,
      source.messageId,
      message.threadId,
      context.selection.organizationIds,
    ],
  );
  if (!scope.rows.length) throw new Error("ASSISTANT_TARGET_NOT_IN_BATCH");
}
