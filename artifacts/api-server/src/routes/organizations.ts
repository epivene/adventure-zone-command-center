import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  DrizzleOrganizationRepository,
  reviewOrganizationFamily,
} from "@/features/organizations/organization-repository";
import {
  prepareOrganizationMergeReferences,
} from "@/features/organizations/organization-merge-reference-preparation";
import {
  organizationListQuerySchema,
  setLastResortInputSchema,
} from "@/features/organizations/last-resort-input";
import { listOrganizationDirectoryPage } from "@/features/organizations/organization-directory-page";
import { createProfileCsv } from "@/features/organizations/profile-csv";
import { setOrganizationLastResort } from "@/features/organizations/last-resort-service";
import { OrganizationConflictError } from "@/features/organizations/organization-conflict";
import { addProfileAsLocation } from "@/features/organizations/add-profile-as-location";
import { filterGroupsContainingResolvedProfiles } from "@/features/organizations/duplicate-review-resolution-filter";
import { prepareSelectedProfileSubsetMerge } from "@/features/organizations/profile-subset-merge-guard";
import { organizationMergeFailureMessage } from "@/features/organizations/organization-merge-error";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { DrizzleLocationRepository } from "@/features/organization-locations/location-repository";
import { attachEventFamiliesToOrganizationPage } from "@/features/event-families/event-family-list";
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
  reviewedLocationConflict: z.boolean().optional().default(false),
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

const addProfileInputSchema = z.object({
  sourceOrgId: z.string().uuid(),
  label: z.string().trim().min(1).max(240).optional(),
});

import { loadProfileCardDetailsWith } from "@/features/organizations/profile-card-details";
export { loadProfileCardDetailsWith } from "@/features/organizations/profile-card-details";
import type { ProfileCardDetails, ProfileCardDetailErrorReporter } from "@/features/organizations/profile-card-details";

async function loadProfileCardDetails(
  ids: string[],
  reportError?: ProfileCardDetailErrorReporter,
): Promise<Map<string, ProfileCardDetails>> {
  return loadProfileCardDetailsWith(
    ids,
    (query) => db.execute(query as any) as any,
    reportError,
  );
}

router.get("/organizations", async (req, res): Promise<void> => {
  const query = organizationListQuerySchema.parse({
    q: req.query.q ?? undefined,
    lastResort: req.query.lastResort ?? undefined,
    filler: req.query.filler ?? undefined,
    leg: req.query.leg ?? undefined,
    type: req.query.type ?? undefined,
    region: req.query.region ?? undefined,
    hasPhone: req.query.hasPhone ?? undefined,
    hasEmail: req.query.hasEmail ?? undefined,
    hasFollowUp: req.query.hasFollowUp ?? undefined,
    hasBooking: req.query.hasBooking ?? undefined,
    hasLocations: req.query.hasLocations ?? undefined,
    showMembers: req.query.showMembers ?? undefined,
    contact: req.query.contact ?? undefined,
    activity: req.query.activity ?? undefined,
    quick: req.query.quick ?? undefined,
    sort: req.query.sort ?? undefined,
    includeRetired: req.query.includeRetired ?? undefined,
    page: req.query.page ?? undefined,
    pageSize: req.query.pageSize ?? undefined,
  });
  try {
    const organizationPage = await listOrganizationDirectoryPage(db, query);
    const cardDetails = await loadProfileCardDetails(
      organizationPage.records.map((record) => record.id),
      (scope, err) => req.log.warn({ err, scope }, "Profile card enrichment query failed"),
    );
    const enrichedPage = {
      ...organizationPage,
      records: organizationPage.records.map((record) => ({
        ...record,
        ...(cardDetails.get(record.id) ?? {
          phone: null,
          email: null,
          website: null,
          description: null,
          placeType: null,
          profileImageDataUrl: null,
          ratingAverage: null,
          ratingCount: 0,
        }),
      })),
    };
    const [{ organizations, families }, travelLegs] = await Promise.all([
      attachEventFamiliesToOrganizationPage(db, query, enrichedPage),
      new DrizzleTravelLegRepository(db).listTravelLegs(),
    ]);
    res.json({ organizations, families, travelLegs });
  } catch (err) {
    req.log.error({ err }, "Failed to list organizations");
    res.status(500).json({ error: "Failed to list organizations" });
  }
});

router.get("/organizations/export", async (req, res): Promise<void> => {
  const baseQuery = organizationListQuerySchema.parse({
    q: req.query.q ?? undefined, lastResort: req.query.lastResort ?? undefined,
    filler: req.query.filler ?? undefined, leg: req.query.leg ?? undefined,
    type: req.query.type ?? undefined, region: req.query.region ?? undefined,
    hasPhone: req.query.hasPhone ?? undefined, hasEmail: req.query.hasEmail ?? undefined,
    hasFollowUp: req.query.hasFollowUp ?? undefined, hasBooking: req.query.hasBooking ?? undefined,
    hasLocations: req.query.hasLocations ?? undefined, showMembers: req.query.showMembers ?? undefined,
    contact: req.query.contact ?? undefined, activity: req.query.activity ?? undefined,
    quick: req.query.quick ?? undefined, sort: req.query.sort ?? undefined,
    includeRetired: req.query.includeRetired ?? undefined, page: 1, pageSize: 50,
  });
  try {
    const records = [];
    let page = 1;
    let pageCount = 1;
    do {
      const result = await listOrganizationDirectoryPage(db, { ...baseQuery, page });
      records.push(...result.records);
      pageCount = result.pageCount;
      page += 1;
    } while (page <= pageCount);
    const labels: Record<string, string> = {
      deadline_soon: "Deadline soon", needs_follow_up: "Needs follow-up", contacted: "Contacted",
      waiting: "Waiting", booked: "Booked", confirmed: "Confirmed", expected: "Expected", not_a_fit: "Not a fit", unrecorded: "",
      flat_fee: "Flat fee", pay_per_play: "Pay-per-play", either: "Either",
    };
    const dateValue = (value: Date | string | null) => {
      if (!value) return "";
      const date = value instanceof Date ? value : new Date(value);
      return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
    };
    const csv = createProfileCsv(records.map((record) => ({
      eventName: record.name,
      location: [record.city, record.region].filter(Boolean).join(", "),
      nextDate: dateValue(record.effectiveEventDate?.startsOn ?? null),
      nextEventStatus: record.effectiveEventDate
        ? labels[record.effectiveEventDate.displayStatus] ?? record.effectiveEventDate.displayStatus
        : "Date not found",
      deadline: dateValue(record.applicationDeadline),
      status: labels[record.decisionStatus] ?? record.decisionStatus,
      recommendedDealModel: record.recommendedDealModel ? labels[record.recommendedDealModel] : "",
      nextAction: [record.nextActionKind, dateValue(record.nextActionDueAt)].filter(Boolean).join(" — "),
      contactName: record.primaryContactName ?? "",
      contactEmail: record.primaryContactEmail ?? "",
      contactPhone: record.primaryContactPhone ?? "",
    })));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="event-profiles.csv"');
    res.send(`\uFEFF${csv}`);
  } catch (err) {
    req.log.error({ err }, "Failed to export profiles");
    res.status(500).json({ error: "Failed to export profiles" });
  }
});

router.get("/organizations/duplicates", async (req, res): Promise<void> => {
  try {
    const groups = await orgRepo().findDuplicates();
    const candidateIds = [...new Set(groups.flatMap((group) => group.organizations.map((profile) => profile.id)))];
    if (!candidateIds.length) {
      res.json({ groups: [] });
      return;
    }

    const idList = sql.join(candidateIds.map((id) => sql`${id}::uuid`), sql.raw(", "));
    const resolvedResult = await db.execute<{ id: string }>(sql`
      select o.id
      from organizations o
      where o.id in (${idList})
        and (
          o.consolidated_into_id is not null
          or o.parent_organization_id is not null
          or exists (
            select 1
            from event_family_members efm
            where efm.organization_id = o.id
          )
        )
    `);
    const resolvedIds = new Set((resolvedResult.rows ?? []).map((row) => row.id));
    res.json({ groups: filterGroupsContainingResolvedProfiles(groups, resolvedIds) });
  } catch (err) {
    req.log.error({ err }, "Failed to find duplicate profiles");
    res.status(500).json({ error: "Failed to find duplicate profiles" });
  }
});

function organizationReviewError(req: Request, res: Response, err: unknown): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({ ok: false, error: err.issues[0]?.message ?? "Invalid input" });
    return;
  }
  if (err instanceof OrganizationConflictError) {
    res.status(409).json({ ok: false, error: err.message });
    return;
  }
  req.log.error({ err }, "Failed to update profile relationship review");
  res.status(500).json({ ok: false, error: "Could not update profile relationship review" });
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

router.use("/organizations/:id/locations", locationRoutes);

router.post("/organizations/:id/add-profile", async (req, res): Promise<void> => {
  const canonicalOrgId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = addProfileInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const result = await addProfileAsLocation(db, { canonicalOrgId, sourceOrgId: parsed.data.sourceOrgId, label: parsed.data.label }, new Date());
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof OrganizationConflictError) {
      res.status(409).json({ ok: false, error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to add existing profile as profile location");
    res.status(500).json({ ok: false, error: "Could not add profile as a location" });
  }
});

router.get("/organizations/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const redirect = await getConsolidationRedirect(db, id);
    if (redirect) { res.json({ consolidatedInto: redirect }); return; }
    const locRepo = new DrizzleLocationRepository(db);
    const [organization, timelinePage, orgLocations, orgLocationRollup] = await Promise.all([
      orgRepo().getOrganizationSummary(id),
      new ActivityService(new DrizzleActivityRepository(db)).listTimeline({ organizationId: id }),
      locRepo.findByOrganization(id),
      locRepo.rollupForOrganization(id),
    ]);
    if (!organization) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ organization, timeline: timelinePage.items, timelineNextPage: timelinePage.nextPage, orgLocations, orgLocationRollup });
  } catch (err) {
    req.log.error({ err }, "Failed to get profile" );
    res.status(500).json({ error: "Failed to get profile" });
  }
});

router.post("/organizations/merge", async (req, res): Promise<void> => {
  const parsed = mergeInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }); return; }
  const { primaryId, duplicateIds, reviewedLocationConflict } = parsed.data;
  if (duplicateIds.includes(primaryId)) { res.status(400).json({ ok: false, error: "primaryId must not appear in duplicateIds" }); return; }
  try {
    await db.transaction(async (transaction) => {
      await prepareSelectedProfileSubsetMerge(
        transaction,
        [primaryId, ...duplicateIds],
        { reviewedLocationConflict },
      );
      await prepareOrganizationMergeReferences(transaction, primaryId, duplicateIds);
      await orgRepo().mergeOrganizations(primaryId, duplicateIds, transaction);
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof OrganizationConflictError) { res.status(409).json({ ok: false, error: err.message }); return; }
    req.log.error({ err }, "Failed to merge profiles");
    res.status(500).json({ ok: false, error: organizationMergeFailureMessage(err) });
  }
});

router.post("/organizations/last-resort", async (req, res): Promise<void> => {
  const parsed = setLastResortInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }); return; }
  try {
    await setOrganizationLastResort(db, parsed.data, new Date());
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update last resort");
    res.status(500).json({ ok: false, error: "Could not update last resort status" });
  }
});

const consolidationPreviewBodySchema = z.object({
  canonicalOrgId: z.string().uuid().nullable().default(null),
  proposedCanonicalName: z.string().trim().min(1).max(240).optional(),
  sourceOrgIds: z.array(z.string().uuid()).min(2).max(20),
});

router.post("/organizations/consolidation-preview", async (req, res): Promise<void> => {
  const parsed = consolidationPreviewBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }); return; }
  const input: ConsolidationPreviewInput = parsed.data;
  try {
    const preview = await buildConsolidationPreview(db, input);
    res.json({ ok: true, preview });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Canonical organization not found")) { res.status(404).json({ ok: false, error: err.message }); return; }
    req.log.error({ err }, "Failed to build consolidation preview");
    res.status(500).json({ ok: false, error: "Could not build profile-location preview" });
  }
});

const consolidationApplyBodySchema = z.object({
  canonicalOrgId: z.string().uuid().nullable().default(null),
  proposedCanonical: z.object({
    name: z.string().trim().min(1).max(240),
    website: z.string().trim().max(2048).nullable().optional(),
    phone: z.string().trim().max(80).nullable().optional(),
  }).optional(),
  locationAssignments: z.array(z.object({ sourceOrgId: z.string().uuid(), label: z.string().trim().min(1).max(240) })).min(2).max(20).refine(
    (assignments) => new Set(assignments.map((a) => a.sourceOrgId)).size === assignments.length,
    { message: "locationAssignments.sourceOrgId values must be unique" },
  ),
});

router.post("/organizations/consolidation-apply", async (req, res): Promise<void> => {
  const parsed = consolidationApplyBodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }); return; }
  const input: ConsolidationApplyInput = parsed.data;
  try {
    const result = await applyConsolidation(db, input, new Date());
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof OrganizationConflictError) { res.status(409).json({ ok: false, error: err.message }); return; }
    req.log.error({ err }, "Failed to apply profile-location consolidation");
    res.status(500).json({ ok: false, error: "Could not combine profiles as locations" });
  }
});

export default router;
