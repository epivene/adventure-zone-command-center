import type { ConversationKind, MessageActor } from "./communication-repository";

export interface CommunicationServiceStore {
  createConversation(input: { kind: ConversationKind; title: string | null; memberLegIds: string[] }): Promise<any>;
  sendMessage(input: { conversationId: string; actor: MessageActor; body: string; clientMutationId: string }): Promise<any>;
  listMemberLegIds(conversationId: string): Promise<string[]>;
}

export interface NotificationServiceStore {
  create(input: {
    legId: string;
    kind: "message";
    title: string;
    body: string | null;
    actionRequired: false;
    sourceType: "conversation";
    sourceId: string;
  }): Promise<any>;
}

export async function createConversationForActor(
  store: CommunicationServiceStore,
  actor: MessageActor,
  input: { kind: ConversationKind; title: string | null; memberLegIds: string[] },
) {
  if (actor.kind === "manager" && input.kind === "all_managers") {
    throw Object.assign(new Error("Only admin can create the All Managers channel"), { code: "FORBIDDEN" });
  }
  const memberLegIds = actor.kind === "manager"
    ? [...new Set([actor.legId, ...input.memberLegIds])]
    : [...new Set(input.memberLegIds)];
  return store.createConversation({ ...input, memberLegIds });
}

export async function sendMessageForActor(
  communication: CommunicationServiceStore,
  notifications: NotificationServiceStore,
  actor: MessageActor,
  input: { conversationId: string; body: string; clientMutationId: string },
) {
  const message = await communication.sendMessage({ ...input, actor });
  const memberLegIds = await communication.listMemberLegIds(input.conversationId);
  const recipients = actor.kind === "manager"
    ? memberLegIds.filter((legId) => legId !== actor.legId)
    : memberLegIds;
  for (const legId of recipients) {
    await notifications.create({
      legId,
      kind: "message",
      title: "New message",
      body: actor.name ? `${actor.name}: ${input.body.slice(0, 180)}` : input.body.slice(0, 180),
      actionRequired: false,
      sourceType: "conversation",
      sourceId: input.conversationId,
    });
  }
  return message;
}
