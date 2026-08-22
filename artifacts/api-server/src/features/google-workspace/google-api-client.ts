import type {
  GoogleCalendarSummary,
  GoogleLabelSummary,
  GoogleWorkspaceFetch,
  GoogleWorkspaceReadClient,
} from "./google-api-types";
import type { GoogleWorkspaceEnvironment } from "./google-workspace-env";

export const GOOGLE_WORKSPACE_READ_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
] as const;

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const userInfoEndpoint = "https://openidconnect.googleapis.com/v1/userinfo";
const labelsEndpoint = "https://gmail.googleapis.com/gmail/v1/users/me/labels";
const calendarListEndpoint =
  "https://www.googleapis.com/calendar/v3/users/me/calendarList";

type TokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  token_type?: unknown;
  error?: unknown;
  error_description?: unknown;
};

type GoogleWorkspaceClientError = Error & { code: string };

function clientError(code: string): GoogleWorkspaceClientError {
  return Object.assign(new Error(code), { code });
}

function scopeList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return body && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function createGoogleWorkspaceReadClient(input: {
  environment: GoogleWorkspaceEnvironment;
  refreshToken?: string;
  fetcher?: GoogleWorkspaceFetch;
}): GoogleWorkspaceReadClient {
  const fetcher = input.fetcher ?? fetch;
  let refreshToken = input.refreshToken?.trim() || null;
  let accessToken: { value: string; expiresAtMs: number } | null = null;

  async function requestToken(
    body: URLSearchParams,
  ): Promise<TokenResponse> {
    const response = await fetcher(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = (await responseJson(response)) as TokenResponse;
    if (!response.ok) {
      if (payload.error === "invalid_grant") {
        throw clientError("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
      }
      throw clientError("GOOGLE_WORKSPACE_OAUTH_TOKEN_REQUEST_FAILED");
    }
    return payload;
  }

  function cacheAccessToken(payload: TokenResponse): string {
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw clientError("GOOGLE_WORKSPACE_OAUTH_RESPONSE_INVALID");
    }
    const expiresInSeconds =
      typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
        ? Math.max(0, payload.expires_in)
        : 3600;
    accessToken = {
      value: payload.access_token,
      expiresAtMs: Date.now() + Math.max(0, expiresInSeconds - 60) * 1000,
    };
    return payload.access_token;
  }

  async function currentAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && accessToken && Date.now() < accessToken.expiresAtMs) {
      return accessToken.value;
    }
    if (!refreshToken) {
      throw clientError("GOOGLE_WORKSPACE_NOT_AUTHENTICATED");
    }

    const payload = await requestToken(
      new URLSearchParams({
        client_id: input.environment.clientId,
        client_secret: input.environment.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    );
    return cacheAccessToken(payload);
  }

  async function authorizedJson(
    url: string,
    retryUnauthorized = true,
  ): Promise<Record<string, unknown>> {
    const token = await currentAccessToken(!retryUnauthorized);
    const response = await fetcher(url, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 401 && retryUnauthorized) {
      accessToken = null;
      return authorizedJson(url, false);
    }
    if (!response.ok) {
      throw clientError("GOOGLE_WORKSPACE_API_REQUEST_FAILED");
    }
    return responseJson(response);
  }

  return {
    authorizationUrl({ state }: { state: string }): string {
      if (!state.trim()) {
        throw clientError("GOOGLE_WORKSPACE_OAUTH_STATE_INVALID");
      }
      const url = new URL(authorizationEndpoint);
      url.searchParams.set("client_id", input.environment.clientId);
      url.searchParams.set("redirect_uri", input.environment.redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", GOOGLE_WORKSPACE_READ_SCOPES.join(" "));
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "true");
      url.searchParams.set("state", state);
      return url.toString();
    },

    async exchangeCode(code: string) {
      if (!code.trim()) {
        throw clientError("GOOGLE_WORKSPACE_AUTHORIZATION_CODE_INVALID");
      }
      const payload = await requestToken(
        new URLSearchParams({
          code,
          client_id: input.environment.clientId,
          client_secret: input.environment.clientSecret,
          redirect_uri: input.environment.redirectUri,
          grant_type: "authorization_code",
        }),
      );
      cacheAccessToken(payload);
      if (typeof payload.refresh_token === "string" && payload.refresh_token.trim()) {
        refreshToken = payload.refresh_token.trim();
      }
      if (!refreshToken) {
        throw clientError("GOOGLE_WORKSPACE_REFRESH_TOKEN_MISSING");
      }
      return {
        refreshToken,
        scopes: scopeList(payload.scope),
      };
    },

    async accountIdentity() {
      const payload = await authorizedJson(userInfoEndpoint);
      if (typeof payload.email !== "string" || !payload.email.trim()) {
        throw clientError("GOOGLE_WORKSPACE_ACCOUNT_IDENTITY_INVALID");
      }
      return {
        subject:
          typeof payload.sub === "string" && payload.sub.trim()
            ? payload.sub.trim()
            : null,
        email: payload.email.trim().toLowerCase(),
      };
    },

    async listLabels(): Promise<GoogleLabelSummary[]> {
      const payload = await authorizedJson(labelsEndpoint);
      const labels = Array.isArray(payload.labels) ? payload.labels : [];
      return labels.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const label = value as Record<string, unknown>;
        if (typeof label.id !== "string" || typeof label.name !== "string") {
          return [];
        }
        return [{
          id: label.id,
          name: label.name,
          type: label.type === "system" ? "system" as const : "user" as const,
        }];
      });
    },

    async listCalendars(): Promise<GoogleCalendarSummary[]> {
      const calendars: GoogleCalendarSummary[] = [];
      let pageToken: string | null = null;
      do {
        const url = new URL(calendarListEndpoint);
        url.searchParams.set("maxResults", "250");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const payload = await authorizedJson(url.toString());
        const items = Array.isArray(payload.items) ? payload.items : [];
        for (const value of items) {
          if (!value || typeof value !== "object") continue;
          const calendar = value as Record<string, unknown>;
          if (typeof calendar.id !== "string" || !calendar.id.trim()) continue;
          const summary =
            typeof calendar.summaryOverride === "string" &&
            calendar.summaryOverride.trim()
              ? calendar.summaryOverride.trim()
              : typeof calendar.summary === "string" && calendar.summary.trim()
                ? calendar.summary.trim()
                : calendar.id;
          calendars.push({
            id: calendar.id,
            summary,
            primary: calendar.primary === true,
          });
        }
        pageToken =
          typeof payload.nextPageToken === "string" && payload.nextPageToken
            ? payload.nextPageToken
            : null;
      } while (pageToken);
      return calendars;
    },
  };
}

export type {
  GoogleCalendarSummary,
  GoogleLabelSummary,
  GoogleWorkspaceReadClient,
} from "./google-api-types";
