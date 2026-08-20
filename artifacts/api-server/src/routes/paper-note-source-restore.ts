import express, { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";

import { PaperNoteSourceRestoreError } from "@/features/paper-notes/paper-note-source-restore-service";

const paramsSchema = z.object({
  batchId: z.string().uuid(),
  pageId: z.string().uuid(),
});
type OwnerRequest = Request & { userId?: string };

function mapError(error: unknown, response: Response) {
  if (!(error instanceof PaperNoteSourceRestoreError)) return false;
  const status = error.code === "SOURCE_NOT_FOUND"
    ? 404
    : error.code === "SOURCE_HASH_MISMATCH"
      ? 409
      : 400;
  response.status(status).json({ error: error.message, code: error.code });
  return true;
}

export function createPaperNoteSourceRestoreRouter(input: {
  restore(input: {
    actorId: string;
    batchId: string;
    pageId: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<{ ok: true }>;
}): IRouter {
  const router = Router();
  router.put(
    "/paper-notes/batches/:batchId/pages/:pageId/source",
    express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "12mb" }),
    async (req, res, next) => {
      const params = paramsSchema.safeParse(req.params);
      const contentType = req.get("content-type")?.split(";")[0]?.trim() ?? "";
      if (!params.success || !Buffer.isBuffer(req.body) || !req.body.length) {
        res.status(400).json({ error: "Choose the exact original paper photo." });
        return;
      }
      try {
        await input.restore({
          actorId: (req as OwnerRequest).userId ?? "",
          batchId: params.data.batchId,
          pageId: params.data.pageId,
          bytes: new Uint8Array(req.body),
          mimeType: contentType,
        });
        res.json({ ok: true });
      } catch (error) {
        if (!mapError(error, res)) next(error);
      }
    },
  );
  return router;
}
