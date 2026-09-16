import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => { process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/test"; });

import { createManagerYearEndInspectionsRouter } from "./manager-year-end-inspections";

const legId = "10000000-0000-4000-8000-000000000001";
const otherLegId = "10000000-0000-4000-8000-000000000002";
const inspectionId = "20000000-0000-4000-8000-000000000001";

function appFor(service: Record<string, any>) {
  const app = express();
  app.use(express.json());
  app.use(createManagerYearEndInspectionsRouter({
    requireManager(req, _res, next) {
      req.legManager = { legId, managerName: "Leg One" };
      next();
    },
    service: service as never,
    photoService: {} as never,
  }));
  return app;
}

describe("manager year-end inspection routes", () => {
  it("returns 404 instead of exposing another leg's inspection", async () => {
    const service = { get: vi.fn(async () => ({ id: inspectionId, legId: otherLegId })) };
    await request(appFor(service)).get(`/manager/year-end-inspections/${inspectionId}`).expect(404);
  });

  it("returns the existing inspection when an offline start mutation is retried", async () => {
    const inspection = { id: inspectionId, legId, status: "in_progress", entries: [] };
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
});
