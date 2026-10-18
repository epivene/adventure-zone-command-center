import { inputHash } from "../chatgpt-connection/contracts";
import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
export async function readAttentionSource(messageId: string) {
  const connections = new PostgresGoogleConnectionRepository();
  const before = await connections.getCurrent(),
    client = await connections.createReadClient();
  if (!before || !client?.getMessageMetadata || !client.getThreadDetail)
    throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
  const metadata = await client.getMessageMetadata(messageId),
    detail = await client.getThreadDetail(metadata.threadId);
  const after = await connections.getCurrent();
  if (after?.id !== before.id)
    throw new Error("GOOGLE_WORKSPACE_CONNECTION_CHANGED");
  if (metadata.labelIds?.includes("DRAFT"))
    throw new Error("GOOGLE_WORKSPACE_DRAFT_REQUIRES_DRAFT_FILING");
  const messages = detail.messages
    .filter((m) => !m.labelIds?.includes("DRAFT"))
    .sort(
      (a, b) =>
        (a.internalDateMs ?? 0) - (b.internalDateMs ?? 0) ||
        a.id.localeCompare(b.id),
    );
  const latest = messages.at(-1);
  if (!latest || !messages.some((m) => m.id === messageId))
    throw new Error("GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND");
  const latestMetadata =
    latest.id === messageId
      ? metadata
      : await client.getMessageMetadata(latest.id);
  const sender = latest.from
    .match(/(?:<|^|\s)([^<>\s]+@[^<>\s]+)(?:>|$)/)?.[1]
    ?.toLowerCase();
  const sent =
    latestMetadata.labelIds?.includes("SENT") ||
    latest.direction === "outgoing" ||
    sender === before.email.toLowerCase();
  const direction = latestMetadata.labelIds?.includes("DRAFT")
    ? "unknown"
    : sent
      ? "outgoing"
      : sender
        ? "incoming"
        : latest.direction;
  return {
    gmailConnectionId: before.id,
    threadId: detail.id,
    latestMessageId: latest.id,
    messageLabels: messages.map((m) => ({
      id: m.id,
      labelIds: m.labelIds ?? [],
    })),
    // Gmail message IDs/content identify the reviewed source. Attachment download
    // references and label-derived direction are retrieval state, not content.
    sourceFingerprint: inputHash(
      messages.map((message) => ({
        id: message.id,
        internalDateMs: message.internalDateMs,
        from: message.from,
        to: message.to,
        cc: message.cc,
        subject: message.subject,
        date: message.date,
        bodyText: message.bodyText,
        attachments: (message.attachments ?? [])
          .map((attachment) => ({
            messageId: attachment.messageId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          }))
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      })),
    ),
    subject: detail.subject,
    from: latestMetadata.headers.from,
    to: latestMetadata.headers.to,
    internalDateMs: latestMetadata.internalDateMs,
    hasAttachments: messages.some(
      (message) => (message.attachments?.length ?? 0) > 0,
    ),
    latestDirection: direction,
  };
}
