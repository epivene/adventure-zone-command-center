import { Router, type IRouter } from "express";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";
import { z } from "zod";

import { db } from "@workspace/db";
import {
  bookings,
  designAssets,
  designCertificates,
  designProjects,
  organizations,
  officeAccounts,
} from "@/db/schema";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { GoogleCloudPrivateObjectStorage } from "@/lib/private-object-storage";
import { requireOwnerMiddleware } from "../lib/auth";

const router: IRouter = Router();
const requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));
const assetStorage = new GoogleCloudPrivateObjectStorage(process.env, [
  "GOOGLE_CLOUD_STORAGE_BUCKET",
  "LEG_MANAGER_RECEIPT_BUCKET",
]);

const idSchema = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid calendar date.").nullable();
const createSchema = z.object({
  officeAccountId: idSchema.optional(),
  name: z.string().trim().min(1, "Certificate name is required.").max(200),
  bookingId: idSchema.nullable().optional(),
  organizationId: idSchema.nullable().optional(),
  assetId: idSchema.nullable().optional(),
  issueDate: dateSchema.optional(),
  expirationDate: dateSchema.optional(),
  reviewState: z.enum(["needs_review", "reviewed"]).optional(),
}).strict();
const patchSchema = createSchema.omit({ officeAccountId: true, name: true }).extend({
  name: createSchema.shape.name.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "No certificate changes provided." });

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function classify(expirationDate: string | null, assetId: string | null, todayText = new Date().toISOString().slice(0, 10)) {
  if (!expirationDate || !assetId) return "incomplete" as const;
  const soon = new Date(`${todayText}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 30);
  const soonText = soon.toISOString().slice(0, 10);
  if (expirationDate < todayText) return "expired" as const;
  if (expirationDate <= soonText) return "expiring_soon" as const;
  return "current" as const;
}

const expirationFilterSchema = z.enum(["all", "current", "expiring_soon", "expired", "incomplete"]).default("all");
const reviewFilterSchema = z.enum(["all", "needs_review", "reviewed"]).default("all");
const certificateFilterQuerySchema = z.object({
  expirationState: expirationFilterSchema,
  reviewState: reviewFilterSchema,
  officeAccountId: idSchema.optional(),
});

export function parseCertificateFilterQuery(query: Record<string, unknown>) {
  const first = (value: unknown) => Array.isArray(value) ? value[0] : value;
  return certificateFilterQuerySchema.safeParse({
    expirationState: first(query.expirationState) || undefined,
    reviewState: first(query.reviewState) || undefined,
    officeAccountId: first(query.officeAccountId) || undefined,
  });
}

type CertificateQueryOptions = {
  officeAccountId?: string;
  expirationState?: z.infer<typeof expirationFilterSchema>;
  reviewState?: z.infer<typeof reviewFilterSchema>;
};

function dateAfterDays(todayText: string, days: number) {
  const date = new Date(`${todayText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function listCertificateRecords({
  officeAccountId,
  expirationState = "all",
  reviewState = "all",
}: CertificateQueryOptions = {}) {
  const todayText = new Date().toISOString().slice(0, 10);
  const soonText = dateAfterDays(todayText, 30);
  const filters = [
    officeAccountId ? eq(designCertificates.officeAccountId, officeAccountId) : undefined,
    reviewState !== "all" ? eq(designCertificates.reviewState, reviewState) : undefined,
  ];
  if (expirationState === "current") {
    filters.push(
      isNotNull(designCertificates.assetId),
      isNotNull(designCertificates.expirationDate),
      gt(designCertificates.expirationDate, soonText),
    );
  } else if (expirationState === "expiring_soon") {
    filters.push(
      isNotNull(designCertificates.assetId),
      gte(designCertificates.expirationDate, todayText),
      lte(designCertificates.expirationDate, soonText),
    );
  } else if (expirationState === "expired") {
    filters.push(
      isNotNull(designCertificates.assetId),
      isNotNull(designCertificates.expirationDate),
      lt(designCertificates.expirationDate, todayText),
    );
  } else if (expirationState === "incomplete") {
    filters.push(or(isNull(designCertificates.assetId), isNull(designCertificates.expirationDate)));
  }
  const rows = await db
    .select({
      id: designCertificates.id,
      officeAccountId: designCertificates.officeAccountId,
      officeAccountName: officeAccounts.displayName,
      name: designCertificates.name,
      bookingId: designCertificates.bookingId,
      bookingName: bookings.name,
      organizationId: designCertificates.organizationId,
      organizationName: organizations.name,
      assetId: designCertificates.assetId,
      assetName: designAssets.name,
      storageKey: designAssets.storageKey,
      issueDate: designCertificates.issueDate,
      expirationDate: designCertificates.expirationDate,
      reviewState: designCertificates.reviewState,
      createdAt: designCertificates.createdAt,
      updatedAt: designCertificates.updatedAt,
    })
    .from(designCertificates)
    .innerJoin(officeAccounts, eq(officeAccounts.id, designCertificates.officeAccountId))
    .leftJoin(bookings, eq(bookings.id, designCertificates.bookingId))
    .leftJoin(organizations, eq(organizations.id, designCertificates.organizationId))
    .leftJoin(designAssets, eq(designAssets.id, designCertificates.assetId))
    .where(and(...filters))
    .orderBy(desc(designCertificates.expirationDate), desc(designCertificates.updatedAt));

  return Promise.all(rows.map(async (row) => ({
    ...row,
    expirationState: classify(row.expirationDate, row.assetId),
    fileAvailable: Boolean(row.storageKey),
    fileUrl: row.storageKey
      ? await assetStorage.getSignedReadUrl(row.storageKey, 15 * 60).catch(() => null)
      : null,
    storageKey: undefined,
  })));
}

async function listAssetCandidates(officeAccountId?: string) {
  const scope = officeAccountId ? eq(designAssets.uploadedByAccountId, officeAccountId) : undefined;
  const candidates = await db
    .select({
      id: designAssets.id,
      officeAccountId: designAssets.uploadedByAccountId,
      name: designAssets.name,
      bookingId: designAssets.bookingId,
      bookingName: bookings.name,
      organizationId: designAssets.organizationId,
      organizationName: organizations.name,
      mimeType: designAssets.mimeType,
      fileAvailable: designAssets.storageKey,
      createdAt: designAssets.createdAt,
    })
    .from(designAssets)
    .leftJoin(bookings, eq(bookings.id, designAssets.bookingId))
    .leftJoin(organizations, eq(organizations.id, designAssets.organizationId))
    .where(and(
      scope,
      or(
        ilike(designAssets.name, "%COI%"),
        ilike(designAssets.name, "%certificate of insurance%"),
        ilike(designAssets.name, "%insurance certificate%"),
      ),
    ))
    .orderBy(desc(designAssets.createdAt));
  return candidates.map((candidate) => ({
    ...candidate,
    fileAvailable: Boolean(candidate.fileAvailable),
  }));
}

async function validateRelations(
  input: { officeAccountId: string; bookingId?: string | null; organizationId?: string | null; assetId?: string | null },
) {
  const [account] = await db.select({ id: officeAccounts.id }).from(officeAccounts).where(eq(officeAccounts.id, input.officeAccountId)).limit(1);
  if (!account) return "Office workspace not found.";
  if (input.bookingId) {
    const [booking] = await db.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, input.bookingId)).limit(1);
    if (!booking) return "Related event not found.";
  }
  if (input.organizationId) {
    const [organization] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.organizationId)).limit(1);
    if (!organization) return "Related profile not found.";
  }
  if (input.bookingId) {
    const [projectLink] = await db
      .select({ id: designProjects.id })
      .from(designProjects)
      .where(and(eq(designProjects.officeAccountId, input.officeAccountId), eq(designProjects.linkedBookingId, input.bookingId)))
      .limit(1);
    const [assetLink] = await db
      .select({ id: designAssets.id })
      .from(designAssets)
      .where(and(eq(designAssets.uploadedByAccountId, input.officeAccountId), eq(designAssets.bookingId, input.bookingId)))
      .limit(1);
    if (!projectLink && !assetLink) return "Related event is outside this Office workspace.";
  }
  if (input.organizationId) {
    const [projectLink] = await db
      .select({ id: designProjects.id })
      .from(designProjects)
      .where(and(eq(designProjects.officeAccountId, input.officeAccountId), eq(designProjects.linkedOrganizationId, input.organizationId)))
      .limit(1);
    const [assetLink] = await db
      .select({ id: designAssets.id })
      .from(designAssets)
      .where(and(eq(designAssets.uploadedByAccountId, input.officeAccountId), eq(designAssets.organizationId, input.organizationId)))
      .limit(1);
    if (!projectLink && !assetLink) return "Related profile is outside this Office workspace.";
  }
  if (input.assetId) {
    const [asset] = await db
      .select({ id: designAssets.id, uploadedByAccountId: designAssets.uploadedByAccountId })
      .from(designAssets)
      .where(and(eq(designAssets.id, input.assetId), eq(designAssets.uploadedByAccountId, input.officeAccountId)))
      .limit(1);
    if (!asset) return "Choose a COI asset from this Office workspace.";
  }
  if (input.bookingId && input.organizationId) {
    const [booking] = await db.select({ organizationId: bookings.organizationId }).from(bookings).where(eq(bookings.id, input.bookingId)).limit(1);
    if (booking?.organizationId && booking.organizationId !== input.organizationId) return "The event and profile do not match.";
  }
  return null;
}

function validateDates(issueDate: string | null | undefined, expirationDate: string | null | undefined) {
  if (issueDate && expirationDate && issueDate > expirationDate) return "Expiration date cannot be before the issue date.";
  return null;
}

async function createCertificate(input: z.infer<typeof createSchema>, officeAccountId: string) {
  const dateError = validateDates(input.issueDate, input.expirationDate);
  if (dateError) return { error: dateError } as const;
  const relationError = await validateRelations({ officeAccountId, ...input });
  if (relationError) return { error: relationError } as const;
  try {
    const [certificate] = await db.insert(designCertificates).values({
      officeAccountId,
      name: input.name,
      bookingId: input.bookingId ?? null,
      organizationId: input.organizationId ?? null,
      assetId: input.assetId ?? null,
      issueDate: input.issueDate ?? null,
      expirationDate: input.expirationDate ?? null,
      reviewState: input.reviewState ?? "needs_review",
    }).returning({ id: designCertificates.id });
    return { certificate } as const;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && (error as { code?: string }).code === "23505") {
      return { error: "That Studio asset is already linked to another COI." } as const;
    }
    throw error;
  }
}

router.get("/boss/coi", requireBoss, async (req, res): Promise<void> => {
  const officeAccountId = req.bossAccount!.studioOfficeAccountId;
  if (!officeAccountId) {
    res.json({ certificates: [], assetCandidates: [], workspaceAvailable: false });
    return;
  }
  try {
    res.json({
      certificates: await listCertificateRecords({ officeAccountId }),
      assetCandidates: await listAssetCandidates(officeAccountId),
      workspaceAvailable: true,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Boss COIs");
    res.status(500).json({ error: "Could not load certificates of insurance." });
  }
});

router.post("/boss/coi", requireBoss, async (req, res): Promise<void> => {
  const input = createSchema.omit({ officeAccountId: true }).safeParse(req.body);
  const officeAccountId = req.bossAccount!.studioOfficeAccountId;
  if (!officeAccountId) { res.status(409).json({ error: "Connect this Boss account to an Office workspace first." }); return; }
  if (!input.success) { res.status(400).json({ error: input.error.issues[0]?.message ?? "Review the certificate details." }); return; }
  try {
    const result = await createCertificate(input.data, officeAccountId);
    if ("error" in result) { res.status(400).json(result); return; }
    res.status(201).json(result);
  } catch (error) {
    req.log.error({ err: error }, "Failed to create Boss COI");
    res.status(500).json({ error: "Could not save the certificate of insurance." });
  }
});

router.patch("/boss/coi/:certificateId", requireBoss, async (req, res): Promise<void> => {
  const certificateId = param(req.params.certificateId);
  const input = patchSchema.safeParse(req.body);
  const officeAccountId = req.bossAccount!.studioOfficeAccountId;
  if (!idSchema.safeParse(certificateId).success || !input.success) { res.status(400).json({ error: "Review the certificate changes." }); return; }
  if (!officeAccountId) { res.status(409).json({ error: "Connect this Boss account to an Office workspace first." }); return; }
  try {
    const [current] = await db.select().from(designCertificates).where(and(eq(designCertificates.id, certificateId), eq(designCertificates.officeAccountId, officeAccountId))).limit(1);
    if (!current) { res.status(404).json({ error: "Certificate of insurance not found." }); return; }
    const next = { ...current, ...input.data };
    const dateError = validateDates(next.issueDate, next.expirationDate);
    if (dateError) { res.status(400).json({ error: dateError }); return; }
    const relationError = await validateRelations({ officeAccountId, bookingId: next.bookingId, organizationId: next.organizationId, assetId: next.assetId });
    if (relationError) { res.status(400).json({ error: relationError }); return; }
    await db.update(designCertificates).set({ ...input.data, updatedAt: new Date() }).where(eq(designCertificates.id, certificateId));
    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Failed to update Boss COI");
    res.status(500).json({ error: "Could not save the certificate changes." });
  }
});

router.get("/admin/coi", requireOwnerMiddleware, async (req, res): Promise<void> => {
  const filters = parseCertificateFilterQuery(req.query);
  if (!filters.success) {
    res.status(400).json({ error: "Choose valid certificate filters." });
    return;
  }
  try {
    const { expirationState, reviewState, officeAccountId } = filters.data;
    const [certificates, assetCandidates, accounts] = await Promise.all([
      listCertificateRecords({ officeAccountId, expirationState, reviewState }),
      listAssetCandidates(),
      db.select({ id: officeAccounts.id, displayName: officeAccounts.displayName }).from(officeAccounts).orderBy(officeAccounts.displayName),
    ]);
    res.json({ certificates, assetCandidates, officeAccounts: accounts, filters: { expirationState, reviewState, officeAccountId: officeAccountId ?? null } });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load admin COIs");
    res.status(500).json({ error: "Could not load certificates of insurance." });
  }
});

router.post("/admin/coi", requireOwnerMiddleware, async (req, res): Promise<void> => {
  const input = createSchema.safeParse(req.body);
  if (!input.success || !input.data.officeAccountId) { res.status(400).json({ error: input.success ? "Choose an Office workspace." : input.error.issues[0]?.message }); return; }
  try {
    const result = await createCertificate(input.data, input.data.officeAccountId);
    if ("error" in result) { res.status(400).json(result); return; }
    res.status(201).json(result);
  } catch (error) {
    req.log.error({ err: error }, "Failed to create admin COI");
    res.status(500).json({ error: "Could not save the certificate of insurance." });
  }
});

router.patch("/admin/coi/:certificateId", requireOwnerMiddleware, async (req, res): Promise<void> => {
  const certificateId = param(req.params.certificateId);
  const input = patchSchema.safeParse(req.body);
  if (!idSchema.safeParse(certificateId).success || !input.success) { res.status(400).json({ error: "Review the certificate changes." }); return; }
  try {
    const [current] = await db.select().from(designCertificates).where(eq(designCertificates.id, certificateId)).limit(1);
    if (!current) { res.status(404).json({ error: "Certificate of insurance not found." }); return; }
    const next = { ...current, ...input.data };
    const dateError = validateDates(next.issueDate, next.expirationDate);
    if (dateError) { res.status(400).json({ error: dateError }); return; }
    const relationError = await validateRelations({ officeAccountId: current.officeAccountId, bookingId: next.bookingId, organizationId: next.organizationId, assetId: next.assetId });
    if (relationError) { res.status(400).json({ error: relationError }); return; }
    await db.update(designCertificates).set({ ...input.data, updatedAt: new Date() }).where(eq(designCertificates.id, certificateId));
    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Failed to update admin COI");
    res.status(500).json({ error: "Could not save the certificate changes." });
  }
});

export default router;