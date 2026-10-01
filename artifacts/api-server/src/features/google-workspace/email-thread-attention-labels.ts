import type { GoogleGmailLabelMutationClient } from "./google-api-types";
import type { AttentionState } from "./email-thread-attention-types";
export async function applyAttentionLabels(
  gmail: GoogleGmailLabelMutationClient,
  input: {
    threadId: string;
    profileLabelId: string;
    oldProfileLabelIds: string[];
    state: AttentionState;
    archive: boolean;
  },
  guard: () => Promise<void>,
): Promise<string[]> {
  await guard();
  const find = async () => {
    const matches = (await gmail.listLabels()).filter(
      (l) => l.type === "user" && l.name === "Needs Attention",
    );
    if (matches.length > 1)
      throw new Error("GOOGLE_WORKSPACE_GMAIL_LABEL_CONFLICT");
    return matches[0];
  };
  let label = await find();
  if (!label && input.state !== "resolved") {
    try {
      label = await gmail.createLabel("Needs Attention");
    } catch (error) {
      label = await find();
      if (!label) throw error;
    }
  }
  await guard();
  await gmail.modifyThreadLabels({
    threadId: input.threadId,
    addLabelIds: [
      input.profileLabelId,
      ...(input.state !== "resolved" && label ? [label.id] : []),
    ],
    removeLabelIds: [],
  });
  // Gmail has no source-version CAS; keep Inbox when a detectable new message arrived.
  await guard();
  const attached = new Set(await gmail.getThreadLabelIds(input.threadId));
  if (
    !attached.has(input.profileLabelId) ||
    (input.state !== "resolved" && (!label || !attached.has(label.id)))
  )
    throw new Error("GOOGLE_WORKSPACE_ATTENTION_LABEL_NOT_VERIFIED");
  const remove = [
    ...new Set([
      ...input.oldProfileLabelIds.filter(
        (id) => id !== input.profileLabelId && attached.has(id),
      ),
      ...(input.state === "resolved" && label && attached.has(label.id)
        ? [label.id]
        : []),
      ...(input.archive && attached.has("INBOX") ? ["INBOX"] : []),
    ]),
  ];
  await guard();
  if (remove.length)
    await gmail.modifyThreadLabels({
      threadId: input.threadId,
      addLabelIds: [],
      removeLabelIds: remove,
    });
  return remove;
}
