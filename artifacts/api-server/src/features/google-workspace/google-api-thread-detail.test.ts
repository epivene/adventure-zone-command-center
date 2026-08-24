import { describe, expect, it } from "vitest";

import { createGoogleWorkspaceReadClient } from "./google-api-client";
import type { GoogleWorkspaceEnvironment } from "./google-workspace-env";

const environment: GoogleWorkspaceEnvironment = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://api.example.com/api/google-workspace/oauth/callback",
  appOrigin: "https://app.example.com",
  tokenEncryptionKey: new Uint8Array(Buffer.alloc(32, 3)),
};

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const b64url = (value: string) =>
  Buffer.from(value, "utf8").toString("base64url");

describe("GoogleWorkspaceReadClient thread detail", () => {
  it("returns chronological readable messages and attachment metadata from a read-only full-thread request", async () => {
    const requests: string[] = [];
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async (input, init) => {
        const url = String(input);
        requests.push(url);
        if (url === "https://oauth2.googleapis.com/token") {
          return response({ access_token: "token", expires_in: 3600 });
        }
        expect(init?.method).toBeUndefined();
        if (url.includes("/threads/thread-1?")) {
          return response({
            id: "thread-1",
            messages: [
              {
                id: "m2",
                threadId: "thread-1",
                internalDate: "2000",
                labelIds: ["SENT"],
                payload: {
                  mimeType: "multipart/mixed",
                  headers: [
                    { name: "From", value: "zone@example.com" },
                    { name: "To", value: "fair@example.org" },
                    { name: "Subject", value: "Re: County Fair" },
                    { name: "Date", value: "Mon, 24 Aug 2026 10:05:00 -0600" },
                  ],
                  parts: [
                    {
                      mimeType: "text/plain",
                      body: { data: b64url("Thanks, we can attend."), size: 22 },
                    },
                    {
                      filename: "contract.pdf",
                      mimeType: "application/pdf",
                      body: { attachmentId: "attachment-1", size: 12345 },
                    },
                  ],
                },
              },
              {
                id: "m1",
                threadId: "thread-1",
                internalDate: "1000",
                labelIds: ["INBOX"],
                payload: {
                  mimeType: "text/plain",
                  headers: [
                    { name: "From", value: "fair@example.org" },
                    { name: "To", value: "zone@example.com" },
                    { name: "Subject", value: "County Fair" },
                    { name: "Date", value: "Mon, 24 Aug 2026 10:00:00 -0600" },
                  ],
                  body: { data: b64url("Would you like to return next year?"), size: 35 },
                },
              },
            ],
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    await expect(client.getThreadDetail!("thread-1")).resolves.toEqual({
      id: "thread-1",
      subject: "County Fair",
      originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-1",
      messages: [
        {
          id: "m1",
          internalDateMs: 1000,
          from: "fair@example.org",
          to: "zone@example.com",
          cc: "",
          subject: "County Fair",
          date: "Mon, 24 Aug 2026 10:00:00 -0600",
          direction: "incoming",
          bodyText: "Would you like to return next year?",
          attachments: [],
        },
        {
          id: "m2",
          internalDateMs: 2000,
          from: "zone@example.com",
          to: "fair@example.org",
          cc: "",
          subject: "Re: County Fair",
          date: "Mon, 24 Aug 2026 10:05:00 -0600",
          direction: "outgoing",
          bodyText: "Thanks, we can attend.",
          attachments: [
            {
              attachmentId: "attachment-1",
              filename: "contract.pdf",
              mimeType: "application/pdf",
              sizeBytes: 12345,
              messageId: "m2",
            },
          ],
        },
      ],
    });

    const threadUrl = new URL(requests.find((url) => url.includes("/threads/thread-1?"))!);
    expect(threadUrl.searchParams.get("format")).toBe("full");
  });
});
