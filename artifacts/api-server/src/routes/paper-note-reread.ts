import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";

import { PaperNoteRereadError } from "@/features/paper-notes/paper-note-reread-service";

const paramsSchema = z.object({
  batchId: z.string().uuid(),
  pageId: z.string().uuid(),
});
const bodySchema = z.object({
  rotationDegrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  confirmDiscardReview: z.literal(true),
});
type OwnerRequest = Request & { userId?: string };

function mapError(error: unknown, response: Response) {
  if (!(error instanceof PaperNoteRereadError)) return false;
  const status = error.code === "PAGE_NOT_FOUND"
    ? 404
    : error.code === "STORAGE_UNAVAILABLE"
      ? 503
      : 409;
  response.status(status).json({ error: error.message, code: error.code });
  return true;
}

export function createPaperNoteRereadRouter(input: {
  reread(input: {
    actorId: string;
    batchId: string;
    pageId: string;
    rotationDegrees: 0 | 90 | 180 | 270;
    confirmDiscardReview: boolean;
    now: Date;
  }): Promise<{ ok: true }>;
}): IRouter {
  const router = Router();
  router.post(
    "/paper-notes/batches/:batchId/pages/:pageId/re-read",
    async (req, res, next) => {
      const params = paramsSchema.safeParse(req.params);
      const body = bodySchema.safeParse(req.body);
      if (!params.success || !body.success) {
        res.status(400).json({
          error: "Confirm that re-reading this page may discard its extracted review work.",
        });
        return;
      }
      try {
        await input.reread({
          actorId: (req as OwnerRequest).userId ?? "",
          batchId: params.data.batchId,
          pageId: params.data.pageId,
          rotationDegrees: body.data.rotationDegrees,
          confirmDiscardReview: true,
          now: new Date(),
        });
        res.json({ ok: true });
      } catch (error) {
        if (!mapError(error, res)) next(error);
      }
    },
  );
  return router;
}
