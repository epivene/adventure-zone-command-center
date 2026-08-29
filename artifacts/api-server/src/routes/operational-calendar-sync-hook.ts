import { Router, type IRouter } from "express";

import { db } from "@workspace/db";
import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";
import { OperationalCalendarLinkRepository } from "@/features/google-workspace/calendar/operational-calendar-link-repository";
import { OperationalCalendarProjectionRepository } from "@/features/google-workspace/calendar/operational-calendar-projection-repository";
import { OperationalCalendarSyncService } from "@/features/google-workspace/calendar/operational-calendar-sync-service";

const router: IRouter = Router();

function service() {
  return new OperationalCalendarSyncService(
    new PostgresGoogleConnectionRepository(),
    new OperationalCalendarProjectionRepository(db),
    new OperationalCalendarLinkRepository(db),
  );
}

function queueAfterSuccess(req: any, res: any, bookingId: () => string | null | undefined) {
  res.once("finish", () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const id = bookingId();
    if (!id) return;
    void service().syncConfirmedBooking(id).catch((error) => {
      req.log?.warn?.({ err: error, bookingId: id }, "Confirmed booking saved but operational calendar sync needs retry");
    });
  });
}

router.patch("/bookings/:bookingId", (req, res, next) => {
  queueAfterSuccess(req, res, () => req.params.bookingId);
  next();
});

router.post("/bookings", (req, res, next) => {
  queueAfterSuccess(req, res, () => res.locals.operationalCalendarBookingId ?? null);
  next();
});

router.post("/bookings/configure-packages", (req, res, next) => {
  queueAfterSuccess(req, res, () => typeof req.body?.bookingId === "string" ? req.body.bookingId : null);
  next();
});

export default router;
