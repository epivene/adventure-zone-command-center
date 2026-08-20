import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";

import { PaperNoteReviewRepositoryError } from "@/features/paper-notes/paper-note-review-repository";
import {
  PaperNoteReviewServiceError,
  type PaperNoteReviewService,
} from "@/features/paper-notes/paper-note-review-service";
import { paperNoteReviewDraftSchema } from "@/features/paper-notes/paper-note-review-schema";

const idSchema = z.string().uuid();
const versionSchema = z.object({ expectedVersion: z.number().int().nonnegative() });
const saveSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  review: paperNoteReviewDraftSchema,
});
type OwnerRequest = Request & { userId?: string };

function actorId(request: OwnerRequest) {
  return request.userId ?? "";
}

function mapError(error: unknown, response: Response) {
  if (error instanceof PaperNoteReviewRepositoryError) {
    const status = error.code === "ENTRY_NOT_FOUND"
      ? 404
      : 409;
    response.status(status).json({ error: error.message, code: error.code });
    return true;
  }
  if (error instanceof PaperNoteReviewServiceError) {
    response.status(error.code === "ENTRY_NOT_FOUND" ? 404 : 409).json({
      error: error.message,
      code: error.code,
    });
    return true;
  }
  return false;
}

export function createPaperNoteReviewRouter(
  service: Pick<
    PaperNoteReviewService,
    "getEntry" | "updateEntry" | "approveEntry" | "unapproveEntry" | "skipEntry"
  >,
): IRouter {
  const router = Router();

  router.get("/paper-notes/entries/:entryId/review", async (req, res, next) => {
    const entryId = idSchema.safeParse(req.params.entryId);
    if (!entryId.success) {
      res.status(400).json({ error: "Review the paper-note entry link." });
      return;
    }
    try {
      res.json({ entry: await service.getEntry(actorId(req as OwnerRequest), entryId.data) });
    } catch (error) {
      if (!mapError(error, res)) next(error);
    }
  });

  router.patch("/paper-notes/entries/:entryId", async (req, res, next) => {
    const entryId = idSchema.safeParse(req.params.entryId);
    const body = saveSchema.safeParse(req.body);
    if (!entryId.success || !body.success) {
      res.status(400).json({ error: "Review the paper-note fields before saving." });
      return;
    }
    try {
      res.json({
        entry: await service.updateEntry({
          actorId: actorId(req as OwnerRequest),
          entryId: entryId.data,
          expectedVersion: body.data.expectedVersion,
          review: body.data.review,
          now: new Date(),
        }),
      });
    } catch (error) {
      if (!mapError(error, res)) next(error);
    }
  });

  for (const action of ["approve", "unapprove", "skip"] as const) {
    router.post(`/paper-notes/entries/:entryId/${action}`, async (req, res, next) => {
      const entryId = idSchema.safeParse(req.params.entryId);
      const body = versionSchema.safeParse(req.body);
      if (!entryId.success || !body.success) {
        res.status(400).json({ error: "Review the paper-note entry version." });
        return;
      }
      try {
        const input = {
          actorId: actorId(req as OwnerRequest),
          entryId: entryId.data,
          expectedVersion: body.data.expectedVersion,
          now: new Date(),
        };
        const entry = action === "approve"
          ? await service.approveEntry(input)
          : action === "unapprove"
            ? await service.unapproveEntry(input)
            : await service.skipEntry(input);
        res.json({ entry });
      } catch (error) {
        if (!mapError(error, res)) next(error);
      }
    });
  }

  return router;
}
