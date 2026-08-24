import { Router, type IRouter, type Request } from "express";
import { z } from "zod";

import {
  GoogleRecentValidationService,
  type GoogleRecentValidationResult,
} from "@/features/google-workspace/google-recent-validation-service";
import {
  PostgresGoogleValidationRepository,
  type GoogleValidationStatus,
} from "@/features/google-workspace/google-validation-repository";

const inputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(100),
  })
  .strict();

const decisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
  })
  .strict();

type ValidationService = {
  run(limit: number): Promise<GoogleRecentValidationResult | unknown>;
};

type ValidationRepository = {
  setDecision(input: {
    status: "approved" | "rejected";
    actorId: string;
    now: Date;
  }): Promise<void>;
  getStatus(): Promise<GoogleValidationStatus>;
};

type OwnerRequest = Request & { userId?: string };

function ownerActorId(req: Request): string {
  return ((req as OwnerRequest).userId || "owner").trim() || "owner";
}

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
  if (code === "GOOGLE_WORKSPACE_VALIDATION_DECISION_INVALID") return 400;
  return 500;
}

export function createGoogleWorkspaceValidationRouter(options?: {
  service?: ValidationService;
  validationRepository?: ValidationRepository;
  now?: () => Date;
}): IRouter {
  const router: IRouter = Router();
  const service = options?.service ?? new GoogleRecentValidationService();
  const validationRepository =
    options?.validationRepository ?? new PostgresGoogleValidationRepository();
  const now = options?.now ?? (() => new Date());

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

  router.post(
    "/google-workspace/validation/decision",
    async (req, res): Promise<void> => {
      const parsed = decisionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "GOOGLE_WORKSPACE_VALIDATION_DECISION_INVALID" });
        return;
      }
      const status = parsed.data.decision === "approve" ? "approved" : "rejected";
      try {
        await validationRepository.setDecision({
          status,
          actorId: ownerActorId(req),
          now: now(),
        });
        res.json({
          validationStatus: status,
          historicalImportStarted: false,
        });
      } catch (error) {
        const code = safeError(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  return router;
}

export default createGoogleWorkspaceValidationRouter();