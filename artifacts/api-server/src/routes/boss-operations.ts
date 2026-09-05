import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookings, contacts, travelLegs, trips } from "@/db/schema";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import { BookingService } from "@/features/bookings/booking-service";
import { bookingStatusValues, probabilityValues } from "@/features/bookings/booking-types";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";

const router: IRouter = Router(), requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));
const routeId = (x: string | string[] | undefined) => Array.isArray(x) ? x[0] ?? "" : x ?? "";
const repo = () => new DrizzleBookingRepository(db);
const bossBookingCreateSchema = z.object({
  name: z.string().trim().min(1).max(240),
  city: z.string().trim().min(1).max(160),
  region: z.string().trim().min(2).max(80),
  eventDate: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(20000).nullable().optional(),
}).strict();
const bossBookingPatchSchema = z.object({
  name: z.string().trim().min(1).max(240).optional(),
  city: z.string().trim().min(1).max(160).optional(),
  region: z.string().trim().min(2).max(80).optional(),
  status: z.enum(bookingStatusValues).optional(),
  probability: z.enum(["likely", "possible", "unlikely"]).optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  notes: z.string().trim().max(20000).nullable().optional(),
}).strict().refine(value => Object.keys(value).length > 0, "No booking changes provided.");
router.get("/boss/bookings", requireBoss, async (_req, res) => res.json({ bookings: await repo().listBookings() }));
router.post("/boss/bookings", requireBoss, async (req, res): Promise<void> => {
  const value = bossBookingCreateSchema.safeParse(req.body); if (!value.success) { res.status(400).json({ error: value.error.issues[0]?.message ?? "Invalid booking." }); return; }
  const followUpDate = value.data.eventDate && value.data.eventDate > new Date()
    ? value.data.eventDate
    : new Date(Date.now() + 24 * 60 * 60 * 1000);
  const booking = await new BookingService(repo() as any).createBooking({
    name: value.data.name,
    city: value.data.city,
    region: value.data.region.toUpperCase(),
    status: "new_lead",
    probability: "possible",
    nextAction: { kind: "Follow up", dueAt: followUpDate },
  });
  if (value.data.eventDate || value.data.notes) {
    await db.update(bookings).set({
      startsAt: value.data.eventDate ?? null,
      endsAt: value.data.eventDate ?? null,
      notes: value.data.notes ?? null,
      updatedAt: new Date(),
    }).where(eq(bookings.id, booking.id));
  }
  res.status(201).json({ ok: true, bookingId: booking.id });
});
router.get("/boss/bookings/:bookingId", requireBoss, async (req, res) => { const booking = await repo().getBookingDetail(routeId(req.params.bookingId)); if (!booking) { res.status(404).json({ error: "Not found" }); return; } res.json(booking); });
router.patch("/boss/bookings/:bookingId", requireBoss, async (req, res): Promise<void> => {
  const value = bossBookingPatchSchema.safeParse(req.body), id = routeId(req.params.bookingId); if (!value.success) { res.status(400).json({ error: value.error.issues[0]?.message ?? "Invalid booking." }); return; }
  if (!z.string().uuid().safeParse(id).success) { res.status(400).json({ error: "Invalid booking ID." }); return; }
  const [current] = await db.select({ id: bookings.id, startsAt: bookings.startsAt, endsAt: bookings.endsAt }).from(bookings).where(eq(bookings.id, id)).limit(1);
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  const effectiveStart = value.data.startsAt === undefined ? current.startsAt : value.data.startsAt;
  const effectiveEnd = value.data.endsAt === undefined ? current.endsAt : value.data.endsAt;
  if (effectiveStart && effectiveEnd && effectiveEnd.getTime() < effectiveStart.getTime()) {
    res.status(400).json({ error: "End date cannot be before the start date." });
    return;
  }
  const [booking] = await db.update(bookings).set({ ...value.data, updatedAt: new Date() }).where(eq(bookings.id, id)).returning({ id: bookings.id });
  if (!booking) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});
router.get("/boss/schedule", requireBoss, async (_req, res) => res.json({ legs: await db.select().from(travelLegs), bookings: await repo().listBookings() }));
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
router.put("/boss/bookings/:bookingId/leg", requireBoss, async (req, res): Promise<void> => {
  const bookingId = routeId(req.params.bookingId), value = z.object({ legId: z.string().uuid().nullable() }).strict().safeParse(req.body); if (!z.string().uuid().safeParse(bookingId).success || !value.success) { res.status(400).json({ error: "Review the leg assignment." }); return; }
  if (value.data.legId && !(await db.select({ id: travelLegs.id }).from(travelLegs).where(eq(travelLegs.id, value.data.legId)).limit(1))[0]) { res.status(400).json({ error: "Travel leg not found." }); return; }
  const [booking] = await db.update(bookings).set({ travelLegId: value.data.legId, updatedAt: new Date() }).where(eq(bookings.id, bookingId)).returning({ id: bookings.id, travelLegId: bookings.travelLegId }); if (!booking) { res.status(404).json({ error: "Booking not found." }); return; } res.json({ booking });
});
router.get("/boss/contacts", requireBoss, async (_req, res) => res.json({ contacts: await db.select().from(contacts).limit(500) }));
router.get("/boss/contacts/:contactId", requireBoss, async (req, res) => { const id = routeId(req.params.contactId); const value = z.string().uuid().safeParse(id); if (!value.success) { res.status(400).json({ error: "Invalid contact ID." }); return; } const contact = (await db.select().from(contacts).where(eq(contacts.id, id)).limit(1))[0]; if (!contact) { res.status(404).json({ error: "Not found" }); return; } res.json({ contact }); });
export default router;