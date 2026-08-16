import { describe, expect, it, vi } from "vitest";
import { createConversationForActor, sendMessageForActor } from "./communication-service";

function stores() {
  const communication = {
    createConversation: vi.fn(async (input: any) => ({ id: "conversation-1", ...input })),
    sendMessage: vi.fn(async (input: any) => ({ id: "message-1", ...input })),
    listMemberLegIds: vi.fn(async () => ["leg-a", "leg-b"]),
  };
  const notifications = { create: vi.fn(async (input: any) => input) };
  return { communication, notifications };
}

describe("manager communication service", () => {
  it("forces a manager-created direct/group thread to include their own leg", async () => {
    const { communication } = stores();
    await createConversationForActor(communication as any, { kind: "manager", legId: "leg-a", name: "Leg A" }, {
      kind: "direct",
      title: null,
      memberLegIds: ["leg-b"],
    });
    expect(communication.createConversation).toHaveBeenCalledWith(expect.objectContaining({ memberLegIds: ["leg-a", "leg-b"] }));
  });

  it("does not let a manager create an all-managers channel", async () => {
    const { communication } = stores();
    await expect(createConversationForActor(communication as any, { kind: "manager", legId: "leg-a", name: null }, {
      kind: "all_managers",
      title: "Fake global",
      memberLegIds: [],
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sends messages using the authenticated manager actor and not a supplied identity", async () => {
    const { communication, notifications } = stores();
    await sendMessageForActor(communication as any, notifications as any, { kind: "manager", legId: "leg-a", name: "Leg A" }, {
      conversationId: "conversation-1",
      body: "Ready to swap",
      clientMutationId: "00000000-0000-4000-8000-000000000001",
    });
    expect(communication.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ actor: { kind: "manager", legId: "leg-a", name: "Leg A" } }));
  });

  it("creates FYI notifications for other manager participants, not the sender", async () => {
    const { communication, notifications } = stores();
    await sendMessageForActor(communication as any, notifications as any, { kind: "manager", legId: "leg-a", name: "Leg A" }, {
      conversationId: "conversation-1",
      body: "Ready to swap",
      clientMutationId: "00000000-0000-4000-8000-000000000002",
    });
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create).toHaveBeenCalledWith(expect.objectContaining({ legId: "leg-b", kind: "message", actionRequired: false }));
  });

  it("admin messages can notify every manager participant", async () => {
    const { communication, notifications } = stores();
    await sendMessageForActor(communication as any, notifications as any, { kind: "admin", name: "Admin" }, {
      conversationId: "conversation-1",
      body: "Meetup approved",
      clientMutationId: "00000000-0000-4000-8000-000000000003",
    });
    expect(notifications.create).toHaveBeenCalledTimes(2);
  });
});
