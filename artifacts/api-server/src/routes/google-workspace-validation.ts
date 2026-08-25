import { Router, type IRouter, type Request } from "express";
import { z } from "zod";

import type { GoogleRecentValidationResult } from "@/features/google-workspace/google-recent-validation-service";
import { GoogleValidationMappingReconciler } from "@/features/google-workspace/google-validation-mapping-reconciler";
import {
  PostgresGoogleValidationRepository,
  type GoogleValidationMappingInput,
  type GoogleValidationReviewItem,
  type GoogleValidationStatus,
} from "@/features/google-workspace/google-validation-repository";
import { GoogleValidationReviewReconciler } from "@/features/google-workspace/google-validation-review-reconciler";
import { GoogleValidationWithManualOverlayService } from "@/features/google-workspace/google-validation-with-manual-overlay-service";

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

const resolveSchema = z
  .object({
    organizationId: z.string().uuid(),
  })
  .strict();

type ValidationService = {
  run(limit: number): Promise<GoogleRecentValidationResult | unknown>;
};

type MappingReconciler = {
  reconcile(input: {
    messageIds: string[];
    rows: GoogleValidationMappingInput[];
  }): Promise<void>;
};

type ReviewReconciler = {
  reconcile(input: {
    sampleMessageIds: string[];
    pendingMessageIds: string[];
  }): Promise<void>;
};

type ValidationRepository = {
  setDecision(input: {
    status: "approved" | "rejected";
    actorId: string;
    now: Date;
  }): Promise<void>;
  getStatus(): Promise<GoogleValidationStatus>;
  listReviewItems(): Promise<GoogleValidationReviewItem[]>;
  resolveReviewItem(input: {
    messageId: string;
    organizationId: string;
    actorId: string;
    now: Date;
  }): Promise<void>;
  ignoreReviewItem(input: {
    messageId: string;
    actorId: string;
    now: Date;
  }): Promise<void>;
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
  if (
    code === "GOOGLE_WORKSPACE_VALIDATION_DECISION_INVALID" ||
    code === "GOOGLE_WORKSPACE_REVIEW_DECISION_INVALID"
  ) {
    return 400;
  }
  if (
    code === "GOOGLE_WORKSPACE_REVIEW_TARGET_NOT_FOUND" ||
    code === "GOOGLE_WORKSPACE_REVIEW_ITEM_NOT_FOUND"
  ) {
    return 404;
  }
  return 500;
}

function isValidationResult(value: unknown): value is GoogleRecentValidationResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<GoogleRecentValidationResult>;
  return (
    Array.isArray(result.matched) &&
    Array.isArray(result.needsReview) &&
    Array.isArray(result.ignored)
  );
}

function reconciliationInput(result: GoogleRecentValidationResult): {
  messageIds: string[];
  rows: GoogleValidationMappingInput[];
} {
  const allRows = [...result.matched, ...result.needsReview, ...result.ignored];
  return {
    messageIds: [...new Set(allRows.map((row) => row.id).filter(Boolean))],
    rows: result.matched.flatMap((row) => {
      if (!row.resolvedOrganization) return [];
      return [{
        messageId: row.id,
        threadId: row.threadId,
        organizationId: row.resolvedOrganization.id,
        contactId: row.matchedContact?.id ?? null,
        evidenceCodes: row.evidenceCodes,
      }];
    }),
  };
}

function reviewReconciliationInput(result: GoogleRecentValidationResult): {
  sampleMessageIds: string[];
  pendingMessageIds: string[];
} {
  const allRows = [...result.matched, ...result.needsReview, ...result.ignored];
  return {
    sampleMessageIds: [...new Set(allRows.map((row) => row.id).filter(Boolean))],
    pendingMessageIds: [
      ...new Set(result.needsReview.map((row) => row.id).filter(Boolean)),
    ],
  };
}

export function createGoogleWorkspaceValidationRouter(options?: {
  service?: ValidationService;
  mappingReconciler?: MappingReconciler;
  reviewReconciler?: ReviewReconciler;
  validationRepository?: ValidationRepository;
  now?: () => Date;
}): IRouter {
  const router: IRouter = Router();
  const service = options?.service ?? new GoogleValidationWithManualOverlayService();
  const mappingReconciler =
    options?.mappingReconciler ?? new GoogleValidationMappingReconciler();
  const reviewReconciler =
    options?.reviewReconciler ?? new GoogleValidationReviewReconciler();
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
        const result = await service.run(parsed.data.limit);
        if (isValidationResult(result)) {
          await mappingReconciler.reconcile(reconciliationInput(result));
          await reviewReconciler.reconcile(reviewReconciliationInput(result));
        }
        res.json(result);
      } catch (error) {
        const code = safeError(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  router.get(
    "/google-workspace/validation/review",
    async (_req, res): Promise<void> => {
      try {
        res.json({ items: await validationRepository.listReviewItems() });
      } catch (error) {
        const code = safeError(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  router.put(
    "/google-workspace/validation/review/:messageId",
    async (req, res): Promise<void> => {
      const parsed = resolveSchema.safeParse(req.body ?? {});
      if (!parsed.success || !req.params.messageId?.trim()) {
        res.status(400).json({ error: "GOOGLE_WORKSPACE_REVIEW_DECISION_INVALID" });
        return;
      }
      try {
        await validationRepository.resolveReviewItem({
          messageId: req.params.messageId,
          organizationId: parsed.data.organizationId,
          actorId: ownerActorId(req),
          now: now(),
        });
        res.json({ ok: true });
      } catch (error) {
        const code = safeError(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  router.post(
    "/google-workspace/validation/review/:messageId/ignore",
    async (req, res): Promise<void> => {
      if (!req.params.messageId?.trim()) {
        res.status(400).json({ error: "GOOGLE_WORKSPACE_REVIEW_DECISION_INVALID" });
        return;
      }
      try {
        await validationRepository.ignoreReviewItem({
          messageId: req.params.messageId,
          actorId: ownerActorId(req),
          now: now(),
        });
        res.json({ ok: true });
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
