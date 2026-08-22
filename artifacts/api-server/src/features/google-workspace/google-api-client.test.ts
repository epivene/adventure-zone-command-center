import { describe, expect, it } from "vitest";

import {
  GOOGLE_WORKSPACE_READ_SCOPES,
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
  it("builds an offline authorization URL with only approved read scopes", () => {
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
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    expect(url.searchParams.get("state")).toBe("oauth-state");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual(
      GOOGLE_WORKSPACE_READ_SCOPES,
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
          scope: GOOGLE_WORKSPACE_READ_SCOPES.join(" "),
          token_type: "Bearer",
        });
      },
    });

    await expect(client.exchangeCode("authorization-code")).resolves.toEqual({
      refreshToken: "existing-refresh-token",
      scopes: [...GOOGLE_WORKSPACE_READ_SCOPES],
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
          scope: GOOGLE_WORKSPACE_READ_SCOPES.join(" "),
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

  it("does not expose Google mutation methods", () => {
    const client = createGoogleWorkspaceReadClient({
      environment,
      fetcher: async () => new Response(),
    });

    expect(Object.keys(client).sort()).toEqual([
      "accountIdentity",
      "authorizationUrl",
      "exchangeCode",
      "listCalendars",
      "listLabels",
    ]);
  });
});
