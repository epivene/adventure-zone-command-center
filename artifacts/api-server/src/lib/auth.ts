import type { NextFunction, Request, Response } from "express";
import { getAuth } from "@clerk/express";

/**
 * Logs a startup warning if OWNER_CLERK_USER_ID is not configured.
 * The middleware fails closed regardless — all protected requests return 403
 * when the env var is absent — but this surfaces the misconfiguration early.
 */
export function validateOwnerConfig(): void {
  const ownerId = process.env.OWNER_CLERK_USER_ID?.trim();
  if (!ownerId) {
    // eslint-disable-next-line no-console
    console.warn(
      "[auth] WARNING: OWNER_CLERK_USER_ID is not set. " +
      "All protected CRM routes will return 403 until this is configured. " +
      "Set it to your Clerk user ID (e.g. user_xxx) in the environment secrets.",
    );
  }
}

/**
 * Requires a signed-in Clerk user AND that the user matches the configured
 * OWNER_CLERK_USER_ID. Fails closed: returns 403 for any authenticated user
 * who is not the owner, and also if the env var is not configured at all.
 */
export function requireOwnerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const auth = getAuth(req);
  const userId = auth?.userId ?? null;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const ownerId = process.env.OWNER_CLERK_USER_ID?.trim();
  // Fail closed: if env var is absent OR user is not the owner, block.
  if (!ownerId || userId !== ownerId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  (req as Request & { userId?: string }).userId = userId;
  next();
}
