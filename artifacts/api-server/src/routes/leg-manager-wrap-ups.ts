import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { DrizzleEventWrapUpRepository } from "@/features/leg-manager/event-wrap-up-repository";
import { EventWrapUpService, type EventWrapUpDraftInput } from "@/features/leg-manager/event-wrap-up-service";
import { DrizzleEventWrapUpSource } from "@/features/leg-manager/event-wrap-up-source";
import { requireOwnerMiddleware } from "../lib/auth";
import {
  organizerFeedbackAdminRouter,
  organizerFeedbackManagerRouter,
  organizerFeedbackPublicRouter,
} from "./organizer-feedback";

const draftSchema = z.object({
  ratingStars: z.number().int().min(0).max(5).nullable(),
  ratingNotes: z.string().max(10_000).nullable(),
  actualCashOnHandCents: z.number().int().nonnegative().nullable(),
  cashDifferenceNote: z.string().max(4_000).nullable(),
}).strict();

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : "Event wrap-up failed";
  if (/outside your leg/i.test(message)) return 403;
  if (/not be found|no travel leg/i.test(message)) return 404;
  if (/actual cash|rating|draft|submitted|reopen/i.test(message)) return 400;
  return 500;
}

export function createManagerWrapUpRouter(deps: {
  service: Pick<EventWrapUpService, "loadManagerWrapUp" | "saveManagerDraft" | "submitManagerWrapUp">;
  requireManager: RequestHandler;
  payload: (bookingId: string, wrapUp: any) => Promise<any>;
}): IRouter {
  const router: IRouter = Router();

  router.get("/manager/wrap-ups/:bookingId", deps.requireManager, async (req, res): Promise<void> => {
    const bookingId = routeParam(req.params.bookingId);
    try {
      const wrapUp = await deps.service.loadManagerWrapUp(bookingId, req.legManager!.legId);
      const payload = await deps.payload(bookingId, wrapUp);
      res.json(payload);
    } catch (error) {
      res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Could not load wrap-up" });
    }
  });

  router.put("/manager/wrap-ups/:bookingId", deps.requireManager, async (req, res): Promise<void> => {
    const body = req.body && typeof req.body === "object" ? { ...req.body } : req.body;
    if (body && typeof body === "object") delete (body as Record<string, unknown>).legId;
    const parsed = draftSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the wrap-up" });
      return;
    }
    const bookingId = routeParam(req.params.bookingId);
    try {
      const wrapUp = await deps.service.saveManagerDraft({
        bookingId,
        managerLegId: req.legManager!.legId,
        managerId: null,
        input: parsed.data as EventWrapUpDraftInput,
      });
      const payload = await deps.payload(bookingId, wrapUp);
      res.json(payload);
    } catch (error) {
      res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Could not save wrap-up" });
    }
  });

  router.post("/manager/wrap-ups/:bookingId/submit", deps.requireManager, async (req, res): Promise<void> => {
    const bookingId = routeParam(req.params.bookingId);
    try {
      const wrapUp = await deps.service.submitManagerWrapUp({
        bookingId,
        managerLegId: req.legManager!.legId,
        managerId: null,
      });
      const payload = await deps.payload(bookingId, wrapUp);
      res.json(payload);
    } catch (error) {
      res.status(errorStatus(error)).json({ error: error instanceof Error ? error.message : "Could not submit wrap-up" });
    }
  });

  // Organizer feedback belongs to the same post-event workflow, but remains a
  // separate record: managers review events above; organizers review managers here.
  router.use(organizerFeedbackPublicRouter);
  router.use(organizerFeedbackManagerRouter);
  router.use("/organizer-feedback/admin", requireOwnerMiddleware);
  router.use(organizerFeedbackAdminRouter);

  return router;
}

const store = new DrizzleEventWrapUpRepository(db);
const source = new DrizzleEventWrapUpSource(db, store);
const service = new EventWrapUpService(store, source);
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));

export default createManagerWrapUpRouter({
  service,
  requireManager,
  payload: (bookingId, wrapUp) => source.buildPayload(bookingId, wrapUp),
});
