import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/test"; });

import { createManagerYearEndInspectionsRouter } from "./manager-year-end-inspections";

const legId = "10000000-0000-4000-8000-000000000001";
const otherLegId = "10000000-0000-4000-8000-000000000002";
const inspectionId = "20000000-0000-4000-8000-000000000001";

function appFor(service: Record<string, any>, photoService: Record<string, any> = {}) {
  const app = express();
  app.use(express.json());
  app.use(createManagerYearEndInspectionsRouter({
    requireManager(req, _res, next) {
      req.legManager = { legId, managerName: "Leg One" };
      next();
    },
    service: service as never,
    photoService: photoService as never,
  }));
  return app;
}

describe("manager year-end inspection routes", () => {
  it("returns 404 instead of exposing another leg's inspection", async () => {
    const service = { get: vi.fn(async () => ({ id: inspectionId, legId: otherLegId })) };
    await request(appFor(service)).get(`/manager/year-end-inspections/${inspectionId}`).expect(404);
  });

  it("returns uploaded photos with signed URLs when a manager reloads an inspection", async () => {
    const inspection = {
      id: inspectionId,
      legId,
      entries: [{ id: "30000000-0000-4000-8000-000000000001" }],
    };
    const service = { get: vi.fn(async () => inspection) };
    const photoService = {
      listWithSignedUrls: vi.fn(async () => [{
        id: "40000000-0000-4000-8000-000000000001",
        description: "Worn seam",
        annotations: { version: 1, ellipses: [] },
        imageUrl: "https://signed.example/year-end/photo",
      }]),
    };

    const response = await request(appFor(service, photoService))
      .get(`/manager/year-end-inspections/${inspectionId}`)
      .expect(200);

    expect(response.body.inspection.entries[0].photos).toEqual([{
      id: "40000000-0000-4000-8000-000000000001",
      description: "Worn seam",
      annotations: { version: 1, ellipses: [] },
      signedUrl: "https://signed.example/year-end/photo",
    }]);
    expect(photoService.listWithSignedUrls).toHaveBeenCalledWith(
      "30000000-0000-4000-8000-000000000001",
      legId,
    );
  });

  it("returns the existing inspection when an offline start mutation is retried", async () => {
    const inspection = { id: inspectionId, legId, inspectionYear: 2026, status: "in_progress", entries: [] };
    const service = {
      findByMutation: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(inspection),
      startForCurrentPieces: vi.fn(async () => inspection),
    };
    const body = { year: 2026, source: "current_pieces", clientMutationId: "30000000-0000-4000-8000-000000000001" };
    const app = appFor(service);
    await request(app).post("/manager/year-end-inspections").send(body).expect(201);
    const retry = await request(app).post("/manager/year-end-inspections").send(body).expect(200);
    expect(retry.body.inspection.id).toBe(inspectionId);
    expect(service.startForCurrentPieces).toHaveBeenCalledOnce();
  });

  it("does not expose another leg's inspection when a start mutation id is reused", async () => {
    const service = {
      findByMutation: vi.fn(async () => ({ id: inspectionId, legId: otherLegId, inspectionYear: 2026, entries: [] })),
      startForCurrentPieces: vi.fn(),
    };
    await request(appFor(service))
      .post("/manager/year-end-inspections")
      .send({ year: 2026, source: "current_pieces", clientMutationId: "30000000-0000-4000-8000-000000000009" })
      .expect(409);
    expect(service.startForCurrentPieces).not.toHaveBeenCalled();
  });

  it("creates a discovered piece directly on the signed-in manager's leg", async () => {
    const inspection = { id: inspectionId, legId, status: "in_progress", entries: [{ id: "entry-1" }] };
    const service = {
      createDiscoveredPieceForLeg: vi.fn(async () => inspection),
    };
    const body = {
      pieceId: "40000000-0000-4000-8000-000000000001",
      entryId: "50000000-0000-4000-8000-000000000001",
      clientMutationId: "60000000-0000-4000-8000-000000000001",
      code: null,
      name: "Blue slide section",
      identityNotes: "Rolled beside the generator",
      resourceId: null,
      newResource: {
        id: "70000000-0000-4000-8000-000000000001",
        name: "Blue slide section",
      },
    };

    const response = await request(appFor(service))
      .post(`/manager/year-end-inspections/${inspectionId}/discovered-pieces`)
      .send(body)
      .expect(201);

    expect(response.body.inspection.entries).toHaveLength(1);
    expect(service.createDiscoveredPieceForLeg).toHaveBeenCalledWith(
      inspectionId,
      legId,
      body,
      "manager:Leg One",
    );
  });

  it.each([
    [new Error("PIECE_RESOURCE_UNAVAILABLE"), "moved attraction"],
    [Object.assign(new Error("duplicate code"), { code: "23505" }), "duplicate attraction code"],
  ])("returns a queue-resolvable conflict for a discovered piece with a %s", async (failure) => {
    const service = {
      createDiscoveredPieceForLeg: vi.fn(async () => { throw failure; }),
    };
    await request(appFor(service))
      .post(`/manager/year-end-inspections/${inspectionId}/discovered-pieces`)
      .send({
        pieceId: "40000000-0000-4000-8000-000000000001",
        entryId: "50000000-0000-4000-8000-000000000001",
        clientMutationId: "60000000-0000-4000-8000-000000000001",
        code: "BLUE-1",
        name: "Blue slide",
        identityNotes: null,
        resourceId: "70000000-0000-4000-8000-000000000001",
        newResource: null,
      })
      .expect(409);
  });

  it("lets the signed-in leg manager reopen a completed inspection", async () => {
    const inspection = { id: inspectionId, legId, status: "completed", entries: [] };
    const reopened = { ...inspection, status: "in_progress" };
    const service = {
      get: vi.fn(async () => inspection),
      reopen: vi.fn(async () => reopened),
    };
    const photoService = { listWithSignedUrls: vi.fn(async () => []) };

    const response = await request(appFor(service, photoService))
      .post(`/manager/year-end-inspections/${inspectionId}/reopen`)
      .send({})
      .expect(200);

    expect(response.body.inspection.status).toBe("in_progress");
    expect(service.reopen).toHaveBeenCalledWith(inspectionId, "manager:Leg One");
  });

  it("removes an accidental discovered piece and its stored photos", async () => {
    const entryId = "50000000-0000-4000-8000-000000000001";
    const inspection = { id: inspectionId, legId, status: "in_progress", entries: [] };
    const service = {
      get: vi.fn(async () => ({ id: inspectionId, legId, entries: [{ id: entryId }] })),
      canRemoveDiscoveredPieceForLeg: vi.fn(async () => true),
      removeDiscoveredPieceForLeg: vi.fn(async () => inspection),
    };
    const photoService = { deleteForEntry: vi.fn(async () => ({ deletedPhotos: 1 })) };

    const response = await request(appFor(service, photoService))
      .delete(`/manager/year-end-inspections/${inspectionId}/discovered-pieces/${entryId}`)
      .expect(200);

    expect(response.body).toEqual({ inspection, deletedPhotos: 1 });
    expect(service.canRemoveDiscoveredPieceForLeg).toHaveBeenCalledWith(
      inspectionId,
      entryId,
      legId,
      "manager:Leg One",
    );
    expect(photoService.deleteForEntry).toHaveBeenCalledWith(entryId, legId);
    expect(service.removeDiscoveredPieceForLeg).toHaveBeenCalledWith(
      inspectionId,
      entryId,
      legId,
      "manager:Leg One",
    );
  });

  it("allows the signed-in leg manager to correct the attraction identity", async () => {
    const entryId = "30000000-0000-4000-8000-000000000001";
    const service = {
      patchEntryForLeg: vi.fn(async () => ({
        id: entryId,
        pieceCodeSnapshot: "WW-001",
        pieceNameSnapshot: "Warrior Wall",
        inspectionNotes: "Identity corrected during inspection",
      })),
    };
    const patch = {
      pieceCodeSnapshot: "WW-001",
      pieceNameSnapshot: "Warrior Wall",
      inspectionNotes: "Identity corrected during inspection",
    };

    const response = await request(appFor(service))
      .patch(`/manager/year-end-inspections/${inspectionId}/entries/${entryId}`)
      .send(patch)
      .expect(200);

    expect(response.body.entry).toMatchObject(patch);
    expect(service.patchEntryForLeg).toHaveBeenCalledWith(
      inspectionId,
      entryId,
      legId,
      patch,
      "manager:Leg One",
    );
  });

  it("requires reopening before manager entry or photo edits", async () => {
    const entryId = "30000000-0000-4000-8000-000000000001";
    const photoId = "40000000-0000-4000-8000-000000000001";
    const completedError = Object.assign(new Error("Reopen the inspection before making changes."), { code: "inspection_completed" });
    const service = {
      get: vi.fn(async () => ({ id: inspectionId, legId, status: "completed", entries: [{ id: entryId }] })),
      patchEntryForLeg: vi.fn(async () => { throw completedError; }),
    };
    const photoService = {
      belongsToInspection: vi.fn(async () => true),
      patchDescriptionAndAnnotations: vi.fn(),
    };
    const app = appFor(service, photoService);

    await request(app)
      .patch(`/manager/year-end-inspections/${inspectionId}/entries/${entryId}`)
      .send({ pieceNameSnapshot: "Blocked" })
      .expect(409);
    await request(app)
      .patch(`/manager/year-end-inspections/${inspectionId}/photos/${photoId}`)
      .send({ description: "Blocked", annotations: { version: 1, ellipses: [] } })
      .expect(409);
    expect(photoService.patchDescriptionAndAnnotations).not.toHaveBeenCalled();
  });

  it("does not upload a photo through a different inspection id", async () => {
    const photoId = "40000000-0000-4000-8000-000000000002";
    const service = { get: vi.fn(async () => ({ id: inspectionId, legId, status: "in_progress", entries: [] })) };
    const photoService = {
      belongsToInspection: vi.fn(async () => false),
      putImage: vi.fn(),
    };
    await request(appFor(service, photoService))
      .put(`/manager/year-end-inspections/${inspectionId}/photos/${photoId}/image`)
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from("photo"))
      .expect(404);
    expect(photoService.putImage).not.toHaveBeenCalled();
  });

  it("treats a lost-response retry as success without replacing saved evidence", async () => {
    const photoId = "40000000-0000-4000-8000-000000000003";
    const service = { get: vi.fn(async () => ({ id: inspectionId, legId, status: "completed", entries: [] })) };
    const photoService = {
      belongsToInspection: vi.fn(async () => true),
      putImage: vi.fn()
        .mockResolvedValueOnce({ alreadyUploaded: false })
        .mockResolvedValueOnce({ alreadyUploaded: true }),
    };
    const app = appFor(service, photoService);

    await request(app)
      .put(`/manager/year-end-inspections/${inspectionId}/photos/${photoId}/image`)
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from("pending photo"))
      .expect(200);
    await request(app)
      .put(`/manager/year-end-inspections/${inspectionId}/photos/${photoId}/image`)
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from("replacement"))
      .expect(200)
      .expect({ ok: true, alreadyUploaded: true });
    expect(photoService.putImage).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed photo annotations as a client error", async () => {
    await request(appFor({}, { createMetadata: vi.fn() }))
      .post(`/manager/year-end-inspections/${inspectionId}/photos`)
      .send({
        id: "40000000-0000-4000-8000-000000000001",
        clientMutationId: "50000000-0000-4000-8000-000000000001",
        entryId: "30000000-0000-4000-8000-000000000001",
        mimeType: "image/jpeg",
        description: "Bad circle",
        annotations: { version: 1, ellipses: [{ id: "circle", x: 2 }] },
      })
      .expect(400);
  });
});
