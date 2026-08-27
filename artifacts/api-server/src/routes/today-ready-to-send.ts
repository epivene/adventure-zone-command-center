import { Router, type IRouter, type Response } from "express";
import { z } from "zod";

import type {
  ReadyToSendResult,
  ReadyToSendSummary,
} from "@/features/opportunity-email/ready-to-send-service";

const uuidSchema = z.string().uuid();
const requestKeySchema = z.string().trim().min(1).max(200);
const sendItemSchema = z.object({
  draftId: uuidSchema,
  opportunityId: uuidSchema,
  requestKey: requestKeySchema,
}).strict();
const sendBodySchema = z.object({
  items: z.array(sendItemSchema).min(1).max(100),
}).strict();
const scheduleItemSchema = sendItemSchema.extend({
  scheduledFor: z.coerce.date(),
}).strict();
const scheduleBodySchema = z.object({
  items: z.array(scheduleItemSchema).min(1).max(100),
}).strict();

export type TodayReadyToSendRouteService = {
  summary(): Promise<ReadyToSendSummary>;
  sendSelected(input: Array<{
    draftId: string;
    opportunityId: string;
    requestKey: string;
  }>): Promise<ReadyToSendResult[]>;
  scheduleSelected(input: Array<{
    draftId: string;
    opportunityId: string;
    requestKey: string;
    scheduledFor: Date;
  }>): Promise<ReadyToSendResult[]>;
};

type RouteOptions = {
  now?: () => Date;
};

function routeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return error instanceof Error && error.message ? error.message : "READY_TO_SEND_OPERATION_FAILED";
}

function sendRouteError(res: Response, error: unknown): void {
  const code = routeErrorCode(error);
  if (code === "READY_TO_SEND_SELECTION_INVALID") {
    res.status(409).json({ ok: false, error: code });
    return;
  }
  res.status(500).json({ ok: false, error: "Ready to Send operation failed." });
}

export function createTodayReadyToSendRouter(
  service: TodayReadyToSendRouteService,
  options: RouteOptions = {},
): IRouter {
  const router: IRouter = Router();
  const now = options.now ?? (() => new Date());

  router.get("/", async (_req, res): Promise<void> => {
    try {
      const summary = await service.summary();
      res.json({ ok: true, summary });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.post("/send", async (req, res): Promise<void> => {
    const body = sendBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ ok: false, error: "Invalid Ready to Send selection." });
      return;
    }
    try {
      const results = await service.sendSelected(body.data.items);
      res.json({ ok: true, results });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  router.post("/schedule", async (req, res): Promise<void> => {
    const body = scheduleBodySchema.safeParse(req.body);
    if (
      !body.success ||
      body.data.items.some((item) => item.scheduledFor.getTime() <= now().getTime())
    ) {
      res.status(400).json({ ok: false, error: "Invalid Ready to Send schedule." });
      return;
    }
    try {
      const results = await service.scheduleSelected(body.data.items);
      res.json({ ok: true, results });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  return router;
}
