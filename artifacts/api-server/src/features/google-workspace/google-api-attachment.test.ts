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

describe("GoogleWorkspaceReadClient attachment access", () => {
  it("reads attachment bytes from Gmail without mutation", async () => {
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
        if (url.includes("/messages/m1/attachments/a1")) {
          return response({
            data: Buffer.from([1, 2, 3]).toString("base64url"),
            size: 3,
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    await expect(
      client.getAttachment!({ messageId: "m1", attachmentId: "a1" }),
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));

    expect(requests.some((url) =>
      url.includes("/gmail/v1/users/me/messages/m1/attachments/a1"),
    )).toBe(true);
  });

  it("rejects blank source identities before making a request", async () => {
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async () => {
        throw new Error("should not fetch");
      },
    });

    await expect(
      client.getAttachment!({ messageId: "", attachmentId: "a1" }),
    ).rejects.toMatchObject({ code: "GOOGLE_WORKSPACE_ATTACHMENT_ID_INVALID" });
  });
});
