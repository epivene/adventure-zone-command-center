import type { RequestHandler } from "express";

let startupReady = true;

export function markAppStarting(): void {
  startupReady = false;
}

export function markAppReady(): void {
  startupReady = true;
}

export const requireStartupReadiness: RequestHandler = (req, res, next) => {
  if (startupReady || (req.method === "GET" && req.path === "/api/healthz")) {
    next();
    return;
  }

  res.setHeader("Retry-After", "5");
  res.status(503).json({
    error: "STARTUP_IN_PROGRESS",
    message: "The API is completing required database startup checks.",
  });
};