import express, { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@workspace/db";
import { businessSourceDocuments } from "@/db/schema";
import {
  DrizzleSourceDocumentFileMetadataStore,
  deleteSourceDocumentFile,
  getSourceDocumentSignedReadUrl,
  uploadSourceDocumentFile,
  type SourceDocumentFileRecord,
} from "@/features/business-sources/source-document-file-service";
import { GoogleCloudSourceDocumentObjectStorage } from "@/features/business-sources/source-document-storage";

const router: IRouter = Router();
const documentIdSchema = z.string().uuid();
const store = new DrizzleSourceDocumentFileMetadataStore(db);
const storage = new GoogleCloudSourceDocumentObjectStorage();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeFileMetadata(file: SourceDocumentFileRecord) {
  return {
    id: file.id,
    sourceDocumentId: file.sourceDocumentId,
    mimeType: file.mimeType,
    originalSizeBytes: file.originalSizeBytes,
    sha256Hex: file.sha256Hex,
    uploadedBy: file.uploadedBy,
    uploadedAt: file.uploadedAt,
  };
}

router.put(
  "/business-sources/:documentId/file",
  express.raw({ type: "*/*", limit: "30mb" }),
  async (req, res): Promise<void> => {
    const documentId = param(req.params.documentId);
    if (!documentIdSchema.safeParse(documentId).success) {
      res.status(400).json({ error: "Invalid business source document ID." });
      return;
    }

    const bytes = req.body instanceof Buffer
      ? new Uint8Array(req.body)
      : new Uint8Array();
    if (!bytes.length) {
      res.status(400).json({ error: "Source document file is required." });
      return;
    }

    const [document] = await db
      .select({ originalFilename: businessSourceDocuments.originalFilename })
      .from(businessSourceDocuments)
      .where(eq(businessSourceDocuments.id, documentId))
      .limit(1);
    if (!document) {
      res.status(404).json({ error: "Business source document not found." });
      return;
    }

    const rawContentType = req.headers["content-type"];
    const contentType = (Array.isArray(rawContentType) ? rawContentType[0] : rawContentType)
      ?.split(";", 1)[0]
      ?.trim() || "application/octet-stream";

    try {
      const file = await uploadSourceDocumentFile(store, storage, {
        documentId,
        originalFilename: document.originalFilename,
        mimeType: contentType,
        bytes,
        actorId: String((req as any).userId ?? "owner"),
      });
      res.json({ file: safeFileMetadata(file) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message === "Unsupported source document file type") {
        res.status(415).json({ error: message });
        return;
      }
      if (message === "Source document file is too large") {
        res.status(413).json({ error: message });
        return;
      }
      if (message === "SOURCE_DOCUMENT_NOT_FOUND") {
        res.status(404).json({ error: "Business source document not found." });
        return;
      }
      req.log.error({ err: error }, "Failed to upload business source document file");
      res.status(503).json({ error: "Could not store the source document file." });
    }
  },
);

router.post("/business-sources/:documentId/file/open", async (req, res): Promise<void> => {
  const documentId = param(req.params.documentId);
  if (!documentIdSchema.safeParse(documentId).success) {
    res.status(400).json({ error: "Invalid business source document ID." });
    return;
  }
  try {
    const signedUrl = await getSourceDocumentSignedReadUrl(store, storage, documentId);
    if (!signedUrl) {
      res.status(404).json({ error: "No file has been uploaded for this source document." });
      return;
    }
    res.json({ url: signedUrl });
  } catch (error) {
    req.log.error({ err: error }, "Failed to create source document signed link");
    res.status(503).json({ error: "Could not open the source document file." });
  }
});

router.get("/business-sources/:documentId/file", async (req, res): Promise<void> => {
  const documentId = param(req.params.documentId);
  if (!documentIdSchema.safeParse(documentId).success) {
    res.status(400).json({ error: "Invalid business source document ID." });
    return;
  }
  try {
    const signedUrl = await getSourceDocumentSignedReadUrl(store, storage, documentId);
    if (!signedUrl) {
      res.status(404).json({ error: "No file has been uploaded for this source document." });
      return;
    }
    res.redirect(302, signedUrl);
  } catch (error) {
    req.log.error({ err: error }, "Failed to open business source document file");
    res.status(503).json({ error: "Could not open the source document file." });
  }
});

router.delete("/business-sources/:documentId/file", async (req, res): Promise<void> => {
  const documentId = param(req.params.documentId);
  if (!documentIdSchema.safeParse(documentId).success) {
    res.status(400).json({ error: "Invalid business source document ID." });
    return;
  }
  try {
    const deleted = await deleteSourceDocumentFile(store, storage, documentId);
    if (!deleted) {
      res.status(404).json({ error: "No file has been uploaded for this source document." });
      return;
    }
    res.json({ file: safeFileMetadata(deleted) });
  } catch (error) {
    req.log.error({ err: error }, "Failed to delete business source document file");
    res.status(503).json({ error: "Could not delete the source document file." });
  }
});

export default router;
