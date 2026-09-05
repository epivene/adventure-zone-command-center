import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { MarketingError, MarketingService } from "@/features/marketing/marketing-service";

const router: IRouter = Router();
const service = new MarketingService(db);
const idSchema = z.string().uuid();
const memberSchema = z.object({ organizationId: idSchema, contactId: idSchema });
const campaignInput = z.object({
  name: z.string().trim().min(1).max(200),
  audienceId: idSchema,
  templateId: idSchema,
  senderName: z.string().trim().min(1).max(200),
  senderEmail: z.string().email().nullable().optional(),
  senderPhone: z.string().trim().max(100).nullable().optional(),
  extraValues: z.record(z.string(), z.string().max(10_000).nullable()).optional(),
  subjectTemplate: z.string().trim().max(500).nullable().optional(),
  bodyTemplate: z.string().trim().min(1).max(100_000).nullable().optional(),
});

function actor(req: any) { return req.userId || "owner"; }
function id(req: any) {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) throw new MarketingError("INVALID_ID");
  return parsed.data;
}
function handle(error: unknown, req: any, res: any) {
  if (error instanceof MarketingError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({ error: "Invalid request.", issues: error.issues });
    return;
  }
  req.log.error({ err: error }, "Marketing campaign request failed");
  res.status(500).json({ error: "The marketing request could not be completed." });
}
const route = (fn: (req: any, res: any) => Promise<void>) => async (req: any, res: any) => {
  try { await fn(req, res); } catch (error) { handle(error, req, res); }
};

router.get("/marketing/audiences", route(async (_req, res) => {
  res.json({ audiences: await service.listAudiences() });
}));
router.get("/marketing/audiences/:id", route(async (req, res) => {
  res.json(await service.audienceDetail(id(req)));
}));
router.post("/marketing/audiences", route(async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).nullable().optional(),
    members: z.array(memberSchema).max(10_000).default([]),
  }).parse(req.body);
  res.status(201).json({ audience: await service.createAudience(input, actor(req)) });
}));
router.delete("/marketing/audiences/:id", route(async (req, res) => {
  await service.deleteAudience(id(req));
  res.status(204).end();
}));
router.patch("/marketing/audiences/:id", route(async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    members: z.array(memberSchema).max(10_000).optional(),
  }).refine((value) => Object.keys(value).length > 0).parse(req.body);
  res.json({ audience: await service.updateAudience(id(req), input, actor(req)) });
}));
router.post("/marketing/audiences/:id/preflight", route(async (req, res) => {
  res.json(await service.preflightAudience(id(req)));
}));
router.get("/marketing/templates", route(async (_req, res) => {
  res.json({ templates: await service.listTemplates() });
}));
router.get("/marketing/campaigns", route(async (_req, res) => {
  res.json({ campaigns: await service.listCampaigns() });
}));
router.get("/marketing/campaigns/:id", route(async (req, res) => {
  res.json(await service.campaignDetail(id(req)));
}));
router.post("/marketing/campaigns", route(async (req, res) => {
  res.status(201).json({ campaign: await service.createCampaign(campaignInput.parse(req.body), actor(req)) });
}));
router.patch("/marketing/campaigns/:id", route(async (req, res) => {
  res.json({ campaign: await service.updateCampaign(id(req), campaignInput.partial().parse(req.body)) });
}));
router.post("/marketing/campaigns/:id/request-review", route(async (req, res) => {
  res.json({ campaign: await service.snapshot(id(req), actor(req)) });
}));
router.post("/marketing/campaigns/:id/return-for-changes", route(async (req, res) => {
  const { note } = z.object({ note: z.string().trim().min(1).max(2_000) }).parse(req.body);
  res.json({ campaign: await service.transition(id(req), ["needs_review"], "draft", actor(req), { note }) });
}));
router.post("/marketing/campaigns/:id/approve", route(async (req, res) => {
  res.json({ campaign: await service.approve(id(req), actor(req)) });
}));
router.post("/marketing/campaigns/:id/send-test", route(async (req, res) => {
  const input = z.object({
    address: z.string().email(),
    values: z.record(z.string(), z.string().max(10_000).nullable()).optional(),
  }).parse(req.body);
  res.json({ delivery: await service.sendTest(id(req), input.address, input.values, actor(req)) });
}));
router.post("/marketing/campaigns/:id/schedule", route(async (req, res) => {
  const { scheduledFor } = z.object({ scheduledFor: z.coerce.date().refine((date) => date.getTime() > Date.now()) }).parse(req.body);
  res.json({ campaign: await service.transition(id(req), ["approved"], "scheduled", actor(req), { scheduledFor }) });
}));
router.post("/marketing/campaigns/:id/cancel", route(async (req, res) => {
  res.json({ campaign: await service.transition(id(req), ["draft", "needs_review", "approved", "scheduled", "failed"], "cancelled", actor(req)) });
}));
router.post("/marketing/campaigns/:id/send-now", route(async (req, res) => {
  res.json(await service.send(id(req), actor(req), "approved"));
}));
router.post("/marketing/campaigns/:id/retry", route(async (req, res) => {
  const campaign = await service.getCampaign(id(req));
  if (campaign.state !== "failed") throw new MarketingError("INVALID_STATE", 409);
  res.json(await service.send(campaign.id, actor(req), "failed"));
}));

export default router;