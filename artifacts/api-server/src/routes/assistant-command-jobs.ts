import { Router, type IRouter } from "express";
import { z } from "zod";

import { routeAssistantCommand } from "@/features/assistant/assistant-command-router";
import { WebsiteAuditService } from "@/features/assistant/website-audit-service";

const router: IRouter = Router();
const service = new WebsiteAuditService();
const generalAskSchema = z.object({ question: z.string().trim().min(1).max(4000) }).strict();
const jobIdSchema = z.uuid();

function actorId(req: unknown): string {
  return String((req as { userId?: unknown }).userId ?? "");
}

router.post("/assistant/general/ask", async (req, res, next): Promise<void> => {
  const parsed = generalAskSchema.safeParse(req.body);
  if (!parsed.success) {
    next();
    return;
  }
  const command = routeAssistantCommand(parsed.data.question);
  if (command?.capability !== "website_verification") {
    next();
    return;
  }
  try {
    const job = await service.create({ actorId: actorId(req), instruction: parsed.data.question });
    res.json({
      kind: "assistant_job",
      text: "Website audit started. I’ll check the saved websites and profile matches. Nothing will be changed without your approval.",
      job,
    });
  } catch (err) {
    req.log.error({ err }, "Could not start assistant website audit");
    res.status(500).json({ error: "Could not start the website audit right now." });
  }
});

router.get("/assistant/jobs/latest", async (req, res): Promise<void> => {
  try {
    res.json({ job: await service.getLatest(actorId(req)) });
  } catch (err) {
    req.log.error({ err }, "Could not load latest assistant job");
    res.status(500).json({ error: "Could not load the assistant job." });
  }
});

router.get("/assistant/jobs/:jobId", async (req, res): Promise<void> => {
  const parsed = jobIdSchema.safeParse(req.params.jobId);
  if (!parsed.success) { res.status(400).json({ error: "Invalid assistant job." }); return; }
  try {
    const job = await service.get({ actorId: actorId(req), jobId: parsed.data });
    if (!job) { res.status(404).json({ error: "Assistant job not found." }); return; }
    res.json({ job });
  } catch (err) {
    req.log.error({ err }, "Could not load assistant job");
    res.status(500).json({ error: "Could not load the assistant job." });
  }
});

router.post("/assistant/jobs/:jobId/stop", async (req, res): Promise<void> => {
  const parsed = jobIdSchema.safeParse(req.params.jobId);
  if (!parsed.success) { res.status(400).json({ error: "Invalid assistant job." }); return; }
  try {
    res.json({ job: await service.requestStop({ actorId: actorId(req), jobId: parsed.data }) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "ASSISTANT_JOB_NOT_STOPPABLE") { res.status(409).json({ error: "That assistant job cannot be stopped now." }); return; }
    req.log.error({ err }, "Could not stop assistant job");
    res.status(500).json({ error: "Could not stop the assistant job." });
  }
});

router.post("/assistant/jobs/:jobId/continue", async (req, res): Promise<void> => {
  const parsed = jobIdSchema.safeParse(req.params.jobId);
  if (!parsed.success) { res.status(400).json({ error: "Invalid assistant job." }); return; }
  try {
    res.json({ job: await service.continue({ actorId: actorId(req), jobId: parsed.data }) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "ASSISTANT_JOB_NOT_CONTINUABLE") { res.status(409).json({ error: "That assistant job cannot be continued now." }); return; }
    req.log.error({ err }, "Could not continue assistant job");
    res.status(500).json({ error: "Could not continue the assistant job." });
  }
});

export default router;
