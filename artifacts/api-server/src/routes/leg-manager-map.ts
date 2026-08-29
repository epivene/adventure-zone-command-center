import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleManagerMapBookingRepository } from "@/features/leg-manager/manager-map-booking-repository";
import { loadManagerScopedMapData } from "@/features/leg-manager/manager-map-data";
import { resolveManagerMapEventLocations } from "@/features/leg-manager/manager-map-location";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { HandoffRepository } from "@/features/routes/handoff-repository";
import { DrizzleTripRepository } from "@/features/trips/trip-repository";
import { NominatimGeocodingProvider } from "@/features/trips/geocoding";
import { managerScopedMapResponseSchema } from "@workspace/api-zod";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
const managerMapGeocoder = new NominatimGeocodingProvider();

router.get("/manager/map", requireManager, async (req, res) => {
  const payload = await loadManagerScopedMapData(
    {
      tripRepository: new DrizzleTripRepository(db),
      bookingRepository: new DrizzleManagerMapBookingRepository(db),
      handoffRepository: new HandoffRepository(db),
    },
    req.legManager!.legId,
  );
  const events = await resolveManagerMapEventLocations(payload.events, managerMapGeocoder);
  res.json(managerScopedMapResponseSchema.parse({ ...payload, events }));
});

export default router;
