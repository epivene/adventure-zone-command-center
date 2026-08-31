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
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

describe("GoogleWorkspaceReadClient.listMessagePage", () => {
  it("passes a bounded Gmail search query to the messages endpoint", async () => {
    const requests: string[] = [];
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async (input) => {
        const url = String(input);
        requests.push(url);
        if (url === "https://oauth2.googleapis.com/token") {
          return response({ access_token: "access-token", expires_in: 3600 });
        }
        if (url.includes("/messages")) {
          return response({ messages: [], nextPageToken: null });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    await client.listMessagePage?.({
      maxResults: 250,
      pageToken: null,
      query: "in:sent after:2025/12/31 before:2027/01/01 -in:trash -in:spam",
    } as never);

    const request = new URL(requests.find((url) => url.includes("/messages"))!);
    expect(request.searchParams.get("q")).toBe(
      "in:sent after:2025/12/31 before:2027/01/01 -in:trash -in:spam",
    );
  });

  it("rejects an empty or excessively long search query", async () => {
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async () => response({ access_token: "access-token", expires_in: 3600 }),
    });

    await expect(client.listMessagePage?.({
      maxResults: 25,
      query: "   ",
    } as never)).rejects.toMatchObject({
      code: "GOOGLE_WORKSPACE_MESSAGE_QUERY_INVALID",
    });
    await expect(client.listMessagePage?.({
      maxResults: 25,
      query: "x".repeat(2_001),
    } as never)).rejects.toMatchObject({
      code: "GOOGLE_WORKSPACE_MESSAGE_QUERY_INVALID",
    });
  });
});
