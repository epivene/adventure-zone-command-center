import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { ActivityService } from "@/features/activities/activity-service";
import {
  createActivityInputSchema,
  editActivityInputSchema,
} from "@/features/activities/activity-input";

const router: IRouter = Router();
function activityService() { return new ActivityService(new DrizzleActivityRepository(db)); }

router.get("/activities/timeline", async (req, res): Promise<void> => {
  const firstString = (value: unknown): string | undefined => {
    if (Array.isArray(value)) value = value[0];
    return typeof value === "string" && value ? value : undefined;
  };
  const parent = {
    contactId: firstString(req.query.contactId),
    organizationId: firstString(req.query.organizationId),
    bookingId: firstString(req.query.bookingId),
  };
  if (!parent.contactId && !parent.organizationId && !parent.bookingId) {
    res.status(400).json({ ok: false, error: "A contactId, organizationId, or bookingId is required" });
    return;
  }
  const rawPage = Number(firstString(req.query.page) ?? "1");
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  try {
    const timelinePage = await activityService().listTimeline(parent, page);
    res.json({ ok: true, items: timelinePage.items, nextPage: timelinePage.nextPage });
  } catch (err) {
    req.log.error({ err }, "Failed to list timeline page");
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/activities", async (req, res): Promise<void> => {
  const parsed = createActivityInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const result = await activityService().create(parsed.data);
    if (!result.ok) { res.status(400).json({ ok: false, error: "Could not create activity" }); return; }
    res.status(201).json({ ok: true, activity: result.value });
  } catch (err) {
    req.log.error({ err }, "Failed to create activity");
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/activities/edit", async (req, res): Promise<void> => {
  const parsed = editActivityInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const result = await activityService().edit(parsed.data);
    if (!result.ok) { res.status(400).json({ ok: false, error: "Could not edit activity" }); return; }
    res.json({ ok: true, activity: result.value });
  } catch (err) {
    req.log.error({ err }, "Failed to edit activity");
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

router.post("/activities/revisions", async (req, res): Promise<void> => {
  const { activityId } = req.body;
  if (!activityId) { res.status(400).json({ ok: false, error: "activityId required" }); return; }
  try {
    const revisions = await new DrizzleActivityRepository(db).listRevisions?.(activityId) ?? [];
    res.json({ ok: true, revisions });
  } catch (err) {
    req.log.error({ err }, "Failed to list revisions");
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
