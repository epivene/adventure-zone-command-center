import { Router, type IRouter } from "express";
import { z } from "zod";
import { BusinessDocumentImportService, PostgresBusinessDocumentImportStore } from "@/features/business-documents/business-document-import-service";
import { BusinessDocumentIngestion } from "@/features/business-documents/business-document-ingestion";
import { GoogleDriveDocumentSource } from "@/features/business-documents/google-drive-document-source";
import { GoogleGmailDocumentSource, PostgresExistingGoogleProfileFileLookup } from "@/features/business-documents/google-gmail-document-source";
import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";
import { logger } from "@/lib/logger";

const uuid = z.string().uuid();
const previewBody = z.object({ folderIds: z.array(z.string().trim().min(1).max(500)).min(1).max(25) }).strict();
const startBody = z.object({ previewRunId: uuid, confirmation: z.literal("START PILOT"), pilotLimit: z.number().int().min(1).max(100).optional() }).strict();
const retryBody = z.object({ confirmation: z.literal("RETRY") }).strict();
const gmailPreviewBody = z.object({ after: z.string().date(), before: z.string().date() }).strict().refine((value) => value.after < value.before, "The Gmail date window is invalid.");
const gmailStartBody = z.object({ previewRunId: uuid, confirmation: z.literal("START PILOT"), pilotLimit: z.number().int().min(1).max(100).optional() }).strict();
type Service = Pick<BusinessDocumentImportService, "preview" | "startApproved" | "previewGmail" | "startApprovedGmail" | "get" | "retry">;
type Factory = () => Promise<Service>;

async function productionService(): Promise<Service> {
  const client = await new PostgresGoogleConnectionRepository().createReadClient();
  if (!client?.listDriveFiles || !client.downloadDriveFile) throw new Error("GOOGLE_DRIVE_NOT_CONNECTED");
  return new BusinessDocumentImportService({
    source: new GoogleDriveDocumentSource(client),
    gmailSource: new GoogleGmailDocumentSource(client, new PostgresExistingGoogleProfileFileLookup()),
    store: new PostgresBusinessDocumentImportStore(),
    ingestion: new BusinessDocumentIngestion(),
    accountKey: "workspace",
  });
}

function actor(req: unknown) { return String((req as { userId?: string }).userId ?? "owner"); }
function param(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
function observeImport(job: Promise<unknown>, source: "drive" | "gmail", previewRunId: string) {
  void job
    .then(() => logger.info({ source, previewRunId }, "Business document pilot completed"))
    .catch(() => logger.warn({ source, previewRunId }, "Business document pilot failed"));
}

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
    try {
      const job = (await factory()).startApproved(parsed.data.previewRunId, actor(req), parsed.data.pilotLimit);
      observeImport(job, "drive", parsed.data.previewRunId);
      res.status(202).json({ accepted: true, previewRunId: parsed.data.previewRunId });
    }
    catch { res.status(409).json({ error: "The Drive preview is no longer available; preview again." }); }
  });
  router.post("/business-document-imports/gmail/preview", async (req, res) => {
    const parsed = gmailPreviewBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Choose a valid bounded Gmail date window." }); return; }
    try { res.json(await (await factory()).previewGmail(parsed.data, actor(req))); }
    catch { res.status(503).json({ error: "Could not preview Gmail attachments." }); }
  });
  router.post("/business-document-imports/gmail/start", async (req, res) => {
    const parsed = gmailStartBody.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Preview Gmail and confirm START PILOT first." }); return; }
    try {
      const job = (await factory()).startApprovedGmail(parsed.data.previewRunId, actor(req), parsed.data.pilotLimit);
      observeImport(job, "gmail", parsed.data.previewRunId);
      res.status(202).json({ accepted: true, previewRunId: parsed.data.previewRunId });
    }
    catch { res.status(409).json({ error: "The Gmail preview is no longer available; preview again." }); }
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
