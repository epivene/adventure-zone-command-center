import { describe, expect, it, vi } from "vitest";

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

  it("reads the labels attached anywhere in a Gmail thread", async () => {
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async (input) => {
        const url = String(input);
        if (url === "https://oauth2.googleapis.com/token") {
          return json({ access_token: "access-token", expires_in: 3600 });
        }
        if (url.includes("/threads/thread-1?")) {
          return json({
            id: "thread-1",
            messages: [
              { id: "message-1", labelIds: ["Label_old", "SENT"] },
              { id: "message-2", labelIds: ["Label_target", "INBOX", "UNREAD"] },
            ],
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    await expect(client.getThreadLabelIds?.("thread-1")).resolves.toEqual([
      "INBOX",
      "Label_old",
      "Label_target",
      "SENT",
      "UNREAD",
    ]);
  });

  it("deletes a Gmail label without deleting any messages", async () => {
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
        if (url.endsWith("/labels/Label_old") && init?.method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    await expect(client.deleteLabel?.("Label_old")).resolves.toBeUndefined();

    expect(requests.some((request) => request.url.includes("/messages/"))).toBe(false);
    expect(requests.some((request) => request.url.includes("/threads/"))).toBe(false);
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


describe("Gmail label lookup efficiency", () => {
  it("coalesces concurrent reads, caches copies, and invalidates after a label mutation", async () => {
    let reads = 0;
    const client = createGoogleWorkspaceReadClient({
      environment, refreshToken: "one-account",
      fetcher: async (input, init) => {
        if (String(input).includes("oauth2")) return json({ access_token: "token" });
        if (init?.method === "POST") return json({ id: "new", name: "New label", type: "user" });
        reads++;
        return json({ labels: [{ id: "old", name: "Original", type: "user" }] });
      },
    });
    const [a, b] = await Promise.all([client.listLabels(), client.listLabels()]);
    expect(reads).toBe(1);
    a[0].name = "Modified by caller";
    expect(b[0].name).toBe("Original");
    expect((await client.listLabels())[0].name).toBe("Original");
    expect(reads).toBe(1);
    await client.createLabel!("New label");
    await client.listLabels();
    expect(reads).toBe(2);
  });

  it("does not cache failed reads and preserves Gmail Retry-After", async () => {
    let reads = 0;
    const client = createGoogleWorkspaceReadClient({
      environment, refreshToken: "one-account",
      fetcher: async input => {
        if (String(input).includes("oauth2")) return json({ access_token: "token" });
        reads++;
        if (reads === 1) return new Response("{}", { status: 429, headers: { "Retry-After": "95" } });
        return json({ labels: [] });
      },
    });
    await expect(client.listLabels()).rejects.toMatchObject({ code: "GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED", retryAfterSeconds: 95 });
    await expect(client.listLabels()).resolves.toEqual([]);
    expect(reads).toBe(2);
  });

  it("keeps account caches separate", async () => {
    const make = (id: string) => createGoogleWorkspaceReadClient({
      environment, refreshToken: id,
      fetcher: async input => String(input).includes("oauth2") ? json({ access_token: id }) : json({ labels: [{ id, name: id }] }),
    });
    expect((await make("a").listLabels())[0].id).toBe("a");
    expect((await make("b").listLabels())[0].id).toBe("b");
  });
});

it("expires cached label lists after 30 seconds", async () => {
  let now = 100_000;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  let reads = 0;
  try {
    const client = createGoogleWorkspaceReadClient({ environment, refreshToken: "account",
      fetcher: async input => {
        if (String(input).includes("oauth2")) return json({ access_token: "token", expires_in: 3600 });
        reads++;
        return json({ labels: [] });
      },
    });
    await client.listLabels();
    now += 29_999;
    await client.listLabels();
    expect(reads).toBe(1);
    now++;
    await client.listLabels();
    expect(reads).toBe(2);
  } finally { clock.mockRestore(); }
});
