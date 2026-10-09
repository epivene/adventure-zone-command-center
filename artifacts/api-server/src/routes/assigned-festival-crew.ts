import { Router, type IRouter, type RequestHandler } from "express";
import { GetManagerFestivalCrewLocationParams, GetManagerFestivalCrewLocationResponse } from "@workspace/api-zod";
import type { AssignedCrewService } from "@/features/festival-crew/assigned-crew-service";
import { CrewRequestError } from "@/features/festival-crew/crew-service";
import { OperationsAccessError } from "@/features/bookings/booking-leg-operations-repository";

export function createAssignedFestivalCrewRouter(dependencies: {
  service: AssignedCrewService;
  requireManager: RequestHandler;
  requireBoss: RequestHandler;
}): IRouter {
  const router = Router();
  for (const role of ["manager", "boss"] as const) {
    router.get(`/${role}/bookings/:id/crew-location`,
      role === "manager" ? dependencies.requireManager : dependencies.requireBoss,
      async (req, res): Promise<void> => {
        res.set("Cache-Control", "no-store");
        const parsed = GetManagerFestivalCrewLocationParams.safeParse(req.params);
        if (!parsed.success) { res.status(400).json({ error: "Choose a valid booking." }); return; }
        try {
          const result = await dependencies.service.get(parsed.data.id, role === "manager"
            ? { kind: "manager", legId: req.legManager!.legId }
            : { kind: "boss" });
          // Allowlisted projection: no organizer CRM fields or emails.
          res.json(GetManagerFestivalCrewLocationResponse.parse(result));
        } catch (error) {
          if (error instanceof OperationsAccessError || error instanceof CrewRequestError) {
            res.status(error.status).json({ error: error.message }); return;
          }
          req.log?.error({ error }, "Assigned festival crew travel request failed");
          res.status(503).json({ error: "Saved crew travel is unavailable. Try again." });
        }
      });
  }
  return router;
}
