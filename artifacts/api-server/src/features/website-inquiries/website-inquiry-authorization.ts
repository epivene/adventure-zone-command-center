import type { NextFunction, Request, Response } from "express";

import { db } from "@workspace/db";
import { verifyToken } from "@/lib/auth";
import { DrizzleOfficeAccountRepository } from "../office/office-account-repository";
import {
  resolveOfficeSession,
  type OfficeRequestContext,
} from "../office/office-middleware";

export type WebsiteInquiryActor =
  | { kind: "owner"; id: "owner"; name: "Desie" }
  | { kind: "office"; id: string; name: string };

declare global {
  namespace Express {
    interface Request {
      websiteInquiryActor?: WebsiteInquiryActor;
    }
  }
}

export function createWebsiteInquiryAuthorization(input?: {
  verifyOwnerToken?: (token: string) => boolean;
  resolveOfficeToken?: (
    token: string,
  ) => Promise<OfficeRequestContext | null>;
}) {
  const verifyOwnerToken = input?.verifyOwnerToken ?? verifyToken;
  const officeRepository = new DrizzleOfficeAccountRepository(db);
  const resolveOfficeToken =
    input?.resolveOfficeToken ??
    ((token: string) => resolveOfficeSession(token, officeRepository));

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const token = header.slice(7);
    if (verifyOwnerToken(token)) {
      req.websiteInquiryActor = {
        kind: "owner",
        id: "owner",
        name: "Desie",
      };
      next();
      return;
    }

    const office = await resolveOfficeToken(token);
    if (!office) {
      res.status(401).json({ error: "Session is invalid or expired." });
      return;
    }
    if (!office.canReviewWebsiteInquiries) {
      res.status(403).json({ error: "Website inquiry access is required." });
      return;
    }
    req.websiteInquiryActor = {
      kind: "office",
      id: office.accountId,
      name: office.displayName,
    };
    next();
  };
}
