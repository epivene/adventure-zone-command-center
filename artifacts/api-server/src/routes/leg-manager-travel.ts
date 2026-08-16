import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { DrizzleFinanceRepository } from "@/features/leg-manager/finance-repository";
import { DrizzleFuelPriceRepository } from "@/features/leg-manager/fuel-price-repository";
import { DrizzleManagerRouteSuggestionRepository } from "@/features/leg-manager/route-suggestion-repository";
import { ManagerRouteSuggestionService } from "@/features/leg-manager/route-suggestion-service";
import { DrizzleRouteSuggestionDomain } from "@/features/leg-manager/route-suggestion-domain";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
const finance = new DrizzleFinanceRepository(db);
const fuelPrices = new DrizzleFuelPriceRepository(db);
const suggestions = new DrizzleManagerRouteSuggestionRepository(db);
const suggestionDomain = new DrizzleRouteSuggestionDomain(db);
const suggestionService = new ManagerRouteSuggestionService(suggestions, suggestionDomain, suggestionDomain);

const fuelPriceSchema = z.object({
  tripId: z.string().uuid().nullable().optional(),
  pricePerGallon: z.number().positive("Fuel price must be greater than zero"),
  locationLabel: z.string().trim().min(1, "Fuel-price location is required").max(200),
  observedAt: z.coerce.date(),
  note: z.string().trim().max(1000).nullable().optional(),
});

const suggestionSchema = z.object({
  targetType: z.enum(["trip", "trip_stop", "booking", "handoff"]),
  targetId: z.string().uuid(),
  kind: z.enum(["reorder_stop", "change_event_time", "change_meetup_time_or_location", "remove_stop", "other_route_change"]),
  proposedJson: z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, "Proposed route change is required"),
  reason: z.string().trim().min(1, "Explain why this route change is needed").max(2000),
});

router.get("/manager/travel/fuel-prices", requireManager, async (req, res) => {
  const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : 20;
  res.json({ observations: await fuelPrices.listForLeg(req.legManager!.legId, limit) });
});

router.post("/manager/travel/fuel-prices", requireManager, async (req, res): Promise<void> => {
  const parsed = fuelPriceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid fuel price" });
    return;
  }

  const tripId = parsed.data.tripId ?? null;
  if (tripId && !(await finance.refsBelongToLeg(req.legManager!.legId, {
    tripId,
    bookingId: null,
    tripSegmentId: null,
  }))) {
    res.status(403).json({ error: "Trip is outside your leg" });
    return;
  }

  const observation = await fuelPrices.create({
    legId: req.legManager!.legId,
    tripId,
    pricePerGallon: parsed.data.pricePerGallon,
    locationLabel: parsed.data.locationLabel,
    observedAt: parsed.data.observedAt,
    note: parsed.data.note ?? null,
    createdByManagerId: null,
  });
  res.status(201).json({ observation });
});

router.get("/manager/travel/suggestions", requireManager, async (req, res) => {
  res.json({ suggestions: await suggestionService.listForManager(req.legManager!.legId) });
});

router.post("/manager/travel/suggestions", requireManager, async (req, res): Promise<void> => {
  const parsed = suggestionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid route suggestion" });
    return;
  }
  try {
    const suggestion = await suggestionService.submitManagerSuggestion({
      managerLegId: req.legManager!.legId,
      managerId: null,
      ...parsed.data,
    });
    res.status(201).json({ suggestion });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit route suggestion";
    res.status(/outside your leg/i.test(message) ? 403 : 400).json({ error: message });
  }
});

export default router;