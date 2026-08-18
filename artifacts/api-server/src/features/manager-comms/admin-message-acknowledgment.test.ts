import { describe, expect, it, vi } from "vitest";
import { sendAdminMessageWithOptionalAcknowledgment } from "./admin-message-acknowledgment";

describe("sendAdminMessageWithOptionalAcknowledgment", () => {
  it("creates one acknowledgment per recipient when required", async () => {
    const sendMessage = vi.fn(async () => ({ id: "msg-1" }));
    const listMemberLegIds = vi.fn(async () => ["leg-a", "leg-b", "leg-b"]);
    const recordAdminOperationalChange = vi.fn(async () => []);

    const result = await sendAdminMessageWithOptionalAcknowledgment({
      communication: { sendMessage, listMemberLegIds },
      acknowledgments: { recordAdminOperationalChange },
      actor: { kind: "admin", name: "Admin" },
      input: {
        conversationId: "conv-1",
        body: "Please confirm the new load-in time.",
        clientMutationId: "11111111-1111-4111-8111-111111111111",
        requireAcknowledgment: true,
        acknowledgmentTitle: "Load-in time changed",
      },
    });

    expect(result.message).toEqual({ id: "msg-1" });
    expect(recordAdminOperationalChange).toHaveBeenCalledWith({
      actionId: "11111111-1111-4111-8111-111111111111",
      legIds: ["leg-a", "leg-b"],
      actor: "Admin",
      sourceType: "manager_message",
      sourceId: "msg-1",
      title: "Load-in time changed",
      items: [{ label: "Message", beforeValue: null, afterValue: "Please confirm the new load-in time." }],
    });
  });

  it("does not create acknowledgments for normal messages", async () => {
    const sendMessage = vi.fn(async () => ({ id: "msg-2" }));
    const listMemberLegIds = vi.fn(async () => ["leg-a"]);
    const recordAdminOperationalChange = vi.fn(async () => []);

    await sendAdminMessageWithOptionalAcknowledgment({
      communication: { sendMessage, listMemberLegIds },
      acknowledgments: { recordAdminOperationalChange },
      actor: { kind: "admin", name: "Admin" },
      input: {
        conversationId: "conv-1",
        body: "FYI only.",
        clientMutationId: "22222222-2222-4222-8222-222222222222",
        requireAcknowledgment: false,
        acknowledgmentTitle: null,
      },
    });

    expect(recordAdminOperationalChange).not.toHaveBeenCalled();
  });
});
