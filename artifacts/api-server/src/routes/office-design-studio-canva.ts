import express, { Router, type IRouter } from "express";
import { asc, desc, eq } from "drizzle-orm";

import {
  db,
  designProjectVersions,
  designProjects,
} from "@workspace/db";
import { officeAccounts } from "@workspace/db/office-coordinator-schema";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { resolveOfficeSession } from "@/features/office/office-middleware";
import { verifyToken } from "@/lib/auth";
import {
  canvaClientConfig,
  CANVA_SCOPES,
  getFreshCanvaEditUrl,
  hasRequiredCanvaScopes,
} from "@/features/design-studio/canva-client";
import { importPdfToCanva } from "@/features/design-studio/canva-import-service";
import {
  consumeCanvaOauthState,
  deleteCanvaConnection,
  getCanvaConnection,
  getProjectCanvaLink,
} from "@/features/design-studio/canva-metadata-repository";
import {
  completeCanvaOauth,
  startCanvaOauth,
} from "@/features/design-studio/canva-oauth";

const router: IRouter = Router();
const officeRepository = new DrizzleOfficeAccountRepository(db);
const projectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireStudio(req: any, res: any, next: () => void): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Design Studio authentication required" });
    return;
  }

  const officeContext = await resolveOfficeSession(token, officeRepository);
  if (officeContext) {
    req.officeAccount = officeContext;
    next();
    return;
  }

  if (verifyToken(token)) {
    const [account] = await db
      .select({
        id: officeAccounts.id,
        displayName: officeAccounts.displayName,
      })
      .from(officeAccounts)
      .where(eq(officeAccounts.enabled, true))
      .orderBy(asc(officeAccounts.createdAt))
      .limit(1);
    if (account) {
      req.officeAccount = {
        accountId: account.id,
        displayName: account.displayName,
        role: "office_coordinator",
      };
      next();
      return;
    }
  }

  res.status(401).json({ error: "Design Studio authentication is invalid or expired" });
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function queryValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canvaConfigured() {
  try {
    canvaClientConfig();
    return true;
  } catch {
    return false;
  }
}

function connectionReady(connection: Awaited<ReturnType<typeof getCanvaConnection>>) {
  return connection?.status === "connected" && hasRequiredCanvaScopes(connection.scopes);
}

function safeCanvaError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("CANVA_")) return message.split(":")[0] ?? fallback;
  return fallback;
}

function safeReturnUrl(returnPath: string, result: { connected?: true; error?: string }) {
  const { appOrigin } = canvaClientConfig();
  const candidate = returnPath.trim();
  const path = candidate.startsWith("/design-studio") && !candidate.startsWith("//")
    ? candidate
    : "/design-studio";
  const url = new URL(path, `${appOrigin}/`);
  url.searchParams.delete("canvaConnected");
  url.searchParams.delete("canvaError");
  if (result.connected) url.searchParams.set("canvaConnected", "1");
  if (result.error) url.searchParams.set("canvaError", result.error);
  return url.toString();
}

async function ownedProject(projectId: string, officeAccountId: string) {
  if (!projectIdPattern.test(projectId)) return null;
  const [project] = await db
    .select()
    .from(designProjects)
    .where(eq(designProjects.id, projectId))
    .limit(1);
  if (!project || project.officeAccountId !== officeAccountId) return null;
  return project;
}

async function latestVersion(projectId: string) {
  const [version] = await db
    .select()
    .from(designProjectVersions)
    .where(eq(designProjectVersions.projectId, projectId))
    .orderBy(desc(designProjectVersions.createdAt))
    .limit(1);
  return version ?? null;
}

router.get("/office/design-studio/canva/status", requireStudio, async (req, res): Promise<void> => {
  const configured = canvaConfigured();
  if (!configured) {
    res.json({ configured: false, connected: false, scopes: [] });
    return;
  }
  try {
    const connection = await getCanvaConnection(req.officeAccount!.accountId);
    res.json({
      configured: true,
      connected: connectionReady(connection),
      scopes: connection?.scopes ?? [],
      requiredScopes: [...CANVA_SCOPES],
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Canva connection status");
    res.status(500).json({ error: "CANVA_STATUS_FAILED" });
  }
});

router.post("/office/design-studio/canva/connect", requireStudio, async (req, res): Promise<void> => {
  try {
    const started = await startCanvaOauth({
      officeAccountId: req.officeAccount!.accountId,
      returnPath: typeof req.body?.returnPath === "string" ? req.body.returnPath : undefined,
    });
    res.json({ authorizationUrl: started.authorizationUrl });
  } catch (error) {
    const code = safeCanvaError(error, "CANVA_CONNECT_FAILED");
    res.status(code === "CANVA_CONNECT_NOT_CONFIGURED" ? 503 : 500).json({ error: code });
  }
});

router.get("/office/design-studio/canva/callback", async (req, res): Promise<void> => {
  const state = queryValue(req.query.state);
  const code = queryValue(req.query.code);
  const providerError = queryValue(req.query.error);
  if (!state || (!code && !providerError)) {
    res.status(400).json({ error: "CANVA_OAUTH_CALLBACK_INVALID" });
    return;
  }

  try {
    if (providerError) {
      const oauthState = await consumeCanvaOauthState(state);
      if (!oauthState) {
        res.status(400).json({ error: "CANVA_OAUTH_STATE_INVALID_OR_EXPIRED" });
        return;
      }
      const errorCode = providerError === "access_denied"
        ? "CANVA_OAUTH_ACCESS_DENIED"
        : "CANVA_OAUTH_PROVIDER_REJECTED";
      res.redirect(303, safeReturnUrl(oauthState.returnPath, { error: errorCode }));
      return;
    }

    const completed = await completeCanvaOauth({ state, code: code! });
    res.redirect(303, safeReturnUrl(completed.returnPath, { connected: true }));
  } catch (error) {
    const codeValue = safeCanvaError(error, "CANVA_OAUTH_CALLBACK_FAILED");
    const status = codeValue === "CANVA_OAUTH_STATE_INVALID_OR_EXPIRED" ? 400 : 502;
    res.status(status).json({ error: codeValue });
  }
});

router.delete("/office/design-studio/canva/connection", requireStudio, async (req, res): Promise<void> => {
  try {
    await deleteCanvaConnection(req.officeAccount!.accountId);
    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Failed to disconnect Canva");
    res.status(500).json({ error: "CANVA_DISCONNECT_FAILED" });
  }
});

router.get("/office/design-studio/projects/:projectId/canva", requireStudio, async (req, res): Promise<void> => {
  const projectId = routeParam(req.params.projectId);
  try {
    const project = await ownedProject(projectId, req.officeAccount!.accountId);
    if (!project) {
      res.status(404).json({ error: "Design project not found." });
      return;
    }

    const [connection, link, version] = await Promise.all([
      getCanvaConnection(req.officeAccount!.accountId),
      getProjectCanvaLink(projectId),
      latestVersion(projectId),
    ]);
    res.json({
      configured: canvaConfigured(),
      connected: connectionReady(connection),
      linked: Boolean(link?.designId),
      designId: link?.designId ?? null,
      importedVersionId: link?.importedVersionId ?? null,
      currentVersionId: version?.id ?? null,
      outdated: Boolean(link && version && link.importedVersionId !== version.id),
      linkStatus: link?.status ?? null,
      lastError: link?.lastError ?? null,
    });
  } catch (error) {
    req.log.error({ err: error, projectId }, "Failed to load Canva project state");
    res.status(500).json({ error: "CANVA_PROJECT_STATE_FAILED" });
  }
});

router.get("/office/design-studio/projects/:projectId/canva/edit-url", requireStudio, async (req, res): Promise<void> => {
  const projectId = routeParam(req.params.projectId);
  try {
    const project = await ownedProject(projectId, req.officeAccount!.accountId);
    if (!project) {
      res.status(404).json({ error: "Design project not found." });
      return;
    }
    const link = await getProjectCanvaLink(projectId);
    if (!link?.designId) {
      res.status(404).json({ error: "CANVA_PROJECT_NOT_LINKED" });
      return;
    }
    const editUrl = await getFreshCanvaEditUrl(req.officeAccount!.accountId, link.designId);
    res.json({ editUrl, designId: link.designId });
  } catch (error) {
    const code = safeCanvaError(error, "CANVA_EDIT_URL_FAILED");
    res.status(code === "CANVA_NOT_CONNECTED" || code === "CANVA_RECONNECT_REQUIRED" ? 412 : 502).json({ error: code });
  }
});

router.post(
  "/office/design-studio/projects/:projectId/canva/import",
  requireStudio,
  express.raw({ type: "application/pdf", limit: "20mb" }),
  async (req, res): Promise<void> => {
    const projectId = routeParam(req.params.projectId);
    try {
      if (!canvaConfigured()) {
        res.status(503).json({ error: "CANVA_CONNECT_NOT_CONFIGURED" });
        return;
      }
      const project = await ownedProject(projectId, req.officeAccount!.accountId);
      if (!project) {
        res.status(404).json({ error: "Design project not found." });
        return;
      }
      const version = await latestVersion(projectId);
      if (!version) {
        res.status(409).json({ error: "CANVA_IMPORT_REQUIRES_SAVED_VERSION" });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.byteLength === 0) {
        res.status(400).json({ error: "CANVA_IMPORT_PDF_REQUIRED" });
        return;
      }

      const imported = await importPdfToCanva({
        officeAccountId: req.officeAccount!.accountId,
        projectId,
        versionId: version.id,
        title: project.name,
        pdfBytes: new Uint8Array(req.body),
      });
      res.status(201).json(imported);
    } catch (error) {
      const code = safeCanvaError(error, "CANVA_IMPORT_FAILED");
      const status =
        code === "CANVA_NOT_CONNECTED" || code === "CANVA_RECONNECT_REQUIRED"
          ? 412
          : code === "CANVA_CONNECT_NOT_CONFIGURED"
            ? 503
            : 502;
      req.log.error({ err: error, projectId }, "Failed to import Design Studio project to Canva");
      res.status(status).json({ error: code });
    }
  },
);

export default router;
