import { describe, expect, it } from "vitest";

import { createGoogleWorkspaceReadClient } from "./google-api-client";
import type { GoogleWorkspaceEnvironment } from "./google-workspace-env";

const environment: GoogleWorkspaceEnvironment = {
  clientId: "client-id.apps.googleusercontent.com",
  clientSecret: "client-secret",
  redirectUri: "https://api.example.com/api/google-workspace/oauth/callback",
  appOrigin: "https://app.example.com",
  tokenEncryptionKey: new Uint8Array(Buffer.alloc(32, 4)),
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Google Gmail label mutation client", () => {
  it("creates, renames, labels, and archives with exact Gmail requests", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async (input, init) => {
        const url = String(input);
        requests.push({ url, init });
        if (url === "https://oauth2.googleapis.com/token") {
          return json({ access_token: "access-token", expires_in: 3600 });
        }
        if (url.endsWith("/labels") && init?.method === "POST") {
          return json({
            id: "Label_10",
            name: "Z - AdventureZone/Profiles/Elko County Fair",
            type: "user",
          });
        }
        if (url.endsWith("/labels/Label_10") && init?.method === "PATCH") {
          return json({
            id: "Label_10",
            name: "Z - AdventureZone/Profiles/Elko County Fair 2027",
            type: "user",
          });
        }
        if (url.endsWith("/modify")) return json({});
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    await expect(
      client.createLabel?.("Z - AdventureZone/Profiles/Elko County Fair"),
    ).resolves.toMatchObject({ id: "Label_10" });
    await expect(
      client.renameLabel?.({
        labelId: "Label_10",
        name: "Z - AdventureZone/Profiles/Elko County Fair 2027",
      }),
    ).resolves.toMatchObject({ id: "Label_10" });
    await client.modifyThreadLabels?.({
      threadId: "thread-1",
      addLabelIds: ["Label_10", "Label_10"],
      removeLabelIds: ["INBOX", "Label_9"],
    });
    await client.modifyMessageLabels?.({
      messageId: "message-2",
      addLabelIds: ["Label_10"],
      removeLabelIds: [],
    });

    const thread = requests.find((request) => request.url.includes("/threads/"));
    expect(thread?.init?.method).toBe("POST");
    expect(JSON.parse(String(thread?.init?.body))).toEqual({
      addLabelIds: ["Label_10"],
      removeLabelIds: ["INBOX", "Label_9"],
    });
    const message = requests.find((request) => request.url.includes("/messages/"));
    expect(JSON.parse(String(message?.init?.body))).toEqual({
      addLabelIds: ["Label_10"],
      removeLabelIds: [],
    });
  });

  it("rejects a label in both add and remove lists before Gmail is called", async () => {
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async () => {
        throw new Error("Gmail must not be called");
      },
    });

    await expect(client.modifyThreadLabels?.({
      threadId: "thread-1",
      addLabelIds: ["Label_10"],
      removeLabelIds: ["Label_10", "INBOX"],
    })).rejects.toMatchObject({
      code: "GOOGLE_WORKSPACE_GMAIL_LABEL_MUTATION_INVALID",
    });
  });

  it("classifies Gmail rate limits as retryable", async () => {
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async (input) =>
        String(input) === "https://oauth2.googleapis.com/token"
          ? json({ access_token: "access-token", expires_in: 3600 })
          : json({ error: "rateLimitExceeded" }, 429),
    });

    await expect(client.modifyMessageLabels?.({
      messageId: "message-1",
      addLabelIds: ["Label_10"],
      removeLabelIds: [],
    })).rejects.toMatchObject({
      code: "GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED",
    });
  });

  it.each([401, 403])(
    "requires reconnect after Gmail authorization fails with %s",
    async (status) => {
      const client = createGoogleWorkspaceReadClient({
        environment,
        refreshToken: "refresh-token",
        fetcher: async (input) =>
          String(input) === "https://oauth2.googleapis.com/token"
            ? json({ access_token: "access-token", expires_in: 3600 })
            : json(
                status === 403
                  ? { error: { errors: [{ reason: "insufficientPermissions" }] } }
                  : {},
                status,
              ),
      });

      await expect(client.modifyMessageLabels?.({
        messageId: "message-1",
        addLabelIds: ["Label_10"],
        removeLabelIds: [],
      })).rejects.toMatchObject({
        code: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
      });
    },
  );

  it("keeps quota-style Gmail 403 responses retryable without requesting reconnect", async () => {
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async (input) =>
        String(input) === "https://oauth2.googleapis.com/token"
          ? json({ access_token: "access-token", expires_in: 3600 })
          : json({
              error: { errors: [{ reason: "userRateLimitExceeded" }] },
            }, 403),
    });

    await expect(client.modifyMessageLabels?.({
      messageId: "message-1",
      addLabelIds: ["Label_10"],
      removeLabelIds: [],
    })).rejects.toMatchObject({
      code: "GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED",
    });
  });

  it("refreshes once after an unauthorized Gmail mutation", async () => {
    let tokenCalls = 0;
    let mutationCalls = 0;
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async (input) => {
        if (String(input) === "https://oauth2.googleapis.com/token") {
          tokenCalls += 1;
          return json({ access_token: `access-${tokenCalls}`, expires_in: 3600 });
        }
        mutationCalls += 1;
        return mutationCalls === 1 ? json({}, 401) : json({});
      },
    });

    await expect(client.modifyMessageLabels?.({
      messageId: "message-1",
      addLabelIds: ["Label_10"],
      removeLabelIds: [],
    })).resolves.toBeUndefined();
    expect(tokenCalls).toBe(2);
    expect(mutationCalls).toBe(2);
  });
});
