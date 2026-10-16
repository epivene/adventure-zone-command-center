import type { GoogleWorkspaceReadClient } from "./google-api-types";

export function boundedArchiveClient(
  client: GoogleWorkspaceReadClient,
  attempt: number,
): GoogleWorkspaceReadClient {
  let selected: string | null = null,
    downloaded = false;
  const handles = new Map<string, string>();
  return {
    ...client,
    getThreadDetail: async (id) => {
      const detail = await client.getSyncThreadDetail!(id);
      const messages = detail.messages
        .filter(
          (m) =>
            !m.labelIds?.includes("DRAFT") && !m.labelIds?.includes("TRASH"),
        )
        .map((m) => ({
          ...m,
          attachments: m.attachments.map((part, index) => {
            // This ordinal is scoped to an immutable Gmail message, never to a thread.
            // Archive identity is deliberately distinct from its transient download token.
            const attachmentId =
              part.partId !== undefined
                ? `com-mime-id:${part.partId}`
                : `com-mime-part:${index}`;
            handles.set(`${m.id}\0${attachmentId}`, part.attachmentId);
            return { ...part, attachmentId };
          }),
        }));
      // Stable message/part order, independent of changing provider download handles.
      // Persisted attempt count advances even when an attachment is unavailable.
      const parts = messages.flatMap((m) =>
        m.attachments.map((a) => `${m.id}\0${a.attachmentId}`),
      );
      selected = parts.length ? parts[attempt % parts.length] : null;
      return { ...detail, messages };
    },
    getAttachment: async (input) => {
      if (
        downloaded ||
        `${input.messageId}\0${input.attachmentId}` !== selected
      )
        throw Error("GOOGLE_WORKSPACE_ATTACHMENT_BATCH_DEFERRED");
      downloaded = true;
      const handle = handles.get(`${input.messageId}\0${input.attachmentId}`);
      if (!handle) throw Error("GOOGLE_WORKSPACE_ATTACHMENT_NOT_FOUND");
      return client.getSyncAttachment!({ ...input, attachmentId: handle });
    },
  };
}
