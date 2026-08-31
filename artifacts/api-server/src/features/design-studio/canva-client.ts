import {
  decryptCanvaSecret,
  encryptCanvaSecret,
  parseCanvaEncryptionKey,
} from "./encrypted-canva-secret";
import {
  getCanvaConnection,
  upsertCanvaConnection,
} from "./canva-metadata-repository";

const CANVA_API_BASE = "https://api.canva.com/rest/v1";
const CANVA_TOKEN_URL = `${CANVA_API_BASE}/oauth/token`;
export const CANVA_SCOPES = ["design:content:write", "design:meta:read"] as const;

export type CanvaTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type: "Bearer" | string;
  expires_in: number;
  scope?: string;
};

export type CanvaDesignSummary = {
  id: string;
  title?: string;
  urls?: {
    edit_url?: string;
    view_url?: string;
  };
};

function requireCanvaConfig() {
  const clientId = process.env.CANVA_CLIENT_ID?.trim();
  const clientSecret = process.env.CANVA_CLIENT_SECRET?.trim();
  const redirectUri = process.env.CANVA_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("CANVA_CONNECT_NOT_CONFIGURED");
  }
  return { clientId, clientSecret, redirectUri };
}

function tokenEncryptionKey() {
  return parseCanvaEncryptionKey(process.env.CANVA_TOKEN_ENCRYPTION_KEY);
}

async function parseCanvaResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!response.ok) {
    const detail =
      body && typeof body === "object" && "message" in body
        ? String((body as { message?: unknown }).message ?? "")
        : typeof body === "string"
          ? body
          : "";
    throw new Error(`CANVA_API_${response.status}${detail ? `: ${detail}` : ""}`);
  }
  return body as T;
}

function tokenAuthorizationHeader() {
  const { clientId, clientSecret } = requireCanvaConfig();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`;
}

export async function exchangeCanvaAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
}) {
  const { redirectUri } = requireCanvaConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: redirectUri,
  });
  const response = await fetch(CANVA_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: tokenAuthorizationHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return parseCanvaResponse<CanvaTokenResponse>(response);
}

export async function refreshCanvaAccessToken(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const response = await fetch(CANVA_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: tokenAuthorizationHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  return parseCanvaResponse<CanvaTokenResponse>(response);
}

function parseScopes(scope: string | undefined, fallback: string[]) {
  if (!scope?.trim()) return fallback;
  return scope.split(/\s+/).filter(Boolean);
}

export async function ensureCanvaAccessToken(officeAccountId: string) {
  const connection = await getCanvaConnection(officeAccountId);
  if (!connection || connection.status !== "connected") {
    throw new Error("CANVA_NOT_CONNECTED");
  }

  const key = tokenEncryptionKey();
  const expiresAt = connection.tokenExpiresAt?.getTime() ?? 0;
  if (expiresAt > Date.now() + 60_000) {
    return decryptCanvaSecret(connection.encryptedAccessToken, key);
  }

  if (!connection.encryptedRefreshToken) {
    throw new Error("CANVA_RECONNECT_REQUIRED");
  }

  const refreshToken = decryptCanvaSecret(connection.encryptedRefreshToken, key);
  const refreshed = await refreshCanvaAccessToken(refreshToken);
  const nextRefreshToken = refreshed.refresh_token ?? refreshToken;
  const nextScopes = parseScopes(refreshed.scope, connection.scopes);
  const nextExpiry = new Date(Date.now() + Math.max(60, refreshed.expires_in) * 1000);

  await upsertCanvaConnection({
    officeAccountId,
    canvaUserId: connection.canvaUserId,
    encryptedAccessToken: encryptCanvaSecret(refreshed.access_token, key),
    encryptedRefreshToken: encryptCanvaSecret(nextRefreshToken, key),
    tokenExpiresAt: nextExpiry,
    scopes: nextScopes,
    status: "connected",
  });

  return refreshed.access_token;
}

export async function canvaApiFetch<T>(
  officeAccountId: string,
  path: string,
  init: RequestInit = {},
) {
  const accessToken = await ensureCanvaAccessToken(officeAccountId);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${CANVA_API_BASE}${path}`, {
    ...init,
    headers,
  });
  return parseCanvaResponse<T>(response);
}

export async function getCanvaDesign(officeAccountId: string, designId: string) {
  return canvaApiFetch<{ design: CanvaDesignSummary }>(
    officeAccountId,
    `/designs/${encodeURIComponent(designId)}`,
    { method: "GET" },
  );
}

export async function getFreshCanvaEditUrl(officeAccountId: string, designId: string) {
  const response = await getCanvaDesign(officeAccountId, designId);
  const editUrl = response.design.urls?.edit_url;
  if (!editUrl) throw new Error("CANVA_EDIT_URL_UNAVAILABLE");
  return editUrl;
}

export function canvaClientConfig() {
  return requireCanvaConfig();
}
