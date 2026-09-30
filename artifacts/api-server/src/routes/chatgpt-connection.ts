import { ProfileUpdateService } from "../features/chatgpt-connection/profile-update-service";
import { Router, type Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requireOwnerMiddleware } from "../lib/auth";
import {
  ConnectionError,
  connectionScopes,
  type ConnectionDatabase,
} from "../features/chatgpt-connection/contracts";
import type { ConnectionOAuth } from "../features/chatgpt-connection/oauth-provider";
export type OwnerConnectionDeps = {
  enabled: boolean;
  appOrigin: string;
  resource: string;
  db: ConnectionDatabase;
  oauth?: ConnectionOAuth;
};
function csrf(req: Request) {
  return createHmac("sha256", process.env.SESSION_SECRET!)
    .update("chatgpt-connection:" + req.headers.authorization)
    .digest("hex");
}
export function createChatGPTConnectionRouter(deps: OwnerConnectionDeps) {
  const router = Router();
  router.use(requireOwnerMiddleware);
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (["GET", "HEAD"].includes(req.method)) return next();
    const expected = Buffer.from(csrf(req)),
      actual = Buffer.from(req.get("X-Connection-CSRF") ?? "");
    if (
      ![deps.appOrigin, new URL(deps.resource).origin].includes(
        req.get("Origin") ?? "",
      ) ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      return res.status(403).json({ error: "CONNECTION_CSRF_REQUIRED" });
    next();
  });
  const query = async (sql: string, params: any[] = []) => {
    try {
      return (await deps.db.query(sql, params)).rows;
    } catch (e) {
      if (!deps.enabled && (e as any).code === "42P01") return [];
      throw e;
    }
  };
  router.get("/", async (req, res) => {
    res.json({
      enabled: deps.enabled,
      endpoint: deps.resource,
      scopes: connectionScopes,
      csrfToken: csrf(req),
      clients: await query(
        "SELECT id,metadata,created_at FROM chatgpt_oauth_clients WHERE owner_id=$1 ORDER BY created_at DESC",
        ["owner"],
      ),
      connections: await query(
        "SELECT id,client_id,scopes,revoked_at,created_at,last_used_at FROM chatgpt_connections WHERE owner_id=$1 ORDER BY created_at DESC",
        ["owner"],
      ),
    });
  });
  router.post("/clients", async (req, res) => {
    if (!deps.enabled || !deps.oauth)
      throw new ConnectionError("CONNECTION_DISABLED", 503);
    res.status(201).json(
      await deps.oauth.store.registerClient("owner", {
        name: req.body.name,
        redirectUris: req.body.redirectUris,
      }),
    );
  });
  router.post("/connections/:id/revoke", async (req, res) => {
    // Revocation remains available after disabling tools, without loading the OAuth runtime.
    if (deps.oauth)
      await deps.oauth.store.revoke("owner", String(req.params.id));
    else {
      const { transaction } =
        await import("../features/chatgpt-connection/contracts");
      await transaction(deps.db, async (tx) => {
        const row = (
          await tx.query(
            "SELECT grant_id FROM chatgpt_connections WHERE id=$1 AND owner_id=$2 FOR UPDATE",
            [req.params.id, "owner"],
          )
        ).rows[0];
        if (!row) throw new ConnectionError("CONNECTION_ACCESS_DENIED", 403);
        await tx.query(
          "UPDATE chatgpt_connections SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1",
          [req.params.id],
        );
        await tx.query(
          "DELETE FROM chatgpt_oauth_artifacts WHERE grant_id=$1",
          [row.grant_id],
        );
      });
    }
    res.json({ revoked: true });
  });
  router.get("/interactions/:uid", async (req, res) => {
    if (!deps.enabled || !deps.oauth)
      throw new ConnectionError("CONNECTION_DISABLED", 503);
    const { d, client, requested } = await deps.oauth.details(
      req,
      res,
      String(req.params.uid),
    );
    res.json({
      interactionId: d.uid,
      clientName: client.metadata.client_name,
      redirectUri: d.params.redirect_uri,
      requestedScopes: requested,
      defaultScopes: requested.includes("crm:read") ? ["crm:read"] : [],
      csrfToken: csrf(req),
    });
  });
  router.post("/interactions/:uid", async (req, res) => {
    if (!deps.enabled || !deps.oauth)
      throw new ConnectionError("CONNECTION_DISABLED", 503);
    if (
      !Array.isArray(req.body.scopes) ||
      typeof req.body.approve !== "boolean"
    )
      throw new ConnectionError("CONNECTION_INVALID_CONSENT");
    const url = await deps.oauth.consent(
      req,
      res,
      String(req.params.uid),
      req.body.scopes,
      req.body.approve,
    );
    res.json({ redirectTo: url });
  });
  for (const type of ["drafts", "proposals"] as const) {
    const draft = type === "drafts";
    const from = draft
      ? "chatgpt_external_drafts p"
      : "chatgpt_update_proposals p JOIN chatgpt_connections c ON c.id=p.connection_id";
    const owner = draft ? "p.owner_id" : "c.owner_id";
    const date = draft ? "updated_at" : "created_at";
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    router.get(`/${type}/:id`, async (req, res) => {
      if (!uuid.test(String(req.params.id)))
        throw new ConnectionError("CONNECTION_NOT_FOUND", 404);
      const rows = await query(
        `SELECT p.* FROM ${from} WHERE ${owner}=$1 AND p.id=$2`,
        ["owner", req.params.id],
      );
      if (!rows[0]) throw new ConnectionError("CONNECTION_NOT_FOUND", 404);
      res.json(rows[0]);
    });
    router.get(`/${type}`, async (req, res) => {
      let cursor: string[] | undefined;
      if (req.query.cursor !== undefined) {
        try {
          if (
            typeof req.query.cursor !== "string" ||
            req.query.cursor.length > 512
          )
            throw Error();
          cursor = JSON.parse(
            Buffer.from(req.query.cursor, "base64url").toString(),
          );
          if (
            !Array.isArray(cursor) ||
            cursor.length !== 2 ||
            typeof cursor[0] !== "string" ||
            !Number.isFinite(Date.parse(cursor[0])) ||
            !uuid.test(cursor[1])
          )
            throw Error();
        } catch {
          throw new ConnectionError("CONNECTION_INVALID_CURSOR");
        }
      }
      const rows = await query(
        `SELECT p.*,p.${date}::text AS page_timestamp FROM ${from} WHERE ${owner}=$1 ${cursor ? `AND (p.${date},p.id)<($2::timestamptz,$3::uuid)` : ""} ORDER BY p.${date} DESC,p.id DESC LIMIT 51`,
        cursor ? ["owner", ...cursor] : ["owner"],
      );
      const items = rows.slice(0, 50);
      const last = items.at(-1);
      res.json({
        items: items.map(({ page_timestamp, ...row }) => row),
        nextCursor:
          rows.length > 50
            ? Buffer.from(
                JSON.stringify([last.page_timestamp, last.id]),
              ).toString("base64url")
            : null,
      });
    });
  }
  router.post("/proposals/:id/approve", async (req, res) => {
    if (!deps.enabled) throw new ConnectionError("CONNECTION_DISABLED", 503);
    res.json(
      await new ProfileUpdateService(deps.db).approve(
        "owner",
        String(req.params.id),
        req.body.contentHash,
      ),
    );
  });
  router.use((error: unknown, _req: Request, res: any, _next: any) => {
    if (error instanceof ConnectionError)
      return res
        .status(error.status)
        .json({ error: error.code, message: error.message });
    res.status(500).json({
      error: "CONNECTION_REQUEST_FAILED",
      message: "The request could not be completed. Refresh and try again.",
    });
  });
  return router;
}
