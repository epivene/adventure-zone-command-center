import { createHmac, timingSafeEqual } from "node:crypto";
import { hashPasswordCredential, verifyPasswordCredential } from "@/lib/password-credential";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type LegManagerTokenClaims = {
  legId: string;
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

export async function hashLegManagerPassword(
  password: string,
): Promise<{ hash: string; salt: string }> {
  return hashPasswordCredential(password);
}

export async function verifyLegManagerPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  return verifyPasswordCredential(password, hash, salt);
}

export function issueLegManagerToken(input: {
  legId: string;
  sessionVersion: number;
}): { token: string; expiresAt: string } | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const expiresAtMs = Date.now() + TOKEN_TTL_MS;
  const payload = `leg.${input.legId}.${input.sessionVersion}.${expiresAtMs}`;
  return {
    token: `${payload}.${sign(payload, secret)}`,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

export function verifyLegManagerToken(token: string): LegManagerTokenClaims | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "leg") return null;
  const [, legId, versionRaw, expiryRaw, signature] = parts;
  const sessionVersion = Number(versionRaw);
  const expiresAtMs = Number(expiryRaw);
  if (!legId || !Number.isInteger(sessionVersion) || sessionVersion < 1) return null;
  if (!Number.isFinite(expiresAtMs)) return null;

  const payload = `leg.${legId}.${sessionVersion}.${expiresAtMs}`;
  if (!safeEqual(signature ?? "", sign(payload, secret))) return null;
  if (Date.now() >= expiresAtMs) return null;
  return { legId, sessionVersion, expiresAtMs };
}
