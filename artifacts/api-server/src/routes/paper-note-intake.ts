import express, { Router, type IRouter, type Request } from "express";
import { z } from "zod";

import type { PaperNoteIntakeService } from "@/features/paper-notes/paper-note-intake-service";
import { PaperNoteIntakeError } from "@/features/paper-notes/paper-note-intake-service";

const uuid = z.string().uuid();
const batchSchema = z.object({
  name: z.string().trim().max(160).nullable().optional(),
}).strict();
const pageSchema = z.object({
  filename: z.string().trim().min(1).max(240),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().min(1).max(12 * 1024 * 1024),
  paperYear: z.number().int().min(1900).max(2100),
}).strict();
const pageMutationSchema = z.object({
  orderedPageIds: z.array(uuid).max(25).optional(),
  rotation: z.object({
    pageId: uuid,
    rotationDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  }).optional(),
}).strict().refine((value) => Boolean(value.orderedPageIds || value.rotation), {
  message: "Add a page order or rotation change.",
});

function ownerId(req: Request) {
  return (req as Request & { userId?: string }).userId ?? "";
}

function id(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function errorStatus(error: PaperNoteIntakeError) {
  if (error.code === "BATCH_NOT_FOUND" || error.code === "PAGE_NOT_FOUND") return 404;
  if (error.code === "STORAGE_UNAVAILABLE") return 503;
  if (error.code === "BATCH_NOT_EDITABLE" || error.code === "DUPLICATE_PAGE" || error.code === "PAGES_INCOMPLETE") return 409;
  if (error.code === "IMAGE_TOO_LARGE") return 413;
  return 400;
}

function sendError(res: any, error: unknown) {
  if (error instanceof PaperNoteIntakeError) {
    res.status(errorStatus(error)).json({ error: error.message, code: error.code });
    return;
  }
  res.status(500).json({ error: "Paper notes could not be updated. Try again." });
}

type IntakeService = Pick<
  PaperNoteIntakeService,
  | "createBatch"
  | "listBatches"
  | "getBatch"
  | "createPage"
  | "uploadPage"
  | "reorderPages"
  | "rotatePage"
  | "deletePage"
  | "deleteBatch"
  | "queueBatch"
>;

export function createPaperNoteIntakeRouter(service: IntakeService): IRouter {
  const router = Router();

  router.post("/paper-notes/batches", async (req, res): Promise<void> => {
    const parsed = batchSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the batch name." });
      return;
    }
    try {
      const batchId = await service.createBatch({
        createdBy: ownerId(req),
        name: parsed.data.name?.trim() || null,
        now: new Date(),
      });
      res.status(201).json({ batchId });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/paper-notes/batches", async (req, res): Promise<void> => {
    try {
      res.json({ batches: await service.listBatches(ownerId(req)) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/paper-notes/batches/:batchId", async (req, res): Promise<void> => {
    const batchId = id(req.params.batchId);
    if (!uuid.safeParse(batchId).success) { res.status(400).json({ error: "Invalid batch ID." }); return; }
    try {
      const batch = await service.getBatch(ownerId(req), batchId);
      if (!batch) { res.status(404).json({ error: "Paper note batch was not found." }); return; }
      res.json({ batch });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/paper-notes/batches/:batchId", async (req, res): Promise<void> => {
    const batchId = id(req.params.batchId);
    if (!uuid.safeParse(batchId).success) { res.status(400).json({ error: "Invalid batch ID." }); return; }
    try {
      await service.deleteBatch({ createdBy: ownerId(req), batchId });
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/paper-notes/batches/:batchId/pages", async (req, res): Promise<void> => {
    const batchId = id(req.params.batchId);
    const parsed = pageSchema.safeParse(req.body);
    if (!uuid.safeParse(batchId).success || !parsed.success) {
      res.status(400).json({ error: parsed.success ? "Invalid batch ID." : parsed.error.issues[0]?.message ?? "Review the page details." });
      return;
    }
    try {
      const pageId = await service.createPage({
        createdBy: ownerId(req),
        batchId,
        ...parsed.data,
        now: new Date(),
      });
      res.status(201).json({ pageId });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.put(
    "/paper-notes/batches/:batchId/pages/:pageId/image",
    express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "12mb" }),
    async (req, res): Promise<void> => {
      const batchId = id(req.params.batchId);
      const pageId = id(req.params.pageId);
      if (!uuid.safeParse(batchId).success || !uuid.safeParse(pageId).success) {
        res.status(400).json({ error: "Invalid paper note page ID." });
        return;
      }
      const bytes = req.body instanceof Buffer ? new Uint8Array(req.body) : new Uint8Array();
      if (!bytes.length) { res.status(400).json({ error: "Paper note image is required." }); return; }
      const header = req.headers["content-type"];
      const mimeType = Array.isArray(header) ? header[0] ?? "" : header ?? "";
      try {
        await service.uploadPage({
          createdBy: ownerId(req),
          batchId,
          pageId,
          bytes,
          mimeType,
          now: new Date(),
        });
        res.json({ ok: true });
      } catch (error) {
        sendError(res, error);
      }
    },
  );

  router.patch("/paper-notes/batches/:batchId/pages", async (req, res): Promise<void> => {
    const batchId = id(req.params.batchId);
    const parsed = pageMutationSchema.safeParse(req.body);
    if (!uuid.safeParse(batchId).success || !parsed.success) {
      res.status(400).json({ error: parsed.success ? "Invalid batch ID." : parsed.error.issues[0]?.message ?? "Review the page change." });
      return;
    }
    try {
      const now = new Date();
      if (parsed.data.orderedPageIds) {
        await service.reorderPages({ createdBy: ownerId(req), batchId, orderedPageIds: parsed.data.orderedPageIds, now });
      }
      if (parsed.data.rotation) {
        await service.rotatePage({ createdBy: ownerId(req), batchId, ...parsed.data.rotation, now });
      }
      res.json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/paper-notes/batches/:batchId/pages/:pageId", async (req, res): Promise<void> => {
    const batchId = id(req.params.batchId);
    const pageId = id(req.params.pageId);
    if (!uuid.safeParse(batchId).success || !uuid.safeParse(pageId).success) {
      res.status(400).json({ error: "Invalid paper note page ID." });
      return;
    }
    try {
      await service.deletePage({ createdBy: ownerId(req), batchId, pageId, now: new Date() });
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/paper-notes/batches/:batchId/extract", async (req, res): Promise<void> => {
    const batchId = id(req.params.batchId);
    if (!uuid.safeParse(batchId).success) { res.status(400).json({ error: "Invalid batch ID." }); return; }
    try {
      await service.queueBatch({ createdBy: ownerId(req), batchId, now: new Date() });
      res.status(202).json({ ok: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
