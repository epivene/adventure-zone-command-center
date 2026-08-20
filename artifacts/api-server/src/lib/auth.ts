import type { NextFunction, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days
// Password auth currently represents one owner rather than a user table row.
// Keep the existing blank actor namespace so already-saved Lead Scout runs
// remain owned by the same actor while protected routes receive a real string.
const SINGLE_OWNER_ACTOR_ID = "";
type OwnerAuthenticatedRequest = Request & { userId: string };

/**
 * Logs a startup warning if OWNER_PASSWORD or SESSION_SECRET is not
 * configured. The middleware fails closed regardless — all protected
 * requests return 401 when either env var is absent — but this surfaces
 * the misconfiguration early.
 */
export function validateOwnerConfig(): void {
  if (!process.env.OWNER_PASSWORD) {
    // eslint-disable-next-line no-console
    console.warn(
      "[auth] WARNING: OWNER_PASSWORD is not set. " +
        "Login is disabled and all protected CRM routes will return 401 until it is configured.",
    );
  }
  if (!process.env.SESSION_SECRET) {
    // eslint-disable-next-line no-console
    console.warn(
      "[auth] WARNING: SESSION_SECRET is not set. " +
        "Tokens cannot be signed or verified; all protected CRM routes will return 401 until it is configured.",
    );
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still perform a comparison to keep timing uniform.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * Verifies the owner password (timing-safe). Fails closed when
 * OWNER_PASSWORD is unset.
 */
export function verifyOwnerPassword(password: string): boolean {
  const expected = process.env.OWNER_PASSWORD;
  if (!expected) return false;
  return timingSafeStringEqual(password, expected);
}

/**
 * Issues an HMAC-signed bearer token: `owner.<expiresAtMs>.<signature>`.
 * Returns null when SESSION_SECRET is unset (fail closed).
 */
export function issueToken(): { token: string; expiresAt: string } | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  const expiresAtMs = Date.now() + TOKEN_TTL_MS;
  const payload = `owner.${expiresAtMs}`;
  const token = `${payload}.${sign(payload, secret)}`;
  return { token, expiresAt: new Date(expiresAtMs).toISOString() };
}

/**
 * Verifies a bearer token's signature (timing-safe) and expiry.
 * Fails closed when SESSION_SECRET is unset.
 */
export function verifyToken(token: string): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "owner") return false;
  const expiresAtMs = Number(parts[1]);
  if (!Number.isFinite(expiresAtMs)) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  if (!timingSafeStringEqual(parts[2] ?? "", sign(payload, secret))) {
    return false;
  }
  return Date.now() < expiresAtMs;
}

/**
 * Requires a valid owner bearer token. Fails closed: returns 401 when the
 * Authorization header is missing/invalid, the token is expired, or the
 * server is missing SESSION_SECRET.
 */
export function requireOwnerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !verifyToken(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as OwnerAuthenticatedRequest).userId = SINGLE_OWNER_ACTOR_ID;
  next();
}
