import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

function timingSafeStringEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function verifyAssistantImportToken(token: string): boolean {
  const expected = process.env.ASSISTANT_IMPORT_TOKEN;
  if (!expected) return false;
  return timingSafeStringEqual(token, expected);
}

export function requireAssistantImportToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !verifyAssistantImportToken(token)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
