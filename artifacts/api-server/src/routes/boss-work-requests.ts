import { Router, type IRouter, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import {
  BossWorkRequestConflictError,
  BossWorkRequestNotFoundError,
} from "@/features/boss-work-requests/boss-work-request-repository";
import { BossWorkRequestService } from "@/features/boss-work-requests/boss-work-request-service";
import {
  conventionDraftSchema,
  conventionNotesSchema,
  conventionSubmissionSchema,
  templateDecisionSchema,
} from "@/features/boss-work-requests/boss-work-request-types";

const router: IRouter = Router();
const requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));
const service = new BossWorkRequestService(db);
const uuid = z.string().uuid();
const param = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";

function requestId(value: string | string[] | undefined) {
  return uuid.parse(param(value));
}

function fail(res: Response, error: unknown) {
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: error.issues[0]?.message ?? "Invalid request." });
  } else if (error instanceof BossWorkRequestNotFoundError) {
    res.status(404).json({ error: error.message });
  } else if (error instanceof BossWorkRequestConflictError) {
    res.status(409).json({ error: error.message });
  } else {
    throw error;
  }
}

router.get("/boss/work-requests", requireBoss, async (req, res) => {
  res.json(await service.bossQueue(req.bossAccount!.accountId));
});

router.get("/boss/work-requests/:requestId", requireBoss, async (req, res) => {
  try {
    res.json(await service.bossDetail(requestId(req.params.requestId), req.bossAccount!.accountId));
  } catch (error) { fail(res, error); }
});

router.patch("/boss/work-requests/:requestId/convention-draft", requireBoss, async (req, res) => {
  try {
    const input = conventionDraftSchema.parse(req.body);
    res.json(await service.saveConventionDraft({
      requestId: requestId(req.params.requestId),
      bossAccountId: req.bossAccount!.accountId,
      clientRevision: input.clientRevision,
      payload: input.payload,
    }));
  } catch (error) { fail(res, error); }
});

router.post("/boss/work-requests/:requestId/convention-submissions", requireBoss, async (req, res) => {
  try {
    const input = conventionSubmissionSchema.parse(req.body);
    const result = await service.submitConvention({
      requestId: requestId(req.params.requestId),
      bossAccountId: req.bossAccount!.accountId,
      ...input,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) { fail(res, error); }
});

router.patch("/boss/work-requests/:requestId/convention-submissions/:submissionId", requireBoss, async (req, res) => {
  try {
    const payload = conventionNotesSchema.parse(req.body);
    res.json({ submission: await service.updateConventionSubmission({
      requestId: requestId(req.params.requestId),
      submissionId: requestId(req.params.submissionId),
      bossAccountId: req.bossAccount!.accountId,
      payload,
    }) });
  } catch (error) { fail(res, error); }
});

router.post("/boss/work-requests/:requestId/template-decision", requireBoss, async (req, res) => {
  try {
    const input = templateDecisionSchema.parse(req.body);
    res.json(await service.decideTemplate({
      requestId: requestId(req.params.requestId),
      bossAccountId: req.bossAccount!.accountId,
      ...input,
    }));
  } catch (error) { fail(res, error); }
});

export default router;
