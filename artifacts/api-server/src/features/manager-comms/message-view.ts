import type { LegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";
import type { ManagerMessage, MessageAttachment } from "./communication-repository";

export async function attachFilesToMessages(
  messages: ManagerMessage[],
  attachments: MessageAttachment[],
  storage: LegManagerObjectStorage,
) {
  const byMessage = new Map<string, any[]>();
  for (const attachment of attachments) {
    if (!attachment.messageId) continue;
    let downloadUrl: string | null = null;
    if (attachment.uploadStatus === "uploaded" && attachment.objectKey) {
      try { downloadUrl = await storage.getSignedReadUrl(attachment.objectKey); } catch { downloadUrl = null; }
    }
    const { objectKey: _privateObjectKey, ...publicAttachment } = attachment;
    const view = { ...publicAttachment, downloadUrl };
    byMessage.set(attachment.messageId, [...(byMessage.get(attachment.messageId) ?? []), view]);
  }
  return messages.map((message) => ({ ...message, attachments: byMessage.get(message.id) ?? [] }));
}
