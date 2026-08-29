import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  DrizzlePackageIntelligenceSettingsRepository,
  PackageIntelligenceSettingsValidationError,
} from "@/features/packages/package-intelligence-settings";
import { PackageSettingsError } from "@/features/packages/package-repository";
import {
  DrizzleResourceIntelligenceSettingsRepository,
} from "@/features/resources/resource-intelligence-settings";
import { ResourceSettingsError } from "@/features/resources/resource-repository";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";
import {
  DrizzleCallScriptSettingsRepository,
  callScriptOverrideInputSchema,
} from "@/features/calls/call-script-settings";
import {
  DrizzleScheduleDisplaySettingsRepository,
  scheduleDisplaySettingsInputSchema,
} from "@/features/calendar/schedule-display-settings";
import businessSourcesRouter from "./business-sources";
import communicationTemplatesRouter from "./communication-templates";
import commercialOffersRouter from "./commercial-offers";
import resourceSourceCandidatesRouter from "./resource-source-candidates";

const router: IRouter = Router();

router.use(businessSourcesRouter);
router.use(communicationTemplatesRouter);
router.use(commercialOffersRouter);
router.use(resourceSourceCandidatesRouter);

router.get("/settings/schedule-display", async (req, res): Promise<void> => {
  try {
    const settings = await new DrizzleScheduleDisplaySettingsRepository(db).get();
    res.json(settings);
  } catch (err) {
    req.log.error({ err }, "Failed to load schedule display settings");
    res.status(500).json({ error: "Failed to load schedule display settings" });
  }
});

router.put("/settings/schedule-display", async (req, res): Promise<void> => {
  const parsed = scheduleDisplaySettingsInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Choose valid calendar colors." });
    return;
  }
  try {
    const actorId = String((req as any).userId ?? "owner");
    const settings = await new DrizzleScheduleDisplaySettingsRepository(db).save(parsed.data, actorId);
    res.json({ ok: true, settings });
  } catch (err) {
    req.log.error({ err }, "Failed to save schedule display settings");
    res.status(500).json({ ok: false, error: "Could not save schedule display settings" });
  }
});

router.get("/settings/packages-resources", async (req, res): Promise<void> => {
  try {
    const [packageTemplates, resources, allTravelLegs] = await Promise.all([
      new DrizzlePackageIntelligenceSettingsRepository(db).listPackageTemplates(),
      new DrizzleResourceIntelligenceSettingsRepository(db).listResources(),
      new DrizzleTravelLegRepository(db).listTravelLegs({ includeArchived: true }),
    ]);
    const travelLegs = allTravelLegs.map((leg) => ({
      id: leg.id,
      name: leg.name,
      archivedAt: leg.archivedAt,
    }));
    res.json({ packageTemplates, resources, travelLegs });
  } catch (err) {
    req.log.error({ err }, "Failed to load settings");
    res.status(500).json({ error: "Failed to load settings" });
  }
});

router.get("/settings/call-scripts", async (req, res): Promise<void> => {
  try {
    const overrides = await new DrizzleCallScriptSettingsRepository(db).listOverrides();
    res.json({ overrides });
  } catch (err) {
    req.log.error({ err }, "Failed to load call script settings");
    res.status(500).json({ error: "Failed to load call scripts" });
  }
});

router.put("/settings/call-scripts/:scriptKind/:nodeId", async (req, res): Promise<void> => {
  const parsed = callScriptOverrideInputSchema.safeParse({
    scriptKind: req.params.scriptKind,
    nodeId: req.params.nodeId,
    sayText: req.body?.sayText,
    coachText: req.body?.coachText ?? null,
  });
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Review this script step." });
    return;
  }

  const actorId = String((req as any).userId ?? "owner");
  try {
    const record = await new DrizzleCallScriptSettingsRepository(db).upsertOverride(parsed.data, actorId);
    res.json({ ok: true, record });
  } catch (err) {
    req.log.error({ err }, "Failed to save call script setting");
    res.status(500).json({ ok: false, error: "Could not save call script" });
  }
});

router.delete("/settings/call-scripts/:scriptKind/:nodeId", async (req, res): Promise<void> => {
  const parsed = callScriptOverrideInputSchema.pick({ scriptKind: true, nodeId: true }).safeParse({
    scriptKind: req.params.scriptKind,
    nodeId: req.params.nodeId,
  });
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: "Unknown call script step." });
    return;
  }

  try {
    await new DrizzleCallScriptSettingsRepository(db).deleteOverride(parsed.data.scriptKind, parsed.data.nodeId);
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to reset call script setting");
    res.status(500).json({ ok: false, error: "Could not reset call script" });
  }
});

router.post("/settings/package-templates", async (req, res): Promise<void> => {
  const actorId = (req as any).userId as string;
  try {
    const record = await new DrizzlePackageIntelligenceSettingsRepository(db)
      .updatePackageTemplate(req.body, actorId);
    res.json({ ok: true, record });
  } catch (err) {
    if (
      err instanceof PackageSettingsError ||
      err instanceof PackageIntelligenceSettingsValidationError
    ) {
      res.status(400).json({ ok: false, error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to update package template");
    res.status(500).json({ ok: false, error: "Could not update package template" });
  }
});

router.post("/settings/resources", async (req, res): Promise<void> => {
  const actorId = (req as any).userId as string;
  try {
    const record = await new DrizzleResourceIntelligenceSettingsRepository(db)
      .upsertResource(req.body, actorId);
    res.json({ ok: true, record });
  } catch (err) {
    if (err instanceof ResourceSettingsError) {
      res.status(400).json({ ok: false, error: err.message });
      return;
    }
    req.log.error({ err }, "Failed to save resource");
    res.status(500).json({ ok: false, error: "Could not save resource" });
  }
});

export default router;
