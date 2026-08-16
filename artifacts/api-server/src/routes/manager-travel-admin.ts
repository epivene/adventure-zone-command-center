import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleManagerMapBookingRepository } from "@/features/leg-manager/manager-map-booking-repository";
import { loadManagerScopedMapData } from "@/features/leg-manager/manager-map-data";
import { DrizzleManagerRouteSuggestionRepository } from "@/features/leg-manager/route-suggestion-repository";
import { ManagerRouteSuggestionService } from "@/features/leg-manager/route-suggestion-service";
import { DrizzleRouteSuggestionDomain } from "@/features/leg-manager/route-suggestion-domain";
import { HandoffRepository } from "@/features/routes/handoff-repository";
import { DrizzleTripRepository } from "@/features/trips/trip-repository";

const router: IRouter = Router();
const repository = new DrizzleManagerRouteSuggestionRepository(db);
const domain = new DrizzleRouteSuggestionDomain(db);
const service = new ManagerRouteSuggestionService(repository, domain, domain);
const rejectSchema = z.object({ adminResponse: z.string().trim().max(2000).nullable().optional() });
const legIdSchema = z.string().uuid();

function param(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }

router.get("/manager-travel-admin/preview/:legId", async (req, res): Promise<void> => {
  const parsed = legIdSchema.safeParse(param(req.params.legId));
  if (!parsed.success) { res.status(400).json({ error: "Valid leg id is required" }); return; }
  const payload = await loadManagerScopedMapData(
    {
      tripRepository: new DrizzleTripRepository(db),
      bookingRepository: new DrizzleManagerMapBookingRepository(db),
      handoffRepository: new HandoffRepository(db),
    },
    parsed.data,
  );
  res.json(payload);
});

router.get("/manager-travel-admin/suggestions", async (_req, res) => {
  res.json({ suggestions: await service.listPendingForAdmin() });
});

router.post("/manager-travel-admin/suggestions/:id/approve", async (req, res): Promise<void> => {
  const id = param(req.params.id);
  if (!id) { res.status(400).json({ error: "Suggestion id is required" }); return; }
  const result = await service.approveAdminSuggestion({ suggestionId: id, reviewedBy: (req as any).userId ?? null });
  if (!result.ok) {
    if (result.code === "STALE") { res.status(409).json({ error: "STALE" }); return; }
    res.status(result.code === "NOT_PENDING" ? 409 : 400).json({ error: "error" in result ? result.error : result.code });
    return;
  }
  res.json({ suggestion: result.suggestion });
});

router.post("/manager-travel-admin/suggestions/:id/reject", async (req, res): Promise<void> => {
  const id = param(req.params.id);
  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (!id || !parsed.success) { res.status(400).json({ error: "Invalid rejection" }); return; }
  const result = await service.rejectAdminSuggestion({
    suggestionId: id,
    reviewedBy: (req as any).userId ?? null,
    adminResponse: parsed.data.adminResponse ?? null,
  });
  if (!result.ok) { res.status(409).json({ error: result.code }); return; }
  res.json({ suggestion: result.suggestion });
});

export default router;