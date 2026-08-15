import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { TravelLegService } from "@/features/routes/travel-leg-editor";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import {
  travelLegConfigurationSchema,
  travelLegDetailsSchema,
  travelLegOrderSchema,
} from "@/features/routes/travel-leg-input";
import { filterMapEvents } from "@/features/routes/map-data";
import {
  invalidateRouteLocationCache,
  resolveRouteMapEvents,
} from "@/features/routes/location-resolver";
import { NominatimGeocodingProvider } from "@/features/trips/geocoding";

const router: IRouter = Router();
const routeGeocoder = new NominatimGeocodingProvider();

router.get("/routes", async (req, res): Promise<void> => {
  try {
    const legRepo = new DrizzleTravelLegRepository(db);
    const [travelLegs, mapEvents, legResources] = await Promise.all([
      legRepo.listTravelLegs({ includeArchived: true }),
      legRepo.listMapEvents(),
      legRepo.listLegResources(),
    ]);
    const filteredEvents = filterMapEvents(mapEvents, {
      statuses: [],
      travelLegIds: [],
      dateFrom: null,
      dateTo: null,
      regions: [],
    });
    const events = await resolveRouteMapEvents(filteredEvents, routeGeocoder);
    res.json({ travelLegs, events, legResources });
  } catch (err) {
    req.log.error({ err }, "Failed to load routes");
    res.status(500).json({ error: "Failed to load routes" });
  }
});

router.post("/routes/events/:bookingId/retry-location", async (req, res): Promise<void> => {
  try {
    const repo = new DrizzleTravelLegRepository(db);
    const event = (await repo.listMapEvents()).find((row) => row.id === req.params.bookingId);
    if (!event) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    if (event.locationLabel) invalidateRouteLocationCache(event.locationLabel);
    const refreshed = (await resolveRouteMapEvents([event], routeGeocoder))[0];
    if (!refreshed) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    res.json({ event: refreshed });
  } catch (err) {
    req.log.error({ err }, "Failed to retry route location");
    res.status(500).json({ error: "Could not retry location" });
  }
});

router.get("/routes/travel-legs", async (req, res): Promise<void> => {
  try {
    const includeArchived = req.query.includeArchived === "1";
    const legs = await new DrizzleTravelLegRepository(db).listTravelLegs({ includeArchived });
    res.json(legs);
  } catch (err) {
    req.log.error({ err }, "Failed to load travel legs");
    res.status(500).json({ error: "Failed to load travel legs" });
  }
});

router.post("/routes/travel-legs/:id/configure", async (req, res): Promise<void> => {
  const parsed = travelLegDetailsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { id } = req.params;
  try {
    const repo = new DrizzleTravelLegRepository(db);
    const result = await new TravelLegService(repo).updateLegDetails(id, parsed.data);
    if (!result.ok) {
      if (result.error.code === "LEG_NOT_FOUND") {
        res.status(404).json({ ok: false, error: "Travel leg not found" });
      } else {
        res.status(409).json({ ok: false, error: "Restore this travel leg before editing it" });
      }
      return;
    }
    res.json({ ok: true, leg: result.value });
  } catch (err) {
    req.log.error({ err }, "Failed to update travel leg");
    res.status(500).json({ ok: false, error: "Could not update travel leg" });
  }
});

router.post("/routes/travel-legs/reorder", async (req, res): Promise<void> => {
  const parsed = travelLegOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const repo = new DrizzleTravelLegRepository(db);
    const result = await new TravelLegService(repo).reorderActiveLegs(parsed.data);
    if (!result.ok) {
      res.status(409).json({ ok: false, error: "Could not reorder travel legs: configuration conflict" });
      return;
    }
    res.json({ ok: true, legs: result.value });
  } catch (err) {
    req.log.error({ err }, "Failed to reorder travel legs");
    res.status(500).json({ ok: false, error: "Could not reorder travel legs" });
  }
});

router.post("/routes/travel-legs/configure", async (req, res): Promise<void> => {
  const parsed = travelLegConfigurationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const repo = new DrizzleTravelLegRepository(db);
    const result = await new TravelLegService(repo).updateConfiguration(parsed.data);
    if (!result.ok) {
      res.status(409).json({ ok: false, error: "Could not update travel legs: configuration conflict" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update travel legs");
    res.status(500).json({ ok: false, error: "Could not update travel legs" });
  }
});

router.post("/routes/travel-legs", async (req, res): Promise<void> => {
  try {
    const repo = new DrizzleTravelLegRepository(db);
    const result = await new TravelLegService(repo).addLeg();
    if (!result.ok) {
      res.status(500).json({ ok: false, error: "Could not add travel leg" });
      return;
    }
    res.status(201).json(result.value);
  } catch (err) {
    req.log.error({ err }, "Failed to add travel leg");
    res.status(500).json({ ok: false, error: "Could not add travel leg" });
  }
});

router.post("/routes/travel-legs/:id/archive", async (req, res): Promise<void> => {
  const { id } = req.params;
  try {
    const repo = new DrizzleTravelLegRepository(db);
    const result = await new TravelLegService(repo).archiveLeg(id);
    if (!result.ok) {
      if (result.error.code === "LEG_NOT_FOUND") {
        res.status(404).json({ ok: false, error: "Travel leg not found" });
      } else {
        res.status(409).json({ ok: false, error: "Cannot archive the last active travel leg" });
      }
      return;
    }
    await new DrizzleLegManagerRepository(db).incrementSessionVersion(id);
    res.json({ ok: true, leg: result.value });
  } catch (err) {
    req.log.error({ err }, "Failed to archive travel leg");
    res.status(500).json({ ok: false, error: "Could not archive travel leg" });
  }
});

router.post("/routes/travel-legs/:id/restore", async (req, res): Promise<void> => {
  const { id } = req.params;
  try {
    const repo = new DrizzleTravelLegRepository(db);
    const result = await new TravelLegService(repo).restoreLeg(id);
    if (!result.ok) {
      res.status(404).json({ ok: false, error: "Travel leg not found" });
      return;
    }
    res.json({ ok: true, leg: result.value });
  } catch (err) {
    req.log.error({ err }, "Failed to restore travel leg");
    res.status(500).json({ ok: false, error: "Could not restore travel leg" });
  }
});

router.delete("/routes/travel-legs/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  try {
    const repo = new DrizzleTravelLegRepository(db);
    const result = await new TravelLegService(repo).deleteLeg(id);
    if (!result.ok) {
      if (result.error.code === "LEG_NOT_FOUND") {
        res.status(404).json({ ok: false, error: "Travel leg not found" });
      } else {
        res.status(409).json({ ok: false, error: "Cannot delete the last travel leg" });
      }
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete travel leg");
    res.status(500).json({ ok: false, error: "Could not delete travel leg" });
  }
});

export default router;
