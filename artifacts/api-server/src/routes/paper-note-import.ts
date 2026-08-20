import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";

import { PaperNoteImportError } from "@/features/paper-notes/paper-note-import-service";
import type { PaperNoteBatchPreflight } from "@/features/paper-notes/paper-note-preflight-service";
import type { PaperNoteImportSummary } from "@/features/paper-notes/paper-note-types";

const idSchema = z.string().uuid();
const importSchema = z.object({ requestKey: z.string().uuid() });
type OwnerRequest = Request & { userId?: string };

function actorId(request: OwnerRequest) {
  return request.userId ?? "";
}

function mapError(error: unknown, response: Response) {
  if (error instanceof PaperNoteImportError) {
    const status = error.code === "BATCH_NOT_FOUND"
      ? 404
      : error.code === "BATCH_NOT_READY" || error.code === "IMPORT_IN_PROGRESS" || error.code === "ENTRY_INVALID" || error.code === "CONTACT_NOT_FOUND"
        ? 409
        : 500;
    response.status(status).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

export function createPaperNoteImportRouter(input: {
  preflight(input: { actorId: string; batchId: string; now: Date }): Promise<PaperNoteBatchPreflight>;
  importBatch(input: { actorId: string; batchId: string; requestKey: string; now: Date }): Promise<PaperNoteImportSummary>;
  archiveBatch(actorId: string, batchId: string, now: Date): Promise<void>;
}): IRouter {
  const router = Router();

  router.post("/paper-notes/batches/:batchId/preflight", async (req, res, next) => {
    const batchId = idSchema.safeParse(req.params.batchId);
    if (!batchId.success) {
      res.status(400).json({ error: "Review the paper-note batch link." });
      return;
    }
    try {
      const preflight = await input.preflight({
        actorId: actorId(req as OwnerRequest),
        batchId: batchId.data,
        now: new Date(),
      });
      res.status(preflight.ready ? 200 : 409).json({ preflight });
    } catch (error) {
      next(error);
    }
  });

  router.post("/paper-notes/batches/:batchId/import", async (req, res, next) => {
    const batchId = idSchema.safeParse(req.params.batchId);
    const body = importSchema.safeParse(req.body);
    if (!batchId.success || !body.success) {
      res.status(400).json({ error: "A valid import request key is required." });
      return;
    }
    try {
      const summary = await input.importBatch({
        actorId: actorId(req as OwnerRequest),
        batchId: batchId.data,
        requestKey: body.data.requestKey,
        now: new Date(),
      });
      res.json({ summary });
    } catch (error) {
      if (!mapError(error, res)) next(error);
    }
  });

  router.post("/paper-notes/batches/:batchId/archive", async (req, res, next) => {
    const batchId = idSchema.safeParse(req.params.batchId);
    if (!batchId.success) {
      res.status(400).json({ error: "Review the paper-note batch link." });
      return;
    }
    try {
      await input.archiveBatch(
        actorId(req as OwnerRequest),
        batchId.data,
        new Date(),
      );
      res.json({ ok: true });
    } catch (error) {
      if (!mapError(error, res)) next(error);
    }
  });

  return router;
}
