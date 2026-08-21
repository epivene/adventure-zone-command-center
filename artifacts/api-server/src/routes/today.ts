import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  enrichTodayDashboardOperations,
  getTodayDashboard,
  TODAY_UPCOMING_EVENT_LIMIT,
} from "@/features/follow-ups/today-query";
import { applyTodaySeasonResetFromDb } from "@/features/follow-ups/today-season-reset";
import { withBookingCopilotMetadata } from "@/features/follow-ups/today-copilot";
import { listTodayUpcomingEvents } from "@/features/follow-ups/today-upcoming-events";
import { createBookingOperationsSummaryProvider } from "@/features/bookings/booking-operations-summary";
import { createContactPhoneRepository } from "@/features/contact-phones/contact-phone-repository";
import {
  clearTodayNextSteps,
  filterClearedTodayNextSteps,
  parseTodayNextStepBookingIds,
  reopenTodayNextSteps,
  snoozeTodayNextSteps,
} from "@/features/follow-ups/today-next-step";
import { listTripsInWindow } from "@/features/trips/trip-repository";
import { businessDayBounds } from "@/lib/business-date";
import { emptyOfficeCoordinatorAttention, loadOfficeCoordinatorAttention } from "@/features/office/office-owner-attention";

const router: IRouter = Router();

type TodayCallablePhone = {
  id: string;
  number: string;
  extension: string | null;
  type: string;
};

async function addCallablePhones<T extends { contactId: string | null; kind: string }>(items: T[]): Promise<Array<T & { callPhone: TodayCallablePhone | null }>> {
  const phoneRepository = createContactPhoneRepository(db);
  const contactIds = [...new Set(items.filter((item) => item.kind === "call" && item.contactId).map((item) => item.contactId as string))];
  const phoneByContact = new Map<string, TodayCallablePhone | null>();
  await Promise.all(contactIds.map(async (contactId) => {
    const phones = await phoneRepository.listForContact(contactId);
    const phone = phones.find((candidate) => candidate.primary && !candidate.doNotCallAt) ?? phones.find((candidate) => !candidate.doNotCallAt) ?? null;
    phoneByContact.set(contactId, phone ? { id: phone.id, number: phone.number, extension: phone.extension, type: phone.type } : null);
  }));
  return items.map((item) => ({ ...item, callPhone: item.kind === "call" && item.contactId ? phoneByContact.get(item.contactId) ?? null : null }));
}

router.get("/today", async (req, res): Promise<void> => {
  try {
    const followUpsPage = Number(req.query.followUpsPage) || 1;
    const planPage = Number(req.query.planPage) || 1;
    const now = new Date();
    const { start, end } = businessDayBounds(now);
    const operationsProvider = createBookingOperationsSummaryProvider(db);
    const [baseDashboard, upcomingEvents, todayTrips, officeCoordinatorAttention] = await Promise.all([
      getTodayDashboard(now, null, { followUps: followUpsPage, needsFollowUpPlan: planPage }, null),
      listTodayUpcomingEvents(db, start, TODAY_UPCOMING_EVENT_LIMIT),
      listTripsInWindow(db, start, end),
      loadOfficeCoordinatorAttention(db).catch((error) => {
        req.log.warn({ err: error }, "Office Coordinator attention could not be loaded for Today");
        return emptyOfficeCoordinatorAttention();
      }),
    ]);
    const enrichedDashboard = await enrichTodayDashboardOperations({ ...baseDashboard, upcomingEvents }, operationsProvider);
    const dashboard = await applyTodaySeasonResetFromDb(db, enrichedDashboard, now);
    const needsFollowUpPlan = await filterClearedTodayNextSteps(db, dashboard.needsFollowUpPlan);
    const copilotDashboard = withBookingCopilotMetadata({ ...dashboard, needsFollowUpPlan }, now);
    const followUps = await addCallablePhones(copilotDashboard.followUps);
    const nextCall = copilotDashboard.nextCall ? (await addCallablePhones([copilotDashboard.nextCall]))[0] ?? null : null;
    res.json({
      ...copilotDashboard,
      followUps,
      nextCall,
      needsFollowUpPlanTotal: needsFollowUpPlan.length,
      officeCoordinatorAttention,
      todayTrips: todayTrips.map((trip) => ({ id: trip.id, name: trip.name, legName: trip.legName, legColor: trip.legColor, startDate: trip.startDate, endDate: trip.endDate, stopCount: trip.stopCount, vehicleName: trip.vehicleName })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load today dashboard");
    res.status(500).json({ error: "Failed to load dashboard" });
  }
});

router.post("/today/next-step/clear", async (req, res): Promise<void> => {
  try {
    const bookingIds = parseTodayNextStepBookingIds(req.body?.bookingIds);
    if (!bookingIds.length) { res.status(400).json({ ok: false, error: "Select at least one booking." }); return; }
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
    if (!bookingIds.length) { res.status(400).json({ ok: false, error: "Select at least one booking." }); return; }
    await reopenTodayNextSteps(db, bookingIds);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to reopen Today next-step items");
    res.status(500).json({ ok: false, error: "Could not restore the cleared items." });
  }
});

router.post("/today/next-step/snooze", async (req, res): Promise<void> => {
  try {
    const bookingIds = parseTodayNextStepBookingIds(req.body?.bookingIds);
    const dueAt = new Date(typeof req.body?.dueAt === "string" ? req.body.dueAt : Number.NaN);
    if (!bookingIds.length || !Number.isFinite(dueAt.getTime())) { res.status(400).json({ ok: false, error: "Select bookings and a valid snooze date." }); return; }
    await snoozeTodayNextSteps(db, bookingIds, dueAt);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to snooze Today next-step items");
    res.status(500).json({ ok: false, error: "Could not snooze the selected items." });
  }
});

export default router;
