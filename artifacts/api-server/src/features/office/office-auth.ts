import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type OfficeTokenClaims = {
  accountId: string;
  sessionVersion: number;
  expiresAtMs: number;
};

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueOfficeToken(input: {
  accountId: string;
  sessionVersion: number;
}): { token: string; expiresAt: string } | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const expiresAtMs = Date.now() + TOKEN_TTL_MS;
  const payload = `office.${input.accountId}.${input.sessionVersion}.${expiresAtMs}`;
  return {
    token: `${payload}.${sign(payload, secret)}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function verifyOfficeToken(token: string): OfficeTokenClaims | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "office") return null;
  const [, accountId, versionRaw, expiryRaw, signature] = parts;
  const sessionVersion = Number(versionRaw);
  const expiresAtMs = Number(expiryRaw);
  if (!accountId || !Number.isInteger(sessionVersion) || sessionVersion < 1) return null;
  if (!Number.isFinite(expiresAtMs)) return null;

  const payload = `office.${accountId}.${sessionVersion}.${expiresAtMs}`;
  if (!safeEqual(signature ?? "", sign(payload, secret))) return null;
  if (Date.now() >= expiresAtMs) return null;
  return { accountId, sessionVersion, expiresAtMs };
}
