import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { z } from "zod";

import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import { BookingService } from "@/features/bookings/booking-service";
import { DrizzleFollowUpRepository } from "@/features/follow-ups/follow-up-repository";
import { FollowUpService } from "@/features/follow-ups/follow-up-service";
import type { EditFollowUpInput } from "@/features/follow-ups/follow-up-types";
import { OpportunityRepository } from "@/features/opportunities/opportunity-repository";
import { OpportunityService } from "@/features/opportunities/opportunity-service";

type FollowUpMutationService = Pick<FollowUpService, "edit" | "delete">;
type OpportunityCompletionService = Pick<OpportunityService, "completeFollowUp">;

const completionSchema = z.object({
  followUpId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  outcome: z.string().trim().min(1),
  nextAction: z
    .object({
      kind: z.string().trim().min(1),
      dueAt: z.coerce.date(),
    })
    .nullable(),
});

function defaultFollowUpService(): FollowUpService {
  return new FollowUpService(new DrizzleFollowUpRepository(db));
}

function defaultOpportunityCompletionService(): OpportunityService {
  return new OpportunityService(
    new BookingService(new DrizzleBookingRepository(db)),
    new OpportunityRepository(db),
  );
}

function toFollowUpId(value: string | string[]): string {
  return Array.isArray(value) ? value[0] ?? "" : value;
}

function toEditInput(id: string, body: Record<string, unknown>): EditFollowUpInput {
  return {
    followUpId: id,
    kind: body.kind,
    dueAt: new Date(typeof body.dueAt === "string" ? body.dueAt : Number.NaN),
    completed: body.completed,
    outcome: body.outcome,
  } as unknown as EditFollowUpInput;
}

function completionErrorResponse(code: string): {
  status: number;
  error: string;
} {
  if (code === "FOLLOW_UP_NOT_FOUND") {
    return { status: 404, error: "Follow-up not found." };
  }
  if (code === "ALREADY_COMPLETED") {
    return { status: 409, error: "Follow-up is already completed." };
  }
  return { status: 400, error: "A next action is required." };
}

export function createFollowUpsRouter(
  service: FollowUpMutationService = defaultFollowUpService(),
  completionService: OpportunityCompletionService =
    defaultOpportunityCompletionService(),
): IRouter {
  const router: IRouter = Router();

  router.post("/:id/complete", async (req, res): Promise<void> => {
    const parsed = completionSchema.safeParse({
      ...(req.body ?? {}),
      followUpId: toFollowUpId(req.params.id),
    });
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "A valid Opportunity, outcome, and next action are required.",
      });
      return;
    }

    try {
      const result = await completionService.completeFollowUp(parsed.data);
      if (!result.ok) {
        const response = completionErrorResponse(result.error.code);
        res.status(response.status).json({ ok: false, error: response.error });
        return;
      }
      res.json({ ok: true, followUp: result.value });
    } catch (error) {
      req.log.error({ error }, "Failed to complete Opportunity follow-up");
      res.status(500).json({
        ok: false,
        error: "Could not complete follow-up.",
      });
    }
  });

  router.patch("/:id", async (req, res): Promise<void> => {
    try {
      const result = await service.edit(
        toEditInput(toFollowUpId(req.params.id), req.body ?? {}),
      );
      if (!result.ok) {
        if (result.error.code === "FOLLOW_UP_NOT_FOUND") {
          res.status(404).json({ ok: false, error: "Follow-up not found." });
          return;
        }
        res.status(400).json({ ok: false, error: result.error.message });
        return;
      }
      res.json({ ok: true, followUp: result.value });
    } catch (error) {
      req.log.error({ error }, "Failed to update follow-up");
      res.status(500).json({ ok: false, error: "Could not update follow-up." });
    }
  });

  router.delete("/:id", async (req, res): Promise<void> => {
    try {
      const result = await service.delete(toFollowUpId(req.params.id));
      if (!result.ok) {
        if (result.error.code === "FOLLOW_UP_NOT_FOUND") {
          res.status(404).json({ ok: false, error: "Follow-up not found." });
          return;
        }
        res.status(409).json({ ok: false, error: result.error.message });
        return;
      }
      res.json({ ok: true });
    } catch (error) {
      req.log.error({ error }, "Failed to delete follow-up");
      res.status(500).json({ ok: false, error: "Could not delete follow-up." });
    }
  });

  return router;
}

export default createFollowUpsRouter();
