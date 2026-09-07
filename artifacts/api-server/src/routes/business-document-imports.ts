import { Router, type IRouter } from "express";
import { z } from "zod";
import { BusinessDocumentImportService, PostgresBusinessDocumentImportStore } from "@/features/business-documents/business-document-import-service";
import { BusinessDocumentIngestion } from "@/features/business-documents/business-document-ingestion";
import { GoogleDriveDocumentSource } from "@/features/business-documents/google-drive-document-source";
import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";

const uuid = z.string().uuid();
const previewBody = z.object({ folderIds: z.array(z.string().trim().min(1).max(500)).min(1).max(25) }).strict();
const startBody = z.object({ previewRunId: uuid, confirmation: z.literal("START PILOT"), pilotLimit: z.number().int().min(1).max(100).optional() }).strict();
const retryBody = z.object({ confirmation: z.literal("RETRY") }).strict();
type Service = Pick<BusinessDocumentImportService, "preview" | "startApproved" | "get" | "retry">;
type Factory = () => Promise<Service>;

async function productionService(): Promise<Service> {
  const client = await new PostgresGoogleConnectionRepository().createReadClient();
  if (!client?.listDriveFiles || !client.downloadDriveFile) throw new Error("GOOGLE_DRIVE_NOT_CONNECTED");
  return new BusinessDocumentImportService({
    source: new GoogleDriveDocumentSource(client),
    store: new PostgresBusinessDocumentImportStore(),
    ingestion: new BusinessDocumentIngestion(),
    accountKey: "workspace",
  });
}

function actor(req: unknown) { return String((req as { userId?: string }).userId ?? "owner"); }
function param(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }

export function createBusinessDocumentImportsRouter(factory: Factory = productionService): IRouter {
  const router = Router();
  router.post("/business-document-imports/drive/preview", async (req, res) => {
    const parsed = previewBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Choose one or more approved Drive folders." }); return; }
    try { res.json(await (await factory()).preview(parsed.data.folderIds, actor(req))); }
    catch { res.status(503).json({ error: "Could not preview the approved Drive folders." }); }
  });
  router.post("/business-document-imports/drive/start", async (req, res) => {
    const parsed = startBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Preview the folders and confirm START PILOT first." }); return; }
    try { res.status(202).json(await (await factory()).startApproved(parsed.data.previewRunId, actor(req), parsed.data.pilotLimit)); }
    catch { res.status(409).json({ error: "The Drive preview is no longer available; preview again." }); }
  });
  router.get("/business-document-imports/:runId", async (req, res) => {
    const runId = param(req.params.runId);
    if (!uuid.safeParse(runId).success) { res.status(400).json({ error: "Invalid import run." }); return; }
    try { res.json({ run: await (await factory()).get(runId) }); }
    catch { res.status(404).json({ error: "Import run not found." }); }
  });
  router.post("/business-document-imports/:runId/retry", async (req, res) => {
    const runId = param(req.params.runId);
    const parsed = retryBody.safeParse(req.body);
    if (!uuid.safeParse(runId).success || !parsed.success) { res.status(400).json({ error: "Confirm RETRY for this import." }); return; }
    try { res.status(202).json(await (await factory()).retry(runId, actor(req))); }
    catch { res.status(409).json({ error: "Only a completed pilot can retry failed files." }); }
  });
  return router;
}

export default createBusinessDocumentImportsRouter();
