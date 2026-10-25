import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { z } from "zod";

import { OpportunityRepository } from "@/features/opportunities/opportunity-repository";
import { EarlyBirdPromoRepository } from "@/features/early-bird-promo/early-bird-promo-repository";
import { EarlyBirdPromoService } from "@/features/early-bird-promo/early-bird-promo-service";
import {
  opportunityPriorityValues,
  opportunityStatusValues,
  type OpportunityRecord,
  type UpdateOpportunityInput,
} from "@/features/opportunities/opportunity-types";

interface OpportunityRouteRepository {
  get(id: string): Promise<OpportunityRecord | null>;
  getForOrganizationYear(
    organizationId: string,
    eventYear: number,
  ): Promise<OpportunityRecord | null>;
  update(id: string, patch: UpdateOpportunityInput): Promise<OpportunityRecord>;
}

const uuidSchema = z.string().uuid();
const yearSchema = z.coerce.number().int().min(2000).max(2200);
const statusSchema = z.enum(opportunityStatusValues);
const prioritySchema = z.enum(opportunityPriorityValues);
const patchSchema = z
  .object({
    status: statusSchema.optional(),
    priority: prioritySchema.optional(),
    nextActionKind: z.string().trim().min(1).nullable().optional(),
    nextActionDueAt: z.coerce.date().nullable().optional(),
    holdReason: z.string().trim().min(1).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

function defaultRepository(): OpportunityRouteRepository {
  return new OpportunityRepository(db);
}

export function createOpportunitiesRouter(
  repository: OpportunityRouteRepository = defaultRepository(),
  options: {
    promotion: Pick<EarlyBirdPromoService, "confirmInterest">;
    now: () => Date;
  } = {
    promotion: new EarlyBirdPromoService(new EarlyBirdPromoRepository(db)),
    now: () => new Date(),
  },
): IRouter {
  const router: IRouter = Router();

  router.get("/current", async (req, res): Promise<void> => {
    const parsed = z
      .object({ organizationId: uuidSchema, year: yearSchema })
      .safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid organization or event year." });
      return;
    }
    const opportunity = await repository.getForOrganizationYear(
      parsed.data.organizationId,
      parsed.data.year,
    );
    res.json({ ok: true, opportunity, suggestedStatus: null });
  });

  router.patch("/:id", async (req, res): Promise<void> => {
    const id = uuidSchema.safeParse(req.params.id);
    const patch = patchSchema.safeParse(req.body);
    if (!id.success || !patch.success) {
      res.status(400).json({ ok: false, error: "Invalid Opportunity update." });
      return;
    }
    const existing = await repository.get(id.data);
    if (!existing) {
      res.status(404).json({ ok: false, error: "Opportunity not found." });
      return;
    }
    if(patch.data.status&&patch.data.status!==existing.status&&["booked","declined","not_pursuing","cancelled"].includes(patch.data.status)) {
      res.status(400).json({ok:false,code:"FINAL_FOLLOW_UP_DECISION_REQUIRED",error:"Use the final follow-up decision to choose a next action or give a no-further-action reason."});return;
    }

    if (patch.data.status === "interested") {
      const { status: _status, ...authoritativePatch } = patch.data;
      const opportunity = Object.keys(authoritativePatch).length
        ? await repository.update(id.data, authoritativePatch)
        : existing;
      res.json({ ok: true, opportunity, suggestedStatus: "interested" });
      return;
    }

    const opportunity = await repository.update(id.data, patch.data);
    res.json({ ok: true, opportunity, suggestedStatus: null });
  });

  router.post("/:id/apply-suggested-status", async (req, res): Promise<void> => {
    const parsed = z
      .object({ id: uuidSchema, status: statusSchema })
      .safeParse({ id: req.params.id, status: req.body?.status });
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid suggested status." });
      return;
    }
    const existing = await repository.get(parsed.data.id);
    if (!existing) {
      res.status(404).json({ ok: false, error: "Opportunity not found." });
      return;
    }
    if(parsed.data.status!==existing.status&&["booked","declined","not_pursuing","cancelled"].includes(parsed.data.status)) {res.status(400).json({ok:false,code:"FINAL_FOLLOW_UP_DECISION_REQUIRED",error:"A final follow-up decision is required."});return;}
    const opportunity = await repository.update(parsed.data.id, {
      status: parsed.data.status,
    });
    if (parsed.data.status === "interested") {
      await options.promotion.confirmInterest({
        opportunityId: parsed.data.id,
        confirmedAt: options.now(),
        evidenceMessageId: null,
      });
    }
    res.json({ ok: true, opportunity, suggestedStatus: null });
  });

  return router;
}

export default createOpportunitiesRouter();

