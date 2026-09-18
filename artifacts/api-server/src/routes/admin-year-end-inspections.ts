import express, { Router, type RequestHandler } from "express";
import { z } from "zod";
import { db } from "@workspace/db";

import { pieceInputSchema, piecePatchSchema } from "@/features/year-end-inspections/piece-input";
import { DrizzlePieceRepository } from "@/features/year-end-inspections/piece-repository";
import { YearEndInspectionService } from "@/features/year-end-inspections/inspection-service";
import { YearEndInspectionPhotoService } from "@/features/year-end-inspections/photo-service";
import { annotationDocumentSchema, photoPatchSchema } from "@/features/year-end-inspections/photo-input";
import { GoogleCloudLegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";
import { requireOwnerMiddleware } from "@/lib/auth";

const uuid = z.string().uuid();
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
  annotations: annotationDocumentSchema,
}).strict();
function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function createAdminYearEndInspectionsRouter(dependencies: {
  pieces: DrizzlePieceRepository;
  service: YearEndInspectionService;
  photoService?: YearEndInspectionPhotoService;
  requireOwner?: RequestHandler;
}) {
  const router = Router();
  const { pieces, service, photoService, requireOwner = requireOwnerMiddleware } = dependencies;
  router.use(requireOwner);
  router.get("/manager-admin/equipment-pieces", async (req, res) => {
    res.json({ pieces: await pieces.list({
      legId: typeof req.query.legId === "string" ? req.query.legId : undefined,
      includeArchived: req.query.includeArchived === "true",
    }) });
  });
  router.post("/manager-admin/equipment-pieces", async (req, res) => {
    const parsed = pieceInputSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review this piece." }); return; }
    res.status(201).json({ piece: await pieces.create(parsed.data, "owner") });
  });
  router.patch("/manager-admin/equipment-pieces/:pieceId", async (req, res) => {
    const parsed = piecePatchSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review this piece." }); return; }
    const piece = await pieces.update(param(req.params.pieceId), parsed.data, "owner");
    if (!piece) { res.status(404).json({ error: "Piece not found." }); return; }
    res.json({ piece });
  });
  router.post("/manager-admin/equipment-pieces/:pieceId/transfer", async (req, res) => {
    const parsed = z.object({ legId: uuid }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Choose a valid leg." }); return; }
    const piece = await pieces.transferLeg(param(req.params.pieceId), parsed.data.legId, "owner");
    if (!piece) { res.status(404).json({ error: "Piece not found." }); return; }
    res.json({ piece });
  });
  router.post("/manager-admin/equipment-pieces/:pieceId/regroup", async (req, res) => {
    const parsed = z.object({ resourceId: uuid.nullable(), reason: z.string().max(1000).nullable().default(null) }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Review the attraction assignment." }); return; }
    const piece = parsed.data.resourceId
      ? await pieces.assignToResource(param(req.params.pieceId), parsed.data.resourceId, "owner", parsed.data.reason)
      : await pieces.clearResourceAssignment(param(req.params.pieceId), "owner", parsed.data.reason);
    if (!piece) { res.status(404).json({ error: "Piece not found." }); return; }
    res.json({ piece });
  });
  router.post("/manager-admin/equipment-pieces/:pieceId/archive", async (req, res) => {
    const piece = await pieces.archive(param(req.params.pieceId), "owner");
    if (!piece) { res.status(404).json({ error: "Piece not found." }); return; }
    res.json({ piece });
  });
  router.post("/manager-admin/equipment-pieces/:pieceId/restore", async (req, res) => {
    const piece = await pieces.restore(param(req.params.pieceId), "owner");
    if (!piece) { res.status(404).json({ error: "Piece not found." }); return; }
    res.json({ piece });
  });
  router.get("/manager-admin/year-end-inspections", async (_req, res) => res.json({ inspections: await service.list() }));
  router.get("/manager-admin/year-end-inspections/:inspectionId", async (req, res) => {
    const inspection = await service.get(param(req.params.inspectionId));
    if (!inspection) { res.status(404).json({ error: "Inspection not found." }); return; }
    const entries = photoService ? await Promise.all(inspection.entries.map(async (entry) => ({
      ...entry,
      photos: (await photoService.listWithSignedUrls(entry.id, inspection.legId)).filter((photo) => Boolean(photo.imageUrl)).map(({ imageUrl, ...photo }) => ({ ...photo, signedUrl: imageUrl! })),
    }))) : inspection.entries;
    res.json({ inspection: { ...inspection, entries } });
  });
  router.patch("/manager-admin/year-end-inspections/:inspectionId/entries/:entryId", async (req, res) => {
    const parsed = entryPatchSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Review this attraction inspection." }); return; }
    try {
      const entry = await service.patchEntryForAdmin(
        param(req.params.inspectionId),
        param(req.params.entryId),
        parsed.data,
        "owner",
      );
      if (!entry) { res.status(404).json({ error: "Inspection entry not found." }); return; }
      res.json({ entry });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        res.status(409).json({ error: "That attraction code is already in use." }); return;
      }
      throw error;
    }
  });
  router.post("/manager-admin/year-end-inspections/:inspectionId/photos", async (req, res) => {
    if (!photoService) { res.status(503).json({ error: "Photo storage is unavailable." }); return; }
    const parsed = photoMetadataSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Review the photo details." }); return; }
    const inspectionId = param(req.params.inspectionId);
    const inspection = await service.get(inspectionId);
    if (!inspection || !inspection.entries.some((entry) => entry.id === parsed.data.entryId)) {
      res.status(404).json({ error: "Inspection entry not found." }); return;
    }
    const photo = await photoService.createMetadata({ ...parsed.data, inspectionId, legId: inspection.legId });
    res.status(201).json({ photo });
  });
  router.put(
    "/manager-admin/year-end-inspections/:inspectionId/photos/:photoId/image",
    express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "15mb" }),
    async (req, res) => {
      if (!photoService) { res.status(503).json({ error: "Photo storage is unavailable." }); return; }
      const inspection = await service.get(param(req.params.inspectionId));
      if (!inspection) { res.status(404).json({ error: "Inspection not found." }); return; }
      try {
        await photoService.putImage(
          param(req.params.photoId),
          inspection.legId,
          new Uint8Array(req.body),
          req.headers["content-type"] ?? "",
        );
        res.json({ ok: true });
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "PHOTO_NOT_FOUND") { res.status(404).json({ error: "Photo not found." }); return; }
        if (code === "PHOTO_TOO_LARGE") { res.status(413).json({ error: "Photo must be 15 MB or smaller." }); return; }
        if (["PHOTO_TYPE_UNSUPPORTED", "PHOTO_TYPE_MISMATCH"].includes(code)) {
          res.status(400).json({ error: "Photo must be a JPEG, PNG, or WebP image." }); return;
        }
        throw error;
      }
    },
  );
  router.patch("/manager-admin/year-end-inspections/:inspectionId/photos/:photoId", async (req, res) => {
    if (!photoService) { res.status(503).json({ error: "Photo storage is unavailable." }); return; }
    const parsed = photoPatchSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Review the photo details." }); return; }
    const inspection = await service.get(param(req.params.inspectionId));
    if (!inspection) { res.status(404).json({ error: "Inspection not found." }); return; }
    try {
      res.json({ photo: await photoService.patchDescriptionAndAnnotations(param(req.params.photoId), inspection.legId, parsed.data) });
    } catch (error) {
      if (error instanceof Error && error.message === "PHOTO_NOT_FOUND") {
        res.status(404).json({ error: "Photo not found." }); return;
      }
      throw error;
    }
  });
  router.delete("/manager-admin/year-end-inspections/:inspectionId/photos/:photoId", async (req, res) => {
    if (!photoService) { res.status(503).json({ error: "Photo storage is unavailable." }); return; }
    const inspection = await service.get(param(req.params.inspectionId));
    if (!inspection) { res.status(404).json({ error: "Inspection not found." }); return; }
    if (!await photoService.deletePhoto(param(req.params.photoId), inspection.legId)) {
      res.status(404).json({ error: "Photo not found." }); return;
    }
    res.json({ ok: true });
  });
  router.post("/manager-admin/year-end-inspections/:inspectionId/reopen", async (req, res) => {
    res.json({ inspection: await service.reopen(param(req.params.inspectionId), "owner") });
  });
  router.post("/manager-admin/year-end-inspections/:inspectionId/reset", async (req, res) => {
    const parsed = z.object({ deleteDiscoveredPieces: z.literal(true) }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Confirm the full inspection reset." }); return; }
    if (!photoService) { res.status(503).json({ error: "Photo cleanup is unavailable." }); return; }
    const inspectionId = param(req.params.inspectionId);
    if (!await service.get(inspectionId)) { res.status(404).json({ error: "Inspection not found." }); return; }
    const photos = await photoService.deleteForInspection(inspectionId);
    const reset = await service.resetForAdmin(inspectionId, { deleteDiscoveredPieces: true, actorId: "owner" });
    res.json({ ok: true, ...photos, ...reset });
  });
  router.post("/manager-admin/year-end-inspection-maintenance/:itemId/resolve", async (req, res) => {
    const parsed = z.object({ resolutionNotes: z.string().trim().min(1).max(12000) }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Resolution notes are required." }); return; }
    await service.resolveMaintenanceItem(param(req.params.itemId), parsed.data, "owner");
    res.json({ ok: true });
  });
  return router;
}

export default createAdminYearEndInspectionsRouter({
  pieces: new DrizzlePieceRepository(db),
  service: new YearEndInspectionService(db),
  photoService: new YearEndInspectionPhotoService(db, new GoogleCloudLegManagerObjectStorage()),
});
