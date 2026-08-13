import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleOrganizationRepository } from "@/features/organizations/organization-repository";
import {
  organizationListQuerySchema,
  setLastResortInputSchema,
} from "@/features/organizations/last-resort-input";
import {
  createOrganizationParentInputSchema,
  setOrganizationParentInputSchema,
  ungroupOrganizationInputSchema,
} from "@/features/organizations/organization-hierarchy-input";
import {
  createOrganizationParent,
  HierarchyConflictError,
  setOrganizationParent,
  ungroupOrganization,
} from "@/features/organizations/organization-hierarchy";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";

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
    action: z.literal("make_locations"),
    candidateIds: familyCandidateIdsSchema,
    parent: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("existing"),
        parentId: z.string().uuid(),
      }),
      z.object({
        kind: z.literal("new"),
        name: z.string().trim().min(1).max(240),
        website: z.string().trim().max(2048).optional(),
        phone: z.string().trim().max(80).optional(),
      }),
    ]),
  }),
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

function hierarchyError(
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
  if (err instanceof HierarchyConflictError) {
    res.status(409).json({ ok: false, error: err.message });
    return;
  }
  req.log.error({ err }, "Failed to update organization hierarchy");
  res.status(500).json({
    ok: false,
    error: "Could not update organization hierarchy",
  });
}

router.post("/organizations/hierarchy/parent", async (req, res): Promise<void> => {
  try {
    const input = setOrganizationParentInputSchema.parse(req.body);
    await setOrganizationParent(db, input, new Date());
    res.json({ ok: true });
  } catch (err) {
    hierarchyError(req, res, err);
  }
});

router.post("/organizations/hierarchy/create-parent", async (req, res): Promise<void> => {
  try {
    const input = createOrganizationParentInputSchema.parse(req.body);
    const { parentId } = await createOrganizationParent(db, input, new Date());
    res.json({ ok: true, parentId });
  } catch (err) {
    hierarchyError(req, res, err);
  }
});

router.post("/organizations/hierarchy/ungroup", async (req, res): Promise<void> => {
  try {
    const input = ungroupOrganizationInputSchema.parse(req.body);
    await ungroupOrganization(db, input, new Date());
    res.json({ ok: true });
  } catch (err) {
    hierarchyError(req, res, err);
  }
});

router.post("/organizations/family-review", async (req, res): Promise<void> => {
  try {
    const input = familyReviewInputSchema.parse(req.body);
    const repository = orgRepo();
    const groups = await repository.findDuplicates();
    const candidate = groups.find(
      (group) =>
        group.classification === "location_candidate" &&
        group.candidateIds.length === input.candidateIds.length &&
        group.candidateIds.every((id, index) => id === input.candidateIds[index]),
    );
    if (!candidate?.groupKey) {
      throw new HierarchyConflictError(
        "This organization family changed. Refresh the review list and try again.",
      );
    }

    const changedAt = new Date();
    if (input.action === "not_related") {
      await repository.saveFamilyReview({
        groupKey: candidate.groupKey,
        candidateIds: candidate.candidateIds,
        evidence: candidate.evidence,
        status: "not_related",
      });
      res.json({ ok: true });
      return;
    }

    if (input.parent.kind === "new") {
      await createOrganizationParent(
        db,
        {
          name: input.parent.name,
          ...(input.parent.website ? { website: input.parent.website } : {}),
          ...(input.parent.phone ? { phone: input.parent.phone } : {}),
          childIds: candidate.candidateIds,
        },
        changedAt,
      );
    } else {
      for (const childId of candidate.candidateIds) {
        await setOrganizationParent(
          db,
          { childId, parentId: input.parent.parentId },
          changedAt,
        );
      }
    }
    await repository.deleteFamilyReview(candidate.groupKey);
    res.json({ ok: true });
  } catch (err) {
    hierarchyError(req, res, err);
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
