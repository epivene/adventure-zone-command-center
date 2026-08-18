import type { MessageActor } from "./communication-repository";

type CommunicationStore = {
  sendMessage(input: {
    conversationId: string;
    actor: MessageActor;
    body: string;
    clientMutationId: string;
  }): Promise<any>;
  listMemberLegIds(conversationId: string): Promise<string[]>;
};

type AcknowledgmentStore = {
  recordAdminOperationalChange(input: {
    actionId: string;
    legIds: string[];
    actor: string;
    sourceType: string;
    sourceId: string | null;
    title: string;
    items: Array<{ label: string; beforeValue: string | null; afterValue: string | null }>;
  }): Promise<any[]>;
};

export async function sendAdminMessageWithOptionalAcknowledgment({
  communication,
  acknowledgments,
  actor,
  input,
}: {
  communication: CommunicationStore;
  acknowledgments: AcknowledgmentStore;
  actor: Extract<MessageActor, { kind: "admin" }>;
  input: {
    conversationId: string;
    body: string;
    clientMutationId: string;
    requireAcknowledgment: boolean;
    acknowledgmentTitle: string | null;
  };
}) {
  const message = await communication.sendMessage({
    conversationId: input.conversationId,
    actor,
    body: input.body,
    clientMutationId: input.clientMutationId,
  });

  if (!input.requireAcknowledgment) {
    return { message, acknowledgments: [] };
  }

  const legIds = [...new Set(await communication.listMemberLegIds(input.conversationId))];
  const rows = await acknowledgments.recordAdminOperationalChange({
    actionId: input.clientMutationId,
    legIds,
    actor: actor.name || "Admin",
    sourceType: "manager_message",
    sourceId: message.id,
    title: input.acknowledgmentTitle?.trim() || "Message from Admin",
    items: [{ label: "Message", beforeValue: null, afterValue: input.body }],
  });

  return { message, acknowledgments: rows };
}
