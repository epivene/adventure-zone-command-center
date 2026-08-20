import { Router, type IRouter } from "express";

import type { PaperNoteHealthService } from "@/features/paper-notes/paper-note-health-service";

export function createPaperNoteHealthRouter(
  service: Pick<PaperNoteHealthService, "health">,
): IRouter {
  const router = Router();
  router.get("/paper-notes/health", async (_req, res, next) => {
    try {
      res.json(await service.health());
    } catch (error) {
      next(error);
    }
  });
  return router;
}
