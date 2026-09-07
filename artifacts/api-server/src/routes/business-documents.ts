import { Router, type IRouter } from "express";
import { z } from "zod";

import {
  businessDocumentCategoryValues,
  businessDocumentReviewStateValues,
} from "@workspace/db";
import { BusinessDocumentService } from "@/features/business-documents/business-document-service";

const uuid = z.string().uuid();
const listQuery = z.object({
  profileId: uuid.optional(),
  category: z.enum(businessDocumentCategoryValues).optional(),
  reviewState: z.enum(businessDocumentReviewStateValues).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();
const linkBody = z.object({
  targetKind: z.enum(["profile", "booking", "event_family"]),
  targetId: uuid,
  confidence: z.number().min(0).max(1).nullable().optional(),
  evidence: z.array(z.record(z.string(), z.unknown())).max(25).optional(),
}).strict();
const deleteBody = z.object({ confirmation: z.literal("DELETE") }).strict();

type Service = BusinessDocumentService;

function actor(req: unknown) {
  return String((req as { userId?: string }).userId ?? "owner");
}

function idParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function statusFor(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "BUSINESS_DOCUMENT_NOT_FOUND") return 404;
  if (message === "BUSINESS_DOCUMENT_FILE_UNAVAILABLE") return 409;
  return 503;
}

export function createBusinessDocumentsRouter(
  service: Service = new BusinessDocumentService(),
): IRouter {
  const router = Router();

  router.get("/business-documents/review-count", async (_req, res) => {
    try { res.json({ count: await service.pendingReviewCount() }); }
    catch { res.status(503).json({ error: "Could not load document review count." }); }
  });

  router.get("/business-documents", async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: "Invalid document filters." }); return; }
    try { res.json({ documents: await service.list(parsed.data) }); }
    catch { res.status(503).json({ error: "Could not load business documents." }); }
  });

  router.get("/business-documents/:documentId", async (req, res) => {
    const documentId = idParam(req.params.documentId);
    if (!uuid.safeParse(documentId).success) { res.status(400).json({ error: "Invalid business document ID." }); return; }
    try { res.json({ document: await service.detail(documentId) }); }
    catch (error) { res.status(statusFor(error)).json({ error: error instanceof Error && error.message === "BUSINESS_DOCUMENT_NOT_FOUND" ? "Business document not found." : "Could not load the business document." }); }
  });

  router.post("/business-documents/:documentId/open", async (req, res) => {
    const documentId = idParam(req.params.documentId);
    if (!uuid.safeParse(documentId).success) { res.status(400).json({ error: "Invalid business document ID." }); return; }
    try { res.json({ url: await service.open(documentId) }); }
    catch (error) { res.status(statusFor(error)).json({ error: "The protected document file is unavailable." }); }
  });

  router.post("/business-documents/:documentId/links", async (req, res) => {
    const documentId = idParam(req.params.documentId);
    const parsed = linkBody.safeParse(req.body);
    if (!uuid.safeParse(documentId).success || !parsed.success) { res.status(400).json({ error: "Invalid document link." }); return; }
    await service.addLink(documentId, {
      ...parsed.data,
      confidence: parsed.data.confidence ?? null,
      evidence: parsed.data.evidence ?? [],
      confirmationMode: "manual",
    }, actor(req));
    res.status(201).json({ ok: true });
  });

  router.delete("/business-documents/:documentId/links/:linkId", async (req, res) => {
    const documentId = idParam(req.params.documentId);
    const linkId = idParam(req.params.linkId);
    if (!uuid.safeParse(documentId).success || !uuid.safeParse(linkId).success) { res.status(400).json({ error: "Invalid document link." }); return; }
    const removed = await service.unlink(documentId, linkId, actor(req));
    if (!removed) { res.status(404).json({ error: "Document link not found." }); return; }
    res.json({ ok: true });
  });

  router.post("/business-documents/:documentId/archive", async (req, res) => {
    const documentId = idParam(req.params.documentId);
    if (!uuid.safeParse(documentId).success) { res.status(400).json({ error: "Invalid business document ID." }); return; }
    const archived = await service.archive(documentId, actor(req));
    if (!archived) { res.status(404).json({ error: "Active business document not found." }); return; }
    res.json({ ok: true });
  });

  router.delete("/business-documents/:documentId", async (req, res) => {
    const documentId = idParam(req.params.documentId);
    const parsed = deleteBody.safeParse(req.body);
    if (!uuid.safeParse(documentId).success || !parsed.success) { res.status(400).json({ error: "Type DELETE to confirm document deletion." }); return; }
    const deleted = await service.delete(documentId, actor(req));
    if (!deleted) { res.status(404).json({ error: "Business document not found." }); return; }
    res.json({ ok: true });
  });

  return router;
}

export default createBusinessDocumentsRouter();
