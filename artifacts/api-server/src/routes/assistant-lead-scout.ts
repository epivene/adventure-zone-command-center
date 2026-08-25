import { Router, type IRouter } from "express";
import { z } from "zod";

import { LeadScoutService } from "@/features/assistant/lead-scout-service";
import {
  RadiusLeadScoutService,
  type RadiusScoutRequest,
} from "@/features/assistant/lead-scout-radius";
import { isResearchProspectValidationError } from "@/features/profile-research/research-prospect-intake";

const createSchema = z.object({ question: z.string().trim().min(1).max(4000) }).strict();
const uuidSchema = z.uuid().transform((value) => value.toLowerCase());
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid YYYY-MM-DD date.");
const scoutCategorySchema = z.enum([
  "fair",
  "festival",
  "rodeo",
  "powwow",
  "community_celebration",
  "car_show",
  "expo_show",
  "parade",
  "other_family_community",
]);
const radiusScoutSchema = z.object({
  anchor: z.object({
    kind: z.enum(["booking", "event_family", "manual", "candidate"]),
    recordId: z.string().trim().min(1).max(200).optional(),
    label: z.string().trim().min(1).max(300),
    city: z.string().trim().min(1).max(160).optional(),
    region: z.string().trim().regex(/^[A-Za-z]{2}$/).optional(),
    address: z.string().trim().min(1).max(500).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  }).strict().refine((anchor) => {
    if (anchor.kind !== "manual") return Boolean(anchor.recordId || anchor.city || anchor.address || anchor.label);
    return Boolean(anchor.city || anchor.address || anchor.label);
  }, "Choose a valid event or location."),
  radiusMiles: z.union([z.literal(25), z.literal(50), z.literal(100), z.literal(150), z.literal(200), z.literal(300)]),
  dateStart: dateOnlySchema,
  dateEnd: dateOnlySchema,
  categories: z.array(scoutCategorySchema).min(1),
  historyFilter: z.enum(["all", "hide_booked", "hide_booked_and_dismissed"]),
}).strict().refine((value) => value.dateEnd >= value.dateStart, {
  message: "End date must be on or after start date.",
  path: ["dateEnd"],
});
const saveCandidateSchema = z.object({
  accepted: z.object({
    name: z.string().trim().min(1).max(300),
    city: z.string().trim().min(1).max(160),
    region: z.string().trim().regex(/^[A-Za-z]{2}$/),
    startsAt: z.string().trim().nullable(),
    endsAt: z.string().trim().nullable(),
    website: z.string().trim().min(1).max(2000),
    contactName: z.string().trim().max(240).nullable().optional(),
    contactEmail: z.string().trim().email().max(320).nullable().optional(),
    contactPhone: z.string().trim().max(80).nullable().optional(),
  }).strict(),
  nextActionKind: z.enum(["call", "email", "prepare_quote"]),
  nextActionDueAt: z.string().trim().min(1).max(40),
}).strict();

type LeadScoutRouteService = Pick<
  LeadScoutService,
  "createCrmDiscovery" | "getRun" | "getLatestRun" | "startWeb" | "stopWeb" | "continueWeb" | "deepenCandidate" | "dismissCandidate" | "saveCandidate"
>;
type RadiusScoutRouteService = Pick<RadiusLeadScoutService, "create">;

function actorId(req: any) {
  return String(req.userId ?? "");
}

function sendError(req: any, res: any, error: unknown) {
  if (error instanceof Error && error.message === "SCOUT_ANCHOR_NOT_RESOLVED") {
    res.status(400).json({ error: "Choose a valid event or location." });
    return;
  }
  if (error instanceof Error && error.message === "LEAD_SCOUT_RUN_NOT_FOUND") {
    res.status(404).json({ error: "Lead Scout run not found." });
    return;
  }
  if (error instanceof Error && error.message === "LEAD_SCOUT_INVALID_STATE") {
    res.status(409).json({ error: "That Lead Scout action is not available in the run's current state." });
    return;
  }
  if (error instanceof Error && error.message === "LEAD_SCOUT_CANDIDATE_NOT_DEEPENABLE") {
    res.status(409).json({ error: "That prospect cannot be researched deeper in its current state." });
    return;
  }
  if (error instanceof Error && error.message === "LEAD_SCOUT_CANDIDATE_NOT_DISMISSIBLE") {
    res.status(409).json({ error: "Stop the active Scout before marking this prospect Not a fit." });
    return;
  }
  if (error instanceof Error && error.message === "LEAD_SCOUT_CANDIDATE_NOT_SAVEABLE") {
    res.status(409).json({ error: "This prospect cannot be saved as a new lead in its current state." });
    return;
  }
  if (isResearchProspectValidationError(error)) {
    res.status(400).json({ error: "Review the accepted prospect details and first follow-up." });
    return;
  }
  if (error instanceof Error && error.message === "LEAD_SCOUT_SAVE_LINK_FAILED") {
    req.log?.error?.({ err: error }, "Lead Scout lead was created but candidate linkage failed");
    res.status(500).json({ error: "The lead was created, but the Scout result could not be linked. Reopen the search before retrying." });
    return;
  }
  req.log?.error?.({ err: error }, "Lead Scout route failed");
  res.status(500).json({ error: "Lead Scout could not complete that request." });
}

export function createAssistantLeadScoutRouter(
  service: LeadScoutRouteService = new LeadScoutService(),
  radiusService: RadiusScoutRouteService = new RadiusLeadScoutService(),
): IRouter {
  const router: IRouter = Router();

  router.post("/assistant/lead-scout/runs", async (req, res): Promise<void> => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the Lead Scout request." });
      return;
    }
    try {
      const result = await service.createCrmDiscovery({ actorId: actorId(req), question: parsed.data.question });
      if ("kind" in result && result.kind === "needs_clarification") {
        res.json(result);
        return;
      }
      res.json({ run: result });
    } catch (error) {
      sendError(req, res, error);
    }
  });

  router.post("/assistant/lead-scout/radius", async (req, res): Promise<void> => {
    const parsed = radiusScoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the Radius Scout request." });
      return;
    }
    try {
      const run = await radiusService.create({
        actorId: actorId(req),
        request: parsed.data as RadiusScoutRequest,
      });
      res.status(201).json({ run });
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

  function parseRun(req: any, res: any) {
    const parsed = uuidSchema.safeParse(req.params.runId);
    if (!parsed.success) {
      res.status(400).json({ error: "Review the Lead Scout run id." });
      return null;
    }
    return { actorId: actorId(req), runId: parsed.data };
  }

  function parseCandidate(req: any, res: any) {
    const parsed = uuidSchema.safeParse(req.params.candidateId);
    if (!parsed.success) {
      res.status(400).json({ error: "Review the Lead Scout prospect id." });
      return null;
    }
    return parsed.data;
  }

  router.post("/assistant/lead-scout/runs/:runId/start", async (req, res): Promise<void> => {
    const input = parseRun(req, res); if (!input) return;
    try { res.json({ run: await service.startWeb(input) }); } catch (error) { sendError(req, res, error); }
  });

  router.post("/assistant/lead-scout/runs/:runId/stop", async (req, res): Promise<void> => {
    const input = parseRun(req, res); if (!input) return;
    try { res.json({ run: await service.stopWeb(input) }); } catch (error) { sendError(req, res, error); }
  });

  router.post("/assistant/lead-scout/runs/:runId/continue", async (req, res): Promise<void> => {
    const input = parseRun(req, res); if (!input) return;
    try { res.json({ run: await service.continueWeb(input) }); } catch (error) { sendError(req, res, error); }
  });

  router.post("/assistant/lead-scout/runs/:runId/candidates/:candidateId/deepen", async (req, res): Promise<void> => {
    const input = parseRun(req, res); if (!input) return;
    const candidateId = parseCandidate(req, res); if (!candidateId) return;
    try {
      res.json({ run: await service.deepenCandidate({ ...input, candidateId }) });
    } catch (error) {
      sendError(req, res, error);
    }
  });

  router.post("/assistant/lead-scout/runs/:runId/candidates/:candidateId/dismiss", async (req, res): Promise<void> => {
    const input = parseRun(req, res); if (!input) return;
    const candidateId = parseCandidate(req, res); if (!candidateId) return;
    try {
      res.json({ run: await service.dismissCandidate({ ...input, candidateId }) });
    } catch (error) {
      sendError(req, res, error);
    }
  });

  router.post("/assistant/lead-scout/runs/:runId/candidates/:candidateId/save", async (req, res): Promise<void> => {
    const input = parseRun(req, res); if (!input) return;
    const candidateId = parseCandidate(req, res); if (!candidateId) return;
    const parsed = saveCandidateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review the accepted prospect details." });
      return;
    }
    try {
      const result = await service.saveCandidate({ ...input, candidateId, ...parsed.data });
      res.status(result.kind === "created" ? 201 : 200).json(result);
    } catch (error) {
      sendError(req, res, error);
    }
  });

  router.get("/assistant/lead-scout/runs/:runId", async (req, res): Promise<void> => {
    const parsed = uuidSchema.safeParse(req.params.runId);
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