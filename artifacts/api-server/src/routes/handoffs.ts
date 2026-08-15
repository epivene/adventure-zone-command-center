import { Router, type IRouter } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { HandoffRepository } from "@/features/routes/handoff-repository";
import { HandoffService } from "@/features/routes/handoff-service";
import { DrizzleTripRepository } from "@/features/trips/trip-repository";
import { TripService } from "@/features/trips/trip-service";
import {
  DrizzleRoutingCacheStore,
  OsrmRoutingProvider,
  RoutingEstimator,
} from "@/features/trips/routing";

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

const yearSchema = z.coerce.number().int().min(2000).max(2200);
const adjustedSchema = z.object({
  meetupLabel: z.string().trim().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  windowStartsAt: z.coerce.date().optional(),
  windowEndsAt: z.coerce.date().optional(),
});

router.get("/handoffs", async (req, res): Promise<void> => {
  const parsed = yearSchema.safeParse(req.query.seasonYear ?? new Date().getFullYear());
  if (!parsed.success) {
    res.status(400).json({ error: "A valid season year is required" });
    return;
  }
  try {
    res.json({ handoffs: await new HandoffService(db).list(parsed.data) });
  } catch (err) {
    req.log.error({ err }, "Failed to list equipment handoffs");
    res.status(500).json({ error: "Failed to load equipment handoffs" });
  }
});

router.post("/handoffs/suggestions/recalculate", async (req, res): Promise<void> => {
  const parsed = yearSchema.safeParse(req.body?.seasonYear ?? new Date().getFullYear());
  if (!parsed.success) {
    res.status(400).json({ error: "A valid season year is required" });
    return;
  }
  try {
    const handoffs = await new HandoffService(db).recalculate(parsed.data);
    res.json({ handoffs });
  } catch (err) {
    req.log.error({ err }, "Failed to recalculate equipment handoffs");
    res.status(500).json({ error: "Could not calculate equipment handoff suggestions" });
  }
});

router.post("/handoffs/:id/preview", async (req, res): Promise<void> => {
  const parsed = adjustedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid meetup" });
    return;
  }
  try {
    const preview = await new HandoffService(db).preview(req.params.id, parsed.data);
    if (!preview) {
      res.status(404).json({ error: "Handoff suggestion could not be previewed" });
      return;
    }
    res.json({ preview });
  } catch (err) {
    req.log.error({ err }, "Failed to preview equipment handoff");
    res.status(500).json({ error: "Could not preview that meetup" });
  }
});

router.post("/handoffs/:id/approve", async (req, res): Promise<void> => {
  const adjusted = req.body && Object.keys(req.body).length
    ? adjustedSchema.safeParse(req.body)
    : null;
  if (adjusted && !adjusted.success) {
    res.status(400).json({ error: adjusted.error.issues[0]?.message ?? "Invalid meetup" });
    return;
  }
  try {
    const repository = new HandoffRepository(db);
    if (adjusted?.success) {
      const preview = await new HandoffService(db).preview(req.params.id, adjusted.data);
      if (!preview || preview.band === "infeasible") {
        res.status(409).json({ error: "That adjusted handoff is not feasible" });
        return;
      }
      const starts = adjusted.data.windowStartsAt;
      const ends = adjusted.data.windowEndsAt;
      await repository.ensureSchema();
      await db.execute(sql`
        update equipment_handoffs set
          meetup_label = ${adjusted.data.meetupLabel},
          meetup_latitude = ${adjusted.data.latitude},
          meetup_longitude = ${adjusted.data.longitude},
          window_starts_at = coalesce(${starts ?? null}, window_starts_at),
          window_ends_at = coalesce(${ends ?? null}, window_ends_at),
          combined_detour_miles = ${preview.addedDetourMiles},
          available_buffer_minutes = ${preview.availableBufferMinutes},
          opportunity_band = ${preview.band},
          explanation = ${`Adjusted meetup approved after route preview. ${preview.reasons.join(" ")}`},
          updated_at = now()
        where id = ${req.params.id}::uuid and status in ('suggested','needs_review')
      `);
    }

    const approved = await repository.approve(req.params.id);
    if (!approved) {
      res.status(409).json({ error: "This handoff is no longer available for approval" });
      return;
    }

    const trips = [approved.fromTripId, approved.toTripId].filter(
      (id): id is string => Boolean(id),
    );
    for (const tripId of trips) {
      await tripService().refreshEstimates(tripId);
    }
    res.json({ handoff: approved, message: "Handoff approved and routes updated" });
  } catch (err) {
    req.log.error({ err }, "Failed to approve equipment handoff");
    res.status(500).json({ error: "Could not approve equipment handoff" });
  }
});

router.post("/handoffs/:id/dismiss", async (req, res): Promise<void> => {
  try {
    const dismissed = await new HandoffRepository(db).dismiss(req.params.id);
    if (!dismissed) {
      res.status(409).json({ error: "Approved handoffs cannot be dismissed" });
      return;
    }
    res.json({ handoff: dismissed });
  } catch (err) {
    req.log.error({ err }, "Failed to dismiss equipment handoff");
    res.status(500).json({ error: "Could not dismiss equipment handoff" });
  }
});

export default router;
