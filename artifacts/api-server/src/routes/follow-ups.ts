import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { z } from "zod";

import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { DrizzleBookingRepository } from "@/features/bookings/booking-repository";
import { BookingService } from "@/features/bookings/booking-service";
import { DrizzleFollowUpRepository } from "@/features/follow-ups/follow-up-repository";
import { FollowUpService } from "@/features/follow-ups/follow-up-service";
import type { EditFollowUpInput } from "@/features/follow-ups/follow-up-types";
import { OpportunityEmailActivityWriter } from "@/features/opportunity-email/opportunity-email-activity";
import { OpportunityRepository } from "@/features/opportunities/opportunity-repository";
import { OpportunityService } from "@/features/opportunities/opportunity-service";
import type { OpportunityRecord, UpdateOpportunityInput } from "@/features/opportunities/opportunity-types";

type FollowUpMutationService = Pick<FollowUpService, "create" | "edit" | "delete">;
type OpportunityCompletionService = Pick<OpportunityService, "completeFollowUp">;
type OpportunityFollowUpRepository = {
  get(id: string): Promise<OpportunityRecord | null>;
  update(id: string, patch: UpdateOpportunityInput): Promise<OpportunityRecord>;
};
type FollowUpActivityWriter = Pick<OpportunityEmailActivityWriter, "recordFollowUpCreated">;

const createSchema = z.object({
  opportunityId: z.string().uuid(),
  kind: z.string().trim().min(1),
  dueAt: z.coerce.date().refine((value) => Number.isFinite(value.getTime())),
});

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

function defaultOpportunityRepository(): OpportunityFollowUpRepository {
  return new OpportunityRepository(db);
}

function defaultActivityWriter(): FollowUpActivityWriter {
  return new OpportunityEmailActivityWriter({
    opportunities: new OpportunityRepository(db),
    activities: new DrizzleActivityRepository(db),
  });
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
  opportunities: OpportunityFollowUpRepository = defaultOpportunityRepository(),
  activity: FollowUpActivityWriter = defaultActivityWriter(),
): IRouter {
  const router: IRouter = Router();

  router.post("/", async (req, res): Promise<void> => {
    const parsed = createSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "A valid Opportunity, follow-up kind, and due date are required." });
      return;
    }

    try {
      const opportunity = await opportunities.get(parsed.data.opportunityId);
      if (!opportunity) {
        res.status(404).json({ ok: false, error: "Opportunity not found." });
        return;
      }

      const result = await service.create({
        organizationId: opportunity.organizationId,
        contactId: opportunity.contactId,
        bookingId: opportunity.bookingId,
        kind: parsed.data.kind,
        dueAt: parsed.data.dueAt,
      });
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error.message });
        return;
      }

      await opportunities.update(opportunity.id, {
        status: "follow_up",
        nextActionKind: parsed.data.kind,
        nextActionDueAt: parsed.data.dueAt,
      });
      await activity.recordFollowUpCreated({
        opportunityId: opportunity.id,
        followUpId: result.value.id,
        dueAt: parsed.data.dueAt,
      });

      res.status(201).json({ ok: true, followUp: result.value });
    } catch (error) {
      req.log.error({ error }, "Failed to create Opportunity follow-up");
      res.status(500).json({ ok: false, error: "Could not create follow-up." });
    }
  });

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
