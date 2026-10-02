import type { NextFunction, Request, Response } from "express";
import { verifyBossToken } from "./boss-auth";
import { DrizzleBossAccountRepository } from "./boss-account-repository";
export type BossRequestContext = { accountId: string; displayName: string; role: "boss"; studioOfficeAccountId: string | null;sessionVersion?:number };
declare global { namespace Express { interface Request { bossAccount?: BossRequestContext; } } }
export function createRequireBossMiddleware(repository: DrizzleBossAccountRepository) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) { res.status(401).json({ error: "Boss authentication required" }); return; }
    const claims = verifyBossToken(header.slice(7));
    const account = claims && await repository.getActiveSession(claims.accountId);
    if (!account || account.sessionVersion !== claims!.sessionVersion || account.role !== "boss") { res.status(401).json({ error: "Boss session is invalid or expired" }); return; }
    req.bossAccount = { accountId: account.id, displayName: account.displayName, role: "boss", studioOfficeAccountId: account.studioOfficeAccountId,sessionVersion:account.sessionVersion };
    next();
  };
}
