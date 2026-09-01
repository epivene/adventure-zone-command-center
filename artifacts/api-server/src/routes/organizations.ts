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
import { setOrganizationLastResort } from "@/features/organizations/last-resort-service";
import { OrganizationConflictError } from "@/features/organizations/organization-conflict";
import { addProfileAsLocation } from "@/features/organizations/add-profile-as-location";
import { filterGroupsContainingResolvedProfiles } from "@/features/organizations/duplicate-review-resolution-filter";
import { prepareSelectedProfileSubsetMerge } from "@/features/organizations/profile-subset-merge-guard";
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

type ProfileCardDetails = {
  id: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  placeType: string | null;
  profileImageDataUrl: string | null;
  ratingAverage: number | null;
  ratingCount: number;
};

type ExecuteQuery = (query: unknown) => Promise<{ rows?: any[] }>;
type ProfileCardDetailErrorReporter = (
  scope: "photo" | "core" | "rating",
  error: unknown,
) => void;

export async function loadProfileCardDetailsWith(
  ids: string[],
  execute: ExecuteQuery,
  reportError?: ProfileCardDetailErrorReporter,
): Promise<Map<string, ProfileCardDetails>> {
  if (!ids.length) return new Map();

  // Keep every UUID as its own bound parameter. Passing the whole JS array as a
  // single ANY($1::uuid[]) value proved fragile with the production driver.
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql.raw(", "));

  let photoRows: any[] = [];
  try {
    const photoResult = await execute(sql`
      select
        o.id,
        o.profile_image_data_url as "profileImageDataUrl"
      from organizations o
      where o.id in (${idList})
    `);
    photoRows = photoResult.rows ?? [];
  } catch (error) {
    reportError?.("photo", error);
    photoRows = [];
  }

  let coreRows: any[] = [];
  try {
    const coreResult = await execute(sql`
      select
        o.id,
        coalesce(c.phone, o.phone) as phone,
        c.email,
        o.website,
        o.description,
        o.place_type as "placeType"
      from organizations o
      left join organization_contacts oc
        on oc.organization_id = o.id
        and oc.active = true
        and oc.is_primary = true
      left join contacts c on c.id = oc.contact_id
      where o.id in (${idList})
    `);
    coreRows = coreResult.rows ?? [];
  } catch (error) {
    reportError?.("core", error);
    coreRows = [];
  }

  let ratingRows: any[] = [];
  try {
    const ratingResult = await execute(sql`
      select
        b.organization_id as id,
        avg(w.rating_stars)::float as "ratingAverage",
        count(w.rating_stars)::int as "ratingCount"
      from bookings b
      inner join event_wrap_ups w on w.booking_id = b.id and w.rating_stars is not null
      where b.organization_id in (${idList})
      group by b.organization_id
    `);
    ratingRows = ratingResult.rows ?? [];
  } catch (error) {
    reportError?.("rating", error);
    ratingRows = [];
  }

  const photosById = new Map(photoRows.map((row) => [row.id, row.profileImageDataUrl ?? null]));
  const coreById = new Map(coreRows.map((row) => [row.id, row]));
  const ratingsById = new Map(ratingRows.map((row) => [row.id, {
    ratingAverage: row.ratingAverage == null ? null : Number(row.ratingAverage),
    ratingCount: Number(row.ratingCount ?? 0),
  }]));

  return new Map(ids.map((id) => {
    const core = coreById.get(id) ?? {};
    const rating = ratingsById.get(id) ?? { ratingAverage: null, ratingCount: 0 };
    return [id, {
      id,
      phone: core.phone ?? null,
      email: core.email ?? null,
      website: core.website ?? null,
      description: core.description ?? null,
      placeType: core.placeType ?? null,
      profileImageDataUrl: photosById.get(id) ?? null,
      ...rating,
    }];
  }));
}

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
  const { primaryId, duplicateIds } = parsed.data;
  if (duplicateIds.includes(primaryId)) { res.status(400).json({ ok: false, error: "primaryId must not appear in duplicateIds" }); return; }
  try {
    await db.transaction(async (transaction) => {
      await prepareSelectedProfileSubsetMerge(transaction, [primaryId, ...duplicateIds]);
      await prepareOrganizationMergeReferences(transaction, primaryId, duplicateIds);
      await orgRepo().mergeOrganizations(primaryId, duplicateIds, transaction);
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof OrganizationConflictError) { res.status(409).json({ ok: false, error: err.message }); return; }
    req.log.error({ err }, "Failed to merge profiles");
    res.status(500).json({ ok: false, error: "Failed to merge profiles" });
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