import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  DEADLINE_KINDS, getProfileDates, getReminderOverview, listRules,
  setRuleEnabled, updateProfileDates,
} from "../features/deadline-reminders/deadline-reminder-service";

const router: IRouter = Router();
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});
const kinds = z.enum(DEADLINE_KINDS);
const dateFields = z.record(kinds, date.nullable());
const offsetFields = z.record(kinds, z.array(z.number().int().min(0).max(365)).max(8));

router.get("/", async (req, res): Promise<void> => {
  try {
    res.json(await getReminderOverview());
  } catch (error) {
    req.log.error({ error }, "Failed to load reminders");
    res.status(500).json({ error: "Reminders could not be loaded." });
  }
});

router.get("/rules", async (req, res): Promise<void> => {
  try {
    res.json({ rules: await listRules(), emailEnabled: process.env.REMINDER_EMAIL_ENABLED === "true" });
  } catch (error) {
    req.log.error({ error }, "Failed to load reminder rules");
    res.status(500).json({ error: "Rules could not be loaded." });
  }
});

router.patch("/rules/:id", async (req, res): Promise<void> => {
  const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
  const id = String(req.params.id);
  if (!parsed.success || !/^[a-z][a-z0-9_]{1,79}$/.test(id)) {
    res.status(400).json({ error: "Choose a valid rule and setting." }); return;
  }
  try {
    if (!await setRuleEnabled(id, parsed.data.enabled)) {
      res.status(404).json({ error: "Rule not found." }); return;
    }
    res.json({ ok: true });
  } catch (error) {
    req.log.error({ error }, "Failed to update reminder rule");
    res.status(500).json({ error: "Rule could not be saved." });
  }
});

router.get("/profiles/:id/dates", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  if (!uuid.safeParse(id).success) { res.status(400).json({ error: "Invalid profile." }); return; }
  try {
    const value = await getProfileDates(id);
    if (!value) { res.status(404).json({ error: "Profile not found." }); return; }
    res.json(value);
  } catch (error) {
    req.log.error({ error }, "Failed to load profile deadlines");
    res.status(500).json({ error: "Profile deadlines could not be loaded." });
  }
});

router.patch("/profiles/:id/dates", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const parsed = z.object({ dates: dateFields, offsets: offsetFields }).strict().safeParse(req.body);
  if (!uuid.safeParse(id).success || !parsed.success) {
    res.status(400).json({ error: "Enter valid dates and reminder offsets." }); return;
  }
  try {
    if (!await updateProfileDates(id, parsed.data.dates, parsed.data.offsets)) {
      res.status(404).json({ error: "Profile not found." }); return;
    }
    res.json({ ok: true });
  } catch (error) {
    req.log.error({ error }, "Failed to update profile deadlines");
    res.status(500).json({ error: "Profile deadlines could not be saved." });
  }
});

export default router;
