import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const KEY_LENGTH = 64;

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
  const salt = randomBytes(24).toString("base64url");
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return { hash: derived.toString("base64url"), salt };
}

export async function verifyLegManagerPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  try {
    const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
    const expected = Buffer.from(hash, "base64url");
    if (derived.length !== expected.length) {
      timingSafeEqual(derived, derived);
      return false;
    }
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
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
