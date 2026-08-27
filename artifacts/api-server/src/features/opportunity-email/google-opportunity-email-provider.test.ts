import { describe, expect, it, vi } from "vitest";

import { GoogleOpportunityEmailProvider } from "./google-opportunity-email-provider";

function connection() {
  return {
    createGmailDraftClient: vi.fn(async () => ({
      connectionId: "connection-1",
      client: {
        createGmailDraft: vi.fn(async () => ({ draftId: "gmail-draft-1", messageId: "gmail-message-1" })),
      },
    })),
    createGmailDeliveryClient: vi.fn(async () => ({
      connectionId: "connection-1",
      client: {
        updateGmailDraft: vi.fn(async () => ({ draftId: "gmail-draft-1", messageId: "gmail-message-2", threadId: "thread-1" })),
        sendGmailDraft: vi.fn(async () => ({ messageId: "gmail-sent-1", threadId: "thread-1" })),
      },
    })),
  };
}

describe("GoogleOpportunityEmailProvider", () => {
  it("creates a real Gmail draft from To, subject, and body", async () => {
    const connected = connection();
    const provider = new GoogleOpportunityEmailProvider(connected as any, { now: () => new Date("2026-08-27T18:30:00.000Z") });

    const result = await provider.createDraft({ to: "fair@example.com", subject: "Sample Fair", body: "Hello" });

    expect(result).toEqual({ draftId: "gmail-draft-1", messageId: "gmail-message-1", threadId: null });
    const client = (await connected.createGmailDraftClient.mock.results[0]!.value).client;
    expect(client.createGmailDraft).toHaveBeenCalledWith({ raw: expect.stringMatching(/^[A-Za-z0-9_-]+$/) });
  });

  it("updates the same Gmail draft and sends only through the delivery client", async () => {
    const connected = connection();
    const provider = new GoogleOpportunityEmailProvider(connected as any, { now: () => new Date("2026-08-27T18:30:00.000Z") });

    const updated = await provider.updateDraft({ draftId: "gmail-draft-1", to: "fair@example.com", subject: "Edited", body: "Edited body" });
    expect(updated).toEqual({ draftId: "gmail-draft-1", messageId: "gmail-message-2", threadId: "thread-1" });

    const sent = await provider.sendDraft({ draftId: "gmail-draft-1" });
    expect(sent).toEqual({ messageId: "gmail-sent-1", threadId: "thread-1", sentAt: new Date("2026-08-27T18:30:00.000Z") });
  });

  it("fails when Google is not connected instead of fabricating a draft", async () => {
    const connected = connection();
    connected.createGmailDraftClient.mockResolvedValueOnce(null as any);
    const provider = new GoogleOpportunityEmailProvider(connected as any);

    await expect(provider.createDraft({ to: "fair@example.com", subject: "Sample", body: "Body" }))
      .rejects.toThrow("GOOGLE_WORKSPACE_NOT_CONNECTED");
  });

  it("does not claim an uncertain send was reconciled without verified evidence", async () => {
    const provider = new GoogleOpportunityEmailProvider(connection() as any);
    await expect(provider.reconcileSend({ draftId: "gmail-draft-1" })).resolves.toBeNull();
  });
});
