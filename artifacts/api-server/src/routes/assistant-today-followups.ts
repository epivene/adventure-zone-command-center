import { and, asc, count, desc, eq, isNull, ne } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  activities,
  bookings,
  contacts,
  followUps,
  organizations,
} from "@/db/schema";
import { decideImportedFollowUpAction } from "@/features/approved-profile-import/imported-follow-up-policy";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();

const createSchema = z.object({
  organizationId: z.string().uuid(),
  label: z.string().trim().min(1).max(180),
  reason: z.string().trim().min(1).max(4000),
  dueAt: z.coerce.date(),
  preserveExisting: z.boolean().optional().default(false),
}).strict();

const clearSchema = z.object({
  organizationId: z.string().uuid(),
  reason: z.string().trim().min(1).max(4000),
}).strict();

router.use(requireAssistantImportToken);

router.get("/today-followups", async (req, res): Promise<void> => {
  const requestedLimit = typeof req.query.limit === "string"
    ? Number.parseInt(req.query.limit, 10)
    : 200;
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 500))
    : 200;

  try {
    const [rows, totalRows] = await Promise.all([
      db
        .select({
          id: followUps.id,
          organizationId: followUps.organizationId,
          organizationName: organizations.name,
          contactId: followUps.contactId,
          contactFirstName: contacts.firstName,
          contactLastName: contacts.lastName,
          bookingId: followUps.bookingId,
          bookingName: bookings.name,
          bookingStatus: bookings.status,
          bookingProbability: bookings.probability,
          bookingStartsAt: bookings.startsAt,
          bookingEndsAt: bookings.endsAt,
          label: followUps.kind,
          reason: followUps.outcome,
          dueAt: followUps.dueAt,
          createdAt: followUps.createdAt,
          updatedAt: followUps.updatedAt,
        })
        .from(followUps)
        .leftJoin(organizations, eq(organizations.id, followUps.organizationId))
        .leftJoin(contacts, eq(contacts.id, followUps.contactId))
        .leftJoin(bookings, eq(bookings.id, followUps.bookingId))
        .where(isNull(followUps.completedAt))
        .orderBy(asc(followUps.dueAt), asc(followUps.createdAt), asc(followUps.id))
        .limit(limit),
      db
        .select({ total: count() })
        .from(followUps)
        .where(isNull(followUps.completedAt)),
    ]);

    res.json({
      ok: true,
      openOnly: true,
      total: totalRows[0]?.total ?? 0,
      returned: rows.length,
      followUps: rows.map((row) => ({
        ...row,
        contactName: `${row.contactFirstName ?? ""} ${row.contactLastName ?? ""}`.trim() || null,
        contactFirstName: undefined,
        contactLastName: undefined,
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed assistant Today follow-up listing");
    res.status(500).json({ ok: false, error: "Today follow-ups could not be listed." });
  }
});

router.post("/today-followups", async (req, res): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Review the follow-up details." });
    return;
  }

  const { organizationId, label, reason, dueAt, preserveExisting } = parsed.data;
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
      const open = await transaction
        .select({
          id: followUps.id,
          label: followUps.kind,
          dueAt: followUps.dueAt,
        })
        .from(followUps)
        .where(and(
          eq(followUps.organizationId, organizationId),
          isNull(followUps.completedAt),
        ))
        .orderBy(
          desc(followUps.updatedAt),
          desc(followUps.createdAt),
          asc(followUps.id),
        );

      const exact = open.find((item) =>
        item.label === label && item.dueAt.getTime() === dueAt.getTime(),
      ) ?? null;
      const action = decideImportedFollowUpAction({
        preserveExisting,
        exactOpenId: exact?.id ?? null,
        openIds: open.map((item) => item.id),
      });

      if (action.action === "reuse_exact") {
        if (!preserveExisting) {
          await transaction
            .update(followUps)
            .set({
              completedAt: now,
              outcome: "Replaced by newer follow-up",
              updatedAt: now,
            })
            .where(and(
              eq(followUps.organizationId, organizationId),
              isNull(followUps.completedAt),
              ne(followUps.id, action.followUpId),
            ));
        }
        return {
          id: action.followUpId,
          created: false,
          preservedExisting: false,
        };
      }

      if (action.action === "preserve_open") {
        return {
          id: action.followUpId,
          created: false,
          preservedExisting: true,
        };
      }

      if (action.action === "replace_and_create") {
        await transaction
          .update(followUps)
          .set({
            completedAt: now,
            outcome: "Replaced by newer follow-up",
            updatedAt: now,
          })
          .where(and(
            eq(followUps.organizationId, organizationId),
            isNull(followUps.completedAt),
          ));
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

      return {
        id: created.id,
        created: true,
        preservedExisting: false,
      };
    });

    res.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      preservedExisting: result.preservedExisting,
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

router.post("/today-followups/clear", async (req, res): Promise<void> => {
  const parsed = clearSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Review the clear-follow-up request." });
    return;
  }

  const { organizationId, reason } = parsed.data;
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
    const open = await db
      .select({ id: followUps.id })
      .from(followUps)
      .where(and(eq(followUps.organizationId, organizationId), isNull(followUps.completedAt)));

    if (open.length > 0) {
      await db
        .update(followUps)
        .set({ completedAt: now, outcome: reason, updatedAt: now })
        .where(and(eq(followUps.organizationId, organizationId), isNull(followUps.completedAt)));
    }

    res.json({
      ok: true,
      organizationId,
      organizationName: organization.name,
      cleared: open.length,
      reason,
    });
  } catch (error) {
    req.log.error({ err: error, organizationId }, "Failed assistant Today follow-up clear");
    res.status(500).json({ ok: false, error: "Today follow-ups could not be cleared." });
  }
});

export default router;
