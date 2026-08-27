import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { z } from "zod";

import {
  DrizzleTodayWorkControls,
  type TodayWorkControls,
} from "@/features/today/today-work-controls";
import { parseBusinessDate } from "@/lib/business-date";

const businessDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => parseBusinessDate(value) !== null);
const opportunityIdSchema = z.string().uuid();

function defaultControls(): TodayWorkControls {
  return new DrizzleTodayWorkControls(db);
}

export function createTodayWorkRouter(
  controls: TodayWorkControls = defaultControls(),
): IRouter {
  const router: IRouter = Router();

  router.post(
    "/today/work/:opportunityId/pin",
    async (req, res): Promise<void> => {
      const parsed = z
        .object({
          opportunityId: opportunityIdSchema,
          businessDate: businessDateSchema,
          pinned: z.boolean(),
        })
        .safeParse({ ...req.body, opportunityId: req.params.opportunityId });
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: "Invalid pin request." });
        return;
      }
      const visible = await controls.pin(
        parsed.data.opportunityId,
        parsed.data.businessDate,
        parsed.data.pinned,
      );
      if (!visible) {
        res.status(404).json({ ok: false, error: "Opportunity work not found." });
        return;
      }
      res.json({ ok: true });
    },
  );

  router.post(
    "/today/work/:opportunityId/urgent",
    async (req, res): Promise<void> => {
      const parsed = z
        .object({ opportunityId: opportunityIdSchema, urgent: z.boolean() })
        .safeParse({ ...req.body, opportunityId: req.params.opportunityId });
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: "Invalid urgent request." });
        return;
      }
      const visible = await controls.urgent(
        parsed.data.opportunityId,
        parsed.data.urgent,
      );
      if (!visible) {
        res.status(404).json({ ok: false, error: "Opportunity work not found." });
        return;
      }
      res.json({ ok: true });
    },
  );

  router.post(
    "/today/work/:opportunityId/snooze",
    async (req, res): Promise<void> => {
      const parsed = z
        .object({
          opportunityId: opportunityIdSchema,
          businessDate: businessDateSchema,
          until: z.coerce.date(),
        })
        .refine(({ until }) => until.getTime() > Date.now())
        .safeParse({ ...req.body, opportunityId: req.params.opportunityId });
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: "Invalid snooze request." });
        return;
      }
      const visible = await controls.snooze(
        parsed.data.opportunityId,
        parsed.data.businessDate,
        parsed.data.until,
      );
      if (!visible) {
        res.status(404).json({ ok: false, error: "Opportunity work not found." });
        return;
      }
      res.json({ ok: true });
    },
  );

  router.post("/today/work/reorder", async (req, res): Promise<void> => {
    const parsed = z
      .object({
        businessDate: businessDateSchema,
        opportunityIds: z.array(opportunityIdSchema).min(1),
      })
      .refine(
        ({ opportunityIds }) =>
          new Set(opportunityIds).size === opportunityIds.length,
      )
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid reorder request." });
      return;
    }
    const visible = await controls.reorder(
      parsed.data.opportunityIds,
      parsed.data.businessDate,
    );
    if (!visible) {
      res.status(409).json({
        ok: false,
        error: "Queue changed. Refresh Today before reordering.",
      });
      return;
    }
    res.json({ ok: true });
  });

  router.post("/today/work/reset-order", async (req, res): Promise<void> => {
    const parsed = z
      .object({ businessDate: businessDateSchema })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "Invalid reset request." });
      return;
    }
    await controls.resetOrder(parsed.data.businessDate);
    res.json({ ok: true });
  });

  return router;
}

export default createTodayWorkRouter();
