import type { NextFunction, Request, Response } from "express";
import { verifyOfficeToken } from "./office-auth";

export type OfficeRequestContext = {
  accountId: string;
  displayName: string;
  role: "office_coordinator";
  canReviewWebsiteInquiries: boolean;
};

export interface OfficeSessionRepository {
  getActiveSession(accountId: string): Promise<{
    id: string;
    displayName: string;
    role: "office_coordinator";
    enabled: boolean;
    sessionVersion: number;
    canReviewWebsiteInquiries: boolean;
  } | null>;
}

declare global {
  namespace Express {
    interface Request {
      officeAccount?: OfficeRequestContext;
    }
  }
}

export async function resolveOfficeSession(token: string, repository: OfficeSessionRepository): Promise<OfficeRequestContext | null> {
  const claims = verifyOfficeToken(token);
  if (!claims) return null;
  const account = await repository.getActiveSession(claims.accountId);
  if (!account || !account.enabled || account.id !== claims.accountId || account.sessionVersion !== claims.sessionVersion) return null;
  if (account.role !== "office_coordinator") return null;
  return {
    accountId: account.id,
    displayName: account.displayName,
    role: account.role,
    canReviewWebsiteInquiries: account.canReviewWebsiteInquiries,
  };
}

export function createRequireOfficeMiddleware(repository: OfficeSessionRepository) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Office authentication required" });
      return;
    }
    const context = await resolveOfficeSession(header.slice(7), repository);
    if (!context) {
      res.status(401).json({ error: "Office session is invalid or expired" });
      return;
    }
    req.officeAccount = context;
    next();
  };
}
