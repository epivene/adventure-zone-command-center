import express, { Router, type RequestHandler } from "express";
import { z } from "zod";
import { db } from "@workspace/db";

import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { GoogleCloudLegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";
import { YearEndInspectionService } from "@/features/year-end-inspections/inspection-service";
import { YearEndInspectionPhotoService } from "@/features/year-end-inspections/photo-service";
import { photoPatchSchema } from "@/features/year-end-inspections/photo-input";

const uuid = z.string().uuid();
const startSchema = z.object({
  year: z.number().int().min(2000).max(2200),
  source: z.enum(["blank", "current_pieces", "prior_year"]),
  sourceInspectionId: uuid.optional(),
  clientMutationId: uuid,
}).strict();
const entryPatchSchema = z.object({
  pieceCodeSnapshot: z.string().trim().min(1).max(80).optional(),
  pieceNameSnapshot: z.string().trim().min(1).max(200).optional(),
  entryState: z.enum(["not_started", "inspected", "not_present"]).optional(),
  condition: z.enum(["good", "needs_cleaning", "minor_repair", "major_repair", "replace", "retired"]).nullable().optional(),
  inspectionNotes: z.string().max(12000).nullable().optional(),
  repairNeeded: z.boolean().optional(),
  repairNotes: z.string().max(12000).nullable().optional(),
  retainForFutureUse: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "No inspection changes provided");
const photoMetadataSchema = z.object({
  id: uuid,
  clientMutationId: uuid,
  entryId: uuid,
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  description: z.string().max(4000).nullable().default(null),
  annotations: z.object({ version: z.literal(1), ellipses: z.array(z.any()).max(50) }),
}).strict();
const discoveredPieceSchema = z.object({
  pieceId: uuid,
  entryId: uuid,
  clientMutationId: uuid,
  code: z.string().trim().min(1).max(80).nullable().default(null),
  name: z.string().trim().min(1).max(200).nullable().default(null),
  identityNotes: z.string().trim().max(12000).nullable().default(null),
  resourceId: uuid.nullable().default(null),
}).strict();

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

type InspectionService = YearEndInspectionService;
type PhotoService = YearEndInspectionPhotoService;

export function createManagerYearEndInspectionsRouter(dependencies: {
  requireManager: RequestHandler;
  service: InspectionService;
  photoService: PhotoService;
}) {
  const router = Router();
  const { requireManager, service, photoService } = dependencies;
  const withPhotos = async (inspection: Awaited<ReturnType<InspectionService["get"]>>) => inspection ? {
    ...inspection,
    entries: await Promise.all(inspection.entries.map(async (entry) => ({
      ...entry,
      photos: (await photoService.listWithSignedUrls(entry.id, inspection.legId))
        .filter((photo) => Boolean(photo.imageUrl))
        .map(({ imageUrl, ...photo }) => ({ ...photo, signedUrl: imageUrl! })),
    }))),
  } : inspection;

  router.get("/manager/year-end-inspections", requireManager, async (req, res) => {
    const year = Number(req.query.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) { res.status(400).json({ error: "Choose a valid inspection year." }); return; }
    res.json({ inspection: await withPhotos(await service.getForLegYear(req.legManager!.legId, year)) });
  });

  router.get("/manager/year-end-inspections/resources", requireManager, async (req, res) => {
    res.json({ resources: await service.listResourcesForLeg(req.legManager!.legId) });
  });

  router.get("/manager/year-end-inspections/:inspectionId", requireManager, async (req, res) => {
    const inspection = await service.get(param(req.params.inspectionId));
    if (!inspection || inspection.legId !== req.legManager!.legId) { res.status(404).json({ error: "Inspection not found." }); return; }
    res.json({ inspection: await withPhotos(inspection) });
  });

  router.post("/manager/year-end-inspections", requireManager, async (req, res) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review this inspection." }); return; }
    const existing = await service.findByMutation(parsed.data.clientMutationId);
    if (existing) { res.json({ inspection: existing }); return; }
    const actorId = `manager:${req.legManager!.managerName ?? req.legManager!.legId}`;
    const base = { legId: req.legManager!.legId, year: parsed.data.year, clientMutationId: parsed.data.clientMutationId, actorId };
    const inspection = parsed.data.source === "blank"
      ? await service.startBlank(base)
      : parsed.data.source === "prior_year"
        ? await service.copyPriorYear({ ...base, sourceInspectionId: parsed.data.sourceInspectionId ?? "" })
        : await service.startForCurrentPieces(base);
    res.status(201).json({ inspection });
  });

  router.patch("/manager/year-end-inspections/:inspectionId/entries/:entryId", requireManager, async (req, res) => {
    const parsed = entryPatchSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review this piece inspection." }); return; }
    const entry = await service.patchEntryForLeg(
      param(req.params.inspectionId),
      param(req.params.entryId),
      req.legManager!.legId,
      parsed.data,
      `manager:${req.legManager!.managerName ?? req.legManager!.legId}`,
    );
    if (!entry) { res.status(404).json({ error: "Inspection entry not found." }); return; }
    res.json({ entry });
  });

  router.post("/manager/year-end-inspections/:inspectionId/pieces", requireManager, async (req, res) => {
    const parsed = z.object({ pieceId: uuid }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Choose a valid piece." }); return; }
    const inspectionId = param(req.params.inspectionId);
    const inspection = await service.get(inspectionId);
    if (!inspection || inspection.legId !== req.legManager!.legId) { res.status(404).json({ error: "Inspection not found." }); return; }
    res.json({ inspection: await service.addPieceToInspection(inspectionId, parsed.data.pieceId) });
  });

  router.post("/manager/year-end-inspections/:inspectionId/discovered-pieces", requireManager, async (req, res) => {
    const parsed = discoveredPieceSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review this piece." }); return; }
    try {
      const inspection = await service.createDiscoveredPieceForLeg(
        param(req.params.inspectionId),
        req.legManager!.legId,
        parsed.data,
        `manager:${req.legManager!.managerName ?? req.legManager!.legId}`,
      );
      res.status(201).json({ inspection });
    } catch (error) {
      if (error instanceof Error && ["INSPECTION_NOT_FOUND", "PIECE_OUTSIDE_LEG"].includes(error.message)) {
        res.status(404).json({ error: "Inspection or piece not found." }); return;
      }
      if (error instanceof Error && ["PIECE_RESOURCE_UNAVAILABLE", "PIECE_RESOURCE_OUTSIDE_LEG"].includes(error.message)) {
        res.status(400).json({ error: "Choose an attraction assigned to this leg." }); return;
      }
      if (error && typeof error === "object" && "code" in error && error.code === "inspection_completed") {
        res.status(409).json({ error: error instanceof Error ? error.message : "Inspection is completed." }); return;
      }
      throw error;
    }
  });

  router.delete("/manager/year-end-inspections/:inspectionId/discovered-pieces/:entryId", requireManager, async (req, res) => {
    const inspectionId = param(req.params.inspectionId);
    const entryId = param(req.params.entryId);
    const legId = req.legManager!.legId;
    const actorId = `manager:${req.legManager!.managerName ?? legId}`;
    if (!await service.canRemoveDiscoveredPieceForLeg(inspectionId, entryId, legId, actorId)) {
      res.status(409).json({ error: "Only a piece discovered during this inspection can be removed." });
      return;
    }
    const { deletedPhotos } = await photoService.deleteForEntry(entryId, legId);
    const inspection = await service.removeDiscoveredPieceForLeg(inspectionId, entryId, legId, actorId);
    res.json({ inspection, deletedPhotos });
  });

  router.post("/manager/year-end-inspections/:inspectionId/complete", requireManager, async (req, res) => {
    const id = param(req.params.inspectionId);
    const inspection = await service.get(id);
    if (!inspection || inspection.legId !== req.legManager!.legId) { res.status(404).json({ error: "Inspection not found." }); return; }
    try {
      res.json({ inspection: await service.complete(id, `manager:${req.legManager!.managerName ?? req.legManager!.legId}`) });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "inspection_incomplete") {
        res.status(409).json({ error: error instanceof Error ? error.message : "Inspection is incomplete." }); return;
      }
      throw error;
    }
  });

  router.post("/manager/year-end-inspections/:inspectionId/photos", requireManager, async (req, res) => {
    const parsed = photoMetadataSchema.safeParse(req.body);
    const inspectionId = param(req.params.inspectionId);
    if (!parsed.success) { res.status(400).json({ error: "Review the photo details." }); return; }
    const inspection = await service.get(inspectionId);
    if (!inspection || inspection.legId !== req.legManager!.legId || !inspection.entries.some((entry) => entry.id === parsed.data.entryId)) {
      res.status(404).json({ error: "Inspection entry not found." }); return;
    }
    const photo = await photoService.createMetadata({ ...parsed.data, inspectionId, legId: req.legManager!.legId });
    res.status(201).json({ photo });
  });

  router.put(
    "/manager/year-end-inspections/:inspectionId/photos/:photoId/image",
    requireManager,
    express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "15mb" }),
    async (req, res) => {
      await photoService.putImage(
        param(req.params.photoId),
        req.legManager!.legId,
        new Uint8Array(req.body),
        req.headers["content-type"] ?? "",
      );
      res.json({ ok: true });
    },
  );

  router.patch("/manager/year-end-inspections/:inspectionId/photos/:photoId", requireManager, async (req, res) => {
    const parsed = photoPatchSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Review the photo details." }); return; }
    const inspection = await service.get(param(req.params.inspectionId));
    if (!inspection || inspection.legId !== req.legManager!.legId) { res.status(404).json({ error: "Inspection not found." }); return; }
    res.json({ photo: await photoService.patchDescriptionAndAnnotations(param(req.params.photoId), req.legManager!.legId, parsed.data) });
  });

  router.delete("/manager/year-end-inspections/:inspectionId/photos/:photoId", requireManager, async (req, res) => {
    const inspection = await service.get(param(req.params.inspectionId));
    if (!inspection || inspection.legId !== req.legManager!.legId) { res.status(404).json({ error: "Inspection not found." }); return; }
    if (!await photoService.deletePhoto(param(req.params.photoId), req.legManager!.legId)) { res.status(404).json({ error: "Photo not found." }); return; }
    res.json({ ok: true });
  });

  return router;
}

const service = new YearEndInspectionService(db);
const photoService = new YearEndInspectionPhotoService(db, new GoogleCloudLegManagerObjectStorage());
export default createManagerYearEndInspectionsRouter({
  requireManager: createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db)),
  service,
  photoService,
});
