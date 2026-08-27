import type { GoogleWorkspaceEnvironment } from "./google-workspace-env";
import type { GoogleWorkspaceFetch } from "./google-api-types";

const tokenEndpoint = "https://oauth2.googleapis.com/token";
const gmailDraftsEndpoint = "https://gmail.googleapis.com/gmail/v1/users/me/drafts";

type GoogleDeliveryClientError = Error & { code: string };

function clientError(code: string): GoogleDeliveryClientError {
  return Object.assign(new Error(code), { code });
}

function validDraftId(value: string): string {
  const draftId = value.trim();
  if (!draftId || !/^[A-Za-z0-9_-]+$/.test(draftId)) {
    throw clientError("GOOGLE_WORKSPACE_GMAIL_DRAFT_ID_INVALID");
  }
  return draftId;
}

function validRaw(value: string): string {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw clientError("GOOGLE_WORKSPACE_GMAIL_MESSAGE_INVALID");
  }
  return value;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export type GoogleGmailDeliveryClient = {
  updateGmailDraft(input: { draftId: string; raw: string }): Promise<{
    draftId: string;
    messageId: string;
    threadId: string | null;
  }>;
  sendGmailDraft(input: { draftId: string }): Promise<{
    messageId: string;
    threadId: string | null;
  }>;
};

export function createGoogleGmailDeliveryClient(input: {
  environment: GoogleWorkspaceEnvironment;
  refreshToken: string;
  fetcher?: GoogleWorkspaceFetch;
  timeoutMs?: number;
}): GoogleGmailDeliveryClient {
  const fetcher = input.fetcher ?? fetch;
  const refreshToken = input.refreshToken.trim();
  if (!refreshToken) throw clientError("GOOGLE_WORKSPACE_NOT_AUTHENTICATED");
  const timeoutMs = typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
    ? Math.min(input.timeoutMs, 30_000)
    : 10_000;
  let accessToken: { value: string; expiresAt: number } | null = null;

  async function currentAccessToken(signal: AbortSignal): Promise<string> {
    if (accessToken && Date.now() < accessToken.expiresAt) return accessToken.value;
    const response = await fetcher(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.environment.clientId,
        client_secret: input.environment.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      signal,
    });
    const payload = await responseJson(response);
    if (!response.ok) {
      if (payload.error === "invalid_grant") throw clientError("GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED");
      throw clientError("GOOGLE_WORKSPACE_OAUTH_TOKEN_REQUEST_FAILED");
    }
    if (typeof payload.access_token !== "string" || !payload.access_token) {
      throw clientError("GOOGLE_WORKSPACE_OAUTH_RESPONSE_INVALID");
    }
    const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in)
      ? Math.max(0, payload.expires_in)
      : 3600;
    accessToken = {
      value: payload.access_token,
      expiresAt: Date.now() + Math.max(0, expiresIn - 60) * 1000,
    };
    return accessToken.value;
  }

  async function bounded<T>(
    uncertainCode: string,
    operation: (token: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const token = await currentAccessToken(controller.signal);
      return await operation(token, controller.signal);
    } catch (error) {
      if (
        !controller.signal.aborted &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
      ) {
        throw error;
      }
      throw clientError(uncertainCode);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async updateGmailDraft({ draftId, raw }) {
      const safeDraftId = validDraftId(draftId);
      const safeRaw = validRaw(raw);
      return bounded("GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN", async (token, signal) => {
        const response = await fetcher(`${gmailDraftsEndpoint}/${safeDraftId}`, {
          method: "PUT",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ message: { raw: safeRaw } }),
          signal,
        });
        const payload = await responseJson(response);
        if (!response.ok) throw clientError("GOOGLE_WORKSPACE_GMAIL_DRAFT_UPDATE_FAILED");
        const message = payload.message && typeof payload.message === "object"
          ? payload.message as Record<string, unknown>
          : null;
        if (typeof payload.id !== "string" || !payload.id || !message || typeof message.id !== "string" || !message.id) {
          throw clientError("GOOGLE_WORKSPACE_GMAIL_DRAFT_OUTCOME_UNCERTAIN");
        }
        return {
          draftId: payload.id,
          messageId: message.id,
          threadId: typeof message.threadId === "string" && message.threadId ? message.threadId : null,
        };
      });
    },

    async sendGmailDraft({ draftId }) {
      const safeDraftId = validDraftId(draftId);
      return bounded("GOOGLE_WORKSPACE_GMAIL_SEND_OUTCOME_UNCERTAIN", async (token, signal) => {
        const response = await fetcher(`${gmailDraftsEndpoint}/send`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ id: safeDraftId }),
          signal,
        });
        const payload = await responseJson(response);
        if (!response.ok) throw clientError("GOOGLE_WORKSPACE_GMAIL_SEND_FAILED");
        if (typeof payload.id !== "string" || !payload.id) {
          throw clientError("GOOGLE_WORKSPACE_GMAIL_SEND_OUTCOME_UNCERTAIN");
        }
        return {
          messageId: payload.id,
          threadId: typeof payload.threadId === "string" && payload.threadId ? payload.threadId : null,
        };
      });
    },
  };
}
