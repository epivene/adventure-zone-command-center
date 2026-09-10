import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleManagerMapBookingRepository } from "@/features/leg-manager/manager-map-booking-repository";
import { loadManagerScopedMapData } from "@/features/leg-manager/manager-map-data";
import { resolveManagerMapEventLocations } from "@/features/leg-manager/manager-map-location";
import { EventLifecycleRepository } from "@/features/leg-manager/event-lifecycle-repository";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { HandoffRepository } from "@/features/routes/handoff-repository";
import { DrizzleTripRepository } from "@/features/trips/trip-repository";
import { DrizzleRoutingCacheStore, OsrmRoutingProvider, RoutingEstimator } from "@/features/trips/routing";
import { NominatimGeocodingProvider } from "@/features/trips/geocoding";
import { managerScopedMapResponseSchema } from "@workspace/api-zod";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
const managerMapGeocoder = new NominatimGeocodingProvider();
const managerRoutingEstimator = new RoutingEstimator(new OsrmRoutingProvider(), new DrizzleRoutingCacheStore(db));

router.get("/manager/map", requireManager, async (req, res) => {
  const payload = await loadManagerScopedMapData(
    {
      tripRepository: new DrizzleTripRepository(db),
      bookingRepository: new DrizzleManagerMapBookingRepository(db),
      routingEstimator: managerRoutingEstimator,
      eventLocationResolver: (events) => resolveManagerMapEventLocations(events, managerMapGeocoder),
      handoffRepository: new HandoffRepository(db),
      lifecycleRepository: new EventLifecycleRepository(db),
    },
    req.legManager!.legId,
  );
  res.json(managerScopedMapResponseSchema.parse(payload));
});

export default router;
