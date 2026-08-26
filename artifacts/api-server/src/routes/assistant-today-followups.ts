import { and, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { activities, followUps, organizations } from "@/db/schema";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();

const createSchema = z.object({
  organizationId: z.string().uuid(),
  label: z.string().trim().min(1).max(180),
  reason: z.string().trim().min(1).max(4000),
  dueAt: z.coerce.date(),
}).strict();

router.use(requireAssistantImportToken);

router.post("/today-followups", async (req, res): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Review the follow-up details." });
    return;
  }

  const { organizationId, label, reason, dueAt } = parsed.data;
  if (!Number.isFinite(dueAt.getTime())) {
    res.status(400).json({ ok: false, error: "Choose a valid due date." });
    return;
  }

  const [organization] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(and(eq(organizations.id, organizationId), isNull(organizations.consolidatedIntoId)))
    .limit(1);
  if (!organization) {
    res.status(404).json({ ok: false, error: "Profile not found." });
    return;
  }

  try {
    const now = new Date();
    const result = await db.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({ id: followUps.id })
        .from(followUps)
        .where(and(
          eq(followUps.organizationId, organizationId),
          eq(followUps.kind, label),
          eq(followUps.dueAt, dueAt),
          isNull(followUps.completedAt),
        ))
        .limit(1);

      if (existing) {
        return { id: existing.id, created: false };
      }

      const [created] = await transaction
        .insert(followUps)
        .values({
          organizationId,
          kind: label,
          dueAt,
          outcome: reason,
          createdAt: now,
          updatedAt: now,
        })
        .returning({ id: followUps.id });
      if (!created) throw new Error("Follow-up was not created.");

      await transaction.insert(activities).values({
        organizationId,
        kind: "note",
        subject: label,
        body: reason,
        occurredAt: now,
        timelineSortAt: now,
        createdAt: now,
        updatedAt: now,
      });

      return { id: created.id, created: true };
    });

    res.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      followUpId: result.id,
      organizationId,
      organizationName: organization.name,
      label,
      reason,
      dueAt: dueAt.toISOString(),
    });
  } catch (error) {
    req.log.error({ err: error, organizationId }, "Failed assistant Today follow-up creation");
    res.status(500).json({ ok: false, error: "Today follow-up could not be created." });
  }
});

export default router;
