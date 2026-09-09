import { Router, type IRouter } from "express";

import { correctBlandingKristyState } from "@/features/leg-manager/blanding-kristy-state-correction";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";
import { correctionErrorDiagnostic } from "./assistant-kristy-review-correction";

type CorrectionService = typeof correctBlandingKristyState;

export function createAssistantBlandingKristyCorrectionRouter(options?: {
  correct?: CorrectionService;
}): IRouter {
  const router: IRouter = Router();
  const correct = options?.correct ?? correctBlandingKristyState;

  router.use(requireAssistantImportToken);

  router.post("/blanding-kristy-state-correction", async (req, res): Promise<void> => {
    try {
      const result = await correct();
      if (result.status === "skipped") {
        res.status(409).json({ ok: false, result });
        return;
      }
      res.json({ ok: true, result });
    } catch (error) {
      const diagnostic = correctionErrorDiagnostic(error);
      req.log?.error?.(
        { err: error, diagnostic },
        "Failed Blanding Kristy live-state correction",
      );
      res.status(500).json({
        ok: false,
        error: "Blanding Kristy live-state correction failed.",
        diagnostic,
      });
    }
  });

  return router;
}

export default createAssistantBlandingKristyCorrectionRouter();
