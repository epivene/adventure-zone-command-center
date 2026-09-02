import { Router, type Request } from "express";
import { isIP } from "node:net";
import { z } from "zod";

import type { ComputerCallingConfigResult } from "@/features/calls/computer-calling-config";
import { ComputerCallingError, type ComputerCallingService } from "@/features/calls/computer-calling-service";
import type { ComputerVoiceProvider } from "@/features/calls/computer-voice-provider";
import type { ComputerCallingRateLimiter } from "@/features/calls/computer-calling-rate-limit";

const ownerId = "owner" as const;
const tokenTtlSeconds = 300;

const intentInputSchema = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
  phoneId: z.string().uuid(),
}).strict();

const sessionParamsSchema = z.object({ id: z.string().uuid() }).strict();

export interface ComputerCallingRouterDependencies {
  service: ComputerCallingService;
  providerForConfig: (config: Extract<ComputerCallingConfigResult, { enabled: true }> ["config"]) => ComputerVoiceProvider;
  getConfig: () => ComputerCallingConfigResult;
  isAssistedCallingEnabled: () => boolean;
  limiter: ComputerCallingRateLimiter;
  clock?: () => Date;
  clientIp?: (request: Request) => string;
}

function activeConfig(dependencies: ComputerCallingRouterDependencies) {
  const result = dependencies.getConfig();
  return dependencies.isAssistedCallingEnabled() && result.enabled ? result.config : null;
}

function errorCode(error: unknown): string {
  return error instanceof ComputerCallingError ? error.code : "server_error";
}

function isRenderProduction(environment: NodeJS.ProcessEnv): boolean {
  // These are Render-managed service identity values. Application-provided
  // configuration such as RENDER_DATABASE_URL is not enough to cross this
  // proxy trust boundary.
  return environment.NODE_ENV === "production"
    && Boolean(environment.RENDER_SERVICE_ID?.trim())
    && environment.RENDER_SERVICE_TYPE === "web";
}

/**
 * Render's Cloudflare edge replaces CF-Connecting-IP before it reaches a web
 * service. X-Forwarded-For is intentionally never read because callers can
 * supply its left-most value. Missing or malformed Cloudflare values fall back
 * to Express's socket-derived address rather than becoming a new bucket key.
 */
export function resolveComputerCallingSourceIp(
  request: Request,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (isRenderProduction(environment)) {
    const candidate = request.get("CF-Connecting-IP")?.trim();
    if (candidate && isIP(candidate)) return candidate;
  }
  return request.ip || request.socket.remoteAddress || "unknown";
}

export function createComputerCallingRouter(dependencies: ComputerCallingRouterDependencies): Router {
  const router = Router();
  const clock = dependencies.clock ?? (() => new Date());
  const clientIp = dependencies.clientIp ?? resolveComputerCallingSourceIp;

  function take(kind: "token" | "intent", request: Request): boolean {
    return dependencies.limiter.take({
      key: `${kind}:${ownerId}:${clientIp(request)}`,
      now: clock(),
    });
  }

  router.post("/calls/computer/token", (req, res): void => {
    const config = activeConfig(dependencies);
    if (!config) {
      res.status(503).json({ error: "feature_disabled" });
      return;
    }
    if (!take("token", req)) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    const now = clock();
    const token = dependencies.providerForConfig(config).createBrowserToken({
      identity: ownerId,
      ttlSeconds: tokenTtlSeconds,
    });
    res.set("Cache-Control", "no-store").json({
      token,
      expiresAt: new Date(now.getTime() + tokenTtlSeconds * 1_000).toISOString(),
    });
  });

  router.post("/calls/computer/intents", async (req, res): Promise<void> => {
    const parsed = intentInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    if (!activeConfig(dependencies)) {
      res.status(503).json({ error: "feature_disabled" });
      return;
    }
    if (!take("intent", req)) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }

    try {
      const result = await dependencies.service.createIntent({
        ownerId,
        ...parsed.data,
        now: clock(),
      });
      res.status(201).json(result);
    } catch (error) {
      const code = errorCode(error);
      if (code === "server_error") req.log.error({ err: error }, "Computer call intent creation failed");
      res.status(code === "server_error" ? 500 : 400).json({ error: code });
    }
  });

  router.get("/calls/computer/sessions/:id", async (req, res): Promise<void> => {
    const parsed = sessionParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    try {
      res.json(await dependencies.service.getSession({ ownerId, sessionId: parsed.data.id }));
    } catch (error) {
      const code = errorCode(error);
      if (code === "server_error") req.log.error({ err: error }, "Computer call session lookup failed");
      res.status(code === "server_error" ? 500 : 404).json({ error: code });
    }
  });

  return router;
}
