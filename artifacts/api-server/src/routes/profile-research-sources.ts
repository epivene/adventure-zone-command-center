import { Router, type IRouter } from "express";
import { z } from "zod";
import { ProfileResearchSourceLibraryService } from "@/features/profile-research/profile-research-source-library";

const router: IRouter = Router();
const uuid = z.string().uuid();
const sourceSchema = z.object({
  url: z.string().trim().min(1),
  title: z.string().trim().max(240).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();
const updateSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).strict();
const scoutSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict().superRefine((value, ctx) => {
  const start = Date.parse(`${value.startDate}T00:00:00Z`);
  const end = Date.parse(`${value.endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    ctx.addIssue({ code: "custom", message: "Choose a valid scouting window." });
    return;
  }
  if ((end - start) / 86_400_000 > 366) {
    ctx.addIssue({ code: "custom", message: "Scout at most 366 days at a time." });
  }
});

router.get("/research-sources", async (req, res): Promise<void> => {
  try {
    const sources = await new ProfileResearchSourceLibraryService().list(req.query.archived === "yes");
    res.json({ sources });
  } catch (error) {
    req.log.error({ err: error }, "Failed to list research sources");
    res.status(500).json({ error: "Could not load research sources." });
  }
});

router.post("/research-sources", async (req, res): Promise<void> => {
  const parsed = sourceSchema.safeParse(req.body ?? {});
  if (!parsed.success) { res.status(400).json({ error: "Review the source details." }); return; }
  try {
    const source = await new ProfileResearchSourceLibraryService().save(parsed.data);
    res.status(201).json({ source });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_RESEARCH_SOURCE_URL") {
      res.status(400).json({ error: "Use a public HTTP(S) source URL." }); return;
    }
    req.log.error({ err: error }, "Failed to save research source");
    res.status(500).json({ error: "Could not save this research source." });
  }
});

router.patch("/research-sources/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!uuid.safeParse(id).success || !parsed.success) { res.status(400).json({ error: "Review the source changes." }); return; }
  try {
    const source = await new ProfileResearchSourceLibraryService().update(id, parsed.data);
    if (!source) { res.status(404).json({ error: "Research source not found." }); return; }
    res.json({ source });
  } catch (error) {
    req.log.error({ err: error }, "Failed to update research source");
    res.status(500).json({ error: "Could not update this research source." });
  }
});

router.post("/research-sources/:id/archive", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!uuid.safeParse(id).success) { res.status(400).json({ error: "Invalid research source." }); return; }
  const archived = await new ProfileResearchSourceLibraryService().archive(id);
  if (!archived) { res.status(404).json({ error: "Research source not found." }); return; }
  res.json({ ok: true });
});

router.post("/research-sources/:id/scout", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const parsed = scoutSchema.safeParse(req.body ?? {});
  if (!uuid.safeParse(id).success || !parsed.success) { res.status(400).json({ error: parsed.error?.issues[0]?.message ?? "Review the scouting window." }); return; }
  try {
    const source = await new ProfileResearchSourceLibraryService().scout(id, parsed.data);
    res.json({ source });
  } catch (error) {
    if (error instanceof Error && error.message === "RESEARCH_SOURCE_NOT_FOUND") { res.status(404).json({ error: "Research source not found." }); return; }
    req.log.error({ err: error }, "Failed to scout saved research source");
    res.status(500).json({ error: "Could not scout this source right now." });
  }
});

export default router;
