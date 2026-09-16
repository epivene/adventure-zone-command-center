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
    app.use(createAdminYearEndInspectionsRouter({ pieces: pieces as never, service: {} as never }));
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
});
