import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { getTodayDashboard } from "@/features/follow-ups/today-query";
import { createBookingOperationsSummaryProvider } from "@/features/bookings/booking-operations-summary";

const router: IRouter = Router();

router.get("/today", async (req, res): Promise<void> => {
  try {
    const followUpsPage = Number(req.query.followUpsPage) || 1;
    const planPage = Number(req.query.planPage) || 1;
    const dashboard = await getTodayDashboard(
      new Date(),
      null,
      { followUps: followUpsPage, needsFollowUpPlan: planPage },
      createBookingOperationsSummaryProvider(db),
    );
    res.json(dashboard);
  } catch (err) {
    req.log.error({ err }, "Failed to load today dashboard");
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

export default router;
