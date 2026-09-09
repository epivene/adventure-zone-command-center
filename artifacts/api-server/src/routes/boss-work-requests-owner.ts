import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { ConventionApplyService } from "@/features/boss-work-requests/convention-apply-service";
import {
  BossWorkRequestConflictError,
  BossWorkRequestNotFoundError,
} from "@/features/boss-work-requests/boss-work-request-repository";
import { BossWorkRequestService } from "@/features/boss-work-requests/boss-work-request-service";
import {
  conventionApplySchema,
  createWorkRequestSchema,
  ownerDecisionSchema,
} from "@/features/boss-work-requests/boss-work-request-types";

const router: IRouter = Router();
const service = new BossWorkRequestService(db);
const applyService = new ConventionApplyService(db);
const uuid = z.string().uuid();
const param = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";
const ownerId = (req: Request) => (req as Request & { userId?: string }).userId || "owner";

function id(value: string | string[] | undefined) {
  return uuid.parse(param(value));
}

function fail(res: Response, error: unknown) {
  if (error instanceof z.ZodError) res.status(400).json({ error: error.issues[0]?.message ?? "Invalid request." });
  else if (error instanceof BossWorkRequestNotFoundError) res.status(404).json({ error: error.message });
  else if (error instanceof BossWorkRequestConflictError) res.status(409).json({ error: error.message });
  else throw error;
}

router.get("/boss-work-requests", async (_req, res) => {
  res.json(await service.ownerQueue());
});

router.get("/boss-work-requests/:requestId", async (req, res) => {
  try { res.json(await service.ownerDetail(id(req.params.requestId))); }
  catch (error) { fail(res, error); }
});

router.post("/boss-work-requests", async (req, res) => {
  try {
    const input = createWorkRequestSchema.parse(req.body);
    const detail = await service.createOwnerRequest({
      ...input,
      instructions: input.instructions ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      ownerId: ownerId(req),
    });
    res.status(201).json(detail);
  } catch (error) { fail(res, error); }
});

router.post("/boss-work-requests/:requestId/cancel", async (req, res) => {
  try {
    const input = ownerDecisionSchema.parse(req.body);
    res.json({ request: await service.cancel(id(req.params.requestId), ownerId(req), input.note) });
  } catch (error) { fail(res, error); }
});

router.post("/boss-work-requests/:requestId/return-for-clarification", async (req, res) => {
  try {
    const input = ownerDecisionSchema.parse(req.body);
    res.json({ request: await service.returnForClarification(id(req.params.requestId), ownerId(req), input.note) });
  } catch (error) { fail(res, error); }
});

router.get("/boss-work-requests/:requestId/submissions/:submissionId/preview", async (req, res) => {
  try {
    await service.ownerDetail(id(req.params.requestId));
    res.json(await applyService.preview(id(req.params.submissionId)));
  } catch (error) { fail(res, error); }
});

router.post("/boss-work-requests/:requestId/submissions/:submissionId/apply", async (req, res) => {
  try {
    const input = conventionApplySchema.parse(req.body);
    res.json(await applyService.apply({
      requestId: id(req.params.requestId),
      submissionId: id(req.params.submissionId),
      ownerId: ownerId(req),
      organizationId: input.organizationId,
      contactId: input.contactId,
      createOrganization: input.createOrganization,
      createContact: input.createContact,
      followUpDueAt: input.followUpDueAt ? new Date(input.followUpDueAt) : null,
    }));
  } catch (error) { fail(res, error); }
});

export default router;
