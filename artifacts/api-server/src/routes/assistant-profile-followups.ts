import { and, eq, isNull, sql } from "drizzle-orm";
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

const clearSchema = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().trim().min(1).max(4000),
}).strict();

router.use(requireAssistantImportToken);

function profileOwnedOpenFollowUps(organizationId: string) {
  return sql`
    f.completed_at is null
    and (
      f.organization_id = ${organizationId}::uuid
      or exists (
        select 1
          from bookings b
         where b.id = f.booking_id
           and b.organization_id = ${organizationId}::uuid
      )
      or exists (
        select 1
          from organization_contacts oc
         where oc.contact_id = f.contact_id
           and oc.organization_id = ${organizationId}::uuid
      )
    )
  `;
}

async function activeProfile(organizationId: string) {
  const [organization] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(and(
      eq(organizations.id, organizationId),
      isNull(organizations.consolidatedIntoId),
    ))
    .limit(1);
  return organization ?? null;
}

router.post("/today-followups", async (req, res): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Review the follow-up details.",
    });
    return;
  }

  const { organizationId, label, reason, dueAt } = parsed.data;
  if (!Number.isFinite(dueAt.getTime())) {
    res.status(400).json({ ok: false, error: "Choose a valid due date." });
    return;
  }

  const organization = await activeProfile(organizationId);
  if (!organization) {
    res.status(404).json({ ok: false, error: "Profile not found." });
    return;
  }

  try {
    const now = new Date();
    const result = await db.transaction(async (transaction) => {
      const existingResult = await transaction.execute<{ id: string }>(sql`
        select f.id::text
          from follow_ups f
         where ${profileOwnedOpenFollowUps(organizationId)}
           and f.kind = ${label}
           and f.due_at = ${dueAt}
         order by
           case when f.organization_id = ${organizationId}::uuid then 0 else 1 end,
           f.created_at,
           f.id
         limit 1
      `);
      const existingId = existingResult.rows[0]?.id ?? null;

      await transaction.execute(sql`
        update follow_ups f
           set completed_at = ${now},
               outcome = 'Replaced by newer profile follow-up',
               updated_at = ${now}
         where ${profileOwnedOpenFollowUps(organizationId)}
           and (${existingId}::uuid is null or f.id <> ${existingId}::uuid)
      `);

      if (existingId) {
        await transaction.update(followUps).set({
          organizationId,
          bookingId: null,
          contactId: null,
          kind: label,
          dueAt,
          outcome: reason,
          updatedAt: now,
        }).where(eq(followUps.id, existingId));
        return { id: existingId, created: false };
      }

      const [created] = await transaction.insert(followUps).values({
        organizationId,
        kind: label,
        dueAt,
        outcome: reason,
        createdAt: now,
        updatedAt: now,
      }).returning({ id: followUps.id });
      if (!created) throw new Error("PROFILE_FOLLOW_UP_CREATE_FAILED");

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
    req.log.error({ err: error, organizationId }, "Failed profile-owned Today follow-up creation");
    res.status(500).json({ ok: false, error: "Today follow-up could not be created." });
  }
});

router.post("/today-followups/clear", async (req, res): Promise<void> => {
  const parsed = clearSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Review the clear-follow-up request.",
    });
    return;
  }

  const { organizationId, reason } = parsed.data;
  const organization = await activeProfile(organizationId);
  if (!organization) {
    res.status(404).json({ ok: false, error: "Profile not found." });
    return;
  }

  try {
    const now = new Date();
    const result = await db.execute<{ id: string }>(sql`
      update follow_ups f
         set completed_at = ${now},
             outcome = ${reason},
             updated_at = ${now}
       where ${profileOwnedOpenFollowUps(organizationId)}
       returning f.id::text
    `);

    res.json({
      ok: true,
      organizationId,
      organizationName: organization.name,
      cleared: result.rows.length,
      reason,
    });
  } catch (error) {
    req.log.error({ err: error, organizationId }, "Failed profile-owned Today follow-up clear");
    res.status(500).json({ ok: false, error: "Today follow-ups could not be cleared." });
  }
});

export default router;
