import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleOrganizationRepository } from "@/features/organizations/organization-repository";
import {
  organizationListQuerySchema,
  setLastResortInputSchema,
} from "@/features/organizations/last-resort-input";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";

const router: IRouter = Router();
function orgRepo() { return new DrizzleOrganizationRepository(db); }

const mergeInputSchema = z.object({
  primaryId: z.string().uuid(),
  duplicateIds: z.array(z.string().uuid()).min(1),
});

router.get("/organizations", async (req, res): Promise<void> => {
  const query = organizationListQuerySchema.parse({
    q: req.query.q ?? undefined,
    lastResort: req.query.lastResort ?? undefined,
    leg: req.query.leg ?? undefined,
    page: req.query.page ?? undefined,
  });
  try {
    const organizations = await orgRepo().listOrganizations(query);
    const travelLegs = await new DrizzleTravelLegRepository(db).listTravelLegs();
    res.json({ organizations, travelLegs });
  } catch (err) {
    req.log.error({ err }, "Failed to list organizations");
    res.status(500).json({ error: "Failed to list organizations" });
  }
});

// Static sub-routes must come before /:id so Express doesn't match them as params
router.get("/organizations/duplicates", async (req, res): Promise<void> => {
  try {
    const groups = await orgRepo().findDuplicates();
    res.json({ groups });
  } catch (err) {
    req.log.error({ err }, "Failed to find duplicate organizations");
    res.status(500).json({ error: "Failed to find duplicate organizations" });
  }
});

router.get("/organizations/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const organization = await orgRepo().getOrganizationSummary(id);
    if (!organization) { res.status(404).json({ error: "Not found" }); return; }
    const timeline = await new ActivityService(
      new DrizzleActivityRepository(db),
    ).listTimeline({ organizationId: id });
    res.json({ organization, timeline });
  } catch (err) {
    req.log.error({ err }, "Failed to get organization");
    res.status(500).json({ error: "Failed to get organization" });
  }
});

router.post("/organizations/merge", async (req, res): Promise<void> => {
  const parsed = mergeInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { primaryId, duplicateIds } = parsed.data;
  if (duplicateIds.includes(primaryId)) {
    res.status(400).json({ ok: false, error: "primaryId must not appear in duplicateIds" });
    return;
  }
  try {
    await orgRepo().mergeOrganizations(primaryId, duplicateIds);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to merge organizations");
    res.status(500).json({ ok: false, error: "Failed to merge organizations" });
  }
});

router.post("/organizations/last-resort", async (req, res): Promise<void> => {
  const parsed = setLastResortInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    await orgRepo().setLastResort(parsed.data, new Date());
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update last resort");
    res.status(500).json({ ok: false, error: "Could not update last resort status" });
  }
});

export default router;
