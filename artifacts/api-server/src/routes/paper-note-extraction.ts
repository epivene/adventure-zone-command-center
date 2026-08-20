import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod/v4";

import {
  PaperNoteRecoveryError,
  type PaperNoteRecoveryRepository,
} from "@/features/paper-notes/paper-note-recovery-repository";

const idSchema = z.string().uuid();
const manualEntrySchema = z.object({
  transcription: z.string().trim().min(1).max(12_000),
});

type OwnerRequest = Request & { userId?: string };

function actorId(request: OwnerRequest) {
  return request.userId ?? "";
}

function mapError(error: unknown, response: Response) {
  if (error instanceof PaperNoteRecoveryError) {
    const status = error.code === "PAGE_NOT_FOUND" || error.code === "BATCH_NOT_FOUND" ? 404 : 409;
    response.status(status).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

export function createPaperNoteExtractionRouter(
  repository: Pick<
    PaperNoteRecoveryRepository,
    "retryPage" | "addManualEntry" | "markReviewedEmpty"
  >,
): IRouter {
  const router = Router();

  router.post(
    "/paper-notes/batches/:batchId/pages/:pageId/retry",
    async (req, res, next) => {
      const ids = z.object({ batchId: idSchema, pageId: idSchema }).safeParse(req.params);
      if (!ids.success) {
        res.status(400).json({ error: "Review the paper-note page link." });
        return;
      }
      try {
        await repository.retryPage(
          actorId(req as OwnerRequest),
          ids.data.batchId,
          ids.data.pageId,
          new Date(),
        );
        res.json({ ok: true });
      } catch (error) {
        if (!mapError(error, res)) next(error);
      }
    },
  );

  router.post(
    "/paper-notes/batches/:batchId/pages/:pageId/manual-entry",
    async (req, res, next) => {
      const ids = z.object({ batchId: idSchema, pageId: idSchema }).safeParse(req.params);
      const body = manualEntrySchema.safeParse(req.body);
      if (!ids.success || !body.success) {
        res.status(400).json({ error: "Enter a paper transcription up to 12,000 characters." });
        return;
      }
      try {
        const entryId = await repository.addManualEntry(
          actorId(req as OwnerRequest),
          ids.data.batchId,
          ids.data.pageId,
          body.data.transcription,
          new Date(),
        );
        res.status(201).json({ entryId });
      } catch (error) {
        if (!mapError(error, res)) next(error);
      }
    },
  );

  router.post(
    "/paper-notes/batches/:batchId/pages/:pageId/reviewed-empty",
    async (req, res, next) => {
      const ids = z.object({ batchId: idSchema, pageId: idSchema }).safeParse(req.params);
      if (!ids.success) {
        res.status(400).json({ error: "Review the paper-note page link." });
        return;
      }
      try {
        await repository.markReviewedEmpty(
          actorId(req as OwnerRequest),
          ids.data.batchId,
          ids.data.pageId,
          new Date(),
        );
        res.json({ ok: true });
      } catch (error) {
        if (!mapError(error, res)) next(error);
      }
    },
  );

  return router;
}
