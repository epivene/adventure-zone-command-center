import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";

import {
  PaperNoteSourceError,
  type PaperNoteSourceService,
} from "@/features/paper-notes/paper-note-source-service";

const idSchema = z.string().uuid();
const kindSchema = z.enum(["original", "analysis"]);
type OwnerRequest = Request & { userId?: string };

function actorId(request: OwnerRequest) {
  return request.userId ?? "";
}

function mapError(error: unknown, response: Response) {
  if (error instanceof PaperNoteSourceError) {
    response.status(error.code === "SOURCE_NOT_FOUND" ? 404 : 409).json({
      error: error.message,
      code: error.code,
    });
    return true;
  }
  return false;
}

export function createPaperNoteSourceRouter(
  service: Pick<PaperNoteSourceService, "pageUrl" | "entryUrl" | "activityUrl">,
): IRouter {
  const router = Router();

  router.get(
    "/paper-notes/batches/:batchId/pages/:pageId/source-url",
    async (req, res, next) => {
      const ids = z.object({ batchId: idSchema, pageId: idSchema }).safeParse(req.params);
      const kind = kindSchema.safeParse(req.query.kind ?? "original");
      if (!ids.success || !kind.success) {
        res.status(400).json({ error: "Review the paper-note source request." });
        return;
      }
      try {
        res.json(await service.pageUrl(
          actorId(req as OwnerRequest),
          ids.data.batchId,
          ids.data.pageId,
          kind.data,
        ));
      } catch (error) {
        if (!mapError(error, res)) next(error);
      }
    },
  );

  router.get(
    "/paper-notes/entries/:entryId/source-url",
    async (req, res, next) => {
      const entryId = idSchema.safeParse(req.params.entryId);
      const kind = kindSchema.safeParse(req.query.kind ?? "original");
      if (!entryId.success || !kind.success) {
        res.status(400).json({ error: "Review the paper-note source request." });
        return;
      }
      try {
        res.json(await service.entryUrl(
          actorId(req as OwnerRequest),
          entryId.data,
          kind.data,
        ));
      } catch (error) {
        if (!mapError(error, res)) next(error);
      }
    },
  );

  router.get(
    "/paper-notes/activities/:activityId/source-url",
    async (req, res, next) => {
      const activityId = idSchema.safeParse(req.params.activityId);
      const kind = kindSchema.safeParse(req.query.kind ?? "original");
      if (!activityId.success || !kind.success) {
        res.status(400).json({ error: "Review the paper-note source request." });
        return;
      }
      try {
        res.json(await service.activityUrl(
          actorId(req as OwnerRequest),
          activityId.data,
          kind.data,
        ));
      } catch (error) {
        if (!mapError(error, res)) next(error);
      }
    },
  );

  return router;
}
