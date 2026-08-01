import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { getTodayDashboard } from "@/features/follow-ups/today-query";
import { createBookingOperationsSummaryProvider } from "@/features/bookings/booking-operations-summary";
import { listTripsInWindow } from "@/features/trips/trip-repository";
import { businessDayBounds } from "@/lib/business-date";

const router: IRouter = Router();

router.get("/today", async (req, res): Promise<void> => {
  try {
    const followUpsPage = Number(req.query.followUpsPage) || 1;
    const planPage = Number(req.query.planPage) || 1;
    const now = new Date();
    const { start, end } = businessDayBounds(now);
    const [dashboard, todayTrips] = await Promise.all([
      getTodayDashboard(
        now,
        null,
        { followUps: followUpsPage, needsFollowUpPlan: planPage },
        createBookingOperationsSummaryProvider(db),
      ),
      listTripsInWindow(db, start, end),
    ]);
    res.json({
      ...dashboard,
      todayTrips: todayTrips.map((trip) => ({
        id: trip.id,
        name: trip.name,
        legName: trip.legName,
        legColor: trip.legColor,
        startDate: trip.startDate,
        endDate: trip.endDate,
        stopCount: trip.stopCount,
        vehicleName: trip.vehicleName,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load today dashboard");
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

export default router;
