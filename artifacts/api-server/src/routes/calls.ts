import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleCallRepository } from "@/features/calls/call-repository";
import { CallService } from "@/features/calls/call-service";
import { completeCallInputSchema } from "@/features/calls/call-input";
import {
  DrizzleCallWorkspaceContextRepository,
  activityTimelineParent,
} from "@/features/calls/call-workspace-context";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { loadCallWorkspace } from "@/features/calls/call-workspace-query";
import { createBookingOperationsSummaryProvider } from "@/features/bookings/booking-operations-summary";
import { createContactPhoneRepository } from "@/features/contact-phones/contact-phone-repository";
import { CallerFinderService } from "@/features/caller-finder/caller-finder-service";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";

const router: IRouter = Router();

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" ? value : undefined;
}

const callerFinderQuerySchema = z.object({
  phone: z.string().max(40).optional().default(""),
  q: z.string().max(120).optional().default(""),
});

router.get("/calls/caller-finder", async (req, res): Promise<void> => {
  const parsed = callerFinderQuerySchema.safeParse({
    phone: firstString(req.query.phone),
    q: firstString(req.query.q),
  });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid caller finder query" });
    return;
  }

  try {
    const result = await new CallerFinderService(
      new DrizzleContactRepository(db),
    ).find({
      phone: parsed.data.phone,
      query: parsed.data.q,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to find caller");
    res.status(500).json({ error: "Failed to find caller" });
  }
});

router.get("/calls/workspace", async (req, res): Promise<void> => {
  try {
    const result = await loadCallWorkspace(
      {
        followUpId: firstString(req.query.followUpId),
        bookingId: firstString(req.query.bookingId),
        contactId: firstString(req.query.contactId),
        organizationId: firstString(req.query.organizationId),
      } as any,
      new DrizzleCallWorkspaceContextRepository(db),
      createContactPhoneRepository(db),
      createBookingOperationsSummaryProvider(db),
    );
    if (!result.ok) {
      res.status(404).json({ error: "Call workspace not found" });
      return;
    }
    const activityParent = activityTimelineParent(result.value.context);
    const timeline = await new ActivityService(new DrizzleActivityRepository(db)).listTimeline(activityParent);
    res.json({ ...result.value, activityParent, timeline });
  } catch (err) {
    req.log.error({ err }, "Failed to load call workspace");
    res.status(500).json({ error: "Failed to load call workspace" });
  }
});

router.post("/calls/complete", async (req, res): Promise<void> => {
  const parsed = completeCallInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  try {
    const result = await new CallService(new DrizzleCallRepository(db)).complete(parsed.data);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: "Could not complete call" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to complete call");
    res.status(500).json({ ok: false, error: "Server error" });
  }
});

export default router;
