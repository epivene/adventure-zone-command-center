import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import {
  businessSourceDocuments,
  businessSourceFactReviews,
} from "@/db/schema";
import { ensureBusinessSourceSeed } from "@/features/business-sources/business-source-seed";

const router: IRouter = Router();

export const businessSourceFactReviewInputSchema = z
  .object({
    reviewState: z.enum(["approved", "conflict", "rejected", "superseded"]),
    normalizedValue: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();

async function ensureSeed() {
  await ensureBusinessSourceSeed(db);
}

router.get("/business-sources", async (req, res): Promise<void> => {
  try {
    await ensureSeed();
    const rows = await db.select().from(businessSourceDocuments);
    res.json({
      sources: rows.map((row) => ({
        id: row.id,
        originalFilename: row.originalFilename,
        displayTitle: row.displayTitle,
        sourceCategory: row.sourceCategory,
        effectiveYear: row.effectiveYear,
        accessScope: row.accessScope,
        reviewState: row.reviewState,
        hasStorageReference: Boolean(row.storageReference),
        notes: row.notes,
        reviewedBy: row.reviewedBy,
        reviewedAt: row.reviewedAt,
        updatedAt: row.updatedAt,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list business sources");
    res.status(500).json({ error: "Could not load business sources" });
  }
});

router.get("/business-sources/conflicts", async (req, res): Promise<void> => {
  try {
    await ensureSeed();
    const rows = await db
      .select({
        fact: businessSourceFactReviews,
        sourceTitle: businessSourceDocuments.displayTitle,
      })
      .from(businessSourceFactReviews)
      .innerJoin(
        businessSourceDocuments,
        eq(businessSourceDocuments.id, businessSourceFactReviews.sourceDocumentId),
      )
      .where(eq(businessSourceFactReviews.reviewState, "conflict"));
    res.json({
      conflicts: rows.map(({ fact, sourceTitle }) => ({
        id: fact.id,
        sourceDocumentId: fact.sourceDocumentId,
        sourceTitle,
        factKey: fact.factKey,
        entityKind: fact.entityKind,
        entityKey: fact.entityKey,
        proposedValue: fact.proposedValue,
        normalizedValue: fact.normalizedValue,
        sourceLocator: fact.sourceLocator,
        conflictGroup: fact.conflictGroup,
        reviewState: fact.reviewState,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to list business source conflicts");
    res.status(500).json({ error: "Could not load source conflicts" });
  }
});

router.patch("/business-sources/facts/:factId", async (req, res): Promise<void> => {
  const parsed = businessSourceFactReviewInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review this source fact." });
    return;
  }
  const rawFactId = req.params.factId;
  const factId = Array.isArray(rawFactId) ? rawFactId[0] ?? "" : rawFactId ?? "";
  if (!z.uuid().safeParse(factId).success) {
    res.status(400).json({ error: "Invalid source fact id" });
    return;
  }
  try {
    const rows = await db
      .update(businessSourceFactReviews)
      .set({
        reviewState: parsed.data.reviewState,
        normalizedValue: parsed.data.normalizedValue ?? null,
        reviewer: String((req as any).userId ?? "owner"),
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(businessSourceFactReviews.id, factId))
      .returning();
    if (!rows[0]) {
      res.status(404).json({ error: "Source fact not found" });
      return;
    }
    res.json({ fact: rows[0] });
  } catch (err) {
    req.log.error({ err }, "Failed to review business source fact");
    res.status(500).json({ error: "Could not save source review" });
  }
});

export default router;
