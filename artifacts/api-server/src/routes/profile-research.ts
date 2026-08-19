import { Router, type IRouter } from "express";
import { z } from "zod";

import { ProfileResearchApplyService } from "@/features/profile-research/profile-research-apply";
import { ProfileResearchService } from "@/features/profile-research/profile-research-service";
import { ProfileResearchSourceScoutService } from "@/features/profile-research/profile-research-source-scout-service";

const router: IRouter = Router();
const uuid = z.string().uuid();
const startSchema = z.object({
  mode: z.enum(["quick", "deep"]),
  contactId: z.string().uuid().optional(),
}).strict();
const applySchema = z.object({
  suggestionIds: z.array(z.string().uuid()).min(1).max(100),
}).strict();
const scoutSourceSchema = z.object({
  sourceUrl: z.string().url().max(2000),
  sourceTitle: z.string().trim().max(180).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

router.post("/event-profiles/:id/research/:runId/scout-source", async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const parsed = scoutSourceSchema.safeParse(req.body);
  if (!uuid.safeParse(profileId).success || !uuid.safeParse(runId).success || !parsed.success) {
    res.status(400).json({ error: parsed.error?.issues[0]?.message ?? "Review the source scout request." });
    return;
  }
  try {
    const run = await new ProfileResearchSourceScoutService().scout({
      profileId,
      runId,
      sourceUrl: parsed.data.sourceUrl,
      sourceTitle: parsed.data.sourceTitle ?? null,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
    });
    res.json({ run });
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_RESEARCH_RUN_NOT_FOUND") {
      res.status(404).json({ error: "Research run not found." });
      return;
    }
    if (error instanceof Error && error.message === "PROFILE_RESEARCH_RUN_NOT_READY") {
      res.status(409).json({ error: "Finish the profile research run before scouting a source." });
      return;
    }
    if (error instanceof Error && ["PUBLIC_SOURCE_URL_REQUIRED", "INVALID_SCOUT_DATE_WINDOW", "SCOUT_DATE_WINDOW_TOO_LARGE"].includes(error.message)) {
      res.status(400).json({ error: "Choose a public source and a valid date window of one year or less." });
      return;
    }
    req.log.error({ err: error }, "Profile research source scout failed");
    res.status(500).json({ error: "Could not scout this source right now." });
  }
});

router.post("/event-profiles/:id/research/:runId/apply", async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  const parsed = applySchema.safeParse(req.body);
  if (!uuid.safeParse(profileId).success || !uuid.safeParse(runId).success || !parsed.success) {
    res.status(400).json({ error: parsed.error?.issues[0]?.message ?? "Review the selected research suggestions." });
    return;
  }
  try {
    const result = await new ProfileResearchApplyService().apply({
      profileId,
      runId,
      suggestionIds: parsed.data.suggestionIds,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_RESEARCH_RUN_NOT_READY") {
      res.status(409).json({ error: "This research run is not ready to apply." });
      return;
    }
    req.log.error({ err: error }, "Failed to apply profile research suggestions");
    res.status(500).json({ error: "Could not apply the selected research suggestions." });
  }
});

router.post("/event-profiles/:id/research/:runId/apply-high-confidence", async (req, res): Promise<void> => {
  const profileId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const runId = Array.isArray(req.params.runId) ? req.params.runId[0] : req.params.runId;
  if (!uuid.safeParse(profileId).success || !uuid.safeParse(runId).success) {
    res.status(400).json({ error: "Invalid research run." });
    return;
  }
  try {
    const result = await new ProfileResearchApplyService().applyAllHighConfidence({ profileId, runId });
    res.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_RESEARCH_RUN_NOT_READY") {
      res.status(409).json({ error: "This research run is not ready to apply." });
      return;
    }
    req.log.error({ err: error }, "Failed to apply high-confidence profile research suggestions");
    res.status(500).json({ error: "Could not apply the high-confidence suggestions." });
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
