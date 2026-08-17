import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { EventLifecycleRepository, eventLocationStatuses } from "@/features/leg-manager/event-lifecycle-repository";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
const lifecycle = new EventLifecycleRepository(db);
const locationInput = z.object({
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationStatus: z.enum(eventLocationStatuses).default("not_requested"),
});

function bookingId(req: any) {
  const raw = req.params.bookingId;
  return Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
}

router.get("/manager/events/lifecycle/incomplete", requireManager, async (req, res) => {
  res.json({ lifecycles: await lifecycle.listIncompleteForLeg(req.legManager!.legId) });
});

router.get("/manager/events/:bookingId/lifecycle", requireManager, async (req, res): Promise<void> => {
  const id = bookingId(req);
  const legId = req.legManager!.legId;
  if (!(await lifecycle.bookingBelongsToLeg(id, legId))) {
    res.status(403).json({ error: "Booking is outside your leg" });
    return;
  }
  res.json({ lifecycle: await lifecycle.get(id, legId) });
});

router.post("/manager/events/:bookingId/check-in", requireManager, async (req, res): Promise<void> => {
  const id = bookingId(req);
  const legId = req.legManager!.legId;
  const parsed = locationInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid check-in location" }); return; }
  if (!(await lifecycle.bookingBelongsToLeg(id, legId))) { res.status(403).json({ error: "Booking is outside your leg" }); return; }
  const row = await lifecycle.checkIn({ bookingId: id, legId, at: new Date(), latitude: parsed.data.latitude ?? null, longitude: parsed.data.longitude ?? null, locationStatus: parsed.data.locationStatus });
  res.json({ lifecycle: row });
});

router.post("/manager/events/:bookingId/check-out", requireManager, async (req, res): Promise<void> => {
  const id = bookingId(req);
  const legId = req.legManager!.legId;
  const parsed = locationInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid check-out location" }); return; }
  if (!(await lifecycle.bookingBelongsToLeg(id, legId))) { res.status(403).json({ error: "Booking is outside your leg" }); return; }
  const result = await lifecycle.checkOut({ bookingId: id, legId, at: new Date(), latitude: parsed.data.latitude ?? null, longitude: parsed.data.longitude ?? null, locationStatus: parsed.data.locationStatus });
  if (!result.ok) { res.status(409).json({ error: "Check in before checking out" }); return; }
  res.json({ lifecycle: result.lifecycle });
});

router.post("/manager/events/:bookingId/wrap-up/finish-later", requireManager, async (req, res): Promise<void> => {
  const id = bookingId(req); const legId = req.legManager!.legId;
  if (!(await lifecycle.bookingBelongsToLeg(id, legId))) { res.status(403).json({ error: "Booking is outside your leg" }); return; }
  const row = await lifecycle.markIncomplete(id, legId);
  if (!row) { res.status(409).json({ error: "Check out before starting wrap-up" }); return; }
  res.json({ lifecycle: row });
});

router.post("/manager/events/:bookingId/wrap-up/finish", requireManager, async (req, res): Promise<void> => {
  const id = bookingId(req); const legId = req.legManager!.legId;
  if (!(await lifecycle.bookingBelongsToLeg(id, legId))) { res.status(403).json({ error: "Booking is outside your leg" }); return; }
  const existing = await lifecycle.get(id, legId);
  if (!existing?.checkedOutAt) { res.status(409).json({ error: "Check out before finishing wrap-up" }); return; }
  res.json({ lifecycle: await lifecycle.finish(id, legId) });
});

export default router;
