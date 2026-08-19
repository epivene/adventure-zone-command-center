import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  enrichTodayDashboardOperations,
  getTodayDashboard,
  TODAY_UPCOMING_EVENT_LIMIT,
} from "@/features/follow-ups/today-query";
import { withBookingCopilotMetadata } from "@/features/follow-ups/today-copilot";
import { listTodayUpcomingEvents } from "@/features/follow-ups/today-upcoming-events";
import { createBookingOperationsSummaryProvider } from "@/features/bookings/booking-operations-summary";
import {
  clearTodayNextSteps,
  filterClearedTodayNextSteps,
  parseTodayNextStepBookingIds,
  reopenTodayNextSteps,
  snoozeTodayNextSteps,
} from "@/features/follow-ups/today-next-step";
import { listTripsInWindow } from "@/features/trips/trip-repository";
import { businessDayBounds } from "@/lib/business-date";

const router: IRouter = Router();

router.get("/today", async (req, res): Promise<void> => {
  try {
    const followUpsPage = Number(req.query.followUpsPage) || 1;
    const planPage = Number(req.query.planPage) || 1;
    const now = new Date();
    const { start, end } = businessDayBounds(now);
    const operationsProvider = createBookingOperationsSummaryProvider(db);
    const [baseDashboard, upcomingEvents, todayTrips] = await Promise.all([
      getTodayDashboard(
        now,
        null,
        { followUps: followUpsPage, needsFollowUpPlan: planPage },
        null,
      ),
      listTodayUpcomingEvents(db, start, TODAY_UPCOMING_EVENT_LIMIT),
      listTripsInWindow(db, start, end),
    ]);
    const dashboard = await enrichTodayDashboardOperations(
      { ...baseDashboard, upcomingEvents },
      operationsProvider,
    );
    const needsFollowUpPlan = await filterClearedTodayNextSteps(db, dashboard.needsFollowUpPlan);
    const copilotDashboard = withBookingCopilotMetadata(
      { ...dashboard, needsFollowUpPlan },
      now,
    );
    res.json({
      ...copilotDashboard,
      needsFollowUpPlanTotal: needsFollowUpPlan.length,
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

router.post("/today/next-step/clear", async (req, res): Promise<void> => {
  try {
    const bookingIds = parseTodayNextStepBookingIds(req.body?.bookingIds);
    if (!bookingIds.length) {
      res.status(400).json({ ok: false, error: "Select at least one booking." });
      return;
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "no_follow_up_needed";
    await clearTodayNextSteps(db, bookingIds, reason);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to clear Today next-step items");
    res.status(500).json({ ok: false, error: "Could not clear the selected items." });
  }
});

router.post("/today/next-step/reopen", async (req, res): Promise<void> => {
  try {
    const bookingIds = parseTodayNextStepBookingIds(req.body?.bookingIds);
    if (!bookingIds.length) {
      res.status(400).json({ ok: false, error: "Select at least one booking." });
      return;
    }
    await reopenTodayNextSteps(db, bookingIds);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to reopen Today next-step items");
    res.status(500).json({ ok: false, error: "Could not restore the selected items." });
  }
});

router.post("/today/next-step/snooze", async (req, res): Promise<void> => {
  try {
    const bookingIds = parseTodayNextStepBookingIds(req.body?.bookingIds);
    const dueAt = new Date(typeof req.body?.dueAt === "string" ? req.body.dueAt : Number.NaN);
    if (!bookingIds.length || !Number.isFinite(dueAt.getTime())) {
      res.status(400).json({ ok: false, error: "Select bookings and a valid snooze date." });
      return;
    }
    await snoozeTodayNextSteps(db, bookingIds, dueAt);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to snooze Today next-step items");
    res.status(500).json({ ok: false, error: "Could not snooze the selected items." });
  }
});

export default router;
