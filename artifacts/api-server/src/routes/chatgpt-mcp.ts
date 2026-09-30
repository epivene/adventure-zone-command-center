import express, { Router } from "express";
import { hostHeaderValidation } from "@modelcontextprotocol/express";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { createConnectionMcpServer } from "../features/chatgpt-connection/mcp-server";
import type {
  ConnectionPrincipal,
  SqlQuery,
} from "../features/chatgpt-connection/contracts";
import type { ConnectionServices } from "../features/chatgpt-connection/tool-registry";
export function createChatGPTMcpRouter(deps: {
  enabled: boolean;
  resource: string;
  allowedOrigins: string[];
  db: SqlQuery;
  verify: (token: string) => Promise<ConnectionPrincipal>;
  services: ConnectionServices;
}) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!deps.enabled)
      return res.status(503).json({ error: "CONNECTION_DISABLED" });
    return next();
  });
  router.use(hostHeaderValidation([new URL(deps.resource).hostname]));
  router.use((req, res, next) => {
    const origin = req.get("Origin");
    if (origin && !deps.allowedOrigins.includes(origin))
      return res.status(403).json({ error: "CONNECTION_ORIGIN_DENIED" });
    return next();
  });
  router.use(express.json({ limit: "256kb" }));
  router.all("/", async (req, res) => {
    if (req.method !== "POST")
      return res
        .status(405)
        .set("Allow", "POST")
        .json({ error: "METHOD_NOT_ALLOWED" });
    let p: ConnectionPrincipal;
    try {
      const header = req.get("Authorization");
      if (!header?.startsWith("Bearer ")) throw Error();
      p = await deps.verify(header.slice(7));
    } catch {
      return res
        .status(401)
        .set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${new URL(deps.resource).origin}/.well-known/oauth-protected-resource/api/chatgpt/mcp"`,
        )
        .json({ error: "invalid_token" });
    }
    const rate = (
      await deps.db.query(
        `INSERT INTO chatgpt_rate_windows(connection_id,window_start,calls) VALUES($1,date_trunc('minute',clock_timestamp()),1) ON CONFLICT(connection_id) DO UPDATE SET calls=CASE WHEN chatgpt_rate_windows.window_start=excluded.window_start THEN chatgpt_rate_windows.calls+1 ELSE 1 END,window_start=excluded.window_start RETURNING calls`,
        [p.connectionId],
      )
    ).rows[0];
    if (rate.calls > 60)
      return res
        .status(429)
        .set("Retry-After", "60")
        .json({ error: "CONNECTION_RATE_LIMITED" });
    const server = createConnectionMcpServer(deps.services, p, deps.resource),
      transport = new NodeStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
    res.on("close", () => {
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return undefined;
  });
  router.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error.type === "entity.too.large" ? 413 : 500).json({
      error:
        error.type === "entity.too.large"
          ? "CONNECTION_REQUEST_TOO_LARGE"
          : "CONNECTION_REQUEST_FAILED",
    });
  });
  return router;
}
