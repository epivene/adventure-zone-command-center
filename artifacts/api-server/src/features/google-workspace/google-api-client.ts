import type {
  GoogleCalendarSummary,
  GoogleLabelSummary,
  GoogleMessageMetadata,
  GoogleMessageRef,
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
const gmailBaseEndpoint = "https://gmail.googleapis.com/gmail/v1/users/me";
const labelsEndpoint = `${gmailBaseEndpoint}/labels`;
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

function partHasAttachment(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const part = value as Record<string, unknown>;
  if (typeof part.filename === "string" && part.filename.trim()) return true;
  if (part.body && typeof part.body === "object") {
    const body = part.body as Record<string, unknown>;
    if (typeof body.attachmentId === "string" && body.attachmentId.trim()) {
      return true;
    }
  }
  return Array.isArray(part.parts) && part.parts.some(partHasAttachment);
}

function headerValue(headers: unknown[], name: string): string {
  const found = headers.find((value) => {
    if (!value || typeof value !== "object") return false;
    const header = value as Record<string, unknown>;
    return (
      typeof header.name === "string" &&
      header.name.toLowerCase() === name.toLowerCase()
    );
  });
  if (!found || typeof found !== "object") return "";
  const value = (found as Record<string, unknown>).value;
  return typeof value === "string" ? value : "";
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
      url.searchParams.set("include_granted_scopes", "false");
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

    async listRecentMessageRefs(limit: number): Promise<GoogleMessageRef[]> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw clientError("GOOGLE_WORKSPACE_MESSAGE_LIMIT_INVALID");
      }
      const refs: GoogleMessageRef[] = [];
      let pageToken: string | null = null;
      do {
        const url = new URL(`${gmailBaseEndpoint}/messages`);
        url.searchParams.set("maxResults", String(Math.min(100, limit - refs.length)));
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const payload = await authorizedJson(url.toString());
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        for (const value of messages) {
          if (refs.length >= limit) break;
          if (!value || typeof value !== "object") continue;
          const message = value as Record<string, unknown>;
          if (
            typeof message.id !== "string" ||
            !message.id.trim() ||
            typeof message.threadId !== "string" ||
            !message.threadId.trim()
          ) {
            continue;
          }
          refs.push({ id: message.id, threadId: message.threadId });
        }
        pageToken =
          refs.length < limit && typeof payload.nextPageToken === "string" && payload.nextPageToken
            ? payload.nextPageToken
            : null;
      } while (pageToken && refs.length < limit);
      return refs;
    },

    async getMessageMetadata(id: string): Promise<GoogleMessageMetadata> {
      const messageId = id.trim();
      if (!messageId) {
        throw clientError("GOOGLE_WORKSPACE_MESSAGE_ID_INVALID");
      }
      const url = new URL(`${gmailBaseEndpoint}/messages/${encodeURIComponent(messageId)}`);
      url.searchParams.set("format", "metadata");
      for (const header of ["From", "To", "Cc", "Subject", "Date"]) {
        url.searchParams.append("metadataHeaders", header);
      }
      const payload = await authorizedJson(url.toString());
      if (
        typeof payload.id !== "string" ||
        typeof payload.threadId !== "string"
      ) {
        throw clientError("GOOGLE_WORKSPACE_MESSAGE_METADATA_INVALID");
      }
      const messagePayload =
        payload.payload && typeof payload.payload === "object"
          ? (payload.payload as Record<string, unknown>)
          : {};
      const headers = Array.isArray(messagePayload.headers)
        ? messagePayload.headers
        : [];
      const rawInternalDate =
        typeof payload.internalDate === "string"
          ? Number(payload.internalDate)
          : typeof payload.internalDate === "number"
            ? payload.internalDate
            : NaN;
      const parts = Array.isArray(messagePayload.parts) ? messagePayload.parts : [];
      return {
        id: payload.id,
        threadId: payload.threadId,
        labelIds: Array.isArray(payload.labelIds)
          ? payload.labelIds.filter((label): label is string => typeof label === "string")
          : [],
        internalDateMs: Number.isFinite(rawInternalDate) ? rawInternalDate : null,
        snippet: typeof payload.snippet === "string" ? payload.snippet : "",
        headers: {
          from: headerValue(headers, "From"),
          to: headerValue(headers, "To"),
          cc: headerValue(headers, "Cc"),
          subject: headerValue(headers, "Subject"),
          date: headerValue(headers, "Date"),
        },
        hasAttachments: parts.some(partHasAttachment),
      };
    },
  };
}

export type {
  GoogleCalendarSummary,
  GoogleLabelSummary,
  GoogleMessageMetadata,
  GoogleMessageRef,
  GoogleWorkspaceReadClient,
} from "./google-api-types";
