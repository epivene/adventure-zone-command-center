import { Router, type IRouter } from "express";
import { z } from "zod";

import { NeedsAnswerRepository } from "@/features/needs-answer/needs-answer-repository";

const router: IRouter = Router();
const optionalUuid = z.string().uuid().nullable().optional();
const createSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  organizationId: optionalUuid,
  contactId: optionalUuid,
  bookingId: optionalUuid,
  followUpId: optionalUuid,
  callSessionId: optionalUuid,
  userNote: z.string().trim().max(4000).nullable().optional(),
}).strict();
const resolveSchema = z.object({
  resolution: z.string().trim().min(1).max(8000),
}).strict();
const statusSchema = z.enum(["open", "resolved"]);
const idSchema = z.string().uuid();

router.get("/needs-answer", async (req, res): Promise<void> => {
  const rawStatus = typeof req.query.status === "string" ? req.query.status : undefined;
  const parsedStatus = rawStatus ? statusSchema.safeParse(rawStatus) : null;
  if (rawStatus && !parsedStatus?.success) {
    res.status(400).json({ error: "Invalid Needs Answer status." });
    return;
  }
  try {
    const items = await new NeedsAnswerRepository().list(
      parsedStatus?.success ? parsedStatus.data : undefined,
    );
    res.json({ items });
  } catch (err) {
    req.log.error({ err }, "Failed to list Needs Answer items");
    res.status(500).json({ error: "Could not load Needs Answer items." });
  }
});

router.post("/needs-answer", async (req, res): Promise<void> => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the question." });
    return;
  }
  try {
    const item = await new NeedsAnswerRepository().create(parsed.data);
    res.status(201).json({ item });
  } catch (err) {
    req.log.error({ err }, "Failed to save Needs Answer item");
    res.status(500).json({ error: "Could not save this question to Needs Answer." });
  }
});

router.post("/needs-answer/:id/resolve", async (req, res): Promise<void> => {
  const id = idSchema.safeParse(req.params.id);
  const parsed = resolveSchema.safeParse(req.body);
  if (!id.success || !parsed.success) {
    res.status(400).json({ error: "Review the resolution." });
    return;
  }
  try {
    const item = await new NeedsAnswerRepository().resolve(id.data, parsed.data.resolution);
    if (!item) {
      res.status(404).json({ error: "Open Needs Answer item not found." });
      return;
    }
    res.json({ item });
  } catch (err) {
    req.log.error({ err }, "Failed to resolve Needs Answer item");
    res.status(500).json({ error: "Could not resolve this Needs Answer item." });
  }
});

export default router;
