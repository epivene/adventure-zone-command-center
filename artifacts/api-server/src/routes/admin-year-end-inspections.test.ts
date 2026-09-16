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
});
