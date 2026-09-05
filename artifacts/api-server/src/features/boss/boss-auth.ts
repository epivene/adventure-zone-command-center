import { createHmac, timingSafeEqual } from "node:crypto";

const TTL = 30 * 24 * 60 * 60 * 1000;
const equal = (left: string, right: string) => {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const signature = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function issueBossToken(input: { accountId: string; sessionVersion: number }) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const expiresAtMs = Date.now() + TTL;
  const payload = `boss.${input.accountId}.${input.sessionVersion}.${expiresAtMs}`;
  return { token: `${payload}.${signature(payload, secret)}`, expiresAt: new Date(expiresAtMs).toISOString() };
}

export function verifyBossToken(token: string) {
  const secret = process.env.SESSION_SECRET;
  const parts = token.split(".");
  if (!secret || parts.length !== 5 || parts[0] !== "boss") return null;
  const [, accountId, rawVersion, rawExpiry, sig] = parts;
  const sessionVersion = Number(rawVersion), expiresAtMs = Number(rawExpiry);
  const payload = `boss.${accountId}.${sessionVersion}.${expiresAtMs}`;
  if (!accountId || !Number.isInteger(sessionVersion) || sessionVersion < 1 || !Number.isFinite(expiresAtMs) || Date.now() >= expiresAtMs || !equal(sig ?? "", signature(payload, secret))) return null;
  return { accountId, sessionVersion };
}