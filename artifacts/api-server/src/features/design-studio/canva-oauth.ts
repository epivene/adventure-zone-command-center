import { createHash, randomBytes } from "node:crypto";

import {
  canvaClientConfig,
  CANVA_SCOPES,
  exchangeCanvaAuthorizationCode,
} from "./canva-client";
import {
  decryptCanvaSecret,
  encryptCanvaSecret,
  parseCanvaEncryptionKey,
} from "./encrypted-canva-secret";
import {
  consumeCanvaOauthState,
  saveCanvaOauthState,
  upsertCanvaConnection,
} from "./canva-metadata-repository";

const CANVA_AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function encryptionKey() {
  return parseCanvaEncryptionKey(process.env.CANVA_TOKEN_ENCRYPTION_KEY);
}

function randomUrlSafe(bytes = 48) {
  return randomBytes(bytes).toString("base64url");
}

export function createCanvaPkcePair() {
  const verifier = randomUrlSafe(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function safeReturnPath(value: string | undefined) {
  const candidate = value?.trim() || "/design-studio";
  if (!candidate.startsWith("/design-studio")) return "/design-studio";
  if (candidate.startsWith("//")) return "/design-studio";
  return candidate;
}

export async function startCanvaOauth(input: {
  officeAccountId: string;
  returnPath?: string;
}) {
  const { clientId, redirectUri } = canvaClientConfig();
  const state = randomUrlSafe(32);
  const { verifier, challenge } = createCanvaPkcePair();
  const returnPath = safeReturnPath(input.returnPath);

  await saveCanvaOauthState({
    officeAccountId: input.officeAccountId,
    state,
    encryptedCodeVerifier: encryptCanvaSecret(verifier, encryptionKey()),
    returnPath,
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  });

  const url = new URL(CANVA_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", CANVA_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");

  return {
    authorizationUrl: url.toString(),
    state,
  };
}

export async function completeCanvaOauth(input: {
  state: string;
  code: string;
}) {
  const oauthState = await consumeCanvaOauthState(input.state);
  if (!oauthState) throw new Error("CANVA_OAUTH_STATE_INVALID_OR_EXPIRED");

  const key = encryptionKey();
  const verifier = decryptCanvaSecret(oauthState.encryptedCodeVerifier, key);
  const tokens = await exchangeCanvaAuthorizationCode({
    code: input.code,
    codeVerifier: verifier,
  });
  const scopes = tokens.scope?.split(/\s+/).filter(Boolean) ?? [...CANVA_SCOPES];
  const expiresAt = new Date(Date.now() + Math.max(60, tokens.expires_in) * 1000);

  await upsertCanvaConnection({
    officeAccountId: oauthState.officeAccountId,
    encryptedAccessToken: encryptCanvaSecret(tokens.access_token, key),
    encryptedRefreshToken: tokens.refresh_token
      ? encryptCanvaSecret(tokens.refresh_token, key)
      : null,
    tokenExpiresAt: expiresAt,
    scopes,
    status: "connected",
  });

  return {
    officeAccountId: oauthState.officeAccountId,
    returnPath: safeReturnPath(oauthState.returnPath),
    scopes,
  };
}
