import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { ensurePostEventFollowUp } from "@/features/follow-ups/post-event-follow-up";
import { EventChecklistLifecycleService } from "@/features/leg-manager/event-checklist-lifecycle";
import { EventChecklistService } from "@/features/leg-manager/event-checklist-service";
import { EventLifecycleRepository, eventLocationStatuses } from "@/features/leg-manager/event-lifecycle-repository";
import { createReviewForManager, DrizzleEventReviewRepository } from "@/features/leg-manager/event-review-repository";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
const lifecycle = new EventLifecycleRepository(db);
const checklists = new EventChecklistService(db as any);
const checklistLifecycle = new EventChecklistLifecycleService(db as any);
const reviews = new DrizzleEventReviewRepository(db);
const ianaTimeZone = z.string().trim().min(1).max(120).refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}, "Invalid time zone");
const locationInput = z.object({
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  locationStatus: z.enum(eventLocationStatuses).default("not_requested"),
  timeZone: ianaTimeZone.nullable().optional(),
  clientMutationId: z.string().uuid().optional(),
}).strict();
const wrapUpReviewInput = z.object({
  rating: z.number().int().min(0).max(5),
  feedback: z.string().trim().max(8000).nullable().optional(),
  clientMutationId: z.string().uuid(),
});

function bookingId(req: any) {
  const raw = req.params.bookingId;
  return Array.isArray(raw) ? raw[0] ?? "" : raw ?? "";
}

async function projectedLifecycle(id: string, legId: string) {
  const row = await lifecycle.get(id, legId);
  if (!row) return null;
  return {
    ...row,
    ...(await checklistLifecycle.projection(id, legId)),
  };
}

router.get("/manager/events/lifecycle/current", requireManager, async (req, res) => {
  const current = await lifecycle.getCurrentForLeg(req.legManager!.legId);
  if (!current) {
    res.json({ lifecycle: null });
    return;
  }
  res.json({
    lifecycle: {
      ...current,
      ...(await checklistLifecycle.projection(current.bookingId, req.legManager!.legId)),
    },
  });
});

router.get("/manager/events/lifecycle/incomplete", requireManager, async (req, res) => {
  const legId = req.legManager!.legId;
  const rows = await lifecycle.listIncompleteForLeg(legId);
  res.json({
    lifecycles: await Promise.all(
      rows.map(async (row) => ({
        ...row,
        ...(await checklistLifecycle.projection(row.bookingId, legId)),
      })),
    ),
  });
});

router.get("/manager/events/:bookingId/lifecycle", requireManager, async (req, res): Promise<void> => {
  const id = bookingId(req);
  const legId = req.legManager!.legId;
  if (!(await lifecycle.bookingBelongsToLeg(id, legId))) {
    res.status(403).json({ error: "Booking is outside your leg" });
    return;
  }
  res.json({ lifecycle: await projectedLifecycle(id, legId) });
});

router.post("/manager/events/:bookingId/check-in", requireManager, async (req, res): Promise<void> => {
  const id = bookingId(req);
  const legId = req.legManager!.legId;
  const parsed = locationInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid check-in data" }); return; }
  if (!(await lifecycle.bookingCanCheckIn(id, legId))) { res.status(403).json({ error: "Only confirmed events assigned to your leg can be checked in" }); return; }

  // Arrival is the source of truth and must persist before any checklist work.
  const row = await lifecycle.checkIn({
    bookingId: id,
    legId,
    at: new Date(),
    timeZone: parsed.data.timeZone ?? null,
    latitude: parsed.data.latitude ?? null,
    longitude: parsed.data.longitude ?? null,
    locationStatus: parsed.data.locationStatus,
  });

  try {
    const checklist = await checklists.ensureRun({
      bookingId: id,
      legId,
      phase: "pre_event",
      clientMutationId: parsed.data.clientMutationId ?? randomUUID(),
    });
    res.json({
      lifecycle: {
        ...row,
        ...(await checklistLifecycle.projection(id, legId)),
      },
      nextAction: "pre_event_checklist",
      checklistId: checklist.id,
    });
  } catch (error) {
    req.log.error({ error, bookingId: id, legId }, "Check-in saved but pre-event checklist could not be prepared");
    res.status(503).json({
      error: "Check-in was saved, but the pre-event checklist still needs to be prepared.",
      lifecycle: row,
      retryAction: "pre_event_checklist",
    });
  }
});

router.post("/manager/events/:bookingId/checkout/start", requireManager, async (req, res): Promise<void> => {
  const id = bookingId(req);
  const legId = req.legManager!.legId;
  const parsed = z.object({ clientMutationId: z.string().uuid().optional() }).strict().safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Invalid checkout start request" }); return; }
  if (!(await lifecycle.bookingBelongsToLeg(id, legId))) { res.status(403).json({ error: "Booking is outside your leg" }); return; }
  const current = await lifecycle.get(id, legId);
  if (!current?.checkedInAt) { res.status(409).json({ error: "Check in before starting checkout" }); return; }
  if (current.checkedOutAt) { res.status(409).json({ error: "This event is already checked out" }); return; }

  try {
    const checklist = await checklists.ensureRun({
      bookingId: id,
      legId,
      phase: "post_event",
      clientMutationId: parsed.data.clientMutationId ?? randomUUID(),
    });
    res.json({
      checklistId: checklist.id,
      lifecycle: await projectedLifecycle(id, legId),
      nextAction: "post_event_checklist",
    });
  } catch (error) {
    req.log.error({ error, bookingId: id, legId }, "Could not start post-event checklist");
    res.status(503).json({ error: "Could not prepare the post-event checklist. Departure has not been recorded." });
  }
});

router.post("/manager/events/:bookingId/check-out", requireManager, async (req, res): Promise<void> => {
  const id = bookingId(req);
  const legId = req.legManager!.legId;
  const parsed = locationInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid check-out data" }); return; }
  if (!(await lifecycle.bookingBelongsToLeg(id, legId))) { res.status(403).json({ error: "Booking is outside your leg" }); return; }

  const canFinalizeCheckout = await checklistLifecycle.canFinalizeCheckout(id, legId);
  if (!canFinalizeCheckout) {
    res.status(409).json({ error: "Complete the post-event checklist, record why it could not be completed, or ask the owner for an override before checking out." });
    return;
  }

  const checkedOutAt = new Date();
  const result = await lifecycle.checkOut({ bookingId: id, legId, at: checkedOutAt, timeZone: parsed.data.timeZone ?? null, latitude: parsed.data.latitude ?? null, longitude: parsed.data.longitude ?? null, locationStatus: parsed.data.locationStatus });
  if (!result.ok) { res.status(409).json({ error: "Check in before checking out" }); return; }

  // Checkout is the source of truth. Follow-up creation is best-effort so a
  // temporary Today/task problem can never make a completed departure look
  // unsuccessful. The helper is idempotent, so retrying safely repairs a
  // missing follow-up without creating duplicates.
  try {
    await ensurePostEventFollowUp(db, id, result.lifecycle.checkedOutAt ?? checkedOutAt);
  } catch (error) {
    req.log.error({ error, bookingId: id, legId }, "Checkout saved but post-event follow-up could not be created");
  }

  res.json({ lifecycle: await projectedLifecycle(id, legId) });
});

router.post("/manager/events/:bookingId/wrap-up/review", requireManager, async (req, res): Promise<void> => {
  const id = bookingId(req);
  const legId = req.legManager!.legId;
  const parsed = wrapUpReviewInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Review rating is required" }); return; }
  if (!(await lifecycle.bookingBelongsToLeg(id, legId))) { res.status(403).json({ error: "Booking is outside your leg" }); return; }
  const existing = (await reviews.listReviewsForLeg(legId)).find((review) => review.bookingId === id);
  if (existing) { res.json({ review: existing, existing: true }); return; }
  const result = await createReviewForManager(reviews, legId, {
    bookingId: id,
    rating: parsed.data.rating,
    feedback: parsed.data.feedback ?? null,
    organizerSiteNotes: null,
    crewNotes: null,
    recommendReturn: null,
    clientMutationId: parsed.data.clientMutationId,
  });
  if (!result.ok) { res.status(403).json({ error: "Booking is outside your leg" }); return; }
  res.status(result.idempotent ? 200 : 201).json({ review: result.review, existing: false });
});

router.post("/manager/events/:bookingId/wrap-up/finish-later", requireManager, async (req, res): Promise<void> => {
  const id = bookingId(req); const legId = req.legManager!.legId;
  if (!(await lifecycle.bookingBelongsToLeg(id, legId))) { res.status(403).json({ error: "Booking is outside your leg" }); return; }
  const existing = await lifecycle.get(id, legId);
  if (!existing?.checkedOutAt) { res.status(409).json({ error: "Check out before starting wrap-up" }); return; }
  await lifecycle.markIncomplete(id, legId);
  res.json({ lifecycle: await projectedLifecycle(id, legId) });
});

router.post("/manager/events/:bookingId/wrap-up/finish", requireManager, async (req, res): Promise<void> => {
  const id = bookingId(req); const legId = req.legManager!.legId;
  if (!(await lifecycle.bookingBelongsToLeg(id, legId))) { res.status(403).json({ error: "Booking is outside your leg" }); return; }
  const existing = await lifecycle.get(id, legId);
  if (!existing?.checkedOutAt) { res.status(409).json({ error: "Check out before finishing wrap-up" }); return; }
  await lifecycle.finish(id, legId);
  res.json({ lifecycle: await projectedLifecycle(id, legId) });
});

export default router;
