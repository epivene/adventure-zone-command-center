import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import {
  bookings,
  businessSourceDocumentLinks,
  businessSourceDocuments,
  businessSourceHistoricalTerms,
  organizationLocations,
  organizations,
  packageTemplates,
} from "@/db/schema";
import {
  historicalTermValueTypeValues,
  sourceDocumentLinkKindValues,
} from "@workspace/db/business-source-schema";

const router: IRouter = Router();
const uuid = z.string().uuid();
const linkInput = z.object({
  linkKind: z.enum(sourceDocumentLinkKindValues),
  organizationId: z.string().uuid().nullable().optional(),
  organizationLocationId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
  packageTemplateId: z.string().uuid().nullable().optional(),
  linkNote: z.string().trim().max(2000).nullable().optional(),
}).strict();
const termInput = z.object({
  documentLinkId: z.string().uuid().nullable().optional(),
  termKey: z.string().trim().min(1).max(160),
  label: z.string().trim().min(1).max(240),
  valueText: z.string().trim().min(1).max(8000),
  valueType: z.enum(historicalTermValueTypeValues),
  sourceLocator: z.string().trim().min(1).max(500),
}).strict();
const termPatch = z.object({
  documentLinkId: z.string().uuid().nullable().optional(),
  label: z.string().trim().min(1).max(240).optional(),
  valueText: z.string().trim().min(1).max(8000).optional(),
  valueType: z.enum(historicalTermValueTypeValues).optional(),
  sourceLocator: z.string().trim().min(1).max(500).optional(),
  reviewState: z.enum(["proposed", "approved", "rejected"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "No historical term changes provided." });

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function exactlyOneTarget(input: z.infer<typeof linkInput>) {
  return [
    input.organizationId,
    input.organizationLocationId,
    input.bookingId,
    input.packageTemplateId,
  ].filter(Boolean).length === 1;
}

function linkKindMatchesTarget(input: z.infer<typeof linkInput>) {
  return (
    (input.linkKind === "profile" && Boolean(input.organizationId)) ||
    (input.linkKind === "location" && Boolean(input.organizationLocationId)) ||
    (input.linkKind === "booking" && Boolean(input.bookingId)) ||
    (input.linkKind === "package_reference" && Boolean(input.packageTemplateId))
  );
}

async function documentExists(documentId: string) {
  return Boolean((await db.select({ id: businessSourceDocuments.id }).from(businessSourceDocuments).where(eq(businessSourceDocuments.id, documentId)).limit(1))[0]);
}

async function validateTarget(input: z.infer<typeof linkInput>) {
  if (input.organizationId) {
    const [organization] = await db
      .select({ id: organizations.id, consolidatedIntoId: organizations.consolidatedIntoId })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);
    if (!organization) return { ok: false as const, status: 404, error: "Profile not found." };
    if (organization.consolidatedIntoId) {
      return {
        ok: false as const,
        status: 409,
        error: "Choose the active canonical profile instead of this retired profile.",
        canonicalOrganizationId: organization.consolidatedIntoId,
      };
    }
  }
  if (input.organizationLocationId) {
    const [location] = await db
      .select({ id: organizationLocations.id, organizationId: organizationLocations.organizationId })
      .from(organizationLocations)
      .where(eq(organizationLocations.id, input.organizationLocationId))
      .limit(1);
    if (!location) return { ok: false as const, status: 404, error: "Profile location not found." };
  }
  if (input.bookingId) {
    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    if (!booking) return { ok: false as const, status: 404, error: "Booking not found." };
  }
  if (input.packageTemplateId) {
    const [template] = await db
      .select({ id: packageTemplates.id })
      .from(packageTemplates)
      .where(eq(packageTemplates.id, input.packageTemplateId))
      .limit(1);
    if (!template) return { ok: false as const, status: 404, error: "Package template not found." };
  }
  return { ok: true as const };
}

async function findExistingLink(documentId: string, input: z.infer<typeof linkInput>) {
  const links = await db
    .select()
    .from(businessSourceDocumentLinks)
    .where(eq(businessSourceDocumentLinks.sourceDocumentId, documentId));
  return links.find((link) =>
    (input.organizationId && link.organizationId === input.organizationId) ||
    (input.organizationLocationId && link.organizationLocationId === input.organizationLocationId) ||
    (input.bookingId && link.bookingId === input.bookingId) ||
    (input.packageTemplateId && link.packageTemplateId === input.packageTemplateId)
  ) ?? null;
}

async function linkBelongsToDocument(documentId: string, linkId: string) {
  return Boolean((await db.select({ id: businessSourceDocumentLinks.id }).from(businessSourceDocumentLinks).where(and(eq(businessSourceDocumentLinks.id, linkId), eq(businessSourceDocumentLinks.sourceDocumentId, documentId))).limit(1))[0]);
}

router.get("/business-sources/:documentId/links", async (req, res): Promise<void> => {
  const documentId = param(req.params.documentId);
  if (!uuid.safeParse(documentId).success) {
    res.status(400).json({ error: "Invalid source document ID." });
    return;
  }
  if (!(await documentExists(documentId))) {
    res.status(404).json({ error: "Business source document not found." });
    return;
  }
  const links = await db
    .select()
    .from(businessSourceDocumentLinks)
    .where(eq(businessSourceDocumentLinks.sourceDocumentId, documentId))
    .orderBy(asc(businessSourceDocumentLinks.createdAt));
  res.json({ links });
});

router.post("/business-sources/:documentId/links", async (req, res): Promise<void> => {
  const documentId = param(req.params.documentId);
  const parsed = linkInput.safeParse(req.body);
  if (!uuid.safeParse(documentId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid source document ID." : parsed.error.issues[0]?.message ?? "Review the document link." });
    return;
  }
  if (!exactlyOneTarget(parsed.data)) {
    res.status(400).json({ error: "Choose exactly one document link target." });
    return;
  }
  if (!linkKindMatchesTarget(parsed.data)) {
    res.status(400).json({ error: "The link kind does not match the selected target." });
    return;
  }
  if (!(await documentExists(documentId))) {
    res.status(404).json({ error: "Business source document not found." });
    return;
  }
  const target = await validateTarget(parsed.data);
  if (!target.ok) {
    res.status(target.status).json(target);
    return;
  }

  const [created] = await db
    .insert(businessSourceDocumentLinks)
    .values({
      sourceDocumentId: documentId,
      organizationId: parsed.data.organizationId ?? null,
      organizationLocationId: parsed.data.organizationLocationId ?? null,
      bookingId: parsed.data.bookingId ?? null,
      packageTemplateId: parsed.data.packageTemplateId ?? null,
      linkKind: parsed.data.linkKind,
      linkNote: parsed.data.linkNote ?? null,
      createdBy: String((req as any).userId ?? "owner"),
    })
    .onConflictDoNothing()
    .returning();
  const link = created ?? await findExistingLink(documentId, parsed.data);
  if (!link) {
    res.status(409).json({ error: "Could not create this source document link." });
    return;
  }
  res.status(created ? 201 : 200).json({ link });
});

router.delete("/business-sources/:documentId/links/:linkId", async (req, res): Promise<void> => {
  const documentId = param(req.params.documentId);
  const linkId = param(req.params.linkId);
  if (!uuid.safeParse(documentId).success || !uuid.safeParse(linkId).success) {
    res.status(400).json({ error: "Invalid source document link." });
    return;
  }
  const [deleted] = await db
    .delete(businessSourceDocumentLinks)
    .where(and(eq(businessSourceDocumentLinks.id, linkId), eq(businessSourceDocumentLinks.sourceDocumentId, documentId)))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Source document link not found." });
    return;
  }
  res.json({ link: deleted });
});

router.get("/business-sources/:documentId/historical-terms", async (req, res): Promise<void> => {
  const documentId = param(req.params.documentId);
  if (!uuid.safeParse(documentId).success) {
    res.status(400).json({ error: "Invalid source document ID." });
    return;
  }
  if (!(await documentExists(documentId))) {
    res.status(404).json({ error: "Business source document not found." });
    return;
  }
  const terms = await db
    .select()
    .from(businessSourceHistoricalTerms)
    .where(eq(businessSourceHistoricalTerms.sourceDocumentId, documentId))
    .orderBy(asc(businessSourceHistoricalTerms.createdAt));
  res.json({ terms });
});

router.post("/business-sources/:documentId/historical-terms", async (req, res): Promise<void> => {
  const documentId = param(req.params.documentId);
  const parsed = termInput.safeParse(req.body);
  if (!uuid.safeParse(documentId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid source document ID." : parsed.error.issues[0]?.message ?? "Review the historical term." });
    return;
  }
  if (!(await documentExists(documentId))) {
    res.status(404).json({ error: "Business source document not found." });
    return;
  }
  const documentLinkId = parsed.data.documentLinkId ?? null;
  if (documentLinkId && !(await linkBelongsToDocument(documentId, documentLinkId))) {
    res.status(400).json({ error: "The selected document link does not belong to this source document." });
    return;
  }
  const [created] = await db
    .insert(businessSourceHistoricalTerms)
    .values({
      sourceDocumentId: documentId,
      documentLinkId,
      termKey: parsed.data.termKey,
      label: parsed.data.label,
      valueText: parsed.data.valueText,
      valueType: parsed.data.valueType,
      sourceLocator: parsed.data.sourceLocator,
      reviewState: "proposed",
    })
    .onConflictDoNothing()
    .returning();
  if (!created) {
    const [existing] = await db
      .select()
      .from(businessSourceHistoricalTerms)
      .where(and(
        eq(businessSourceHistoricalTerms.sourceDocumentId, documentId),
        eq(businessSourceHistoricalTerms.termKey, parsed.data.termKey),
        eq(businessSourceHistoricalTerms.sourceLocator, parsed.data.sourceLocator),
      ))
      .limit(1);
    res.status(200).json({ term: existing ?? null });
    return;
  }
  res.status(201).json({ term: created });
});

router.patch("/business-sources/:documentId/historical-terms/:termId", async (req, res): Promise<void> => {
  const documentId = param(req.params.documentId);
  const termId = param(req.params.termId);
  const parsed = termPatch.safeParse(req.body);
  if (!uuid.safeParse(documentId).success || !uuid.safeParse(termId).success || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Invalid historical term ID." : parsed.error.issues[0]?.message ?? "Review the historical term changes." });
    return;
  }
  if (parsed.data.documentLinkId && !(await linkBelongsToDocument(documentId, parsed.data.documentLinkId))) {
    res.status(400).json({ error: "The selected document link does not belong to this source document." });
    return;
  }
  const actorId = String((req as any).userId ?? "owner");
  const reviewState = parsed.data.reviewState;
  const [updated] = await db
    .update(businessSourceHistoricalTerms)
    .set({
      ...(parsed.data.documentLinkId !== undefined ? { documentLinkId: parsed.data.documentLinkId } : {}),
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      ...(parsed.data.valueText !== undefined ? { valueText: parsed.data.valueText } : {}),
      ...(parsed.data.valueType !== undefined ? { valueType: parsed.data.valueType } : {}),
      ...(parsed.data.sourceLocator !== undefined ? { sourceLocator: parsed.data.sourceLocator } : {}),
      ...(reviewState !== undefined ? {
        reviewState,
        reviewedBy: reviewState === "proposed" ? null : actorId,
        reviewedAt: reviewState === "proposed" ? null : new Date(),
      } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(businessSourceHistoricalTerms.id, termId), eq(businessSourceHistoricalTerms.sourceDocumentId, documentId)))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Historical term not found." });
    return;
  }
  res.json({ term: updated });
});

export default router;
