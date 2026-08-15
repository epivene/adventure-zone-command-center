import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  DrizzleOrganizationRepository,
  reviewOrganizationFamily,
} from "@/features/organizations/organization-repository";
import {
  organizationListQuerySchema,
  setLastResortInputSchema,
} from "@/features/organizations/last-resort-input";
import { OrganizationConflictError } from "@/features/organizations/organization-conflict";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { DrizzleLocationRepository } from "@/features/organization-locations/location-repository";
import locationRoutes from "@/routes/organization-locations";
import {
  applyConsolidation,
  buildConsolidationPreview,
  getConsolidationRedirect,
  type ConsolidationApplyInput,
  type ConsolidationPreviewInput,
} from "@/features/organizations/organization-consolidation";

const router: IRouter = Router();
function orgRepo() { return new DrizzleOrganizationRepository(db); }

const mergeInputSchema = z.object({
  primaryId: z.string().uuid(),
  duplicateIds: z.array(z.string().uuid()).min(1),
});

const familyCandidateIdsSchema = z
  .array(z.string().uuid())
  .min(2)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "candidateIds must be unique",
  })
  .transform((ids) => [...ids].sort((left, right) => left.localeCompare(right, "en-US")));

const familyReviewInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("not_related"),
    candidateIds: familyCandidateIdsSchema,
  }),
]);

router.get("/organizations", async (req, res): Promise<void> => {
  const query = organizationListQuerySchema.parse({
    q: req.query.q ?? undefined,
    lastResort: req.query.lastResort ?? undefined,
    leg: req.query.leg ?? undefined,
    type: req.query.type ?? undefined,
    region: req.query.region ?? undefined,
    hasPhone: req.query.hasPhone ?? undefined,
    hasEmail: req.query.hasEmail ?? undefined,
    hasFollowUp: req.query.hasFollowUp ?? undefined,
    hasBooking: req.query.hasBooking ?? undefined,
    hasLocations: req.query.hasLocations ?? undefined,
    contact: req.query.contact ?? undefined,
    activity: req.query.activity ?? undefined,
    includeRetired: req.query.includeRetired ?? undefined,
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

function organizationReviewError(
  req: Request,
  res: Response,
  err: unknown,
): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({
      ok: false,
      error: err.issues[0]?.message ?? "Invalid input",
    });
    return;
  }
  if (err instanceof OrganizationConflictError) {
    res.status(409).json({ ok: false, error: err.message });
    return;
  }
  req.log.error({ err }, "Failed to update organization review");
  res.status(500).json({
    ok: false,
    error: "Could not update organization review",
  });
}

router.post("/organizations/family-review", async (req, res): Promise<void> => {
  try {
    const input = familyReviewInputSchema.parse(req.body);
    await reviewOrganizationFamily(db, input, new Date());
    res.json({ ok: true });
  } catch (err) {
    organizationReviewError(req, res, err);
  }
});

// Location CRUD routes nested under /organizations/:id/locations.
// Must be registered before /:id to prevent Express matching "locations" as a param.
router.use("/organizations/:id/locations", locationRoutes);

router.get("/organizations/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    // Check for consolidation redirect before loading the full summary.
    const redirect = await getConsolidationRedirect(db, id);
    if (redirect) {
      res.json({ consolidatedInto: redirect });
      return;
    }

    const locRepo = new DrizzleLocationRepository(db);
    const [organization, timelinePage, orgLocations, orgLocationRollup] = await Promise.all([
      orgRepo().getOrganizationSummary(id),
      new ActivityService(new DrizzleActivityRepository(db)).listTimeline({ organizationId: id }),
      locRepo.findByOrganization(id),
      locRepo.rollupForOrganization(id),
    ]);
    if (!organization) { res.status(404).json({ error: "Not found" }); return; }
    res.json({
      organization,
      timeline: timelinePage.items,
      timelineNextPage: timelinePage.nextPage,
      orgLocations,
      orgLocationRollup,
    });
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
    if (err instanceof OrganizationConflictError) {
      res.status(409).json({ ok: false, error: err.message });
      return;
    }
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

//  Consolidation

const consolidationPreviewBodySchema = z.object({
  canonicalOrgId: z.string().uuid().nullable().default(null),
  proposedCanonicalName: z.string().trim().min(1).max(240).optional(),
  sourceOrgIds: z.array(z.string().uuid()).min(2).max(20),
});

router.post("/organizations/consolidation-preview", async (req, res): Promise<void> => {
  const parsed = consolidationPreviewBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const input: ConsolidationPreviewInput = parsed.data;
  try {
    const preview = await buildConsolidationPreview(db, input);
    res.json({ ok: true, preview });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Canonical organization not found")) {
      res.status(404).json({ ok: false, error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to build consolidation preview");
    res.status(500).json({ ok: false, error: "Could not build consolidation preview" });
  }
});

const consolidationApplyBodySchema = z.object({
  canonicalOrgId: z.string().uuid().nullable().default(null),
  proposedCanonical: z.object({
    name: z.string().trim().min(1).max(240),
    website: z.string().trim().max(2048).nullable().optional(),
    phone: z.string().trim().max(80).nullable().optional(),
  }).optional(),
  locationAssignments: z.array(z.object({
    sourceOrgId: z.string().uuid(),
    label: z.string().trim().min(1).max(240),
  })).min(2).max(20).refine(
    (assignments) => {
      const ids = assignments.map((a) => a.sourceOrgId);
      return new Set(ids).size === ids.length;
    },
    { message: "locationAssignments.sourceOrgId values must be unique" },
  ),
});

router.post("/organizations/consolidation-apply", async (req, res): Promise<void> => {
  const parsed = consolidationApplyBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const input: ConsolidationApplyInput = parsed.data;
  try {
    const result = await applyConsolidation(db, input, new Date());
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof OrganizationConflictError) {
      res.status(409).json({ ok: false, error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to apply consolidation");
    res.status(500).json({ ok: false, error: "Could not apply consolidation" });
  }
});

export default router;
