import type { NextFunction, Request, Response } from "express";
import { verifyLegManagerToken } from "./leg-manager-auth";

export type LegManagerRequestContext = {
  legId: string;
  managerName: string | null;
  sessionVersion?: number;
};

export interface LegManagerSessionRepository {
  getActiveAccess(legId: string): Promise<{
    legId: string;
    legName?: string;
    managerName?: string | null;
    sessionVersion: number;
  } | null>;
}

declare global {
  namespace Express {
    interface Request {
      legManager?: LegManagerRequestContext;
    }
  }
}

export async function resolveLegManagerSession(
  token: string,
  repo: LegManagerSessionRepository,
): Promise<LegManagerRequestContext | null> {
  const claims = verifyLegManagerToken(token);
  if (!claims) return null;
  const access = await repo.getActiveAccess(claims.legId);
  if (!access || access.legId !== claims.legId || access.sessionVersion !== claims.sessionVersion) return null;
  return {
    legId: access.legId,
    managerName: access.legName ?? access.managerName ?? null,
    sessionVersion: access.sessionVersion,
  };
}

export function createRequireLegManagerMiddleware(repo: LegManagerSessionRepository) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Manager authentication required" });
      return;
    }
    const context = await resolveLegManagerSession(header.slice(7), repo);
    if (!context) {
      res.status(401).json({ error: "Manager session is invalid or expired" });
      return;
    }
    req.legManager = context;
    next();
  };
}
