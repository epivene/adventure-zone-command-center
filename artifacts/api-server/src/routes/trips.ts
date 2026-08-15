import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { db } from "@workspace/db";
import { travelLegs } from "@/db/schema";
import { DrizzleTripRepository } from "@/features/trips/trip-repository";
import { TripService } from "@/features/trips/trip-service";
import { HandoffRepository } from "@/features/routes/handoff-repository";
import {
  DrizzleRoutingCacheStore,
  OsrmRoutingProvider,
  RoutingEstimator,
} from "@/features/trips/routing";
import {
  GeocodingUnavailableError,
  NominatimGeocodingProvider,
} from "@/features/trips/geocoding";

const router: IRouter = Router();

function tripService(): TripService {
  return new TripService(
    new DrizzleTripRepository(db),
    new RoutingEstimator(
      new OsrmRoutingProvider(),
      new DrizzleRoutingCacheStore(db),
    ),
    new HandoffRepository(db),
  );
}

function tripRepository(): DrizzleTripRepository {
  return new DrizzleTripRepository(db);
}

const isoDate = z.coerce.date().refine((value) => Number.isFinite(value.getTime()), {
  message: "Invalid date",
});

const endpointSchema = z.object({
  label: z.string().trim().min(1, "A location label is required"),
  latitude: z.number().min(-90).max(90).nullable().default(null),
  longitude: z.number().min(-180).max(180).nullable().default(null),
});

const createTripSchema = z
  .object({
    travelLegId: z.string().uuid(),
    name: z.string().trim().min(1, "Trip name is required"),
    startDate: isoDate,
    endDate: isoDate,
    start: endpointSchema.optional(),
    end: endpointSchema.optional(),
    vehicleName: z.string().trim().min(1).nullable().optional(),
    mpg: z.number().positive().nullable().optional(),
    fuelPricePerGallon: z.number().min(0).nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "End date must be on or after the start date",
  });

const updateTripSchema = z.object({
  name: z.string().trim().min(1).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  startLabel: z.string().trim().min(1).optional(),
  startLatitude: z.number().min(-90).max(90).nullable().optional(),
  startLongitude: z.number().min(-180).max(180).nullable().optional(),
  endLabel: z.string().trim().min(1).optional(),
  endLatitude: z.number().min(-90).max(90).nullable().optional(),
  endLongitude: z.number().min(-180).max(180).nullable().optional(),
  vehicleName: z.string().trim().min(1).nullable().optional(),
  mpg: z.number().positive().nullable().optional(),
  fuelPricePerGallon: z.number().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.get("/trips", async (req, res): Promise<void> => {
  try {
    const travelLegId =
      typeof req.query.legId === "string" && req.query.legId ? req.query.legId : undefined;
    const trips = await tripRepository().listTrips({ travelLegId });
    res.json({ trips });
  } catch (err) {
    req.log.error({ err }, "Failed to list trips");
    res.status(500).json({ error: "Failed to list trips" });
  }
});

router.post("/trips", async (req, res): Promise<void> => {
  const parsed = createTripSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const [leg] = await db
      .select()
      .from(travelLegs)
      .where(eq(travelLegs.id, parsed.data.travelLegId))
      .limit(1);
    if (!leg) {
      res.status(404).json({ ok: false, error: "Travel leg not found" });
      return;
    }
    const trip = await tripService().createTrip({
      leg: {
        id: leg.id,
        name: leg.name,
        baseAddress: leg.baseAddress,
        defaultVehicleName: leg.defaultVehicleName,
        defaultMpg: leg.defaultMpg,
      },
      name: parsed.data.name,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      start: parsed.data.start,
      end: parsed.data.end,
      vehicleName: parsed.data.vehicleName,
      mpg: parsed.data.mpg,
      fuelPricePerGallon: parsed.data.fuelPricePerGallon,
      notes: parsed.data.notes,
    });
    res.status(201).json({ ok: true, trip });
  } catch (err) {
    req.log.error({ err }, "Failed to create trip");
    res.status(500).json({ ok: false, error: "Could not create trip" });
  }
});

const geocoder = new NominatimGeocodingProvider();

router.get("/trips/geocode", async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    res.status(400).json({ ok: false, error: "Query parameter 'q' is required." });
    return;
  }
  try {
    const results = await geocoder.geocode(q);
    res.json({ ok: true, results });
  } catch (err) {
    if (err instanceof GeocodingUnavailableError) {
      const status = err.code === "no_results" ? 404 : 502;
      res.status(status).json({ ok: false, error: err.message, code: err.code });
      return;
    }
    req.log.error({ err }, "Geocoding failed unexpectedly");
    res.status(500).json({ ok: false, error: "Geocoding unavailable." });
  }
});

router.get("/trips/:id", async (req, res): Promise<void> => {
  try {
    const detail = await tripService().getTripDetail(req.params.id);
    if (!detail) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    const resources = await tripRepository().listResources(req.params.id);
    res.json({ ...detail, resources });
  } catch (err) {
    req.log.error({ err }, "Failed to load trip");
    res.status(500).json({ error: "Failed to load trip" });
  }
});

router.patch("/trips/:id", async (req, res): Promise<void> => {
  const parsed = updateTripSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const trip = await tripService().updateTrip(req.params.id, parsed.data);
    if (!trip) {
      res.status(404).json({ ok: false, error: "Trip not found" });
      return;
    }
    res.json({ ok: true, trip });
  } catch (err) {
    req.log.error({ err }, "Failed to update trip");
    res.status(500).json({ ok: false, error: "Could not update trip" });
  }
});

router.delete("/trips/:id", async (req, res): Promise<void> => {
  try {
    const deleted = await tripRepository().deleteTrip(req.params.id);
    if (!deleted) {
      res.status(404).json({ ok: false, error: "Trip not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete trip");
    res.status(500).json({ ok: false, error: "Could not delete trip" });
  }
});

router.post("/trips/:id/stops", async (req, res): Promise<void> => {
  const parsed = z.object({ bookingId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "A booking is required" });
    return;
  }
  try {
    const added = await tripService().addStop(req.params.id, parsed.data.bookingId);
    if (!added) {
      res.status(409).json({ ok: false, error: "That booking is already a stop on this trip" });
      return;
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to add trip stop");
    res.status(500).json({ ok: false, error: "Could not add stop" });
  }
});

router.delete("/trips/:id/stops/:stopId", async (req, res): Promise<void> => {
  try {
    const removed = await tripService().removeStop(req.params.id, req.params.stopId);
    if (!removed) {
      res.status(404).json({ ok: false, error: "Stop not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to remove trip stop");
    res.status(500).json({ ok: false, error: "Could not remove stop" });
  }
});

router.post("/trips/:id/reorder", async (req, res): Promise<void> => {
  const parsed = z
    .object({ orderedStopIds: z.array(z.string().uuid()).min(1) })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "An ordered stop list is required" });
    return;
  }
  try {
    const applied = await tripService().reorderStops(
      req.params.id,
      parsed.data.orderedStopIds,
    );
    if (!applied) {
      res.status(409).json({ ok: false, error: "Stop list is out of date — reload and try again" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to reorder trip stops");
    res.status(500).json({ ok: false, error: "Could not reorder stops" });
  }
});

router.post("/trips/:id/suggest-order", async (req, res): Promise<void> => {
  const force = Boolean((req.body as { force?: boolean } | undefined)?.force);
  try {
    const result = await tripService().applySuggestedOrder(req.params.id, { force });
    if (!result.ok) {
      if (result.error === "TRIP_NOT_FOUND") {
        res.status(404).json({ ok: false, error: "Trip not found" });
      } else {
        res.status(409).json({
          ok: false,
          error:
            "This route is confirmed and will not be rearranged automatically. Confirm to replace it with the suggested order.",
          code: "ROUTE_CONFIRMED",
        });
      }
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to apply suggested order");
    res.status(500).json({ ok: false, error: "Could not apply suggested order" });
  }
});

router.post("/trips/:id/refresh", async (req, res): Promise<void> => {
  try {
    const trip = await tripRepository().getTrip(req.params.id);
    if (!trip) {
      res.status(404).json({ ok: false, error: "Trip not found" });
      return;
    }
    await tripService().refreshEstimates(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to refresh trip estimates");
    res.status(500).json({ ok: false, error: "Could not refresh estimates" });
  }
});

router.patch("/trips/:id/segments/:segmentId", async (req, res): Promise<void> => {
  const parsed = z
    .object({
      overrideMiles: z.number().min(0).nullable(),
      overrideMinutes: z.number().min(0).nullable(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Override miles and minutes must be zero or more" });
    return;
  }
  try {
    const segment = await tripService().overrideSegment(
      req.params.id,
      req.params.segmentId,
      parsed.data,
    );
    if (!segment) {
      res.status(404).json({ ok: false, error: "Segment not found" });
      return;
    }
    res.json({ ok: true, segment });
  } catch (err) {
    req.log.error({ err }, "Failed to override trip segment");
    res.status(500).json({ ok: false, error: "Could not save the override" });
  }
});

router.post("/trips/:id/resources", async (req, res): Promise<void> => {
  const parsed = z.object({ resourceId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "A resource is required" });
    return;
  }
  try {
    const trip = await tripRepository().getTrip(req.params.id);
    if (!trip) {
      res.status(404).json({ ok: false, error: "Trip not found" });
      return;
    }
    const added = await tripRepository().addResource(
      req.params.id,
      parsed.data.resourceId,
    );
    if (!added) {
      res.status(409).json({ ok: false, error: "That resource is already assigned to this trip" });
      return;
    }
    res.status(201).json({ ok: true, resource: added });
  } catch (err) {
    req.log.error({ err }, "Failed to assign trip resource");
    res.status(500).json({ ok: false, error: "Could not assign resource" });
  }
});

router.delete("/trips/:id/resources/:resourceId", async (req, res): Promise<void> => {
  try {
    const removed = await tripRepository().removeResource(
      req.params.id,
      req.params.resourceId,
    );
    if (!removed) {
      res.status(404).json({ ok: false, error: "Resource assignment not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to remove trip resource");
    res.status(500).json({ ok: false, error: "Could not remove resource" });
  }
});

export default router;