import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { TravelLegService } from "@/features/routes/travel-leg-editor";
import { travelLegConfigurationSchema } from "@/features/routes/travel-leg-input";
import { filterMapEvents } from "@/features/routes/map-data";

const router: IRouter = Router();

router.get("/routes", async (req, res): Promise<void> => {
  try {
    const legRepo = new DrizzleTravelLegRepository(db);
    const [travelLegs, mapEvents] = await Promise.all([
      legRepo.listTravelLegs(),
      legRepo.listMapEvents(),
    ]);
    const events = filterMapEvents(mapEvents, {
      statuses: [],
      travelLegIds: [],
      dateFrom: null,
      dateTo: null,
      regions: [],
    });
    res.json({ travelLegs, events });
  } catch (err) {
    req.log.error({ err }, "Failed to load routes");
    res.status(500).json({ error: "Failed to load routes" });
  }
});

router.get("/routes/travel-legs", async (req, res): Promise<void> => {
  try {
    const legs = await new DrizzleTravelLegRepository(db).listTravelLegs();
    res.json(legs);
  } catch (err) {
    req.log.error({ err }, "Failed to load travel legs");
    res.status(500).json({ error: "Failed to load travel legs" });
  }
});

router.post("/routes/travel-legs", async (req, res): Promise<void> => {
  const parsed = travelLegConfigurationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const repo = new DrizzleTravelLegRepository(db);
    const result = await new TravelLegService(repo as any).updateConfiguration(parsed.data);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: "Could not update travel legs" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update travel legs");
    res.status(500).json({ ok: false, error: "Could not update travel legs" });
  }
});

export default router;
