import { randomUUID } from "node:crypto";
import express, { Router, type IRouter } from "express";
import { z } from "zod";

import {
  businessDocumentCategoryValues,
  businessDocumentReviewStateValues,
} from "@workspace/db";
import { BusinessDocumentService } from "@/features/business-documents/business-document-service";
import { BusinessDocumentIngestion } from "@/features/business-documents/business-document-ingestion";

const uuid = z.string().uuid();
const listQuery = z.object({
  profileId: uuid.optional(),
  category: z.enum(businessDocumentCategoryValues).optional(),
  reviewState: z.enum(businessDocumentReviewStateValues).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).max(100_000).optional(),
}).strict();
const linkBody = z.object({
  targetKind: z.enum(["profile", "booking", "event_family"]),
  targetId: uuid,
  confidence: z.number().min(0).max(1).nullable().optional(),
  evidence: z.array(z.record(z.string(), z.unknown())).max(25).optional(),
}).strict();
const deleteBody = z.object({ confirmation: z.literal("DELETE") }).strict();
const updateBody = z.object({
  displayName: z.string().trim().min(1).max(255),
  category: z.enum(businessDocumentCategoryValues),
  notes: z.string().trim().max(5000).nullable(),
}).strict();
const targetCorrection = z.object({
  targetKind: z.enum(["profile", "booking", "event_family"]),
  targetId: uuid,
}).strict();
const corrections = z.object({
  category: z.enum(businessDocumentCategoryValues).optional(),
  effectiveDate: z.string().date().nullable().optional(),
  issueDate: z.string().date().nullable().optional(),
  expirationDate: z.string().date().nullable().optional(),
  targets: z.array(targetCorrection).max(25).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one correction.");
const reviewActionBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }).strict(),
  z.object({ action: z.literal("correct_and_approve"), corrections }).strict(),
  z.object({ action: z.literal("non_business") }).strict(),
  z.object({ action: z.literal("defer"), deferredUntil: z.string().datetime() }).strict(),
  z.object({ action: z.literal("retry") }).strict(),
]);

type Service = BusinessDocumentService;
type Ingestion = Pick<BusinessDocumentIngestion, "ingest">;

function actor(req: unknown) {
  const request = req as {
    userId?: string;
    bossAccount?: { accountId: string };
    officeAccount?: { accountId: string };
  };
  return String(
    request.userId
      ?? (request.bossAccount ? `boss:${request.bossAccount.accountId}` : undefined)
      ?? (request.officeAccount ? `office:${request.officeAccount.accountId}` : undefined)
      ?? "owner",
  );
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

function safeUploadFilename(header: string | string[] | undefined) {
  if (typeof header !== "string") return null;
  try {
    const decoded = decodeURIComponent(header).replaceAll("\\", "/");
    const filename = decoded.split("/").at(-1)?.trim() ?? "";
    if (!filename || filename === "." || filename === ".." || filename.length > 255 || /[\u0000-\u001f]/.test(filename)) return null;
    return filename;
  } catch {
    return null;
  }
}

function safeUploadDisplayName(header: string | string[] | undefined) {
  if (typeof header !== "string") return null;
  try {
    const value = decodeURIComponent(header).trim();
    if (!value || value.length > 255 || /[\u0000-\u001f]/.test(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function createBusinessDocumentsRouter(
  service: Service = new BusinessDocumentService(),
  ingestion: Ingestion = new BusinessDocumentIngestion(),
): IRouter {
  const router = Router();

  router.post("/business-documents/upload", express.raw({ type: () => true, limit: "25mb" }), async (req, res) => {
    const filename = safeUploadFilename(req.headers["x-file-name"]);
    const bytes = req.body instanceof Buffer ? new Uint8Array(req.body) : new Uint8Array();
    const rawMimeType = req.headers["content-type"];
    const mimeType = (Array.isArray(rawMimeType) ? rawMimeType[0] : rawMimeType)?.split(";", 1)[0]?.trim() || "application/octet-stream";
    const rawDisplayName = req.headers["x-document-name"];
    const rawCategory = req.headers["x-document-category"];
    const hasUploadMetadata = rawDisplayName !== undefined || rawCategory !== undefined;
    const uploadMetadata = hasUploadMetadata
      ? z.object({
          displayName: z.string().min(1).max(255),
          category: z.enum(businessDocumentCategoryValues),
        }).safeParse({
          displayName: safeUploadDisplayName(rawDisplayName),
          category: Array.isArray(rawCategory) ? rawCategory[0] : rawCategory,
        })
      : null;
    if (!filename || !bytes.length) { res.status(400).json({ error: "Choose a non-empty document with a safe filename." }); return; }
    if (uploadMetadata && !uploadMetadata.success) { res.status(400).json({ error: "Choose a valid document name and category." }); return; }
    try {
      const result = await ingestion.ingest({
        bytes,
        filename,
        mimeType,
        subject: filename,
        bodyText: "",
        source: { sourceKind: "manual", sourceAccountKey: "owner", externalId: randomUUID(), originalUrl: null, metadata: {} },
        evidence: { approvedThreadProfileId: null, exactEmailProfileIds: [], exactEventMatches: [], fuzzyNameMatches: [] },
        actor: actor(req),
      });
      if (result.outcome === "skipped") { res.status(422).json({ error: "That file is not an importable business document." }); return; }
      if (uploadMetadata?.success) {
        await service.update(result.documentId, {
          displayName: uploadMetadata.data.displayName,
          category: uploadMetadata.data.category,
          notes: null,
        }, actor(req));
      }
      res.status(201).json(result);
    } catch {
      res.status(503).json({ error: "Could not store that business document." });
    }
  });

  router.get("/business-documents/review-count", async (_req, res) => {
    try { res.json({ count: await service.pendingReviewCount() }); }
    catch { res.status(503).json({ error: "Could not load document review count." }); }
  });

  router.get("/business-documents/reviews", async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(100).catch(50).parse(req.query.limit);
    try { res.json({ items: await service.reviewItems(limit) }); }
    catch { res.status(503).json({ error: "Could not load document reviews." }); }
  });

  router.post("/business-documents/reviews/:reviewId/actions", async (req, res) => {
    const reviewId = idParam(req.params.reviewId);
    const parsed = reviewActionBody.safeParse(req.body);
    if (!uuid.safeParse(reviewId).success || !parsed.success) { res.status(400).json({ error: "Review the document action." }); return; }
    try { res.json(await service.reviewAction(reviewId, parsed.data, actor(req))); }
    catch (error) {
      const message = error instanceof Error ? error.message : "";
      res.status(message === "BUSINESS_DOCUMENT_REVIEW_NOT_FOUND" ? 404 : message === "BUSINESS_DOCUMENT_RETRY_NOT_ALLOWED" ? 409 : 503)
        .json({ error: message === "BUSINESS_DOCUMENT_REVIEW_NOT_FOUND" ? "Document review not found." : "Could not apply the document review action." });
    }
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

  router.patch("/business-documents/:documentId", async (req, res) => {
    const documentId = idParam(req.params.documentId);
    const parsed = updateBody.safeParse(req.body);
    if (!uuid.safeParse(documentId).success || !parsed.success) { res.status(400).json({ error: "Review the document details." }); return; }
    try { res.json({ document: await service.update(documentId, parsed.data, actor(req)) }); }
    catch (error) { res.status(statusFor(error)).json({ error: error instanceof Error && error.message === "BUSINESS_DOCUMENT_NOT_FOUND" ? "Business document not found." : "Could not update the business document." }); }
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
