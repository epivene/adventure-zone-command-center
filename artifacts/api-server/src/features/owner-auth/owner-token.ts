import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type OwnerTokenClaims = {
  ownerId: string;
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

export function issueOwnerToken(
  input: { ownerId: string; sessionVersion: number },
  nowMs = Date.now(),
): { token: string; expiresAt: string } | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  if (!input.ownerId || !Number.isInteger(input.sessionVersion) || input.sessionVersion < 1) {
    return null;
  }
  const expiresAtMs = nowMs + TOKEN_TTL_MS;
  const payload = `owner.${input.ownerId}.${input.sessionVersion}.${expiresAtMs}`;
  return {
    token: `${payload}.${sign(payload, secret)}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function verifyOwnerToken(
  token: string,
  nowMs = Date.now(),
): OwnerTokenClaims | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "owner") return null;
  const [, ownerId, versionRaw, expiryRaw, signature] = parts;
  const sessionVersion = Number(versionRaw);
  const expiresAtMs = Number(expiryRaw);
  if (!ownerId || !Number.isInteger(sessionVersion) || sessionVersion < 1) return null;
  if (!Number.isFinite(expiresAtMs)) return null;

  const payload = `owner.${ownerId}.${sessionVersion}.${expiresAtMs}`;
  if (!safeEqual(signature ?? "", sign(payload, secret))) return null;
  if (nowMs >= expiresAtMs) return null;
  return { ownerId, sessionVersion, expiresAtMs };
}
