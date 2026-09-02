import type { RequestHandler } from "express";

let startupReady = true;

export function markAppStarting(): void {
  startupReady = false;
}

export function markAppReady(): void {
  startupReady = true;
}

export const requireStartupReadiness: RequestHandler = (req, res, next) => {
  const isLiveness = req.method === "GET" && req.path === "/api/healthz";
  const isAuthenticatedImportRoute =
    req.path === "/api/assistant-import" ||
    req.path.startsWith("/api/assistant-import/");
  if (startupReady || isLiveness || isAuthenticatedImportRoute) {
    next();
    return;
  }

  res.setHeader("Retry-After", "5");
  res.status(503).json({
    error: "STARTUP_IN_PROGRESS",
    message: "The API is completing required database startup checks.",
  });
};