import { replayActualOutreach } from "../features/outreach-planner/outreach-events";
import { OutreachError } from "../features/outreach-planner/outreach-repository";
import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { DrizzleCallRepository } from "@/features/calls/call-repository";
import { CallService } from "@/features/calls/call-service";
import { completeCallInputSchema } from "@/features/calls/call-input";
import { isAssistedCallingEnabled } from "@/features/calls/assisted-calling-enabled";
import { readComputerCallingConfig } from "@/features/calls/computer-calling-config";
import { readInboundCallingConfig } from "@/features/calls/inbound-calling-config";
import {
  DrizzleCallWorkspaceContextRepository,
  activityTimelineParent,
} from "@/features/calls/call-workspace-context";
import { DrizzleCallScriptSettingsRepository } from "@/features/calls/call-script-settings";
import { ActivityService } from "@/features/activities/activity-service";
import { DrizzleActivityRepository } from "@/features/activities/activity-repository";
import { loadCallWorkspace } from "@/features/calls/call-workspace-query";
import { createBookingOperationsSummaryProvider } from "@/features/bookings/booking-operations-summary";
import { createContactPhoneRepository } from "@/features/contact-phones/contact-phone-repository";
import { CallerFinderService } from "@/features/caller-finder/caller-finder-service";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import { submitQuickCaller } from "@/features/contacts/quick-caller-service";

const router: IRouter = Router();

function requireAssistedCalling(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isAssistedCallingEnabled()) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

router.get("/calls/config", (_req, res): void => {
  const assistedCallingEnabled = isAssistedCallingEnabled();
  res.json({
    assistedCallingEnabled,
    voicemailLauncherUrl: process.env.VOICEMAIL_LAUNCH_URL || null,
    computerCalling: assistedCallingEnabled
      ? readComputerCallingConfig(process.env).capability
      : { enabled: false, reason: "disabled", callerIdDisplay: null },
    inboundCalling: assistedCallingEnabled
      ? readInboundCallingConfig(process.env).capability
      : {
          enabled: false,
          reason: "disabled",
          inboundNumberDisplay: null,
          retentionDays: 30,
          maxSeconds: 120,
        },
  });
});

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value))
    return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" ? value : undefined;
}

function recentHistorySummary(items: any[]): string | null {
  const snippets = items
    .filter((item) => typeof item?.body === "string" && item.body.trim())
    .slice(0, 3)
    .map((item) => {
      const body = item.body.trim().replace(/\s+/g, " ");
      const clipped = body.length > 180 ? `${body.slice(0, 177)}…` : body;
      const kind =
        typeof item.kind === "string"
          ? item.kind.replaceAll("_", " ")
          : "history";
      return `${kind}: ${clipped}`;
    });
  return snippets.length ? snippets.join(" · ") : null;
}

const callerFinderQuerySchema = z.object({
  phone: z.string().max(40).optional().default(""),
  q: z.string().max(120).optional().default(""),
});

router.get(
  "/calls/caller-finder",
  requireAssistedCalling,
  async (req, res): Promise<void> => {
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
      if (err instanceof OutreachError) {
        res.status(err.status).json({ ok: false, error: err.message });
        return;
      }
      req.log.error({ err }, "Failed to find caller");
      res.status(500).json({ error: "Failed to find caller" });
    }
  },
);

router.post(
  "/calls/quick-caller",
  requireAssistedCalling,
  async (req, res): Promise<void> => {
    try {
      const result = await submitQuickCaller(
        req.body,
        new DrizzleContactRepository(db),
      );
      if (!result.ok && "error" in result) {
        res.status(400).json(result);
        return;
      }
      res.status(result.ok ? 201 : 200).json(result);
    } catch (err) {
      if (err instanceof OutreachError) {
        res.status(err.status).json({ ok: false, error: err.message });
        return;
      }
      req.log.error({ err }, "Failed to create quick caller");
      res.status(500).json({ ok: false, error: "Could not create caller" });
    }
  },
);

router.get(
  "/calls/workspace",
  requireAssistedCalling,
  async (req, res): Promise<void> => {
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
      const [timelinePage, guidedScriptOverrides] = await Promise.all([
        new ActivityService(new DrizzleActivityRepository(db)).listTimeline(
          activityParent,
        ),
        new DrizzleCallScriptSettingsRepository(db).listOverrides(),
      ]);
      const briefing = {
        ...result.value.briefing,
        historySummary: recentHistorySummary(timelinePage.items),
      };
      res.json({
        ...result.value,
        briefing,
        activityParent,
        timeline: timelinePage.items,
        timelineNextPage: timelinePage.nextPage,
        guidedScriptOverrides,
      });
    } catch (err) {
      if (err instanceof OutreachError) {
        res.status(err.status).json({ ok: false, error: err.message });
        return;
      }
      req.log.error({ err }, "Failed to load call workspace");
      res.status(500).json({ error: "Failed to load call workspace" });
    }
  },
);

router.post(
  "/calls/complete",
  requireAssistedCalling,
  async (req, res): Promise<void> => {
    const parsed = completeCallInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({
          ok: false,
          error: parsed.error.issues[0]?.message ?? "Invalid input",
        });
      return;
    }
    try {
      const result = await new CallService(new DrizzleCallRepository(db), {
        outreachEvents: { replay: () => replayActualOutreach(db) },
      }).complete(parsed.data);
      if (!result.ok) {
        const error =
          result.error.code === "NEXT_ACTION_REQUIRED"
            ? "Choose a next action and a future date before saving this call."
            : result.error.code === "INVALID_CALL_INPUT"
              ? result.error.message
              : result.error.code === "ALREADY_COMPLETED"
                ? "This call was already completed."
                : "Could not complete call";
        res.status(400).json({ ok: false, error });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof OutreachError) {
        res.status(err.status).json({ ok: false, error: err.message });
        return;
      }
      req.log.error({ err }, "Failed to complete call");
      res.status(500).json({ ok: false, error: "Server error" });
    }
  },
);

export default router;
