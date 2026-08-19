import { Router, type IRouter } from "express";
import { z } from "zod";

import { ProfileResearchService } from "@/features/profile-research/profile-research-service";

const router: IRouter = Router();
const uuid = z.string().uuid();
const startSchema = z.object({
  mode: z.enum(["quick", "deep"]),
  contactId: z.string().uuid().optional(),
}).strict();

router.post("/event-profiles/:id/research", async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsedId = uuid.safeParse(profileId);
  const parsed = startSchema.safeParse(req.body);
  if (!parsedId.success || !parsed.success) {
    res.status(400).json({ error: parsed.error?.issues[0]?.message ?? "Review the research request." });
    return;
  }

  try {
    const run = await new ProfileResearchService().start({
      profileId: parsedId.data,
      mode: parsed.data.mode,
      contactId: parsed.data.contactId,
      requestedBy: (req as any).userId ?? null,
    });
    res.status(201).json({ run });
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_NOT_FOUND") {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    req.log.error({ err: error }, "Profile research failed");
    res.status(500).json({ error: "Could not research this profile right now." });
  }
});

router.get("/event-profiles/:id/research/:runId", async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  if (!uuid.safeParse(profileId).success || !uuid.safeParse(runId).success) {
    res.status(400).json({ error: "Invalid research run." });
    return;
  }
  try {
    const run = await new ProfileResearchService().getRun(profileId, runId);
    if (!run) {
      res.status(404).json({ error: "Research run not found." });
      return;
    }
    res.json({ run });
  } catch (error) {
    req.log.error({ err: error }, "Failed to load profile research");
    res.status(500).json({ error: "Could not load this research run." });
  }
});

router.post("/event-profiles/:id/research/:runId/suggestions/:suggestionId/dismiss", async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const suggestionId = Array.isArray(req.params.suggestionId) ? req.params.suggestionId[0] : req.params.suggestionId;
  if (![profileId, runId, suggestionId].every((value) => uuid.safeParse(value).success)) {
    res.status(400).json({ error: "Invalid research suggestion." });
    return;
  }
  try {
    const updated = await new ProfileResearchService().dismiss(profileId, runId, suggestionId);
    if (!updated) {
      res.status(404).json({ error: "Research suggestion not found." });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    req.log.error({ err: error }, "Failed to dismiss profile research suggestion");
    res.status(500).json({ error: "Could not dismiss this suggestion." });
  }
});

export default router;
