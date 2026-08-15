import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import { TravelLegService } from "@/features/routes/travel-leg-editor";
import {
  travelLegConfigurationSchema,
  travelLegDetailsSchema,
  travelLegOrderSchema,
} from "@/features/routes/travel-leg-input";
import { filterMapEvents } from "@/features/routes/map-data";

const router: IRouter = Router();

router.get("/routes", async (req, res): Promise<void> => {
  try {
    const legRepo = new DrizzleTravelLegRepository(db);
    const [travelLegs, mapEvents, legResources] = await Promise.all([
      legRepo.listTravelLegs({ includeArchived: true }),
      legRepo.listMapEvents(),
      legRepo.listLegResources(),
    ]);
    const events = filterMapEvents(mapEvents, {
      statuses: [],
      travelLegIds: [],
      dateFrom: null,
      dateTo: null,
      regions: [],
    });
    res.json({ travelLegs, events, legResources });
  } catch (err) {
    req.log.error({ err }, "Failed to load routes");
    res.status(500).json({ error: "Failed to load routes" });
  }
});

// Active legs only by default (used by booking forms); ?includeArchived=1 for all
router.get("/routes/travel-legs", async (req, res): Promise<void> => {
  try {
    const includeArchived = req.query.includeArchived === "1";
    const legs = await new DrizzleTravelLegRepository(db).listTravelLegs({
      includeArchived,
    });
    res.json(legs);
  } catch (err) {
    req.log.error({ err }, "Failed to load travel legs");
    res.status(500).json({ error: "Failed to load travel legs" });
  }
});

// Configure one active leg's editable details without touching other legs or order.
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

// Save active-leg order only; detail fields are intentionally not accepted here.
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

// Legacy bulk configuration endpoint retained for compatibility.
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

// Archive a leg (kept on existing bookings; hidden from new-booking pickers)
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
    res.json({ ok: true, leg: result.value });
  } catch (err) {
    req.log.error({ err }, "Failed to archive travel leg");
    res.status(500).json({ ok: false, error: "Could not archive travel leg" });
  }
});

// Restore an archived leg
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
