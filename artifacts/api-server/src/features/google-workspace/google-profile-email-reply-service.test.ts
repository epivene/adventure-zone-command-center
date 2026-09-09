import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

import { GoogleProfileEmailReplyService } from "./google-profile-email-reply-service";
import type { ArchivedProfileEmailThread } from "./google-profile-email-archive-types";

function conversation(): ArchivedProfileEmailThread {
  return {
    id: "conversation-1",
    organizationId: "org-1",
    contactId: "contact-1",
    subject: "County fair",
    originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-old",
    providerThreadIds: ["thread-old"],
    archiveState: "complete",
    lastSyncedAt: "2026-09-09T12:00:00.000Z",
    lastGmailErrorCode: null,
    messages: [{
      id: "saved-1",
      gmailMessageId: "message-old",
      gmailThreadId: "thread-old",
      internalDateMs: 1,
      from: "Fair Office <fair@example.org>",
      to: "zone@example.com",
      cc: "",
      subject: "County fair",
      date: "",
      direction: "incoming",
      bodyText: "Can you attend?",
      attachments: [],
    }],
  };
}

describe("GoogleProfileEmailReplyService", () => {
  it("sends to the saved participant and attaches the sent message to the same app conversation", async () => {
    const sendGmailMessage = vi.fn(async () => ({
      messageId: "message-new",
      threadId: "thread-new",
    }));
    const upsertThread = vi.fn(async (input) => ({
      ...conversation(),
      providerThreadIds: ["thread-old", input.gmailThreadId],
      messages: [
        ...conversation().messages,
        {
          id: "saved-new",
          ...input.messages[0],
        },
      ],
    }));
    const service = new GoogleProfileEmailReplyService({
      connection: {
        createGmailDeliveryClient: async () => ({
          connectionId: "connection-1",
          client: { sendGmailMessage } as never,
        }),
      },
      archive: {
        getForOrganization: async () => conversation(),
        upsertThread,
      } as never,
      now: () => new Date("2026-09-09T13:00:00.000Z"),
    });

    const result = await service.reply({
      organizationId: "org-1",
      conversationId: "conversation-1",
      bodyText: "Yes, we are available.",
      actorId: "owner",
    });

    expect(sendGmailMessage).toHaveBeenCalledWith({
      raw: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      threadId: "thread-old",
    });
    const raw = sendGmailMessage.mock.calls[0]![0].raw;
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("To: fair@example.org");
    expect(mime).toContain("Subject: Re: County fair");
    expect(upsertThread).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: "conversation-1",
      gmailThreadId: "thread-new",
      archiveState: "complete",
      messages: [expect.objectContaining({
        gmailMessageId: "message-new",
        gmailThreadId: "thread-new",
        direction: "outgoing",
        bodyText: "Yes, we are available.",
      })],
    }));
    expect(result.conversation.id).toBe("conversation-1");
  });

  it("starts one replacement Gmail thread when the original Gmail thread is gone", async () => {
    const sendGmailMessage = vi.fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND"), {
          code: "GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND",
        }),
      )
      .mockResolvedValueOnce({
        messageId: "message-new",
        threadId: "thread-replacement",
      });
    const service = new GoogleProfileEmailReplyService({
      connection: {
        createGmailDeliveryClient: async () => ({
          connectionId: "connection-1",
          client: { sendGmailMessage } as never,
        }),
      },
      archive: {
        getForOrganization: async () => conversation(),
        upsertThread: async () => conversation(),
      } as never,
    });

    await service.reply({
      organizationId: "org-1",
      conversationId: "conversation-1",
      bodyText: "Following up.",
      actorId: "owner",
    });

    expect(sendGmailMessage).toHaveBeenCalledTimes(2);
    expect(sendGmailMessage.mock.calls[0]![0].threadId).toBe("thread-old");
    expect(sendGmailMessage.mock.calls[1]![0]).not.toHaveProperty("threadId");
  });

  it("rejects blank replies and cross-profile conversations before Gmail is called", async () => {
    const createGmailDeliveryClient = vi.fn();
    const service = new GoogleProfileEmailReplyService({
      connection: { createGmailDeliveryClient },
      archive: {
        getForOrganization: async () => null,
      } as never,
    });

    await expect(service.reply({
      organizationId: "org-2",
      conversationId: "conversation-1",
      bodyText: "Hello",
      actorId: "owner",
    })).rejects.toThrow("GOOGLE_WORKSPACE_PROFILE_EMAIL_NOT_FOUND");
    await expect(service.reply({
      organizationId: "org-1",
      conversationId: "conversation-1",
      bodyText: "   ",
      actorId: "owner",
    })).rejects.toThrow("GOOGLE_WORKSPACE_PROFILE_EMAIL_REPLY_INVALID");
    expect(createGmailDeliveryClient).not.toHaveBeenCalled();
  });
});
