import { Router, type IRouter, type Request } from "express";
import { z } from "zod";

import { GoogleMatchedEmailCorrectionService } from "@/features/google-workspace/google-matched-email-correction-service";

const metadataSchema = z.object({
  threadId: z.string().min(1),
  subject: z.string(),
  from: z.string(),
  to: z.string(),
  internalDateMs: z.number().nullable(),
  hasAttachments: z.boolean(),
});
const assignSchema = metadataSchema.extend({ organizationId: z.string().uuid() }).strict();
const ignoreSchema = metadataSchema.strict();

type OwnerRequest = Request & { userId?: string };
function actorId(req: Request) {
  return ((req as OwnerRequest).userId || "owner").trim() || "owner";
}
function safeError(error: unknown): string {
  return error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")
    ? error.message
    : "GOOGLE_WORKSPACE_VALIDATION_FAILED";
}
function status(code: string): number {
  if (code === "GOOGLE_WORKSPACE_REVIEW_TARGET_NOT_FOUND") return 404;
  if (code === "GOOGLE_WORKSPACE_NOT_CONNECTED") return 409;
  if (code === "GOOGLE_WORKSPACE_MATCHED_CORRECTION_INVALID") return 400;
  return 500;
}

export function createGoogleWorkspaceMatchedCorrectionsRouter(options?: {
  service?: GoogleMatchedEmailCorrectionService;
  now?: () => Date;
}): IRouter {
  const router: IRouter = Router();
  const service = options?.service ?? new GoogleMatchedEmailCorrectionService();
  const now = options?.now ?? (() => new Date());

  router.put("/google-workspace/validation/matched/:messageId", async (req, res) => {
    const parsed = assignSchema.safeParse(req.body ?? {});
    if (!parsed.success || !req.params.messageId?.trim()) {
      res.status(400).json({ error: "GOOGLE_WORKSPACE_MATCHED_CORRECTION_INVALID" });
      return;
    }
    try {
      await service.assign({
        messageId: req.params.messageId,
        ...parsed.data,
        actorId: actorId(req),
        now: now(),
      });
      res.json({ ok: true });
    } catch (error) {
      const code = safeError(error);
      res.status(status(code)).json({ error: code });
    }
  });

  router.post("/google-workspace/validation/matched/:messageId/ignore", async (req, res) => {
    const parsed = ignoreSchema.safeParse(req.body ?? {});
    if (!parsed.success || !req.params.messageId?.trim()) {
      res.status(400).json({ error: "GOOGLE_WORKSPACE_MATCHED_CORRECTION_INVALID" });
      return;
    }
    try {
      await service.ignore({
        messageId: req.params.messageId,
        ...parsed.data,
        actorId: actorId(req),
        now: now(),
      });
      res.json({ ok: true });
    } catch (error) {
      const code = safeError(error);
      res.status(status(code)).json({ error: code });
    }
  });

  return router;
}

export default createGoogleWorkspaceMatchedCorrectionsRouter();
