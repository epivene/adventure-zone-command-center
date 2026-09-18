import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/test"; });

import { createAdminYearEndInspectionsRouter } from "./admin-year-end-inspections";

describe("admin year-end inspection routes", () => {
  it("transfers a piece and returns the persisted record", async () => {
    const piece = { id: "10000000-0000-4000-8000-000000000001", currentLegId: "20000000-0000-4000-8000-000000000001" };
    const pieces = { transferLeg: vi.fn(async () => piece) };
    const app = express();
    app.use(express.json());
    app.use(createAdminYearEndInspectionsRouter({
      pieces: pieces as never,
      service: {} as never,
      requireOwner: (_req, _res, next) => next(),
    }));
    const response = await request(app)
      .post(`/manager-admin/equipment-pieces/${piece.id}/transfer`)
      .send({ legId: piece.currentLegId })
      .expect(200);
    expect(response.body.piece).toEqual(piece);
    expect(pieces.transferLeg).toHaveBeenCalledWith(piece.id, piece.currentLegId, "owner");
  });

  it("deletes inspection photos before fully resetting a selected inspection", async () => {
    const inspectionId = "10000000-0000-4000-8000-000000000001";
    const calls: string[] = [];
    const service = {
      get: vi.fn(async () => ({ id: inspectionId, inspectionYear: 2026, managerIdentitySnapshot: "manager:Kristy" })),
      resetForAdmin: vi.fn(async () => { calls.push("reset"); return { deletedPieces: 2 }; }),
    };
    const photoService = {
      deleteForInspection: vi.fn(async () => { calls.push("photos"); return { deletedPhotos: 3 }; }),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminYearEndInspectionsRouter({
      pieces: {} as never,
      service: service as never,
      photoService: photoService as never,
      requireOwner: (_req, _res, next) => next(),
    }));

    const response = await request(app)
      .post(`/manager-admin/year-end-inspections/${inspectionId}/reset`)
      .send({ deleteDiscoveredPieces: true })
      .expect(200);

    expect(calls).toEqual(["photos", "reset"]);
    expect(response.body).toEqual({ ok: true, deletedPhotos: 3, deletedPieces: 2 });
  });

  it("rejects an unauthenticated full reset", async () => {
    const app = express();
    app.use(express.json());
    app.use(createAdminYearEndInspectionsRouter({
      pieces: {} as never,
      service: { get: vi.fn() } as never,
      photoService: { deleteForInspection: vi.fn() } as never,
    }));

    await request(app)
      .post("/manager-admin/year-end-inspections/10000000-0000-4000-8000-000000000001/reset")
      .send({ deleteDiscoveredPieces: true })
      .expect(401);
  });

  it("allows an admin to edit any inspection entry", async () => {
    const inspectionId = "10000000-0000-4000-8000-000000000001";
    const entryId = "20000000-0000-4000-8000-000000000001";
    const patch = { pieceCodeSnapshot: "BC-002", pieceNameSnapshot: "Balloon Castle" };
    const service = {
      patchEntryForAdmin: vi.fn(async () => ({ id: entryId, ...patch })),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminYearEndInspectionsRouter({
      pieces: {} as never,
      service: service as never,
      requireOwner: (_req, _res, next) => next(),
    }));

    const response = await request(app)
      .patch(`/manager-admin/year-end-inspections/${inspectionId}/entries/${entryId}`)
      .send(patch)
      .expect(200);

    expect(response.body.entry).toMatchObject(patch);
    expect(service.patchEntryForAdmin).toHaveBeenCalledWith(inspectionId, entryId, patch, "owner");
  });

  it("allows an admin to create and describe inspection photos", async () => {
    const inspectionId = "10000000-0000-4000-8000-000000000001";
    const photoId = "30000000-0000-4000-8000-000000000001";
    const entryId = "20000000-0000-4000-8000-000000000001";
    const service = { get: vi.fn(async () => ({ id: inspectionId, legId: "40000000-0000-4000-8000-000000000001", entries: [{ id: entryId }] })) };
    const photoService = {
      createMetadata: vi.fn(async (input) => input),
      patchDescriptionAndAnnotations: vi.fn(async (_id, _legId, input) => ({ id: photoId, ...input })),
      putImage: vi.fn(async () => undefined),
      deletePhoto: vi.fn(async () => true),
    };
    const app = express();
    app.use(express.json());
    app.use(createAdminYearEndInspectionsRouter({
      pieces: {} as never,
      service: service as never,
      photoService: photoService as never,
      requireOwner: (_req, _res, next) => next(),
    }));

    await request(app)
      .post(`/manager-admin/year-end-inspections/${inspectionId}/photos`)
      .send({
        id: photoId,
        clientMutationId: "50000000-0000-4000-8000-000000000001",
        entryId,
        mimeType: "image/jpeg",
        description: "Entrance seam",
        annotations: { version: 1, ellipses: [] },
      })
      .expect(201);

    const response = await request(app)
      .patch(`/manager-admin/year-end-inspections/${inspectionId}/photos/${photoId}`)
      .send({ description: "Worn entrance seam", annotations: { version: 1, ellipses: [] } })
      .expect(200);

    expect(response.body.photo).toMatchObject({ id: photoId, description: "Worn entrance seam" });

    await request(app)
      .put(`/manager-admin/year-end-inspections/${inspectionId}/photos/${photoId}/image`)
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from("photo"))
      .expect(200);
    expect(photoService.putImage).toHaveBeenCalledWith(
      photoId,
      "40000000-0000-4000-8000-000000000001",
      expect.any(Uint8Array),
      "image/jpeg",
    );

    await request(app)
      .delete(`/manager-admin/year-end-inspections/${inspectionId}/photos/${photoId}`)
      .expect(200);
    expect(photoService.deletePhoto).toHaveBeenCalledWith(photoId, "40000000-0000-4000-8000-000000000001");
  });

  it("protects admin inspection edits and photos with owner authentication", async () => {
    const app = express();
    app.use(express.json());
    app.use(createAdminYearEndInspectionsRouter({
      pieces: {} as never,
      service: { get: vi.fn() } as never,
      photoService: {} as never,
    }));

    await request(app)
      .patch("/manager-admin/year-end-inspections/10000000-0000-4000-8000-000000000001/entries/20000000-0000-4000-8000-000000000001")
      .send({ pieceNameSnapshot: "Blocked edit" })
      .expect(401);
    await request(app)
      .post("/manager-admin/year-end-inspections/10000000-0000-4000-8000-000000000001/photos")
      .send({})
      .expect(401);
  });
});
