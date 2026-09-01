import { Router, type IRouter } from "express";

import { correctKristyReviewState } from "@/features/leg-manager/kristy-review-state-correction";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

type CorrectionService = typeof correctKristyReviewState;

export function createAssistantKristyReviewCorrectionRouter(options?: {
  correct?: CorrectionService;
}): IRouter {
  const router: IRouter = Router();
  const correct = options?.correct ?? correctKristyReviewState;

  router.use(requireAssistantImportToken);

  router.post("/kristy-review-state-correction", async (req, res): Promise<void> => {
    try {
      const result = await correct();
      if (result.status === "skipped") {
        res.status(409).json({ ok: false, result });
        return;
      }
      res.json({ ok: true, result });
    } catch (error) {
      req.log?.error?.({ err: error }, "Failed Kristy review state correction");
      res.status(500).json({
        ok: false,
        error: "Kristy review state correction failed.",
      });
    }
  });

  return router;
}

export default createAssistantKristyReviewCorrectionRouter();
