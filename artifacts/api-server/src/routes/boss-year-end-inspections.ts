import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { db } from "@workspace/db";

import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import { YearEndInspectionService } from "@/features/year-end-inspections/inspection-service";
import { YearEndInspectionPhotoService } from "@/features/year-end-inspections/photo-service";
import { GoogleCloudLegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function createBossYearEndInspectionsRouter(dependencies: {
  requireBoss: RequestHandler;
  service: YearEndInspectionService;
  photoService?: YearEndInspectionPhotoService;
}) {
  const router = Router();
  const { requireBoss, service, photoService } = dependencies;
  const withPhotos = async (inspection: Awaited<ReturnType<YearEndInspectionService["get"]>>) => inspection && photoService ? {
    ...inspection,
    entries: await Promise.all(inspection.entries.map(async (entry) => ({
      ...entry,
      photos: (await photoService.listWithSignedUrls(entry.id, inspection.legId)).filter((photo) => Boolean(photo.imageUrl)).map(({ imageUrl, ...photo }) => ({ ...photo, signedUrl: imageUrl! })),
    }))),
  } : inspection;
  router.get("/boss/year-end-inspections", requireBoss, async (_req, res) => {
    res.json({ inspections: await service.list() });
  });
  router.get("/boss/year-end-inspections/:inspectionId", requireBoss, async (req, res) => {
    const inspection = await service.get(param(req.params.inspectionId));
    if (!inspection) { res.status(404).json({ error: "Inspection not found." }); return; }
    res.json({ inspection: await withPhotos(inspection) });
  });
  router.post("/boss/year-end-inspections/:inspectionId/reopen", requireBoss, async (req, res) => {
    res.json({ inspection: await service.reopen(param(req.params.inspectionId), "boss") });
  });
  router.post("/boss/year-end-inspection-maintenance/:itemId/resolve", requireBoss, async (req, res) => {
    const parsed = z.object({ resolutionNotes: z.string().trim().min(1).max(12000) }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Resolution notes are required." }); return; }
    await service.resolveMaintenanceItem(param(req.params.itemId), parsed.data, "boss");
    res.json({ ok: true });
  });
  return router;
}

export default createBossYearEndInspectionsRouter({
  requireBoss: createRequireBossMiddleware(new DrizzleBossAccountRepository(db)),
  service: new YearEndInspectionService(db),
  photoService: new YearEndInspectionPhotoService(db, new GoogleCloudLegManagerObjectStorage()),
});
