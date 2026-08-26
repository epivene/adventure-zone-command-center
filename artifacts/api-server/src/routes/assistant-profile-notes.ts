import { and, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { activities, organizations } from "@/db/schema";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();

const schema = z.object({
  organizationId: z.string().uuid(),
  subject: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(4000),
}).strict();

router.use(requireAssistantImportToken);

router.post("/profile-notes", async (req, res): Promise<void> => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Review the note details." });
    return;
  }

  const { organizationId, subject, body } = parsed.data;
  const [organization] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(and(eq(organizations.id, organizationId), isNull(organizations.consolidatedIntoId)))
    .limit(1);

  if (!organization) {
    res.status(404).json({ ok: false, error: "Profile not found." });
    return;
  }

  const [existing] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(
      eq(activities.organizationId, organizationId),
      eq(activities.kind, "note"),
      eq(activities.subject, subject),
      eq(activities.body, body),
      isNull(activities.deletedAt),
    ))
    .limit(1);

  if (existing) {
    res.json({ ok: true, created: false, activityId: existing.id, organizationId, organizationName: organization.name });
    return;
  }

  const now = new Date();
  const [created] = await db
    .insert(activities)
    .values({
      organizationId,
      kind: "note",
      subject,
      body,
      occurredAt: now,
      timelineSortAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: activities.id });

  res.status(201).json({ ok: true, created: true, activityId: created!.id, organizationId, organizationName: organization.name });
});

export default router;
