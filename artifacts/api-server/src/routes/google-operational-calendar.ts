import { requireOwnerMiddleware } from "@/lib/auth";
import { ProfileCalendarPreviewService } from "@/features/google-workspace/calendar/profile-calendar-preview-service";
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
    packageKey: z.enum(["zone", "pirates", "warrior"]).optional(),
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

router.get("/google-workspace/operational-calendar/bookings/search", async (req, res): Promise<void> => {
  const query = z.string().trim().min(2).max(160).safeParse(req.query.q);
  if (!query.success) {
    res.status(400).json({ error: "Enter 2–160 characters to search existing profiles and bookings." });
    return;
  }
  try {
    const repository = new OperationalCalendarLinkRepository(db);
    const [candidates, profiles] = await Promise.all([
      repository.searchExistingBookings(query.data), repository.searchExistingProfiles(query.data),
    ]);
    res.json({ candidates, profiles });
  } catch (error) {
    req.log.error({ err: error }, "Calendar booking search failed");
    res.status(500).json({ error: "Could not search existing profiles and bookings." });
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
      "GOOGLE_OPERATIONAL_CALENDAR_CANCELLED_CREATE_BLOCKED",
      "GOOGLE_OPERATIONAL_CALENDAR_BOOKING_ALREADY_LINKED",
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

const proposalSchema = z.object({
  profileId: z.string().uuid(), bookingId: z.string().uuid(),
  setupOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  teardownOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
const applyPreviewSchema = z.object({ previewId: z.string().uuid(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
for (const action of ["preview", "apply"] as const) {
  router.post("/google-workspace/operational-calendar/profile/" + action, requireOwnerMiddleware, async (req, res): Promise<void> => {
    const actor = (req as typeof req & { userId?: string }).userId;
    if (typeof actor !== "string") { res.status(403).json({ error: "Owner authentication required." }); return; }
    try {
      const service = new ProfileCalendarPreviewService(db, connectionRepository);
      if (action === "preview") {
        const parsed = proposalSchema.safeParse(req.body);
        if (!parsed.success) { res.status(400).json({ error: "Invalid calendar preview." }); return; }
        res.json(await service.preview(parsed.data, actor || "single-owner"));
      } else {
        const parsed = applyPreviewSchema.safeParse(req.body);
        if (!parsed.success) { res.status(400).json({ error: "Invalid calendar save." }); return; }
        res.json(await service.apply(parsed.data, actor || "single-owner"));
      }
    } catch (error) {
      const value = error as { status?: number; code?: string };
      const status = value.status && value.status >= 400 && value.status < 500 ? value.status : 500;
      req.log.error({ err: error }, "Profile calendar preview failed");
      res.status(status).json({ error: status === 500
        ? "Calendar save could not be verified. Retry this same preview to reconcile it before creating anything else."
        : ({
          PREVIEW_EXPIRED: "This preview expired. Refresh it and review again.",
          PREVIEW_STALE: "Saved booking details or evidence changed. Refresh the preview.",
          PREVIEW_MISMATCH: "The preview no longer matches. Refresh it before saving.",
          CALENDAR_CONNECTION_CHANGED: "The calendar connection changed. Refresh the preview.",
          CALENDAR_EVENT_CHANGED: "An existing calendar event changed. Refresh and review its current details.",
          CALENDAR_LINK_CHANGED: "The linked calendar events changed. Review the links before saving.",
          POSSIBLE_DUPLICATE_REQUIRES_REVIEW: "A possible duplicate appeared. Review and link it before saving.",
          CALENDAR_SAVE_NOT_VERIFIED: "The calendar readback did not match. Retry this preview to check the saved event.",
          RESOLVE_PREVIEW_CHECKS: "Resolve the checks shown in the preview before saving.",
          RESOLVE_CALENDAR_REVIEW: "Resolve the pending calendar review before saving.",
          SOURCE_CHANGED_DURING_SAVE: "Source evidence changed while saving. Review the calendar and refresh the preview.",
          CALENDAR_DUPLICATE_SEARCH_INCOMPLETE: "The duplicate check could not finish. Nothing new can be created until it completes.",
        } as Record<string, string>)[value.code ?? ""] ?? "Calendar review could not finish. Refresh the preview and review the saved booking." });
    }
  });
}

export default router;

