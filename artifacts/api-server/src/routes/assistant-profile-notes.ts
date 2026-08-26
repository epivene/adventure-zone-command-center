import { and, eq, inArray, isNull } from "drizzle-orm";
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

const territoryHoldRules = {
  NM: {
    subject: "Territory hold - New Mexico",
    body: "Territory hold — New Mexico is not currently being actively pursued under current booking strategy. Do not send new outreach until this restriction is lifted or the lead is specifically approved.",
  },
  OR: {
    subject: "Territory hold - Oregon",
    body: "Territory hold — Oregon is not currently being actively pursued under current booking strategy. Do not send new outreach until this restriction is lifted or the lead is specifically approved.",
  },
  CA: {
    subject: "Territory hold - California licensing",
    body: "Territory hold — California is not currently being actively pursued due to licensing requirements. Do not send new outreach until the licensing restriction is resolved or the lead is specifically approved.",
  },
  KS: {
    subject: "Territory hold - Kansas",
    body: "Territory hold — Kansas is not currently being actively pursued under current booking strategy. Do not send new outreach until this restriction is lifted or the lead is specifically approved.",
  },
  OK: {
    subject: "Territory hold - Oklahoma",
    body: "Territory hold — Oklahoma is not currently being actively pursued under current booking strategy. Do not send new outreach until this restriction is lifted or the lead is specifically approved.",
  },
  TX: {
    subject: "Territory hold - Texas",
    body: "Territory hold — Texas is not currently being actively pursued under current booking strategy. Do not send new outreach until this restriction is lifted or the lead is specifically approved.",
  },
} as const;

type TerritoryHoldRegion = keyof typeof territoryHoldRules;

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

router.post("/profile-notes/territory-holds", async (req, res): Promise<void> => {
  try {
    const regions = Object.keys(territoryHoldRules) as TerritoryHoldRegion[];
    const profiles = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        region: organizations.region,
      })
      .from(organizations)
      .where(and(
        inArray(organizations.region, regions),
        isNull(organizations.consolidatedIntoId),
      ));

    const now = new Date();
    const summary: Record<TerritoryHoldRegion, { profiles: number; created: number; existing: number }> = {
      NM: { profiles: 0, created: 0, existing: 0 },
      OR: { profiles: 0, created: 0, existing: 0 },
      CA: { profiles: 0, created: 0, existing: 0 },
      KS: { profiles: 0, created: 0, existing: 0 },
      OK: { profiles: 0, created: 0, existing: 0 },
      TX: { profiles: 0, created: 0, existing: 0 },
    };

    for (const profile of profiles) {
      const region = profile.region?.trim().toUpperCase() as TerritoryHoldRegion | undefined;
      if (!region || !(region in territoryHoldRules)) continue;
      const rule = territoryHoldRules[region];
      summary[region].profiles += 1;

      const [existing] = await db
        .select({ id: activities.id })
        .from(activities)
        .where(and(
          eq(activities.organizationId, profile.id),
          eq(activities.kind, "note"),
          eq(activities.subject, rule.subject),
          eq(activities.body, rule.body),
          isNull(activities.deletedAt),
        ))
        .limit(1);

      if (existing) {
        summary[region].existing += 1;
        continue;
      }

      await db.insert(activities).values({
        organizationId: profile.id,
        kind: "note",
        subject: rule.subject,
        body: rule.body,
        occurredAt: now,
        timelineSortAt: now,
        createdAt: now,
        updatedAt: now,
      });
      summary[region].created += 1;
    }

    res.json({
      ok: true,
      totalProfiles: profiles.length,
      totalCreated: Object.values(summary).reduce((sum, item) => sum + item.created, 0),
      totalExisting: Object.values(summary).reduce((sum, item) => sum + item.existing, 0),
      states: summary,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed bulk territory hold note creation");
    res.status(500).json({ ok: false, error: "Territory hold notes could not be applied." });
  }
});

export default router;
