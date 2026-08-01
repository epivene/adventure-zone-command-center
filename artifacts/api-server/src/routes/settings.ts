import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  DrizzlePackageSettingsRepository,
  PackageSettingsError,
} from "@/features/packages/package-repository";
import {
  DrizzleResourceSettingsRepository,
  ResourceSettingsError,
} from "@/features/resources/resource-repository";
import { DrizzleTravelLegRepository } from "@/features/routes/travel-leg-repository";

const router: IRouter = Router();

router.get("/settings/packages-resources", async (req, res): Promise<void> => {
  try {
    const [packageTemplates, resources, allTravelLegs] = await Promise.all([
      new DrizzlePackageSettingsRepository(db).listPackageTemplates(),
      new DrizzleResourceSettingsRepository(db).listResources(),
      new DrizzleTravelLegRepository(db).listTravelLegs({ includeArchived: true }),
    ]);
    // ResourceInventoryEditor expects ResourceTravelLegOption shape
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

router.post("/settings/package-templates", async (req, res): Promise<void> => {
  const actorId = (req as any).userId as string;
  try {
    const record = await new DrizzlePackageSettingsRepository(db).updatePackageTemplate(
      req.body,
      actorId,
    );
    res.json({ ok: true, record });
  } catch (err) {
    if (err instanceof PackageSettingsError) {
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
    const record = await new DrizzleResourceSettingsRepository(db).upsertResource(
      req.body,
      actorId,
    );
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
