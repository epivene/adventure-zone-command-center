import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleManagerMapBookingRepository } from "@/features/leg-manager/manager-map-booking-repository";
import { loadManagerScopedMapData } from "@/features/leg-manager/manager-map-data";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { HandoffRepository } from "@/features/routes/handoff-repository";
import { DrizzleTripRepository } from "@/features/trips/trip-repository";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));

router.get("/manager/map", requireManager, async (req, res) => {
  const payload = await loadManagerScopedMapData(
    {
      tripRepository: new DrizzleTripRepository(db),
      bookingRepository: new DrizzleManagerMapBookingRepository(db),
      handoffRepository: new HandoffRepository(db),
    },
    req.legManager!.legId,
  );
  res.json(payload);
});

export default router;
