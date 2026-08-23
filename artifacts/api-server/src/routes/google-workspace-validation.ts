import { Router, type IRouter } from "express";
import { z } from "zod";

import {
  GoogleRecentValidationService,
  type GoogleRecentValidationResult,
} from "@/features/google-workspace/google-recent-validation-service";

const inputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(100),
  })
  .strict();

type ValidationService = {
  run(limit: number): Promise<GoogleRecentValidationResult | unknown>;
};

function safeError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")) {
    return error.message;
  }
  return "GOOGLE_WORKSPACE_VALIDATION_FAILED";
}

function errorStatus(code: string): number {
  if (
    code === "GOOGLE_WORKSPACE_NOT_CONNECTED" ||
    code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"
  ) {
    return 409;
  }
  if (code === "GOOGLE_WORKSPACE_VALIDATION_UNAVAILABLE") return 503;
  return 500;
}

export function createGoogleWorkspaceValidationRouter(options?: {
  service?: ValidationService;
}): IRouter {
  const router: IRouter = Router();
  const service = options?.service ?? new GoogleRecentValidationService();

  router.post(
    "/google-workspace/validation/recent",
    async (req, res): Promise<void> => {
      const parsed = inputSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "GOOGLE_WORKSPACE_VALIDATION_INPUT_INVALID" });
        return;
      }
      try {
        res.json(await service.run(parsed.data.limit));
      } catch (error) {
        const code = safeError(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  return router;
}

export default createGoogleWorkspaceValidationRouter();
