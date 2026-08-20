import { Router, type IRouter, type Request } from "express";
import { z } from "zod";

import type { PaperNoteMatchingService } from "@/features/paper-notes/paper-note-matching-service";
import type { PaperNoteReviewService } from "@/features/paper-notes/paper-note-review-service";

type OwnerRequest = Request & { userId?: string };
const idSchema = z.string().uuid();

export function createPaperNoteMatchingRouter(input: {
  getEntry: Pick<PaperNoteReviewService, "getEntry">["getEntry"];
  match: Pick<PaperNoteMatchingService, "match">["match"];
}): IRouter {
  const router = Router();

  router.get("/paper-notes/entries/:entryId/matches", async (req, res, next) => {
    const entryId = idSchema.safeParse(req.params.entryId);
    if (!entryId.success) {
      res.status(400).json({ error: "Review the paper-note entry link." });
      return;
    }
    try {
      const actorId = (req as OwnerRequest).userId ?? "";
      const entry = await input.getEntry(actorId, entryId.data);
      const matches = await input.match(entry.review);
      res.json({ matches });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
