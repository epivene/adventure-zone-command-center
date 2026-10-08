import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { festivalEditions, organizations } from "@/db/schema";
import { SaveFestivalEditionBody } from "@workspace/api-zod";
import { requireOwnerMiddleware } from "@/lib/auth";

const router = Router();
router.use(requireOwnerMiddleware);
const uuid = z.string().uuid();
const yearSchema = z.coerce.number().int().min(1900).max(2200);
const calendarDate = z.iso.date();
const dateKeys = ["startsOn", "endsOn", "applicationDeadline", "foodDeadline", "performanceDeadline"];

router.get("/event-profiles/:id/editions", async (req, res) => {
  const id = String(req.params.id);
  if (!uuid.safeParse(id).success) { res.status(400).json({ error: "Choose a valid profile." }); return; }
  res.set("Cache-Control", "no-store");
  try {
    const [organization] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id)).limit(1);
    if (!organization) { res.status(404).json({ error: "Profile not found." }); return; }
    res.json({ editions: await db.select().from(festivalEditions).where(eq(festivalEditions.organizationId, id)).orderBy(desc(festivalEditions.year)) });
  } catch (error) {
    req.log.error({ error }, "Could not load festival years");
    res.status(503).json({ error: "Festival years could not be loaded. Try again." });
  }
});

router.put("/event-profiles/:id/editions/:year", async (req, res) => {
  const id = String(req.params.id);
  const year = yearSchema.safeParse(req.params.year);
  const input = SaveFestivalEditionBody.safeParse(req.body);
  if (!uuid.safeParse(id).success || !year.success || !input.success) {
    res.status(400).json({ error: "Enter a valid event year and optional details." }); return;
  }
  const { details, expectedUpdatedAt } = input.data;
  if (Object.keys(details).length > 60 || Object.entries(details).some(([key, value]) => key.length > 80 || value.length > 4000) ||
      dateKeys.some(key => details[key] && !calendarDate.safeParse(details[key]).success) ||
      (details.startsOn && details.endsOn && details.endsOn < details.startsOn)) {
    res.status(400).json({ error: "Review the dates and detail lengths. The end date must not precede the start date." }); return;
  }
  for (const [key, value] of Object.entries(details)) {
    if (!key.endsWith("Url") || !value) continue;
    try { const url = new URL(value); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); }
    catch { res.status(400).json({ error: "Application and gallery links must be valid http or https URLs." }); return; }
  }
  try {
    const result = await db.transaction(async tx => {
      // Serialize saves and additions for this organizer, including the first year.
      const [organization] = await tx.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, id)).for("update");
      if (!organization) return { status: 404, error: "Profile not found." } as const;
      const where = and(eq(festivalEditions.organizationId, id), eq(festivalEditions.year, year.data));
      const [current] = await tx.select().from(festivalEditions).where(where);
      if ((current?.updatedAt.toISOString() ?? null) !== expectedUpdatedAt) {
        return { status: 409, error: "This event year changed in another session. Reload its details before saving." } as const;
      }
      const values = { details, updatedAt: new Date(Math.max(Date.now(), (current?.updatedAt.getTime() ?? 0) + 1)) };
      const [saved] = current
        ? await tx.update(festivalEditions).set(values).where(where).returning()
        : await tx.insert(festivalEditions).values({ organizationId: id, year: year.data, ...values }).returning();
      return { status: 200, saved } as const;
    });
    if ("error" in result) res.status(result.status).json({ error: result.error });
    else res.json(result.saved);
  } catch (error) {
    req.log.error({ error }, "Could not save festival year");
    res.status(503).json({ error: "The festival year could not be saved. Your existing information has not been replaced." });
  }
});
export default router;
