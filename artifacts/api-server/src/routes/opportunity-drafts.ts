import { OutreachError } from "../features/outreach-planner/outreach-repository";
import { Router, type IRouter, type Response } from "express";
import { z } from "zod";

import type { DraftBlocker } from "@/features/opportunity-email/draft-guardrails";
import type { DraftRewriteAction } from "@/features/opportunity-email/opportunity-email-service";
import type {
  OpportunityDraftPurpose,
  OpportunityEmailRecord,
} from "@/features/opportunity-email/opportunity-email-types";

const uuidSchema = z.string().uuid();
const purposeSchema = z.enum(["new_outreach", "follow_up", "reply"]);
const rewriteActionSchema = z.enum([
  "shorter",
  "more_casual",
  "more_direct",
  "rewrite_opening",
  "more_personal",
  "stronger_follow_up",
  "fix_wording",
]);
const requestKeySchema = z.string().trim().min(1).max(200);
const editableDraftSchema = z.object({
  draftId: uuidSchema,
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1),
});

export type OpportunityDraftRouteService = {
  createDraft(input: {
    opportunityId: string;
    purpose: OpportunityDraftPurpose;
  }): Promise<
    | { ok: true; draft: OpportunityEmailRecord }
    | { ok: false; blocker: DraftBlocker }
  >;
  getDraft(opportunityId: string): Promise<OpportunityEmailRecord | null>;
  saveDraft(input: {
    opportunityId: string;
    draftId: string;
    subject: string;
    body: string;
  }): Promise<OpportunityEmailRecord>;
  rewriteDraft(input: {
    opportunityId: string;
    draftId: string;
    action: DraftRewriteAction;
    subject: string;
    body: string;
  }): Promise<{
    draft: OpportunityEmailRecord;
    undoSubject: string;
    undoBody: string;
  }>;
  sendDraft(input: {
    opportunityId: string;
    draftId: string;
    requestKey: string;
  }): Promise<{ draft: OpportunityEmailRecord; followUpReferenceAt: Date }>;
  scheduleDraft(input: {
    opportunityId: string;
    draftId: string;
    requestKey: string;
    scheduledFor: Date;
  }): Promise<{ draft: OpportunityEmailRecord; followUpReferenceAt: Date }>;
  retryDraft(input: {
    opportunityId: string;
    draftId: string;
    requestKey: string;
  }): Promise<{
    draft: OpportunityEmailRecord;
    followUpReferenceAt: Date | null;
  }>;
};

type RouteOptions = {
  now?: () => Date;
};

type ServiceError = Error & { code?: string };

function parseOpportunityId(value: unknown): string | null {
  const parsed = uuidSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function sendServiceError(res: Response, error: unknown): void {
  if (error instanceof OutreachError) {
    res.status(error.status).json({ ok: false, error: error.message });
    return;
  }
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as ServiceError).code ?? "")
      : error instanceof Error
        ? error.message
        : "";

  if (code === "OUTREACH_DELIVERY_OUTCOME_REVIEW_REQUIRED") {
    res
      .status(409)
      .json({
        ok: false,
        error:
          "Delivery outcome requires review. Check the provider and reconcile the dispatch before retrying.",
      });
    return;
  }
  if (
    code === "OPPORTUNITY_EMAIL_DRAFT_NOT_FOUND" ||
    code === "BOOKING_OPPORTUNITY_NOT_FOUND"
  ) {
    res
      .status(404)
      .json({ ok: false, error: "Draft or Opportunity not found." });
    return;
  }
  if (code === "OPPORTUNITY_EMAIL_DRAFT_MISMATCH") {
    res
      .status(409)
      .json({ ok: false, error: "Draft does not belong to this Opportunity." });
    return;
  }
  if (code === "OPPORTUNITY_EMAIL_REWRITE_UNAVAILABLE") {
    res
      .status(503)
      .json({ ok: false, error: "Draft rewrite is temporarily unavailable." });
    return;
  }
  res
    .status(500)
    .json({ ok: false, error: "Opportunity email operation failed." });
}

export function createOpportunityDraftsRouter(
  service: OpportunityDraftRouteService,
  options: RouteOptions = {},
): IRouter {
  const router: IRouter = Router();
  const now = options.now ?? (() => new Date());

  router.post("/:id/drafts", async (req, res): Promise<void> => {
    const opportunityId = parseOpportunityId(req.params.id);
    const body = z
      .object({ purpose: purposeSchema })
      .strict()
      .safeParse(req.body);
    if (!opportunityId || !body.success) {
      res.status(400).json({ ok: false, error: "Invalid draft request." });
      return;
    }
    try {
      const result = await service.createDraft({
        opportunityId,
        purpose: body.data.purpose,
      });
      if (!result.ok) {
        res.status(409).json({ ok: false, blocker: result.blocker });
        return;
      }
      res.status(201).json({ ok: true, draft: result.draft });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.get("/:id/draft", async (req, res): Promise<void> => {
    const opportunityId = parseOpportunityId(req.params.id);
    if (!opportunityId) {
      res.status(400).json({ ok: false, error: "Invalid Opportunity ID." });
      return;
    }
    try {
      const draft = await service.getDraft(opportunityId);
      if (!draft) {
        res.status(404).json({ ok: false, error: "Draft not found." });
        return;
      }
      res.json({ ok: true, draft });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.patch("/:id/draft", async (req, res): Promise<void> => {
    const opportunityId = parseOpportunityId(req.params.id);
    const body = editableDraftSchema.strict().safeParse(req.body);
    if (!opportunityId || !body.success) {
      res.status(400).json({ ok: false, error: "Invalid draft update." });
      return;
    }
    try {
      const draft = await service.saveDraft({ opportunityId, ...body.data });
      res.json({ ok: true, draft });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.post("/:id/draft/rewrite", async (req, res): Promise<void> => {
    const opportunityId = parseOpportunityId(req.params.id);
    const body = editableDraftSchema
      .extend({ action: rewriteActionSchema })
      .strict()
      .safeParse(req.body);
    if (!opportunityId || !body.success) {
      res
        .status(400)
        .json({ ok: false, error: "Invalid draft rewrite request." });
      return;
    }
    try {
      const result = await service.rewriteDraft({
        opportunityId,
        ...body.data,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.post("/:id/draft/send", async (req, res): Promise<void> => {
    const opportunityId = parseOpportunityId(req.params.id);
    const body = z
      .object({ draftId: uuidSchema, requestKey: requestKeySchema })
      .strict()
      .safeParse(req.body);
    if (!opportunityId || !body.success) {
      res.status(400).json({ ok: false, error: "Invalid send request." });
      return;
    }
    try {
      const result = await service.sendDraft({ opportunityId, ...body.data });
      res.json({ ok: true, ...result });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.post("/:id/draft/schedule", async (req, res): Promise<void> => {
    const opportunityId = parseOpportunityId(req.params.id);
    const body = z
      .object({
        draftId: uuidSchema,
        requestKey: requestKeySchema,
        scheduledFor: z.coerce.date(),
      })
      .strict()
      .safeParse(req.body);
    if (
      !opportunityId ||
      !body.success ||
      body.data.scheduledFor.getTime() <= now().getTime()
    ) {
      res.status(400).json({ ok: false, error: "Invalid schedule request." });
      return;
    }
    try {
      const result = await service.scheduleDraft({
        opportunityId,
        ...body.data,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  router.post("/:id/draft/retry", async (req, res): Promise<void> => {
    const opportunityId = parseOpportunityId(req.params.id);
    const body = z
      .object({ draftId: uuidSchema, requestKey: requestKeySchema })
      .strict()
      .safeParse(req.body);
    if (!opportunityId || !body.success) {
      res.status(400).json({ ok: false, error: "Invalid retry request." });
      return;
    }
    try {
      const result = await service.retryDraft({ opportunityId, ...body.data });
      res.json({ ok: true, ...result });
    } catch (error) {
      sendServiceError(res, error);
    }
  });

  return router;
}
