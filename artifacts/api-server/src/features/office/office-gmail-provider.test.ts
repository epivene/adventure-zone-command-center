import { describe, expect, it, vi } from "vitest";

import { OfficeGmailProvider } from "./office-gmail-provider";

function decodeRaw(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

describe("Office Gmail provider", () => {
  it("creates an HTML MIME draft without accepting a From address", async () => {
    const createGmailDraft = vi.fn(async ({ raw }: { raw: string }) => ({
      draftId: "gmail-draft-1",
      messageId: "gmail-message-1",
      threadId: null,
      raw,
    }));
    const provider = new OfficeGmailProvider({
      createGmailDraft,
      updateGmailDraft: vi.fn(),
    });

    await provider.createOrUpdateDraft({
      gmailDraftId: null,
      to: "gm@example.com",
      subject: "Adventure Zone visit",
      html: "<html><body><strong>Hello</strong></body></html>",
    });

    const mime = decodeRaw(createGmailDraft.mock.calls[0]![0].raw);
    expect(mime).toContain("Content-Type: text/html; charset=UTF-8");
    expect(mime).toContain("To: gm@example.com");
    expect(mime).not.toContain("From:");
    const encodedBody = mime.split("\r\n\r\n")[1]!.replaceAll("\r\n", "");
    expect(Buffer.from(encodedBody, "base64").toString("utf8")).toContain(
      "<strong>Hello</strong>",
    );
  });

  it("updates the existing Gmail draft and rejects header injection", async () => {
    const updateGmailDraft = vi.fn().mockResolvedValue({
      draftId: "gmail-draft-1",
      messageId: "gmail-message-2",
      threadId: "thread-1",
    });
    const provider = new OfficeGmailProvider({
      createGmailDraft: vi.fn(),
      updateGmailDraft,
    });

    await provider.createOrUpdateDraft({
      gmailDraftId: "gmail-draft-1",
      to: "gm@example.com",
      subject: "Updated subject",
      html: "<p>Updated</p>",
    });
    expect(updateGmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: "gmail-draft-1" }),
    );
    await expect(
      provider.createOrUpdateDraft({
        gmailDraftId: null,
        to: "gm@example.com",
        subject: "Okay\r\nBcc: stranger@example.com",
        html: "<p>No</p>",
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_WORKSPACE_GMAIL_HEADER_INVALID" });
  });

  it("classifies ambiguous provider results for manual review", async () => {
    const provider = new OfficeGmailProvider({
      createGmailDraft: vi.fn().mockRejectedValue(
        Object.assign(new Error("timeout"), {
          code: "GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN",
        }),
      ),
      updateGmailDraft: vi.fn(),
    });

    await expect(
      provider.createOrUpdateDraft({
        gmailDraftId: null,
        to: "gm@example.com",
        subject: "Subject",
        html: "<p>Hello</p>",
      }),
    ).rejects.toMatchObject({ code: "GMAIL_DRAFT_OUTCOME_UNKNOWN" });
  });

  it("rechecks delivery guards immediately before sending a provider draft", async () => {
    const order: string[] = [];
    const provider = new OfficeGmailProvider(
      {
        createGmailDraft: vi.fn(),
        updateGmailDraft: vi.fn(),
      },
      {
        sendGmailDraft: vi.fn(async () => {
          order.push("provider");
          return { messageId: "sent-message-1", threadId: "thread-1" };
        }),
      },
    );
    await expect(
      provider.sendDraft({
        draftId: "gmail-draft-1",
        beforeSend: async () => {
          order.push("guard");
        },
      }),
    ).resolves.toMatchObject({
      messageId: "sent-message-1",
      threadId: "thread-1",
    });
    expect(order).toEqual(["guard", "provider"]);
  });
});
