import { Router, type IRouter } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import { EventChecklistService } from "@/features/leg-manager/event-checklist-service";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));
const checklists = new EventChecklistService(db as any);
const uuid = z.string().uuid();
const phaseSchema = z.enum(["pre_event", "post_event"]);
const startSchema = z.object({ clientMutationId: uuid }).strict();
const resultSchema = z
  .object({
    result: z.enum(["acceptable", "needs_work_safe", "unsafe", "not_applicable"]),
    note: z.string().max(8000).nullable().optional(),
    clientMutationId: uuid,
  })
  .strict();
const unableSchema = z
  .object({ reason: z.string().trim().min(1).max(8000) })
  .strict();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function routeIds(req: any) {
  return {
    bookingId: param(req.params.bookingId),
    resultId: param(req.params.resultId),
    phase: param(req.params.phase),
  };
}

function checklistError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "CHECKLIST_OUTSIDE_LEG") {
    res.status(403).json({ error: "Booking is outside your leg." });
    return true;
  }
  if (message === "CHECKLIST_RESULT_NOT_FOUND") {
    res.status(404).json({ error: "Checklist item not found." });
    return true;
  }
  if (message === "CHECKLIST_NOT_STARTED") {
    res.status(409).json({ error: "Start this checklist first." });
    return true;
  }
  if (message === "CHECKLIST_RUN_CLOSED") {
    res.status(409).json({ error: "This checklist is already closed." });
    return true;
  }
  if (message === "CHECKLIST_UNABLE_REASON_REQUIRED") {
    res.status(400).json({ error: "Add a reason for why the checklist could not be completed." });
    return true;
  }
  if (message.startsWith("CHECKLIST_INVALID_ANSWER:")) {
    res.status(400).json({ error: message.slice("CHECKLIST_INVALID_ANSWER:".length) });
    return true;
  }
  if (message.startsWith("CHECKLIST_NOT_COMPLETE:")) {
    res.status(409).json({ error: message.slice("CHECKLIST_NOT_COMPLETE:".length) });
    return true;
  }
  return false;
}

router.get(
  "/manager/events/:bookingId/checklists/:phase",
  requireManager,
  async (req, res): Promise<void> => {
    const { bookingId, phase } = routeIds(req);
    const parsedPhase = phaseSchema.safeParse(phase);
    if (!uuid.safeParse(bookingId).success || !parsedPhase.success) {
      res.status(400).json({ error: "Invalid event or checklist phase." });
      return;
    }
    try {
      const checklist = await checklists.get(
        bookingId,
        req.legManager!.legId,
        parsedPhase.data,
      );
      if (!checklist) {
        res.status(404).json({ error: "Checklist has not been started." });
        return;
      }
      res.json({ checklist });
    } catch (error) {
      if (checklistError(res, error)) return;
      req.log.error({ error }, "Failed to load manager event checklist");
      res.status(500).json({ error: "Could not load the event checklist." });
    }
  },
);

router.post(
  "/manager/events/:bookingId/checklists/:phase/start",
  requireManager,
  async (req, res): Promise<void> => {
    const { bookingId, phase } = routeIds(req);
    const parsedPhase = phaseSchema.safeParse(phase);
    const parsed = startSchema.safeParse(req.body);
    if (!uuid.safeParse(bookingId).success || !parsedPhase.success || !parsed.success) {
      res.status(400).json({ error: "Invalid checklist start request." });
      return;
    }
    try {
      const checklist = await checklists.ensureRun({
        bookingId,
        legId: req.legManager!.legId,
        phase: parsedPhase.data,
        clientMutationId: parsed.data.clientMutationId,
      });
      res.json({ checklist });
    } catch (error) {
      if (checklistError(res, error)) return;
      req.log.error({ error }, "Failed to start manager event checklist");
      res.status(500).json({ error: "Could not start the event checklist." });
    }
  },
);

router.patch(
  "/manager/events/:bookingId/checklist-results/:resultId",
  requireManager,
  async (req, res): Promise<void> => {
    const { bookingId, resultId } = routeIds(req);
    const parsed = resultSchema.safeParse(req.body);
    if (
      !uuid.safeParse(bookingId).success ||
      !uuid.safeParse(resultId).success ||
      !parsed.success
    ) {
      res.status(400).json({ error: parsed.success ? "Invalid checklist item." : parsed.error.issues[0]?.message ?? "Review this checklist answer." });
      return;
    }
    try {
      const linked = await checklists.repository.resultForLeg(
        resultId,
        req.legManager!.legId,
      );
      if (!linked) {
        res.status(404).json({ error: "Checklist item not found." });
        return;
      }
      if (linked.run.bookingId !== bookingId) {
        res.status(403).json({ error: "Checklist item does not belong to this event." });
        return;
      }
      const checklist = await checklists.saveResult({
        resultId,
        legId: req.legManager!.legId,
        result: parsed.data.result,
        note: parsed.data.note ?? null,
        clientMutationId: parsed.data.clientMutationId,
      });
      res.json({ checklist });
    } catch (error) {
      if (checklistError(res, error)) return;
      req.log.error({ error }, "Failed to save manager checklist result");
      res.status(500).json({ error: "Could not save this checklist answer." });
    }
  },
);

router.post(
  "/manager/events/:bookingId/checklists/:phase/complete",
  requireManager,
  async (req, res): Promise<void> => {
    const { bookingId, phase } = routeIds(req);
    const parsedPhase = phaseSchema.safeParse(phase);
    if (!uuid.safeParse(bookingId).success || !parsedPhase.success) {
      res.status(400).json({ error: "Invalid event or checklist phase." });
      return;
    }
    try {
      const checklist = await checklists.complete(
        bookingId,
        req.legManager!.legId,
        parsedPhase.data,
      );
      res.json({ checklist });
    } catch (error) {
      if (checklistError(res, error)) return;
      req.log.error({ error }, "Failed to complete manager event checklist");
      res.status(500).json({ error: "Could not complete the event checklist." });
    }
  },
);

router.post(
  "/manager/events/:bookingId/checklists/:phase/unable-to-complete",
  requireManager,
  async (req, res): Promise<void> => {
    const { bookingId, phase } = routeIds(req);
    const parsedPhase = phaseSchema.safeParse(phase);
    const parsed = unableSchema.safeParse(req.body);
    if (!uuid.safeParse(bookingId).success || !parsedPhase.success || !parsed.success) {
      res.status(400).json({ error: "A reason is required for this checklist exception." });
      return;
    }
    try {
      const checklist = await checklists.unableToComplete(
        bookingId,
        req.legManager!.legId,
        parsedPhase.data,
        parsed.data.reason,
      );
      res.json({ checklist });
    } catch (error) {
      if (checklistError(res, error)) return;
      req.log.error({ error }, "Failed to record manager checklist exception");
      res.status(500).json({ error: "Could not save the checklist exception." });
    }
  },
);

export default router;
