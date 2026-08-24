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

describe("GoogleWorkspaceReadClient Gmail metadata discovery", () => {
  it("lists newest message refs with spam and trash included and enforces the requested limit", async () => {
    const requests: string[] = [];
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url === "https://oauth2.googleapis.com/token") {
          return response({ access_token: "token", expires_in: 3600 });
        }
        if (url.includes("/gmail/v1/users/me/messages") && !url.includes("/messages/")) {
          return response({
            messages: [
              { id: "m1", threadId: "t1" },
              { id: "m2", threadId: "t2" },
              { id: "m3", threadId: "t3" },
            ],
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    await expect(client.listRecentMessageRefs!(2)).resolves.toEqual([
      { id: "m1", threadId: "t1" },
      { id: "m2", threadId: "t2" },
    ]);

    const listUrl = new URL(requests.find((url) => url.includes("/messages?")) as string);
    expect(listUrl.searchParams.get("includeSpamTrash")).toBe("true");
    expect(listUrl.searchParams.get("maxResults")).toBe("2");
  });

  it("returns safe metadata headers and attachment presence without requesting a full message body", async () => {
    const requests: string[] = [];
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url === "https://oauth2.googleapis.com/token") {
          return response({ access_token: "token", expires_in: 3600 });
        }
        if (url.includes("/messages/m1?")) {
          return response({
            id: "m1",
            threadId: "t1",
            labelIds: ["INBOX", "IMPORTANT"],
            internalDate: "1787510000000",
            snippet: "Convention application follow up",
            payload: {
              headers: [
                { name: "From", value: "Fair Office <fair@example.org>" },
                { name: "To", value: "zone@example.com" },
                { name: "Cc", value: "helper@example.org" },
                { name: "Subject", value: "County Fair 2027" },
                { name: "Date", value: "Sun, 23 Aug 2026 10:00:00 -0600" },
              ],
              parts: [
                { mimeType: "text/plain", body: { size: 12 } },
                { filename: "application.pdf", body: { attachmentId: "a1", size: 200 } },
              ],
            },
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    await expect(client.getMessageMetadata!("m1")).resolves.toEqual({
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX", "IMPORTANT"],
      internalDateMs: 1787510000000,
      snippet: "Convention application follow up",
      headers: {
        from: "Fair Office <fair@example.org>",
        to: "zone@example.com",
        cc: "helper@example.org",
        subject: "County Fair 2027",
        date: "Sun, 23 Aug 2026 10:00:00 -0600",
      },
      hasAttachments: true,
    });

    const metadataUrl = new URL(requests.find((url) => url.includes("/messages/m1?")) as string);
    expect(metadataUrl.searchParams.get("format")).toBe("metadata");
    expect(metadataUrl.searchParams.getAll("metadataHeaders")).toEqual([
      "From",
      "To",
      "Cc",
      "Subject",
      "Date",
    ]);
    expect(metadataUrl.searchParams.get("format")).not.toBe("full");
  });
});
