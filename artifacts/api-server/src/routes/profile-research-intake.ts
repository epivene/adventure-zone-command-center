import { commitmentTransaction } from "@/features/outreach-planner/outreach-commitments";
import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@workspace/db";
import { bookings, organizations } from "@/db/schema";
import { parseBusinessDateInput } from "@/lib/business-date";
import { isSafeResearchUrl } from "@/features/profile-research/profile-research-matching";
import { ProfileResearchBulkIntakeService } from "@/features/profile-research/profile-research-bulk-intake";

const router: IRouter = Router();
const uuid = z.string().uuid();
const intakeSchema = z.object({
  sourceUrl: z.string().trim().min(1),
  startsAt: z.string().trim().optional().default(""),
  endsAt: z.string().trim().optional().default(""),
}).strict().superRefine((input, context) => {
  if (!isSafeResearchUrl(input.sourceUrl)) {
    context.addIssue({ code: "custom", message: "Use a public HTTP(S) source URL.", path: ["sourceUrl"] });
  }
  const start = input.startsAt ? parseBusinessDateInput(input.startsAt) : null;
  const end = input.endsAt ? parseBusinessDateInput(input.endsAt) : null;
  if (input.startsAt && !start) context.addIssue({ code: "custom", message: "Review the discovered start date.", path: ["startsAt"] });
  if (input.endsAt && !end) context.addIssue({ code: "custom", message: "Review the discovered end date.", path: ["endsAt"] });
  if (start && end && end.getTime() < start.getTime()) context.addIssue({ code: "custom", message: "End date cannot be before start date.", path: ["endsAt"] });
});

const bulkEventSchema = z.object({
  name: z.string().trim().min(1),
  city: z.string().trim().nullable(),
  region: z.string().trim().nullable(),
  startsAt: z.string().trim().nullable(),
  endsAt: z.string().trim().nullable(),
  venue: z.string().trim().nullable(),
  url: z.string().trim().min(1),
  rationale: z.string().trim().default("Found by Source Scout."),
}).strict();

const bulkIntakeSchema = z.object({
  events: z.array(bulkEventSchema).min(1).max(20),
  nextActionKind: z.enum(["call", "email", "prepare_quote"]),
  nextActionDueAt: z.string().trim().min(1),
}).strict();

router.post("/event-profiles/:id/research-intake-context", async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsedId = uuid.safeParse(profileId);
  const parsed = intakeSchema.safeParse(req.body ?? {});
  if (!parsedId.success || !parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error?.issues[0]?.message ?? "Review the Source Scout intake details." });
    return;
  }

  const startsAt = parsed.data.startsAt ? parseBusinessDateInput(parsed.data.startsAt) : null;
  const endsAt = parsed.data.endsAt ? parseBusinessDateInput(parsed.data.endsAt) : null;

  try {
    const result = await commitmentTransaction(db, async (transaction) => {
      const [profile] = await transaction
        .select({ id: organizations.id, website: organizations.website })
        .from(organizations)
        .where(eq(organizations.id, parsedId.data))
        .limit(1);
      if (!profile) return null;

      let websiteSaved = false;
      if (!profile.website) {
        await transaction
          .update(organizations)
          .set({ website: parsed.data.sourceUrl, updatedAt: new Date() })
          .where(and(eq(organizations.id, parsedId.data), isNull(organizations.website)));
        websiteSaved = true;
      }

      const [booking] = await transaction
        .select({ id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt })
        .from(bookings)
        .where(and(eq(bookings.organizationId, parsedId.data), eq(bookings.status, "new_lead")))
        .orderBy(desc(bookings.createdAt), desc(bookings.id))
        .limit(1);

      let datesSaved = false;
      if (booking && (startsAt || endsAt)) {
        await transaction
          .update(bookings)
          .set({
            startsAt: booking.startsAt ?? startsAt,
            endsAt: booking.endsAt ?? endsAt,
            updatedAt: new Date(),
          })
          .where(eq(bookings.id, booking.id));
        datesSaved = true;
      }

      return { profileId: parsedId.data, bookingId: booking?.id ?? null, websiteSaved, datesSaved };
    });

    if (!result) {
      res.status(404).json({ ok: false, error: "Profile not found." });
      return;
    }
    res.json({ ok: true, ...result });
  } catch (error) {
    req.log.error({ err: error, profileId: parsedId.data }, "Failed to save Source Scout intake context");
    res.status(500).json({ ok: false, error: "The lead was created, but its Source Scout context could not be saved." });
  }
});

router.post("/profile-research/bulk-intake", async (req, res): Promise<void> => {
  const parsed = bulkIntakeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Review the selected Source Scout prospects." });
    return;
  }

  try {
    const result = await new ProfileResearchBulkIntakeService().create(parsed.data);
    res.status(201).json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (["BULK_PROSPECT_EMPTY", "BULK_PROSPECT_LIMIT", "BULK_PROSPECT_ACTION_REQUIRED", "INVALID_BULK_FOLLOW_UP_DATE"].includes(message)) {
      res.status(400).json({ ok: false, error: "Review the selected prospects and first follow-up." });
      return;
    }
    req.log.error({ err: error }, "Failed to create Source Scout prospects in bulk");
    res.status(500).json({ ok: false, error: "Could not create the selected prospects." });
  }
});

export default router;
