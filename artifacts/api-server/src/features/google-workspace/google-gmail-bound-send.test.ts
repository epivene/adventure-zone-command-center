import { describe, it, expect, vi } from "vitest";
import { createGoogleGmailDeliveryClient } from "./google-gmail-delivery-client";
import { buildGmailRawMessage } from "./google-api-client";
const environment = {
  clientId: "test",
  clientSecret: "test",
  redirectUri: "https://example.com",
  appOrigin: "https://example.com",
  tokenEncryptionKey: new Uint8Array(32),
};
describe("Gmail atomic reviewed draft send", () => {
  it("uses one consuming drafts.send with exact MIME, preserving draft/thread and rechecking after OAuth", async () => {
    const order: string[] = [];
    const fetcher = vi.fn(async (url: any, init: any) => {
      if (String(url).includes("oauth2")) {
        order.push("token");
        return Response.json({ access_token: "token", expires_in: 3600 });
      }
      order.push("send");
      const body = JSON.parse(init.body);
      expect(body).toMatchObject({
        id: "existing-draft",
        message: { threadId: "thread" },
      });
      const mime = Buffer.from(body.message.raw, "base64url").toString();
      expect(mime).toContain("To: reviewed@example.com");
      expect(
        Buffer.from(
          mime.split("\r\n\r\n")[1].replace(/\r\n/g, ""),
          "base64",
        ).toString(),
      ).toBe("Reviewed content");
      return Response.json({ id: "actual-sent", threadId: "thread" });
    });
    const client = createGoogleGmailDeliveryClient({
      environment,
      refreshToken: "fake",
      fetcher,
    });
    await client.sendGmailDraft({
      draftId: "existing-draft",
      raw: buildGmailRawMessage({
        to: "reviewed@example.com",
        subject: "Reviewed subject",
        body: "Reviewed content",
      }),
      threadId: "thread",
      beforeSend: async () => {
        order.push("verify");
      },
    });
    expect(order).toEqual(["token", "verify", "send"]);
    expect(fetcher.mock.calls[1][0]).toMatch(/\/drafts\/send$/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not send if final recheck fails and does not retry unknown HTTP outcomes", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ access_token: "token", expires_in: 3600 }),
    );
    const client = createGoogleGmailDeliveryClient({
      environment,
      refreshToken: "fake",
      fetcher,
    });
    await expect(
      client.sendGmailDraft({
        draftId: "draft",
        raw: "YWJj",
        beforeSend: async () => {
          throw new Error("ASSISTANT_SOURCES_CHANGED");
        },
      }),
    ).rejects.toMatchObject({ code: "OUTREACH_SEND_RECHECK_FAILED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValueOnce(
      Response.json({ error: "server failed" }, { status: 503 }),
    );
    await expect(
      client.sendGmailDraft({ draftId: "draft", raw: "YWJj" }),
    ).rejects.toMatchObject({
      code: "GOOGLE_WORKSPACE_GMAIL_SEND_OUTCOME_UNCERTAIN",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
