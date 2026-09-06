import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookings, contacts, travelLegs, trips } from "@/db/schema";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";

const router: IRouter = Router(), requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));
const routeId = (x: string | string[] | undefined) => Array.isArray(x) ? x[0] ?? "" : x ?? "";
const legPatch = z.object({ name: z.string().trim().min(1).max(160).optional(), color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(), baseAddress: z.string().trim().max(500).nullable().optional(), defaultVehicleName: z.string().trim().max(160).nullable().optional(), defaultMpg: z.number().positive().nullable().optional(), archivedAt: z.coerce.date().nullable().optional() }).strict().refine(value => Object.keys(value).length > 0, "No leg changes provided.");
router.get("/boss/legs", requireBoss, async (_req, res) => {
  const [legs, assignedBookings, assignedTrips] = await Promise.all([db.select().from(travelLegs).orderBy(travelLegs.sortOrder), db.select({ id: bookings.id, name: bookings.name, travelLegId: bookings.travelLegId, startsAt: bookings.startsAt, status: bookings.status }).from(bookings), db.select({ id: trips.id, name: trips.name, travelLegId: trips.travelLegId }).from(trips)]);
  res.json({ legs: legs.map(leg => ({ ...leg, bookings: assignedBookings.filter(item => item.travelLegId === leg.id), trips: assignedTrips.filter(item => item.travelLegId === leg.id) })) });
});
router.patch("/boss/legs/:legId", requireBoss, async (req, res): Promise<void> => {
  const legId = routeId(req.params.legId), value = legPatch.safeParse(req.body); if (!z.string().uuid().safeParse(legId).success || !value.success) { res.status(400).json({ error: value.success ? "Invalid leg ID." : value.error.issues[0]?.message ?? "Review leg changes." }); return; }
  // sortOrder is intentionally not writable here: unique ordered legs must be reordered atomically.
  const [leg] = await db.update(travelLegs).set({ ...value.data, updatedAt: new Date() }).where(eq(travelLegs.id, legId)).returning(); if (!leg) { res.status(404).json({ error: "Leg not found." }); return; } res.json({ leg });
});
router.get("/boss/contacts", requireBoss, async (_req, res) => res.json({ contacts: await db.select().from(contacts).limit(500) }));
router.get("/boss/contacts/:contactId", requireBoss, async (req, res) => { const id = routeId(req.params.contactId); const value = z.string().uuid().safeParse(id); if (!value.success) { res.status(400).json({ error: "Invalid contact ID." }); return; } const contact = (await db.select().from(contacts).where(eq(contacts.id, id)).limit(1))[0]; if (!contact) { res.status(404).json({ error: "Not found" }); return; } res.json({ contact }); });
export default router;