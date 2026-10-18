import { describe, expect, it } from "vitest";

import {
  GOOGLE_WORKSPACE_REQUIRED_SCOPES,
  createGoogleWorkspaceReadClient,
} from "./google-api-client";
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

describe("GoogleWorkspaceReadClient", () => {
  it("builds an offline authorization URL isolated to approved least-privilege scopes", () => {
    const client = createGoogleWorkspaceReadClient({
      environment,
      fetcher: async () => new Response(),
    });
    const url = new URL(client.authorizationUrl({ state: "oauth-state" }));

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("state")).toBe("oauth-state");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(
      GOOGLE_WORKSPACE_REQUIRED_SCOPES,
    );
  });

  it("exchanges a code and preserves an existing refresh token when Google omits one", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "existing-refresh-token",
      fetcher: async (input, init) => {
        calls.push({ url: String(input), init });
        return response({
          access_token: "access-token",
          expires_in: 3600,
          scope: GOOGLE_WORKSPACE_REQUIRED_SCOPES.join(" "),
          token_type: "Bearer",
        });
      },
    });

    await expect(client.exchangeCode("authorization-code")).resolves.toEqual({
      refreshToken: "existing-refresh-token",
      scopes: [...GOOGLE_WORKSPACE_REQUIRED_SCOPES],
    });

    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("authorization-code");
    expect(body.get("client_secret")).toBe(environment.clientSecret);
  });

  it("does not invent granted scopes when Google omits the scope field", async () => {
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "existing-refresh-token",
      fetcher: async () =>
        response({
          access_token: "access-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
    });

    await expect(client.exchangeCode("authorization-code")).resolves.toEqual({
      refreshToken: "existing-refresh-token",
      scopes: [],
    });
  });

  it("normalizes account identity, Gmail labels, and paginated calendars", async () => {
    const requests: string[] = [];
    const fetcher = async (input: URL | RequestInfo) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://oauth2.googleapis.com/token") {
        return response({
          access_token: "access-token",
          expires_in: 3600,
          scope: GOOGLE_WORKSPACE_REQUIRED_SCOPES.join(" "),
          token_type: "Bearer",
        });
      }
      if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
        return response({ sub: "google-subject", email: "zone@example.com" });
      }
      if (url === "https://gmail.googleapis.com/gmail/v1/users/me/labels") {
        return response({
          labels: [
            { id: "Label_1", name: "Shows", type: "user" },
            { id: "INBOX", name: "INBOX", type: "system" },
          ],
        });
      }
      if (url.includes("calendarList") && !url.includes("pageToken=")) {
        return response({
          nextPageToken: "next-page",
          items: [
            { id: "calendar-1", summary: "Adventure Zone Calendar", primary: true },
          ],
        });
      }
      if (url.includes("pageToken=next-page")) {
        return response({
          items: [
            {
              id: "zone.pirate.warrior@gmail.com",
              summaryOverride: "Zone Pirate Warrior",
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher,
    });

    await expect(client.accountIdentity()).resolves.toEqual({
      subject: "google-subject",
      email: "zone@example.com",
    });
    await expect(client.listLabels()).resolves.toEqual([
      { id: "Label_1", name: "Shows", type: "user" },
      { id: "INBOX", name: "INBOX", type: "system" },
    ]);
    await expect(client.listCalendars()).resolves.toEqual([
      { id: "calendar-1", summary: "Adventure Zone Calendar", primary: true },
      {
        id: "zone.pirate.warrior@gmail.com",
        summary: "Zone Pirate Warrior",
        primary: false,
      },
    ]);
    expect(requests.filter((url) => url.includes("calendarList"))).toHaveLength(2);
  });

  it("returns one bounded Gmail message page and its next page token", async () => {
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
          return response({
            messages: [
              { id: "m1", threadId: "t1" },
              { id: "m2", threadId: "t2" },
            ],
            nextPageToken: "older-page",
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    });

    await expect(
      client.listMessagePage?.({ maxResults: 250, pageToken: "current-page" }),
    ).resolves.toEqual({
      messages: [
        { id: "m1", threadId: "t1" },
        { id: "m2", threadId: "t2" },
      ],
      nextPageToken: "older-page",
    });

    const gmailRequest = new URL(requests.find((url) => url.includes("/messages"))!);
    expect(gmailRequest.searchParams.get("maxResults")).toBe("250");
    expect(gmailRequest.searchParams.get("pageToken")).toBe("current-page");
    expect(gmailRequest.searchParams.get("includeSpamTrash")).toBe("false");
  });

  it("maps a revoked refresh token to reauthorization required", async () => {
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "revoked-token",
      fetcher: async () => response({ error: "invalid_grant" }, 400),
    });

    await expect(client.accountIdentity()).rejects.toMatchObject({
      code: "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED",
    });
  });

  it("exposes the bounded Gmail and Drive capabilities and no send method", () => {
    const client = createGoogleWorkspaceReadClient({
      environment,
      fetcher: async () => new Response(),
    });

    expect(Object.keys(client).sort()).toEqual([
      "accountIdentity",
      "authorizationUrl",
      "createGmailDraft",
      "createLabel",
      "deleteLabel",
      "downloadDriveFile",
      "driveBackup",
      "exchangeCode",
      "getAttachment",
      "getGmailDraftRaw",
      "getGmailMessageRaw",
      "getMessageMetadata",
      "getSyncAttachment",
      "getSyncThreadDetail",
      "getThreadDetail",
      "getThreadLabelIds",
      "listCalendarEvents",
      "listCalendars",
      "listDriveFiles",
      "listGmailDrafts",
      "listLabels",
      "listMessagePage",
      "listRecentMessageRefs",
      "mailboxSync",
      "modifyMessageLabels",
      "modifyThreadLabels",
      "renameLabel",
      "updateGmailDraft",
    ]);
    expect(Object.keys(client).some((name) => /send/i.test(name))).toBe(false);
    const scopes = GOOGLE_WORKSPACE_REQUIRED_SCOPES as readonly string[];
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.modify");
    expect(scopes).toContain("https://www.googleapis.com/auth/drive.file");
    expect(scopes).not.toContain("https://www.googleapis.com/auth/gmail.readonly");
  });

  it("updates an existing Gmail draft in place", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async (input, init) => {
        calls.push({ url: String(input), init });
        if (String(input) === "https://oauth2.googleapis.com/token") {
          return response({ access_token: "access-token", expires_in: 3600 });
        }
        return response({
          id: "gmail-draft-1",
          message: { id: "gmail-message-2", threadId: "thread-1" },
        });
      },
    });

    await expect(
      client.updateGmailDraft?.({ draftId: "gmail-draft-1", raw: "YWJj" }),
    ).resolves.toEqual({
      draftId: "gmail-draft-1",
      messageId: "gmail-message-2",
      threadId: "thread-1",
    });
    const update = calls.find((call) => call.url.endsWith("/drafts/gmail-draft-1"));
    expect(update?.init?.method).toBe("PUT");
    expect(JSON.parse(String(update?.init?.body))).toEqual({
      message: { raw: "YWJj" },
    });
  });

  it("creates and updates only files addressed through the narrow Drive backup client", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let driveResponseId = 0;
    const client = createGoogleWorkspaceReadClient({
      environment,
      refreshToken: "refresh-token",
      fetcher: async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === "https://oauth2.googleapis.com/token") {
          return response({ access_token: "access-token", expires_in: 3600 });
        }
        if (url.includes("/drive/v3/files?") && init?.method !== "POST") {
          return response({
            files: [{
              id: "child-folder",
              name: "Profiles",
              mimeType: "application/vnd.google-apps.folder",
              parents: ["root-folder"],
              webViewLink: "https://drive.google.com/child-folder",
            }],
          });
        }
        driveResponseId += 1;
        return response({
          id: `drive-file-${driveResponseId}`,
          name: "Profile Summary.pdf",
          mimeType: "application/pdf",
          parents: ["profile-folder"],
          webViewLink: "https://drive.google.com/file",
          md5Checksum: "google-md5",
        });
      },
    });

    const drive = client.driveBackup;
    await expect(
      drive?.findChild(
        "root-folder",
        "Profiles",
        "application/vnd.google-apps.folder",
      ),
    ).resolves.toMatchObject({ id: "child-folder", parents: ["root-folder"] });
    await drive?.createFolder("root-folder", "Profiles");
    await drive?.createFile({
      parentId: "profile-folder",
      name: "Profile Summary.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([1, 2, 3]),
    });
    await drive?.updateFile({
      fileId: "drive-file-2",
      name: "Profile Summary.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([4, 5]),
      currentParentId: "old-folder",
      parentId: "profile-folder",
    });
    await drive?.getFile("drive-file-2");

    const createFolder = calls.find((call) =>
      call.url.startsWith("https://www.googleapis.com/drive/v3/files?") &&
      call.init?.method === "POST",
    );
    expect(createFolder?.init?.headers).toMatchObject({
      authorization: "Bearer access-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(createFolder?.init?.body))).toEqual({
      name: "Profiles",
      mimeType: "application/vnd.google-apps.folder",
      parents: ["root-folder"],
    });

    const uploads = calls.filter((call) =>
      call.url.startsWith("https://www.googleapis.com/upload/drive/v3/files"),
    );
    expect(uploads).toHaveLength(2);
    expect(uploads[0]?.init?.method).toBe("POST");
    expect(uploads[1]?.init?.method).toBe("PATCH");
    expect(new URL(uploads[1]!.url).searchParams.get("addParents")).toBe(
      "profile-folder",
    );
    expect(new URL(uploads[1]!.url).searchParams.get("removeParents")).toBe(
      "old-folder",
    );
    expect(String((uploads[0]?.init?.headers as Record<string, string>)?.[
      "content-type"
    ])).toMatch(/^multipart\/related; boundary=/);
    const uploadBody = Buffer.from(
      await new Response(uploads[0]?.init?.body).arrayBuffer(),
    ).toString("utf8");
    expect(uploadBody).toContain("Profile Summary.pdf");
    expect(uploadBody).toContain("application/pdf");
  });

  it("classifies Drive authorization and retryable failures", async () => {
    for (const [status, expectedCode] of [
      [403, "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"],
      [429, "GOOGLE_WORKSPACE_DRIVE_RETRYABLE_FAILURE"],
      [503, "GOOGLE_WORKSPACE_DRIVE_RETRYABLE_FAILURE"],
    ] as const) {
      const client = createGoogleWorkspaceReadClient({
        environment,
        refreshToken: "refresh-token",
        fetcher: async (input) => {
          if (String(input) === "https://oauth2.googleapis.com/token") {
            return response({ access_token: "access-token", expires_in: 3600 });
          }
          return response(
            status === 403
              ? { error: { errors: [{ reason: "insufficientPermissions" }] } }
              : { error: { message: "temporary" } },
            status,
          );
        },
      });

      await expect(
        client.driveBackup?.createFolder("root-folder", "Profiles"),
      ).rejects.toMatchObject({ code: expectedCode });
    }
  });

});
