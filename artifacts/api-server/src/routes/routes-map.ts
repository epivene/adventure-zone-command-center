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

// Configure (rename/recolor) existing legs — no add/delete
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

// Add a new leg (max 9)
router.post("/routes/travel-legs", async (req, res): Promise<void> => {
  try {
    const repo = new DrizzleTravelLegRepository(db);
    const result = await new TravelLegService(repo).addLeg();
    if (!result.ok) {
      res.status(409).json({ ok: false, error: "Cannot add leg: maximum of 9 legs already reached" });
      return;
    }
    res.status(201).json(result.value);
  } catch (err) {
    req.log.error({ err }, "Failed to add travel leg");
    res.status(500).json({ ok: false, error: "Could not add travel leg" });
  }
});

// Delete a leg by id (min 1 must remain)
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
