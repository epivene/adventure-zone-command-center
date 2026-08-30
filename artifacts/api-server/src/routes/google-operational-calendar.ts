import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, pool } from "@workspace/db";
import {
  googleOperationalCalendarReviews,
} from "@/db/schema";
import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";
import { OperationalCalendarImportService } from "@/features/google-workspace/calendar/operational-calendar-import-service";
import { OperationalCalendarLinkRepository } from "@/features/google-workspace/calendar/operational-calendar-link-repository";
import { OperationalCalendarProjectionRepository } from "@/features/google-workspace/calendar/operational-calendar-projection-repository";
import { projectOperationalCalendarReview } from "@/features/google-workspace/calendar/operational-calendar-review-projection";
import { OperationalCalendarSyncService } from "@/features/google-workspace/calendar/operational-calendar-sync-service";
import { ensureBookingProbabilitySchema } from "@/features/bookings/booking-probability-schema";

const router: IRouter = Router();
const connectionRepository = new PostgresGoogleConnectionRepository();

function syncService() {
  return new OperationalCalendarSyncService(
    connectionRepository,
    new OperationalCalendarProjectionRepository(db),
    new OperationalCalendarLinkRepository(db),
  );
}

const importSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).strict();

const decisionSchema = z.object({
  decision: z.enum(["accepted", "rejected"]),
}).strict();
const resolutionSchema = z.discriminatedUnion("resolution", [
  z.object({
    resolution: z.literal("link_existing"),
    bookingId: z.string().uuid(),
  }).strict(),
  z.object({
    resolution: z.literal("create_new"),
  }).strict(),
]);

router.get("/google-workspace/operational-calendar", async (_req, res): Promise<void> => {
  try {
    const connection = await connectionRepository.getByRole("operational_calendar");
    const reviews = connection
      ? await new OperationalCalendarLinkRepository(db).listPendingReviews(connection.id)
      : [];
    const reviewEvents = reviews
      .flatMap((review) => {
        try {
          return [projectOperationalCalendarReview({
            id: review.id,
            calendarId: review.calendarId,
            googleEventId: review.googleEventId,
            reason: review.reason,
            bookingId: review.bookingId,
            proposedChanges: review.proposedChanges,
          })];
        } catch {
          return [];
        }
      });
    res.json({ connection, pendingReviewCount: reviews.length, reviews, reviewEvents });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "GOOGLE_OPERATIONAL_CALENDAR_STATUS_FAILED" });
  }
});

router.post("/google-workspace/operational-calendar/import", async (req, res): Promise<void> => {
  const parsed = importSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "GOOGLE_OPERATIONAL_CALENDAR_IMPORT_INPUT_INVALID" });
    return;
  }
  const now = new Date();
  const from = parsed.data.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const to = parsed.data.to ?? new Date(Date.UTC(now.getUTCFullYear() + 1, 11, 31, 23, 59, 59));
  try {
    await ensureBookingProbabilitySchema(pool);
    const service = new OperationalCalendarImportService(
      db,
      () => connectionRepository.createOperationalCalendarClient(),
    );
    res.json(await service.importWindow({ from, to }));
  } catch (error) {
    req.log.error({ err: error }, "Operational calendar import failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "GOOGLE_OPERATIONAL_CALENDAR_IMPORT_FAILED" });
  }
});

router.post("/google-workspace/operational-calendar/bookings/:bookingId/sync", async (req, res): Promise<void> => {
  try {
    const result = await syncService().syncConfirmedBooking(req.params.bookingId);
    res.json(result);
  } catch (error) {
    req.log.error({ err: error, bookingId: req.params.bookingId }, "Operational calendar sync failed");
    res.status(500).json({ error: error instanceof Error ? error.message : "GOOGLE_OPERATIONAL_CALENDAR_SYNC_FAILED" });
  }
});

router.post("/google-workspace/operational-calendar/reviews/:reviewId/decision", async (req, res): Promise<void> => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "GOOGLE_OPERATIONAL_CALENDAR_REVIEW_INPUT_INVALID" });
    return;
  }
  try {
    const [review] = await db
      .select()
      .from(googleOperationalCalendarReviews)
      .where(eq(googleOperationalCalendarReviews.id, req.params.reviewId))
      .limit(1);
    if (!review || review.state !== "pending") {
      res.status(404).json({ error: "GOOGLE_OPERATIONAL_CALENDAR_REVIEW_NOT_FOUND" });
      return;
    }
    await db.update(googleOperationalCalendarReviews).set({
      state: parsed.data.decision,
      reviewedBy: (req as any).userId ?? "owner",
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(googleOperationalCalendarReviews.id, review.id));

    // Rejecting a calendar change means "keep the app as source of truth".
    // The next explicit/automatic sync will retry the app projection. Accepting
    // records the owner's acknowledgement; imported unmatched/ambiguous rows stay
    // non-destructive until manually linked through their event profile.
    res.json({ ok: true, state: parsed.data.decision, bookingId: review.bookingId });
  } catch (error) {
    req.log.error({ err: error }, "Operational calendar review decision failed");
    res.status(500).json({ error: "GOOGLE_OPERATIONAL_CALENDAR_REVIEW_FAILED" });
  }
});

router.post("/google-workspace/operational-calendar/reviews/:reviewId/resolve", async (req, res): Promise<void> => {
  const parsed = resolutionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "GOOGLE_OPERATIONAL_CALENDAR_RESOLUTION_INPUT_INVALID" });
    return;
  }
  try {
    const result = await new OperationalCalendarLinkRepository(db).resolveReview({
      reviewId: req.params.reviewId,
      ...parsed.data,
      reviewedBy: (req as any).userId ?? "owner",
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "GOOGLE_OPERATIONAL_CALENDAR_REVIEW_RESOLUTION_FAILED";
    const clientErrors = new Set([
      "GOOGLE_OPERATIONAL_CALENDAR_REVIEW_NOT_FOUND",
      "GOOGLE_OPERATIONAL_CALENDAR_REVIEW_ALREADY_RESOLVED",
      "GOOGLE_OPERATIONAL_CALENDAR_PACKAGE_REQUIRED",
      "GOOGLE_OPERATIONAL_CALENDAR_WINDOW_INVALID",
      "GOOGLE_OPERATIONAL_CALENDAR_CANDIDATE_INVALID",
      "GOOGLE_OPERATIONAL_CALENDAR_BOOKING_NOT_FOUND",
      "GOOGLE_OPERATIONAL_CALENDAR_LOCATION_REQUIRED",
      "GOOGLE_OPERATIONAL_CALENDAR_PACKAGE_TEMPLATE_NOT_FOUND",
      "GOOGLE_OPERATIONAL_CALENDAR_RESERVED_START_INVALID",
      "GOOGLE_OPERATIONAL_CALENDAR_RESERVED_END_INVALID",
    ]);
    if (clientErrors.has(code)) {
      res.status(code.endsWith("NOT_FOUND") ? 404 : 400).json({ error: code });
      return;
    }
    req.log.error({ err: error, reviewId: req.params.reviewId }, "Operational calendar review resolution failed");
    res.status(500).json({ error: "GOOGLE_OPERATIONAL_CALENDAR_REVIEW_RESOLUTION_FAILED" });
  }
});

export default router;