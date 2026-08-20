import { Router, type IRouter } from "express";
import { z } from "zod";

import type { PaperNoteManualProfileSearchService } from "@/features/paper-notes/paper-note-manual-profile-search";

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
});

export function createPaperNoteManualProfileSearchRouter(
  service: Pick<PaperNoteManualProfileSearchService, "search">,
): IRouter {
  const router = Router();

  router.get("/paper-notes/profiles/search", async (req, res, next) => {
    const parsed = querySchema.safeParse({ q: req.query.q });
    if (!parsed.success) {
      res.status(400).json({ error: "Enter a profile search." });
      return;
    }
    try {
      res.json({ matches: await service.search(parsed.data.q, 8) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
