import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import { bookings, contacts, travelLegs, trips } from "@/db/schema";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import { LegAssignmentRepository } from "@/features/leg-assignment/leg-assignment-repository";
import { LegAssignmentService } from "@/features/leg-assignment/leg-assignment-service";
import { RouteDriveTimeEstimator } from "@/features/leg-assignment/drive-time-estimator";
import { isBookedForSchedule } from "@/features/calendar/schedule-booking-state";
import { DrizzleScheduleDisplaySettingsRepository } from "@/features/calendar/schedule-display-settings";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { filterMapEvents } from "@/features/routes/map-data";
import { resolveRouteMapEvents } from "@/features/routes/location-resolver";
import { NominatimGeocodingProvider } from "@/features/trips/geocoding";

const router: IRouter = Router(), requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));
const routeGeocoder = new NominatimGeocodingProvider();
const routeId = (x: string | string[] | undefined) => Array.isArray(x) ? x[0] ?? "" : x ?? "";
const legPatch = z.object({ name: z.string().trim().min(1).max(160).optional(), color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional(), baseAddress: z.string().trim().max(500).nullable().optional(), defaultVehicleName: z.string().trim().max(160).nullable().optional(), defaultMpg: z.number().positive().nullable().optional(), archivedAt: z.coerce.date().nullable().optional() }).strict().refine(value => Object.keys(value).length > 0, "No leg changes provided.");
const legReassignment = z.object({ travelLegId: z.string().uuid() }).strict();
router.get("/boss/legs", requireBoss, async (_req, res) => {
  const legRepo = new DrizzleTravelLegRepository(db);
  const [legs, mapEvents, assignedTrips, displaySettings] = await Promise.all([
    db.select().from(travelLegs).orderBy(travelLegs.sortOrder),
    legRepo.listMapEvents(),
    db.select({ id: trips.id, name: trips.name, travelLegId: trips.travelLegId }).from(trips),
    new DrizzleScheduleDisplaySettingsRepository(db).get(),
  ]);
  const resolvedEvents = await resolveRouteMapEvents(
    filterMapEvents(mapEvents, {
      statuses: [],
      travelLegIds: [],
      dateFrom: null,
      dateTo: null,
      regions: [],
    }),
    routeGeocoder,
  );
  const routeMetadataById = new Map(mapEvents.map((event) => [event.id, event]));
  const planningBookings = resolvedEvents.map((event) => {
    const routeMetadata = routeMetadataById.get(event.id);
    return {
      id: event.id,
      name: event.name,
      city: event.city,
      region: event.region,
      latitude: event.latitude,
      longitude: event.longitude,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: event.status,
      probability: event.probability,
      travelLegId: event.travelLegId,
      travelLegName: event.travelLegName,
      travelLegColor: event.travelLegColor,
      travelLegAssignmentKind: routeMetadata?.travelLegAssignmentKind ?? null,
      legAssignmentWarning: routeMetadata?.legAssignmentWarning ?? null,
      legAssignmentExplanation: routeMetadata?.legAssignmentExplanation ?? null,
      routeBucket: event.routeBucket,
      locationQuality: event.locationQuality,
      locationLabel: [event.city, event.region].filter(Boolean).join(", ") || null,
      mappingState: event.mappingState,
      seasonYear: event.seasonYear,
    };
  });
  res.json({
    bookings: planningBookings,
    displaySettings,
    legs: legs.map((leg) => ({
      ...leg,
      bookings: planningBookings.filter((item) => item.travelLegId === leg.id && isBookedForSchedule(item)),
      trips: assignedTrips.filter((item) => item.travelLegId === leg.id),
    })),
  });
});
router.patch("/boss/legs/:legId", requireBoss, async (req, res): Promise<void> => {
  const legId = routeId(req.params.legId), value = legPatch.safeParse(req.body); if (!z.string().uuid().safeParse(legId).success || !value.success) { res.status(400).json({ error: value.success ? "Invalid leg ID." : value.error.issues[0]?.message ?? "Review leg changes." }); return; }
  // sortOrder is intentionally not writable here: unique ordered legs must be reordered atomically.
  const [leg] = await db.update(travelLegs).set({ ...value.data, updatedAt: new Date() }).where(eq(travelLegs.id, legId)).returning(); if (!leg) { res.status(404).json({ error: "Leg not found." }); return; } res.json({ leg });
});
router.put("/boss/bookings/:bookingId/leg", requireBoss, async (req, res): Promise<void> => {
  const bookingId = routeId(req.params.bookingId), value = legReassignment.safeParse(req.body);
  if (!z.string().uuid().safeParse(bookingId).success || !value.success) { res.status(400).json({ error: "Choose a valid booking and destination leg." }); return; }
  const [booking, targetLeg] = await Promise.all([
    db.select({ id: bookings.id, travelLegId: bookings.travelLegId, status: bookings.status, probability: bookings.probability }).from(bookings).where(eq(bookings.id, bookingId)).limit(1),
    db.select({ id: travelLegs.id }).from(travelLegs).where(and(eq(travelLegs.id, value.data.travelLegId), isNull(travelLegs.archivedAt))).limit(1),
  ]);
  if (!booking[0] || !booking[0].travelLegId) { res.status(409).json({ error: "Boss can only reassign events that Desie has already assigned." }); return; }
  if (!isBookedForSchedule(booking[0])) { res.status(409).json({ error: "Potential events are view-only." }); return; }
  if (!targetLeg[0]) { res.status(404).json({ error: "Destination leg not found or archived." }); return; }
  await new LegAssignmentService(new LegAssignmentRepository(db), new RouteDriveTimeEstimator(db)).recordManualAssignment(bookingId, value.data.travelLegId);
  res.json({ ok: true });
});
router.get("/boss/contacts", requireBoss, async (_req, res) => res.json({ contacts: await db.select().from(contacts).limit(500) }));
router.get("/boss/contacts/:contactId", requireBoss, async (req, res) => { const id = routeId(req.params.contactId); const value = z.string().uuid().safeParse(id); if (!value.success) { res.status(400).json({ error: "Invalid contact ID." }); return; } const contact = (await db.select().from(contacts).where(eq(contacts.id, id)).limit(1))[0]; if (!contact) { res.status(404).json({ error: "Not found" }); return; } res.json({ contact }); });
export default router;