import { Router } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { AssignLeadLegBody } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { bookings, travelLegs } from "@/db/schema";
import { requireOwnerMiddleware } from "@/lib/auth";
import { commitmentTransaction } from "@/features/outreach-planner/outreach-commitments";
import { OutreachError } from "@/features/outreach-planner/outreach-repository";
import { LegAssignmentRepository } from "@/features/leg-assignment/leg-assignment-repository";
import { LegAssignmentService } from "@/features/leg-assignment/leg-assignment-service";
import { RouteDriveTimeEstimator } from "@/features/leg-assignment/drive-time-estimator";

const router = Router();
const leadStatuses = new Set(["new_lead", "researching", "contact_due", "contacted", "interested", "possible", "unlikely", "quote_sent", "pending_decision"]);
router.post("/bookings/:id/lead-leg", requireOwnerMiddleware, async (req, res) => {
  const id = String(req.params.id);
  const input = AssignLeadLegBody.safeParse(req.body);
  if (!z.string().uuid().safeParse(id).success || !input.success) { res.status(400).json({ error: "Choose a valid lead and travel leg." }); return; }
  try {
    const result = await commitmentTransaction(db, async tx => {
      const [booking] = await tx.select({ id: bookings.id, status: bookings.status, travelLegId: bookings.travelLegId }).from(bookings).where(eq(bookings.id, id)).for("update");
      if (!booking) return { status: 404, error: "Lead not found." } as const;
      if (!leadStatuses.has(booking.status)) return { status: 409, error: "This is no longer an open lead. Review its assignment from the booking." } as const;
      if (booking.travelLegId !== input.data.expectedTravelLegId) return { status: 409, error: "This assignment changed in another session. Refresh before choosing a leg." } as const;
      const [leg] = await tx.select({ id: travelLegs.id }).from(travelLegs).where(and(eq(travelLegs.id, input.data.travelLegId), isNull(travelLegs.archivedAt)));
      if (!leg) return { status: 400, error: "Choose an active travel leg." } as const;
      const service = new LegAssignmentService(new LegAssignmentRepository(tx as unknown as typeof db), new RouteDriveTimeEstimator(db));
      return { status: 200, legAssignment: await service.recordManualAssignment(id, leg.id) } as const;
    });
    if ("error" in result) res.status(result.status).json({ error: result.error });
    else res.json({ legAssignment: result.legAssignment });
  } catch (error) {
    if (error instanceof OutreachError) { res.status(error.status).json({ error: error.message }); return; }
    req.log.error({ error }, "Could not assign lead leg");
    res.status(503).json({ error: "The assignment could not be saved. Refresh to check its current state." });
  }
});
export default router;
