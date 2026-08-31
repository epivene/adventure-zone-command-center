import { timingSafeEqual } from "node:crypto";

import {
  issueOwnerToken,
  verifyOwnerToken,
} from "@/features/owner-auth/owner-token";

const COMPATIBILITY_OWNER_ID = "00000000-0000-4000-8000-000000000001";

/**
 * Logs startup warnings for settings required to bootstrap and sign owner
 * sessions. Existing database-backed owner credentials can still authenticate
 * when OWNER_PASSWORD is absent, but a fresh deployment cannot bootstrap.
 */
export function validateOwnerConfig(): void {
  if (!process.env.OWNER_PASSWORD) {
    // eslint-disable-next-line no-console
    console.warn(
      "[auth] WARNING: OWNER_PASSWORD is not set. " +
        "A fresh owner account cannot be bootstrapped; an existing database-backed owner can still sign in.",
    );
  }
  if (!process.env.SESSION_SECRET) {
    // eslint-disable-next-line no-console
    console.warn(
      "[auth] WARNING: SESSION_SECRET is not set. " +
        "Owner tokens cannot be signed or verified; protected routes fail closed.",
    );
  }
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Verifies the legacy environment password used only to bootstrap the one
 * primary owner record. It is not consulted after that database record exists.
 */
export function verifyOwnerPassword(password: string): boolean {
  const expected = process.env.OWNER_PASSWORD;
  if (!expected) return false;
  return timingSafeStringEqual(password, expected);
}

export { issueOwnerToken, verifyOwnerToken };

/**
 * Temporary compatibility helper for older isolated tests. Production login
 * always calls issueOwnerToken with the real database owner ID and version.
 */
export function issueToken(): { token: string; expiresAt: string } | null {
  return issueOwnerToken({ ownerId: COMPATIBILITY_OWNER_ID, sessionVersion: 1 });
}

/** Temporary boolean compatibility wrapper for existing token-family tests. */
export function verifyToken(token: string): boolean {
  return verifyOwnerToken(token) !== null;
}
