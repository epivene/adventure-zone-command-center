import { Router, type IRouter, type Request } from "express";
import { z } from "zod";

import type {
  GoogleThreadDetail,
  GoogleWorkspaceReadClient,
} from "@/features/google-workspace/google-api-types";
import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";
import type { GoogleRecentValidationResult } from "@/features/google-workspace/google-recent-validation-service";
import {
  PostgresGoogleProfileLabelCleanupService,
  type GoogleProfileLabelCleanupCandidate,
  type GoogleProfileLabelCleanupFailure,
} from "@/features/google-workspace/google-profile-label-cleanup-service";
import { GoogleReviewProfileAssignmentService, type GoogleReviewAssignmentView } from "@/features/google-workspace/google-review-profile-assignment-service";
import { GoogleValidationMappingReconciler } from "@/features/google-workspace/google-validation-mapping-reconciler";
import {
  PostgresGoogleValidationRepository,
  type GoogleValidationMappingInput,
  type GoogleValidationReviewInput,
  type GoogleValidationReviewItem,
  type GoogleValidationStatus,
} from "@/features/google-workspace/google-validation-repository";
import { GoogleValidationReviewReconciler } from "@/features/google-workspace/google-validation-review-reconciler";
import { GoogleValidationWithManualOverlayService } from "@/features/google-workspace/google-validation-with-manual-overlay-service";
import { PostgresGoogleThreadIgnoreTransaction } from "@/features/google-workspace/google-thread-ignore-transaction";

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

const cleanupLabelsSchema = z
  .object({
    labelIds: z.array(z.string().trim().min(1).max(255)).min(1).max(100),
    confirm: z.literal(true),
  })
  .strict();

type ConnectionAccess = {
  createReadClient(): Promise<GoogleWorkspaceReadClient | null>;
};

type ValidationService = {
  run(
    limit: number,
    options?: { skipProcessed?: boolean },
  ): Promise<GoogleRecentValidationResult | unknown>;
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

type ReviewAssignmentService = {
  resolve(input: {
    messageId: string;
    organizationId: string;
    actorId: string;
    now: Date;
  }): Promise<GoogleReviewAssignmentView | void>;
};

type ValidationRepository = {
  setDecision(input: {
    status: "approved" | "rejected";
    actorId: string;
    now: Date;
  }): Promise<void>;
  getStatus(): Promise<GoogleValidationStatus>;
  listReviewItems(): Promise<GoogleValidationReviewItem[]>;
  upsertReviewItems(items: GoogleValidationReviewInput[]): Promise<void>;
  markProcessedMessageIds(messageIds: string[]): Promise<void>;
  ignoreReviewItem(input: {
    messageId: string;
    actorId: string;
    now: Date;
  }): Promise<void>;
};

type IgnoreService = {
  ignoreReview(input: {
    messageId: string;
    actorId: string;
    now: Date;
  }): Promise<void>;
};

type LabelCleanupService = {
  preview(): Promise<{ labels: GoogleProfileLabelCleanupCandidate[] }>;
  deleteSelected(labelIds: string[]): Promise<{
    deleted: GoogleProfileLabelCleanupCandidate[];
    skippedLabelIds: string[];
    failed: GoogleProfileLabelCleanupFailure[];
  }>;
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

function diagnosticFields(error: unknown): {
  stage: string | null;
  postgresCode: string | null;
} {
  if (!error || typeof error !== "object") {
    return { stage: null, postgresCode: null };
  }
  const value = error as { stage?: unknown; postgresCode?: unknown };
  return {
    stage: typeof value.stage === "string" ? value.stage : null,
    postgresCode:
      typeof value.postgresCode === "string" ? value.postgresCode : null,
  };
}

function errorStatus(code: string): number {
  if (
    code === "GOOGLE_WORKSPACE_NOT_CONNECTED" ||
    code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED" ||
    code === "GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT" ||
    code === "GOOGLE_WORKSPACE_GMAIL_LABEL_CONFLICT" ||
    code === "GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND" ||
    code === "GOOGLE_WORKSPACE_CONNECTION_CHANGED"
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
    code === "GOOGLE_WORKSPACE_REVIEW_ITEM_NOT_FOUND" ||
    code === "GOOGLE_WORKSPACE_REVIEW_ATTACHMENT_NOT_FOUND" ||
    code === "GOOGLE_WORKSPACE_GMAIL_SOURCE_NOT_FOUND"
  ) {
    return 404;
  }
  return 500;
}

function safeAttachmentFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7e]|["\\/]/g, "_") || "attachment";
}

function encodedAttachmentFilename(filename: string): string {
  return encodeURIComponent(filename).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function attachmentResponseHeaders(filename: string, mimeType: string): {
  contentType: string;
  contentDisposition: string;
} {
  const passiveMimeTypes = new Set([
    "application/pdf",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/csv",
    "text/plain",
  ]);
  const normalizedMimeType = mimeType.trim().toLowerCase();
  const inline = passiveMimeTypes.has(normalizedMimeType);
  const disposition = inline ? "inline" : "attachment";
  return {
    contentType: inline ? normalizedMimeType : "application/octet-stream",
    contentDisposition:
      `${disposition}; filename="${safeAttachmentFilename(filename)}"; ` +
      `filename*=UTF-8''${encodedAttachmentFilename(filename)}`,
  };
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

function finalReviewItems(
  result: GoogleRecentValidationResult,
): GoogleValidationReviewInput[] {
  return result.needsReview.map((row) => {
    const candidates = new Map<string, { id: string; name: string }>();
    for (const candidate of row.organizationCandidates ?? []) {
      candidates.set(candidate.id, candidate);
    }
    for (const candidate of row.candidates ?? []) {
      if (candidate.kind === "organization" || candidate.kind === "profile") {
        candidates.set(candidate.id, { id: candidate.id, name: candidate.name });
      }
    }
    return {
      messageId: row.id,
      threadId: row.threadId,
      subject: row.subject,
      from: row.from,
      to: row.to,
      internalDateMs: row.internalDateMs,
      evidenceCodes: row.evidenceCodes,
      candidates: [...candidates.values()],
      hasAttachments: row.hasAttachments,
    };
  });
}

export function createGoogleWorkspaceValidationRouter(options?: {
  service?: ValidationService;
  mappingReconciler?: MappingReconciler;
  reviewReconciler?: ReviewReconciler;
  reviewAssignmentService?: ReviewAssignmentService;
  validationRepository?: ValidationRepository;
  ignoreService?: IgnoreService;
  labelCleanupService?: LabelCleanupService;
  connection?: ConnectionAccess;
  now?: () => Date;
}): IRouter {
  const router: IRouter = Router();
  const service = options?.service ?? new GoogleValidationWithManualOverlayService();
  const mappingReconciler =
    options?.mappingReconciler ?? new GoogleValidationMappingReconciler();
  const reviewReconciler =
    options?.reviewReconciler ?? new GoogleValidationReviewReconciler();
  const defaultReviewAssignment = new GoogleReviewProfileAssignmentService();
  const reviewAssignmentService =
    options?.reviewAssignmentService ?? {
      resolve: defaultReviewAssignment.resolveReview.bind(defaultReviewAssignment),
    };
  const validationRepository =
    options?.validationRepository ?? new PostgresGoogleValidationRepository();
  const ignoreService =
    options?.ignoreService ??
    (options?.validationRepository
      ? {
          ignoreReview:
            validationRepository.ignoreReviewItem.bind(validationRepository),
        }
      : new PostgresGoogleThreadIgnoreTransaction());
  const labelCleanupService =
    options?.labelCleanupService ??
    new PostgresGoogleProfileLabelCleanupService();
  const connection =
    options?.connection ?? new PostgresGoogleConnectionRepository();
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
        const result = await service.run(parsed.data.limit, {
          skipProcessed: true,
        });
        if (isValidationResult(result)) {
          const mappingInput = reconciliationInput(result);
          await mappingReconciler.reconcile(mappingInput);
          await validationRepository.upsertReviewItems(finalReviewItems(result));
          await reviewReconciler.reconcile(reviewReconciliationInput(result));
          await validationRepository.markProcessedMessageIds(mappingInput.messageIds);
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

  router.get(
    "/google-workspace/validation/review/:messageId/thread",
    async (req, res): Promise<void> => {
      const messageId = req.params.messageId?.trim();
      if (!messageId) {
        res.status(400).json({ error: "GOOGLE_WORKSPACE_REVIEW_DECISION_INVALID" });
        return;
      }
      try {
        const item = (await validationRepository.listReviewItems()).find(
          (review) => review.messageId === messageId,
        );
        if (!item) {
          res.status(404).json({ error: "GOOGLE_WORKSPACE_REVIEW_ITEM_NOT_FOUND" });
          return;
        }

        const client = await connection.createReadClient();
        if (!client) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
        if (!client.getThreadDetail) {
          throw new Error("GOOGLE_WORKSPACE_VALIDATION_UNAVAILABLE");
        }

        const detail: GoogleThreadDetail = await client.getThreadDetail(item.threadId);
        res.json(detail);
      } catch (error) {
        const code = safeError(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  router.get(
    "/google-workspace/validation/review/:messageId/attachments/:gmailMessageId/:attachmentId",
    async (req, res): Promise<void> => {
      try {
        const item = (await validationRepository.listReviewItems()).find(
          (review) => review.messageId === req.params.messageId,
        );
        if (!item) {
          res.status(404).json({ error: "GOOGLE_WORKSPACE_REVIEW_ITEM_NOT_FOUND" });
          return;
        }

        const client = await connection.createReadClient();
        if (!client) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
        if (!client.getThreadDetail || !client.getAttachment) {
          throw new Error("GOOGLE_WORKSPACE_VALIDATION_UNAVAILABLE");
        }

        const detail = await client.getThreadDetail(item.threadId);
        const message = detail.messages.find(
          (candidate) => candidate.id === req.params.gmailMessageId,
        );
        const attachment = message?.attachments.find(
          (candidate) => candidate.attachmentId === req.params.attachmentId,
        );
        if (!message || !attachment) {
          res.status(404).json({
            error: "GOOGLE_WORKSPACE_REVIEW_ATTACHMENT_NOT_FOUND",
          });
          return;
        }

        const bytes = await client.getAttachment({
          messageId: message.id,
          attachmentId: attachment.attachmentId,
        });
        const headers = attachmentResponseHeaders(
          attachment.filename,
          attachment.mimeType,
        );
        res.setHeader("Content-Type", headers.contentType);
        res.setHeader("Content-Disposition", headers.contentDisposition);
        res.send(Buffer.from(bytes));
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
        const assignment = await reviewAssignmentService.resolve({
          messageId: req.params.messageId,
          organizationId: parsed.data.organizationId,
          actorId: ownerActorId(req),
          now: now(),
        });
        res.json({ ok: true, ...(assignment ?? {}) });
      } catch (error) {
        const code = safeError(error);
        const diagnostics = diagnosticFields(error);
        req.log.error(
          {
            code,
            stage: diagnostics.stage,
            postgresCode: diagnostics.postgresCode,
          },
          "Google Workspace review assignment failed",
        );
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
        await ignoreService.ignoreReview({
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

  router.get(
    "/google-workspace/profile-labels/cleanup",
    async (_req, res): Promise<void> => {
      try {
        res.json(await labelCleanupService.preview());
      } catch (error) {
        const code = safeError(error);
        res.status(errorStatus(code)).json({ error: code });
      }
    },
  );

  router.post(
    "/google-workspace/profile-labels/cleanup",
    async (req, res): Promise<void> => {
      const parsed = cleanupLabelsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: "GOOGLE_WORKSPACE_PROFILE_LABEL_CLEANUP_INPUT_INVALID",
        });
        return;
      }
      try {
        res.json(
          await labelCleanupService.deleteSelected(parsed.data.labelIds),
        );
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
