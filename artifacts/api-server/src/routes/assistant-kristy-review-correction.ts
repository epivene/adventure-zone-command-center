import { Router, type IRouter } from "express";

import { correctKristyReviewState } from "@/features/leg-manager/kristy-review-state-correction";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

type CorrectionService = typeof correctKristyReviewState;

type DatabaseDiagnostic = {
  name: string;
  message: string;
  code: string | null;
  table: string | null;
  column: string | null;
  constraint: string | null;
  routine: string | null;
};

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function correctionErrorDiagnostic(error: unknown): DatabaseDiagnostic {
  const record = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  return {
    name: textField(record.name) ?? "Error",
    message: textField(record.message) ?? "Unknown correction error",
    code: textField(record.code),
    table: textField(record.table),
    column: textField(record.column),
    constraint: textField(record.constraint),
    routine: textField(record.routine),
  };
}

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
      const diagnostic = correctionErrorDiagnostic(error);
      req.log?.error?.({ err: error, diagnostic }, "Failed Kristy review state correction");
      res.status(500).json({
        ok: false,
        error: "Kristy review state correction failed.",
        diagnostic,
      });
    }
  });

  return router;
}

export default createAssistantKristyReviewCorrectionRouter();
