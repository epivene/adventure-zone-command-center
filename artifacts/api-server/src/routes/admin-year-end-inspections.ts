import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { db } from "@workspace/db";

import { pieceInputSchema, piecePatchSchema } from "@/features/year-end-inspections/piece-input";
import { DrizzlePieceRepository } from "@/features/year-end-inspections/piece-repository";
import { YearEndInspectionService } from "@/features/year-end-inspections/inspection-service";
import { YearEndInspectionPhotoService } from "@/features/year-end-inspections/photo-service";
import { GoogleCloudLegManagerObjectStorage } from "@/features/leg-manager/leg-manager-object-storage";
import { requireOwnerMiddleware } from "@/lib/auth";

const uuid = z.string().uuid();
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
  router.post("/manager-admin/year-end-inspections/:inspectionId/reopen", async (req, res) => {
    res.json({ inspection: await service.reopen(param(req.params.inspectionId), "owner") });
  });
  router.post("/manager-admin/year-end-inspections/:inspectionId/reset", requireOwner, async (req, res) => {
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
