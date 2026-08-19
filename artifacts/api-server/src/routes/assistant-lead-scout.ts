import { Router, type IRouter } from "express";
import { z } from "zod";

import { LeadScoutService } from "@/features/assistant/lead-scout-service";

const createSchema = z.object({ question: z.string().trim().min(1).max(4000) }).strict();
const runIdSchema = z.uuid().transform((value) => value.toLowerCase());

type LeadScoutRouteService = Pick<
  LeadScoutService,
  "createCrmDiscovery" | "getRun" | "getLatestRun"
>;

function actorId(req: any) {
  return String(req.userId ?? "");
}

function sendError(req: any, res: any, error: unknown) {
  if (error instanceof Error && error.message === "LEAD_SCOUT_RUN_NOT_FOUND") {
    res.status(404).json({ error: "Lead Scout run not found." });
    return;
  }
  req.log?.error?.({ err: error }, "Lead Scout route failed");
  res.status(500).json({ error: "Lead Scout could not complete that request." });
}

export function createAssistantLeadScoutRouter(
  service: LeadScoutRouteService = new LeadScoutService(),
): IRouter {
  const router: IRouter = Router();

  router.post("/assistant/lead-scout/runs", async (req, res): Promise<void> => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the Lead Scout request." });
      return;
    }
    try {
      const result = await service.createCrmDiscovery({
        actorId: actorId(req),
        question: parsed.data.question,
      });
      if ("kind" in result && result.kind === "needs_clarification") {
        res.json(result);
        return;
      }
      res.json({ run: result });
    } catch (error) {
      sendError(req, res, error);
    }
  });

  router.get("/assistant/lead-scout/runs/latest", async (req, res): Promise<void> => {
    try {
      const run = await service.getLatestRun(actorId(req));
      res.json({ run });
    } catch (error) {
      sendError(req, res, error);
    }
  });

  router.get("/assistant/lead-scout/runs/:runId", async (req, res): Promise<void> => {
    const parsed = runIdSchema.safeParse(req.params.runId);
    if (!parsed.success) {
      res.status(400).json({ error: "Review the Lead Scout run id." });
      return;
    }
    try {
      const run = await service.getRun({ actorId: actorId(req), runId: parsed.data });
      res.json({ run });
    } catch (error) {
      sendError(req, res, error);
    }
  });

  return router;
}

export default createAssistantLeadScoutRouter();
