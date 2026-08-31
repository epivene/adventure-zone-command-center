import type { NextFunction, Request, Response } from "express";

import type { OwnerAccountSessionRecord } from "./owner-account-repository";
import { verifyOwnerToken } from "./owner-token";

export type OwnerRequestContext = {
  accountId: string;
  displayName: string;
  role: "owner";
};

export interface OwnerSessionRepository {
  getActiveSession(ownerId: string): Promise<OwnerAccountSessionRecord | null>;
}

type OwnerAuthenticatedRequest = Request & {
  userId: string;
  ownerAccount: OwnerRequestContext;
};

export function createRequireOwnerMiddleware(repository: OwnerSessionRepository) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const claims = token ? verifyOwnerToken(token) : null;
    if (!claims) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const owner = await repository.getActiveSession(claims.ownerId);
      if (
        !owner ||
        !owner.enabled ||
        owner.id !== claims.ownerId ||
        owner.role !== "owner" ||
        owner.sessionVersion !== claims.sessionVersion
      ) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const authenticated = req as OwnerAuthenticatedRequest;
      authenticated.userId = owner.id;
      authenticated.ownerAccount = {
        accountId: owner.id,
        displayName: owner.displayName,
        role: "owner",
      };
      next();
    } catch (error) {
      req.log?.error?.({ err: error }, "Owner session validation failed");
      res.status(503).json({ error: "Owner authentication is temporarily unavailable" });
    }
  };
}
