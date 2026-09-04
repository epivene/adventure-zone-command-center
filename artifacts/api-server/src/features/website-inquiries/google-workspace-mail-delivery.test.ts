import { describe, expect, it, vi } from "vitest";

import { createGoogleWorkspaceMailDelivery } from "./google-workspace-mail-delivery";

describe("Google Workspace website inquiry mail delivery", () => {
  it("sends through the connected Gmail account without using SMTP", async () => {
    const sendGmailMessage = vi.fn(async (_input: { raw: string }) => ({ messageId: "gmail-message-1", threadId: null }));
    const connection = {
      createGmailDeliveryClient: vi.fn(async () => ({
        connectionId: "google-connection-1",
        client: { sendGmailMessage },
      })),
    };
    const smtpFallback = vi.fn();
    const delivery = createGoogleWorkspaceMailDelivery(connection, smtpFallback);

    await expect(delivery.send({
      to: "owner@example.com",
      subject: "New website inquiry",
      body: "Open the secure inbox.",
    })).resolves.toEqual({ messageId: "gmail-message-1" });

    expect(smtpFallback).not.toHaveBeenCalled();
    const raw = sendGmailMessage.mock.calls[0]?.[0].raw ?? "";
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toContain("To: owner@example.com\r\n");
    expect(mime).toContain("Subject: New website inquiry\r\n");
    expect(mime).toContain(Buffer.from("Open the secure inbox.", "utf8").toString("base64"));
  });

  it("uses the existing SMTP delivery only when no Google account is connected", async () => {
    const smtpSend = vi.fn(async () => ({ messageId: "smtp-message-1" }));
    const smtpFallback = vi.fn(() => ({ send: smtpSend }));
    const delivery = createGoogleWorkspaceMailDelivery(
      { createGmailDeliveryClient: vi.fn(async () => null) },
      smtpFallback,
    );
    const input = { to: "owner@example.com", subject: "Inquiry", body: "Body" };

    await expect(delivery.send(input)).resolves.toEqual({ messageId: "smtp-message-1" });
    expect(smtpSend).toHaveBeenCalledWith(input);
  });
});
